import { HttpError } from './input.mjs';

const DATA = '/session/data/postgresql';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class Guacamole {
  constructor({ baseUrl, adminPassword, adminUser = 'guacadmin' }) {
    const parsed = new URL(baseUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid Guacamole base URL');
    this.baseUrl = baseUrl.replace(/\/$/u, '');
    this.adminPassword = adminPassword; this.adminUser = adminUser;
    this.tokens = new Map();
  }
  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
    } catch { throw new HttpError(502, '远程桌面网关暂时不可用'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status === 403 ? 403 : 502, response.status === 403 ? '没有远程桌面网关访问权限' : '远程桌面网关操作失败');
    }
    if (response.status === 204) return undefined;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { await response.body.cancel(); throw new Error('Response too large'); }
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new HttpError(502, '远程桌面网关响应无效'); }
  }
  async token(owner) {
    const key = owner ?? Symbol.for('admin'), cached = this.tokens.get(key);
    if (cached && cached.expires > Date.now()) return cached.token;
    const passwordLogin = owner === undefined && this.adminPassword !== undefined;
    const body = passwordLogin ? new URLSearchParams({ username: this.adminUser, password: this.adminPassword }) : new URLSearchParams();
    const reply = await this.request('/tokens', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(passwordLogin ? {} : { 'X-DSH-User': owner ?? this.adminUser }) }, body });
    if (!object(reply) || typeof reply.authToken !== 'string' || !reply.authToken || !Array.isArray(reply.availableDataSources) || !reply.availableDataSources.includes('postgresql')) throw new HttpError(502, '远程桌面网关认证响应无效');
    if (this.tokens.size > 256) this.tokens.clear();
    this.tokens.set(key, { token: reply.authToken, expires: Date.now() + 60000 });
    return reply.authToken;
  }
  async call(owner, path, options = {}) {
    const token = await this.token(owner);
    return this.request(`${DATA}${path}`, { ...options, headers: { 'Guacamole-Token': token, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) } });
  }
  async authorized(owner) {
    const reply = await this.call(owner, '/connections?permission=READ');
    if (!object(reply)) throw new HttpError(502, '远程桌面网关机器列表无效');
    return Object.entries(reply).filter(([, value]) => object(value) && value.protocol === 'rdp').map(([id, value]) => ({ id, name: typeof value.name === 'string' ? value.name : id }));
  }
  async parameters(id) {
    const reply = await this.call(undefined, `/connections/${encodeURIComponent(id)}/parameters`);
    if (!object(reply)) throw new HttpError(502, '远程桌面网关机器参数无效');
    // Select only non-secret metadata. Passwords and trust configuration never leave this boundary.
    return { hostname: reply.hostname, port: reply.port, username: reply.username };
  }
  async active(owner) {
    const reply = await this.call(owner, '/activeConnections');
    if (!object(reply)) throw new HttpError(502, '远程桌面网关会话列表无效');
    return Object.values(reply).filter(value => object(value) && typeof value.identifier === 'string' && typeof value.connectionIdentifier === 'string' && typeof value.username === 'string' && typeof value.connectable === 'boolean');
  }
  async create(owner, machine) {
    const payload = { parentIdentifier: 'ROOT', name: machine.name, protocol: 'rdp', parameters: { hostname: machine.host, port: String(machine.port), username: machine.username, security: 'nla', 'resize-method': 'display-update', 'server-layout': 'en-us-qwerty', 'cert-tofu': 'true' }, attributes: {} };
    const reply = await this.call(undefined, '/connections', { method: 'POST', body: JSON.stringify(payload) });
    if (!object(reply) || typeof reply.identifier !== 'string' || !reply.identifier) throw new HttpError(502, '远程桌面网关创建响应无效');
    const id = reply.identifier;
    try {
      await this.call(undefined, `/users/${encodeURIComponent(owner)}/permissions`, { method: 'PATCH', body: JSON.stringify([{ op: 'add', path: `/connectionPermissions/${id.replace(/~/gu, '~0').replace(/\//gu, '~1')}`, value: 'READ' }]) });
    } catch (error) {
      try { await this.remove(id); }
      catch { throw new HttpError(502, '网关权限分配失败且清理失败，请联系管理员'); }
      throw error;
    }
    // Refresh the user's authentication context after its permissions changed.
    this.tokens.delete(owner);
    return id;
  }
  async remove(id) { await this.call(undefined, `/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}
