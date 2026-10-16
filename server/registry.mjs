import { randomUUID } from 'node:crypto';
import { HttpError, clientUrl } from './input.mjs';

export class Registry {
  constructor(domain, credentials) {
    this.domain = domain; this.credentials = credentials;
    this.machines = domain.table('machines'); this.history = domain.table('history');
    this.suppressions = domain.table('suppressed'); this.sessions = domain.table('sessions');
    this.ordinal = [...this.history.entries()].reduce((maximum, [, row]) => Math.max(maximum, row.ordinal), 0);
  }
  password(machine) { return this.credentials.decrypt(machine.encryptedPassword, `${machine.owner}\0${machine.id}`); }
  suppressed(owner, gatewayId) { return Boolean(this.suppressions.get(`${owner}\0${gatewayId}`)); }
  async suppress(owner, gatewayId) { await this.suppressions.put(`${owner}\0${gatewayId}`, { owner, gatewayId }); }
  list(owner) { return [...this.machines.entries()].map(([, row]) => row).filter(row => row.owner === owner).sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? '') || b.createdAt.localeCompare(a.createdAt)); }
  get(owner, id) { const row = this.machines.get(id); if (!row || row.owner !== owner) throw new HttpError(404, '机器不存在'); return row; }
  byGateway(owner, id) { return this.list(owner).find(row => row.gatewayId === id); }
  byTarget(owner, target) { return this.list(owner).find(row => row.host === target.host && row.port === target.port && row.username === target.username); }
  async save(owner, values, gateway) {
    const previous = gateway.id ? this.get(owner, gateway.id) : this.byTarget(owner, values), id = previous?.id ?? randomUUID();
    const sameTarget = previous && previous.host === values.host && previous.port === values.port && previous.username === values.username;
    let encryptedPassword = sameTarget ? previous.encryptedPassword : null;
    if (values.rememberPassword === false) encryptedPassword = null;
    if (values.rememberPassword === true && values.password !== undefined) encryptedPassword = this.credentials.encrypt(values.password, `${owner}\0${id}`);
    const row = { id, owner, name: values.name, username: values.username, address: values.address, host: values.host, port: values.port, gatewayId: gateway.gatewayId, owned: Boolean(gateway.owned), encryptedPassword, lastConnectedAt: previous?.lastConnectedAt ?? null, createdAt: previous?.createdAt ?? new Date().toISOString() };
    await this.machines.put(id, row); return row;
  }
  async remember(owner, id, credentials) {
    const row = this.get(owner, id); let encryptedPassword = row.encryptedPassword;
    if (credentials.rememberPassword === false) encryptedPassword = null;
    if (credentials.rememberPassword === true && credentials.password !== undefined) encryptedPassword = this.credentials.encrypt(credentials.password, `${owner}\0${id}`);
    const updated = { ...row, encryptedPassword }; await this.machines.put(id, updated); return updated;
  }
  async append(machine, event, detail) {
    const entry = { id: randomUUID(), owner: machine.owner, machineId: machine.id, machineName: machine.name, address: machine.address, username: machine.username, event, occurredAt: new Date().toISOString(), ordinal: ++this.ordinal, ...(detail ? { detail } : {}) };
    await this.history.put(entry.id, entry); return entry;
  }
  async connected(owner, id, sessionId) {
    const row = this.get(owner, id), key = `${owner}\0${sessionId}`;
    if (!this.sessions.get(key)) {
      await this.append(row, 'connected');
      await this.sessions.put(key, { owner, sessionId, machineId: id, gatewayId: row.gatewayId });
    }
    const updated = { ...row, lastConnectedAt: new Date().toISOString() }; await this.machines.put(id, updated); return updated;
  }
  ready(owner, machineId) { return [...this.sessions.entries()].map(([, row]) => row).filter(row => row.owner === owner && (machineId === undefined || row.machineId === machineId)); }
  async end(owner, machineId, event, sessionId, detail) {
    const row = this.get(owner, machineId), sessions = this.ready(owner, machineId).filter(session => sessionId !== undefined && session.sessionId === sessionId);
    if (event === 'disconnected' && sessionId !== undefined && sessions.length === 0) return;
    await this.append(row, event, detail);
  }
  async forget(owner, sessionId) { await this.sessions.delete(`${owner}\0${sessionId}`);
  }
  async delete(owner, id) { this.get(owner, id); await this.machines.delete(id); for (const session of this.ready(owner, id)) await this.sessions.delete(`${owner}\0${session.sessionId}`); }
  events(owner, { machineId, cursor }) {
    let rows = [...this.history.entries()].map(([, row]) => row).filter(row => row.owner === owner && (machineId === undefined || row.machineId === machineId)).sort((a, b) => b.ordinal - a.ordinal);
    if (cursor !== undefined) { const index = rows.findIndex(row => row.id === cursor); if (index < 0) throw new HttpError(400, '历史记录游标无效'); rows = rows.slice(index + 1); }
    const page = rows.slice(0, 100);
    return { events: page.map(({ owner: _owner, ordinal: _ordinal, ...event }) => event), ...(rows.length > 100 ? { nextCursor: page.at(-1).id } : {}) };
  }
  public(row) { return { id: row.id, name: row.name, username: row.username, address: row.address, gatewayId: row.gatewayId, lastConnectedAt: row.lastConnectedAt, hasSavedPassword: row.encryptedPassword !== null, url: clientUrl(row.gatewayId) }; }
}
