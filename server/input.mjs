import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function parseAddress(value) {
  if (typeof value !== 'string' || value.length > 300 || !value.trim() || /[\s/@?#\\%]/u.test(value)) throw new HttpError(400, '地址必须是主机名或 IP，可附加端口');
  let host, portText;
  if (value.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/u.exec(value);
    if (!match || isIP(match[1]) !== 6) throw new HttpError(400, 'IPv6 地址格式错误');
    host = match[1].toLowerCase(); portText = match[2];
  } else if (isIP(value) === 6) { host = value.toLowerCase(); }
  else {
    const parts = value.split(':');
    if (parts.length > 2) throw new HttpError(400, '地址格式错误');
    host = domainToASCII(parts[0]).toLowerCase(); portText = parts[1];
    if (!host || host.length > 253 || !host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part)) || (/^[\d.]+$/u.test(host) && isIP(host) !== 4)) throw new HttpError(400, '主机名或 IP 无效');
  }
  if (portText !== undefined && !/^\d{1,5}$/u.test(portText)) throw new HttpError(400, '端口无效');
  const port = portText === undefined ? 3389 : Number(portText);
  if (port < 1 || port > 65535) throw new HttpError(400, '端口必须在 1–65535 之间');
  if (isIP(host) === 6) host = new URL(`http://[${host}]`).hostname.slice(1, -1);
  const displayHost = isIP(host) === 6 ? `[${host}]` : host;
  return { host, port, address: port === 3389 ? displayHost : `${displayHost}:${port}` };
}
export function parseObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '请求内容必须是 JSON 对象');
  return value;
}
export function parseCredentials(value) {
  const body = parseObject(value);
  if (body.password !== undefined && (typeof body.password !== 'string' || body.password.length > 4096 || body.password.includes('\0'))) throw new HttpError(400, '密码格式无效');
  if (body.rememberPassword !== undefined && typeof body.rememberPassword !== 'boolean') throw new HttpError(400, '记住密码必须是布尔值');
  return { password: body.password, rememberPassword: body.rememberPassword };
}
export function parseMachine(value) {
  const body = parseObject(value);
  for (const field of ['name', 'username']) {
    if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 200 || /[\x00-\x1f\x7f]/u.test(body[field])) throw new HttpError(400, '机器名称和登录名不能为空或过长');
  }
  return { name: body.name.trim(), username: body.username.trim(), ...parseAddress(body.address), ...parseCredentials(body) };
}
export function parseOwner(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f\x7f]/u.test(value)) throw new HttpError(401, '请先登录');
  return value;
}
export function clientUrl(id, type = 'c') {
  return `/guacamole/#/client/${Buffer.from(`${id}\0${type}\0postgresql`).toString('base64url')}`;
}
