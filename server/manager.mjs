import { HttpError, parseAddress, parseMachine, clientUrl } from './input.mjs';

export class Manager {
  constructor(registry, guac) { this.registry = registry; this.guac = guac; this.pending = Promise.resolve(); }
  exclusive(action) { const result = this.pending.then(action); this.pending = result.catch(() => {}); return result; }
  async reconcile(owner) {
    const ready = this.registry.ready(owner);
    if (ready.length === 0) return;
    const active = await this.guac.active(owner);
    for (const session of ready) {
      if (!active.some(connection => connection.identifier === session.sessionId && connection.username === owner && connection.connectionIdentifier === session.gatewayId)) {
        await this.registry.end(owner, session.machineId, 'disconnected', session.sessionId, '网关会话已结束');
        await this.registry.forget(owner, session.sessionId);
      }
    }
  }
  async list(owner) {
    try { return await this.importList(owner); }
    catch (error) {
      if (!(error instanceof HttpError) || error.status !== 502) throw error;
      return { machines: this.registry.list(owner).map(row => this.registry.public(row)), warning: '网关暂时不可用，显示 DSH 已保存的机器' };
    }
  }
  async importList(owner) {
    await this.reconcile(owner);
    for (const connection of await this.guac.authorized(owner)) {
      if (this.registry.byGateway(owner, connection.id) || this.registry.suppressed(owner, connection.id)) continue;
      const parameters = await this.guac.parameters(connection.id);
      let values;
      try {
        const host = typeof parameters.hostname === 'string' && parameters.hostname.includes(':') ? `[${parameters.hostname}]` : parameters.hostname;
        values = parseMachine({ name: connection.name, username: parameters.username, address: `${host}${parameters.port ? `:${parameters.port}` : ''}` });
      } catch (error) { if (error instanceof HttpError && error.status === 400) continue; throw error; }
      if (!this.registry.byTarget(owner, values)) await this.registry.save(owner, values, { gatewayId: connection.id, owned: false });
    }
    return { machines: this.registry.list(owner).map(row => this.registry.public(row)) };
  }
  async authorizedTarget(owner, row) {
    if (!(await this.guac.authorized(owner)).some(connection => connection.id === row.gatewayId)) throw new HttpError(403, '没有此机器的网关访问权限');
    const parameters = await this.guac.parameters(row.gatewayId);
    let target;
    try {
      const host = typeof parameters.hostname === 'string' && parameters.hostname.includes(':') ? `[${parameters.hostname}]` : parameters.hostname;
      target = parseAddress(`${host}${parameters.port ? `:${parameters.port}` : ''}`);
    } catch { throw new HttpError(502, '网关机器目标配置无效'); }
    return row.host === target.host && row.port === target.port && row.username === parameters.username;
  }
  async save(owner, values, id) {
    const previous = id ? this.registry.get(owner, id) : this.registry.byTarget(owner, values), duplicate = this.registry.byTarget(owner, values);
    if (id && duplicate && duplicate.id !== id) throw new HttpError(400, '该机器地址和登录名已存在');
    const sameTarget = previous && previous.host === values.host && previous.port === values.port && previous.username === values.username;
    if (sameTarget && await this.authorizedTarget(owner, previous)) return this.registry.public(await this.registry.save(owner, values, { id: previous.id, gatewayId: previous.gatewayId, owned: previous.owned }));
    const gatewayId = await this.guac.create(owner, values);
    let saved;
    try { saved = await this.registry.save(owner, values, { ...(previous ? { id: previous.id } : {}), gatewayId, owned: true }); }
    catch (error) { await this.guac.remove(gatewayId); throw error; }
    if (previous?.owned) await this.guac.remove(previous.gatewayId);
    if (previous && !previous.owned) await this.registry.suppress(owner, previous.gatewayId);
    return this.registry.public(saved);
  }
  async connect(owner, id, credentials) {
    const row = this.registry.get(owner, id);
    await this.registry.append(row, 'attempt');
    try {
      if (!await this.authorizedTarget(owner, row)) throw new HttpError(400, '网关机器目标已变更，请编辑配置并重新保存');
      const ready = this.registry.ready(owner, id);
      const active = (await this.guac.active(owner)).find(connection => connection.connectable && connection.connectionIdentifier === row.gatewayId && connection.username === owner && ready.some(session => session.sessionId === connection.identifier));
      const updated = await this.registry.remember(owner, id, credentials);
      if (active) return { url: clientUrl(active.identifier, 'a'), reused: true };
      let password;
      try { password = credentials.password ?? this.registry.password(updated); }
      catch { throw new HttpError(502, '保存的密码无法解密，请重新输入'); }
      return { url: clientUrl(row.gatewayId), ...(password === undefined ? {} : { password }), reused: false };
    } catch (error) { await this.registry.append(row, 'failed', '连接请求未完成'); throw error; }
  }
  async connected(owner, id, sessionId) {
    const row = this.registry.get(owner, id);
    if (!(await this.guac.active(owner)).some(connection => connection.identifier === sessionId && connection.username === owner && connection.connectionIdentifier === row.gatewayId)) throw new HttpError(400, '远程桌面会话尚未就绪');
    return this.registry.public(await this.registry.connected(owner, id, sessionId));
  }
  async event(owner, id, terminal) {
    await this.registry.end(owner, id, terminal.event, terminal.sessionId, terminal.detail);
    if (terminal.sessionId === undefined) return;
    const session = this.registry.ready(owner, id).find(value => value.sessionId === terminal.sessionId);
    if (!session) return;
    let active;
    try { active = await this.guac.active(owner); }
    catch (error) { if (error instanceof HttpError && error.status === 502) return; throw error; }
    if (!active.some(connection => connection.identifier === session.sessionId && connection.username === owner && connection.connectionIdentifier === session.gatewayId)) await this.registry.forget(owner, session.sessionId);
  }
  async history(owner, query) {
    try { await this.reconcile(owner); }
    catch (error) { if (!(error instanceof HttpError) || error.status !== 502) throw error; }
    return this.registry.events(owner, query);
  }
  async delete(owner, id) {
    const row = this.registry.get(owner, id);
    if (row.owned) await this.guac.remove(row.gatewayId);
    if (this.registry.ready(owner, id).length > 0) await this.registry.end(owner, id, 'disconnected', undefined, '机器配置已删除');
    await this.registry.suppress(owner, row.gatewayId); await this.registry.delete(owner, id);
  }
}
