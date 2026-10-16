// src/index.ts
import schema from "@deepseek-ai/schemastery";

// server/native.mjs
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { z } from "zod";
import { homedir } from "node:os";
import { resolve as resolve2, join } from "node:path";

// server/credentials.mjs
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
var Credentials = class {
  constructor(keyFile) {
    const file = resolve(keyFile), directory = dirname(file);
    mkdirSync(directory, { recursive: true, mode: 448 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error("Private key directory must not be a symlink");
    chmodSync(directory, 448);
    if (!existsSync(file)) writeFileSync(file, randomBytes(32), { flag: "wx", mode: 384 });
    if (lstatSync(file).isSymbolicLink()) throw new Error("Private key must not be a symlink");
    chmodSync(file, 384);
    this.key = readFileSync(file);
    if (this.key.length !== 32) throw new Error("Private key must contain 32 bytes");
  }
  close() {
    this.key.fill(0);
  }
  encrypt(password, identity) {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(identity));
    const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  decrypt(encrypted, identity) {
    if (encrypted === null) return void 0;
    const bytes = Buffer.from(encrypted, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  }
};

// server/registry.mjs
import { randomUUID } from "node:crypto";

// server/input.mjs
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function parseAddress(value) {
  if (typeof value !== "string" || value.length > 300 || !value.trim() || /[\s/@?#\\%]/u.test(value)) throw new HttpError(400, "\u5730\u5740\u5FC5\u987B\u662F\u4E3B\u673A\u540D\u6216 IP\uFF0C\u53EF\u9644\u52A0\u7AEF\u53E3");
  let host, portText;
  if (value.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/u.exec(value);
    if (!match || isIP(match[1]) !== 6) throw new HttpError(400, "IPv6 \u5730\u5740\u683C\u5F0F\u9519\u8BEF");
    host = match[1].toLowerCase();
    portText = match[2];
  } else if (isIP(value) === 6) {
    host = value.toLowerCase();
  } else {
    const parts = value.split(":");
    if (parts.length > 2) throw new HttpError(400, "\u5730\u5740\u683C\u5F0F\u9519\u8BEF");
    host = domainToASCII(parts[0]).toLowerCase();
    portText = parts[1];
    if (!host || host.length > 253 || !host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(part)) || /^[\d.]+$/u.test(host) && isIP(host) !== 4) throw new HttpError(400, "\u4E3B\u673A\u540D\u6216 IP \u65E0\u6548");
  }
  if (portText !== void 0 && !/^\d{1,5}$/u.test(portText)) throw new HttpError(400, "\u7AEF\u53E3\u65E0\u6548");
  const port = portText === void 0 ? 3389 : Number(portText);
  if (port < 1 || port > 65535) throw new HttpError(400, "\u7AEF\u53E3\u5FC5\u987B\u5728 1\u201365535 \u4E4B\u95F4");
  if (isIP(host) === 6) host = new URL(`http://[${host}]`).hostname.slice(1, -1);
  const displayHost = isIP(host) === 6 ? `[${host}]` : host;
  return { host, port, address: port === 3389 ? displayHost : `${displayHost}:${port}` };
}
function parseObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "\u8BF7\u6C42\u5185\u5BB9\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
  return value;
}
function parseCredentials(value) {
  const body = parseObject(value);
  if (body.password !== void 0 && (typeof body.password !== "string" || body.password.length > 4096 || body.password.includes("\0"))) throw new HttpError(400, "\u5BC6\u7801\u683C\u5F0F\u65E0\u6548");
  if (body.rememberPassword !== void 0 && typeof body.rememberPassword !== "boolean") throw new HttpError(400, "\u8BB0\u4F4F\u5BC6\u7801\u5FC5\u987B\u662F\u5E03\u5C14\u503C");
  return { password: body.password, rememberPassword: body.rememberPassword };
}
function parseMachine(value) {
  const body = parseObject(value);
  for (const field of ["name", "username"]) {
    if (typeof body[field] !== "string" || !body[field].trim() || body[field].length > 200 || /[\x00-\x1f\x7f]/u.test(body[field])) throw new HttpError(400, "\u673A\u5668\u540D\u79F0\u548C\u767B\u5F55\u540D\u4E0D\u80FD\u4E3A\u7A7A\u6216\u8FC7\u957F");
  }
  return { name: body.name.trim(), username: body.username.trim(), ...parseAddress(body.address), ...parseCredentials(body) };
}
function clientUrl(id, type = "c") {
  return `/guacamole/#/client/${Buffer.from(`${id}\0${type}\0postgresql`).toString("base64url")}`;
}

// server/registry.mjs
var Registry = class {
  constructor(domain, credentials) {
    this.domain = domain;
    this.credentials = credentials;
    this.machines = domain.table("machines");
    this.history = domain.table("history");
    this.suppressions = domain.table("suppressed");
    this.sessions = domain.table("sessions");
    this.ordinal = [...this.history.entries()].reduce((maximum, [, row]) => Math.max(maximum, row.ordinal), 0);
  }
  password(machine) {
    return this.credentials.decrypt(machine.encryptedPassword, `${machine.owner}\0${machine.id}`);
  }
  suppressed(owner, gatewayId) {
    return Boolean(this.suppressions.get(`${owner}\0${gatewayId}`));
  }
  async suppress(owner, gatewayId) {
    await this.suppressions.put(`${owner}\0${gatewayId}`, { owner, gatewayId });
  }
  list(owner) {
    return [...this.machines.entries()].map(([, row]) => row).filter((row) => row.owner === owner).sort((a, b) => (b.lastConnectedAt ?? "").localeCompare(a.lastConnectedAt ?? "") || b.createdAt.localeCompare(a.createdAt));
  }
  get(owner, id) {
    const row = this.machines.get(id);
    if (!row || row.owner !== owner) throw new HttpError(404, "\u673A\u5668\u4E0D\u5B58\u5728");
    return row;
  }
  byGateway(owner, id) {
    return this.list(owner).find((row) => row.gatewayId === id);
  }
  byTarget(owner, target) {
    return this.list(owner).find((row) => row.host === target.host && row.port === target.port && row.username === target.username);
  }
  async save(owner, values, gateway) {
    const previous = gateway.id ? this.get(owner, gateway.id) : this.byTarget(owner, values), id = previous?.id ?? randomUUID();
    const sameTarget = previous && previous.host === values.host && previous.port === values.port && previous.username === values.username;
    let encryptedPassword = sameTarget ? previous.encryptedPassword : null;
    if (values.rememberPassword === false) encryptedPassword = null;
    if (values.rememberPassword === true && values.password !== void 0) encryptedPassword = this.credentials.encrypt(values.password, `${owner}\0${id}`);
    const row = { id, owner, name: values.name, username: values.username, address: values.address, host: values.host, port: values.port, gatewayId: gateway.gatewayId, owned: Boolean(gateway.owned), encryptedPassword, lastConnectedAt: previous?.lastConnectedAt ?? null, createdAt: previous?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString() };
    await this.machines.put(id, row);
    return row;
  }
  async remember(owner, id, credentials) {
    const row = this.get(owner, id);
    let encryptedPassword = row.encryptedPassword;
    if (credentials.rememberPassword === false) encryptedPassword = null;
    if (credentials.rememberPassword === true && credentials.password !== void 0) encryptedPassword = this.credentials.encrypt(credentials.password, `${owner}\0${id}`);
    const updated = { ...row, encryptedPassword };
    await this.machines.put(id, updated);
    return updated;
  }
  async append(machine, event, detail) {
    const entry = { id: randomUUID(), owner: machine.owner, machineId: machine.id, machineName: machine.name, address: machine.address, username: machine.username, event, occurredAt: (/* @__PURE__ */ new Date()).toISOString(), ordinal: ++this.ordinal, ...detail ? { detail } : {} };
    await this.history.put(entry.id, entry);
    return entry;
  }
  async connected(owner, id, sessionId) {
    const row = this.get(owner, id), key = `${owner}\0${sessionId}`;
    if (!this.sessions.get(key)) {
      await this.append(row, "connected");
      await this.sessions.put(key, { owner, sessionId, machineId: id, gatewayId: row.gatewayId });
    }
    const updated = { ...row, lastConnectedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await this.machines.put(id, updated);
    return updated;
  }
  ready(owner, machineId) {
    return [...this.sessions.entries()].map(([, row]) => row).filter((row) => row.owner === owner && (machineId === void 0 || row.machineId === machineId));
  }
  async end(owner, machineId, event, sessionId, detail) {
    const row = this.get(owner, machineId), sessions = this.ready(owner, machineId).filter((session) => sessionId !== void 0 && session.sessionId === sessionId);
    if (event === "disconnected" && sessionId !== void 0 && sessions.length === 0) return;
    await this.append(row, event, detail);
  }
  async forget(owner, sessionId) {
    await this.sessions.delete(`${owner}\0${sessionId}`);
  }
  async delete(owner, id) {
    this.get(owner, id);
    await this.machines.delete(id);
    for (const session of this.ready(owner, id)) await this.sessions.delete(`${owner}\0${session.sessionId}`);
  }
  events(owner, { machineId, cursor }) {
    let rows = [...this.history.entries()].map(([, row]) => row).filter((row) => row.owner === owner && (machineId === void 0 || row.machineId === machineId)).sort((a, b) => b.ordinal - a.ordinal);
    if (cursor !== void 0) {
      const index = rows.findIndex((row) => row.id === cursor);
      if (index < 0) throw new HttpError(400, "\u5386\u53F2\u8BB0\u5F55\u6E38\u6807\u65E0\u6548");
      rows = rows.slice(index + 1);
    }
    const page = rows.slice(0, 100);
    return { events: page.map(({ owner: _owner, ordinal: _ordinal, ...event }) => event), ...rows.length > 100 ? { nextCursor: page.at(-1).id } : {} };
  }
  public(row) {
    return { id: row.id, name: row.name, username: row.username, address: row.address, gatewayId: row.gatewayId, lastConnectedAt: row.lastConnectedAt, hasSavedPassword: row.encryptedPassword !== null, url: clientUrl(row.gatewayId) };
  }
};

// server/guacamole.mjs
var DATA = "/session/data/postgresql";
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var Guacamole = class {
  constructor({ baseUrl, adminPassword, adminUser = "guacadmin" }) {
    const parsed = new URL(baseUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !["http:", "https:"].includes(parsed.protocol)) throw new Error("Invalid Guacamole base URL");
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.adminPassword = adminPassword;
    this.adminUser = adminUser;
    this.tokens = /* @__PURE__ */ new Map();
  }
  async request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api${path}`, { ...options, redirect: "error", signal: AbortSignal.timeout(8e3) });
    } catch {
      throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u6682\u65F6\u4E0D\u53EF\u7528");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status === 403 ? 403 : 502, response.status === 403 ? "\u6CA1\u6709\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u8BBF\u95EE\u6743\u9650" : "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u64CD\u4F5C\u5931\u8D25");
    }
    if (response.status === 204) return void 0;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          await response.body.cancel();
          throw new Error("Response too large");
        }
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u54CD\u5E94\u65E0\u6548");
    }
  }
  async token(owner) {
    const key = owner ?? Symbol.for("admin"), cached = this.tokens.get(key);
    if (cached && cached.expires > Date.now()) return cached.token;
    const passwordLogin = owner === void 0 && this.adminPassword !== void 0;
    const body = passwordLogin ? new URLSearchParams({ username: this.adminUser, password: this.adminPassword }) : new URLSearchParams();
    const reply = await this.request("/tokens", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...passwordLogin ? {} : { "X-DSH-User": owner ?? this.adminUser } }, body });
    if (!object(reply) || typeof reply.authToken !== "string" || !reply.authToken || !Array.isArray(reply.availableDataSources) || !reply.availableDataSources.includes("postgresql")) throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u8BA4\u8BC1\u54CD\u5E94\u65E0\u6548");
    if (this.tokens.size > 256) this.tokens.clear();
    this.tokens.set(key, { token: reply.authToken, expires: Date.now() + 6e4 });
    return reply.authToken;
  }
  async call(owner, path, options = {}) {
    const token = await this.token(owner);
    return this.request(`${DATA}${path}`, { ...options, headers: { "Guacamole-Token": token, ...options.body === void 0 ? {} : { "Content-Type": "application/json" } } });
  }
  async authorized(owner) {
    const reply = await this.call(owner, "/connections?permission=READ");
    if (!object(reply)) throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u673A\u5668\u5217\u8868\u65E0\u6548");
    return Object.entries(reply).filter(([, value]) => object(value) && value.protocol === "rdp").map(([id, value]) => ({ id, name: typeof value.name === "string" ? value.name : id }));
  }
  async parameters(id) {
    const reply = await this.call(void 0, `/connections/${encodeURIComponent(id)}/parameters`);
    if (!object(reply)) throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u673A\u5668\u53C2\u6570\u65E0\u6548");
    return { hostname: reply.hostname, port: reply.port, username: reply.username };
  }
  async active(owner) {
    const reply = await this.call(owner, "/activeConnections");
    if (!object(reply)) throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u4F1A\u8BDD\u5217\u8868\u65E0\u6548");
    return Object.values(reply).filter((value) => object(value) && typeof value.identifier === "string" && typeof value.connectionIdentifier === "string" && typeof value.username === "string" && typeof value.connectable === "boolean");
  }
  async create(owner, machine) {
    const payload = { parentIdentifier: "ROOT", name: machine.name, protocol: "rdp", parameters: { hostname: machine.host, port: String(machine.port), username: machine.username, security: "nla", "resize-method": "display-update", "server-layout": "en-us-qwerty", "cert-tofu": "true" }, attributes: {} };
    const reply = await this.call(void 0, "/connections", { method: "POST", body: JSON.stringify(payload) });
    if (!object(reply) || typeof reply.identifier !== "string" || !reply.identifier) throw new HttpError(502, "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u521B\u5EFA\u54CD\u5E94\u65E0\u6548");
    const id = reply.identifier;
    try {
      await this.call(void 0, `/users/${encodeURIComponent(owner)}/permissions`, { method: "PATCH", body: JSON.stringify([{ op: "add", path: `/connectionPermissions/${id.replace(/~/gu, "~0").replace(/\//gu, "~1")}`, value: "READ" }]) });
    } catch (error) {
      try {
        await this.remove(id);
      } catch {
        throw new HttpError(502, "\u7F51\u5173\u6743\u9650\u5206\u914D\u5931\u8D25\u4E14\u6E05\u7406\u5931\u8D25\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458");
      }
      throw error;
    }
    this.tokens.delete(owner);
    return id;
  }
  async remove(id) {
    await this.call(void 0, `/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
};

// server/manager.mjs
var Manager = class {
  constructor(registry, guac) {
    this.registry = registry;
    this.guac = guac;
    this.pending = Promise.resolve();
  }
  exclusive(action) {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {
    });
    return result;
  }
  async reconcile(owner) {
    const ready = this.registry.ready(owner);
    if (ready.length === 0) return;
    const active = await this.guac.active(owner);
    for (const session of ready) {
      if (!active.some((connection) => connection.identifier === session.sessionId && connection.username === owner && connection.connectionIdentifier === session.gatewayId)) {
        await this.registry.end(owner, session.machineId, "disconnected", session.sessionId, "\u7F51\u5173\u4F1A\u8BDD\u5DF2\u7ED3\u675F");
        await this.registry.forget(owner, session.sessionId);
      }
    }
  }
  async list(owner) {
    try {
      return await this.importList(owner);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 502) throw error;
      return { machines: this.registry.list(owner).map((row) => this.registry.public(row)), warning: "\u7F51\u5173\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u663E\u793A DSH \u5DF2\u4FDD\u5B58\u7684\u673A\u5668" };
    }
  }
  async importList(owner) {
    await this.reconcile(owner);
    for (const connection of await this.guac.authorized(owner)) {
      if (this.registry.byGateway(owner, connection.id) || this.registry.suppressed(owner, connection.id)) continue;
      const parameters = await this.guac.parameters(connection.id);
      let values;
      try {
        const host = typeof parameters.hostname === "string" && parameters.hostname.includes(":") ? `[${parameters.hostname}]` : parameters.hostname;
        values = parseMachine({ name: connection.name, username: parameters.username, address: `${host}${parameters.port ? `:${parameters.port}` : ""}` });
      } catch (error) {
        if (error instanceof HttpError && error.status === 400) continue;
        throw error;
      }
      if (!this.registry.byTarget(owner, values)) await this.registry.save(owner, values, { gatewayId: connection.id, owned: false });
    }
    return { machines: this.registry.list(owner).map((row) => this.registry.public(row)) };
  }
  async authorizedTarget(owner, row) {
    if (!(await this.guac.authorized(owner)).some((connection) => connection.id === row.gatewayId)) throw new HttpError(403, "\u6CA1\u6709\u6B64\u673A\u5668\u7684\u7F51\u5173\u8BBF\u95EE\u6743\u9650");
    const parameters = await this.guac.parameters(row.gatewayId);
    let target;
    try {
      const host = typeof parameters.hostname === "string" && parameters.hostname.includes(":") ? `[${parameters.hostname}]` : parameters.hostname;
      target = parseAddress(`${host}${parameters.port ? `:${parameters.port}` : ""}`);
    } catch {
      throw new HttpError(502, "\u7F51\u5173\u673A\u5668\u76EE\u6807\u914D\u7F6E\u65E0\u6548");
    }
    return row.host === target.host && row.port === target.port && row.username === parameters.username;
  }
  async save(owner, values, id) {
    const previous = id ? this.registry.get(owner, id) : this.registry.byTarget(owner, values), duplicate = this.registry.byTarget(owner, values);
    if (id && duplicate && duplicate.id !== id) throw new HttpError(400, "\u8BE5\u673A\u5668\u5730\u5740\u548C\u767B\u5F55\u540D\u5DF2\u5B58\u5728");
    const sameTarget = previous && previous.host === values.host && previous.port === values.port && previous.username === values.username;
    if (sameTarget && await this.authorizedTarget(owner, previous)) return this.registry.public(await this.registry.save(owner, values, { id: previous.id, gatewayId: previous.gatewayId, owned: previous.owned }));
    const gatewayId = await this.guac.create(owner, values);
    let saved;
    try {
      saved = await this.registry.save(owner, values, { ...previous ? { id: previous.id } : {}, gatewayId, owned: true });
    } catch (error) {
      await this.guac.remove(gatewayId);
      throw error;
    }
    if (previous?.owned) await this.guac.remove(previous.gatewayId);
    if (previous && !previous.owned) await this.registry.suppress(owner, previous.gatewayId);
    return this.registry.public(saved);
  }
  async connect(owner, id, credentials) {
    const row = this.registry.get(owner, id);
    await this.registry.append(row, "attempt");
    try {
      if (!await this.authorizedTarget(owner, row)) throw new HttpError(400, "\u7F51\u5173\u673A\u5668\u76EE\u6807\u5DF2\u53D8\u66F4\uFF0C\u8BF7\u7F16\u8F91\u914D\u7F6E\u5E76\u91CD\u65B0\u4FDD\u5B58");
      const ready = this.registry.ready(owner, id);
      const active = (await this.guac.active(owner)).find((connection) => connection.connectable && connection.connectionIdentifier === row.gatewayId && connection.username === owner && ready.some((session) => session.sessionId === connection.identifier));
      const updated = await this.registry.remember(owner, id, credentials);
      if (active) return { url: clientUrl(active.identifier, "a"), reused: true };
      let password;
      try {
        password = credentials.password ?? this.registry.password(updated);
      } catch {
        throw new HttpError(502, "\u4FDD\u5B58\u7684\u5BC6\u7801\u65E0\u6CD5\u89E3\u5BC6\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165");
      }
      return { url: clientUrl(row.gatewayId), ...password === void 0 ? {} : { password }, reused: false };
    } catch (error) {
      await this.registry.append(row, "failed", "\u8FDE\u63A5\u8BF7\u6C42\u672A\u5B8C\u6210");
      throw error;
    }
  }
  async connected(owner, id, sessionId) {
    const row = this.registry.get(owner, id);
    if (!(await this.guac.active(owner)).some((connection) => connection.identifier === sessionId && connection.username === owner && connection.connectionIdentifier === row.gatewayId)) throw new HttpError(400, "\u8FDC\u7A0B\u684C\u9762\u4F1A\u8BDD\u5C1A\u672A\u5C31\u7EEA");
    return this.registry.public(await this.registry.connected(owner, id, sessionId));
  }
  async event(owner, id, terminal) {
    await this.registry.end(owner, id, terminal.event, terminal.sessionId, terminal.detail);
    if (terminal.sessionId === void 0) return;
    const session = this.registry.ready(owner, id).find((value) => value.sessionId === terminal.sessionId);
    if (!session) return;
    let active;
    try {
      active = await this.guac.active(owner);
    } catch (error) {
      if (error instanceof HttpError && error.status === 502) return;
      throw error;
    }
    if (!active.some((connection) => connection.identifier === session.sessionId && connection.username === owner && connection.connectionIdentifier === session.gatewayId)) await this.registry.forget(owner, session.sessionId);
  }
  async history(owner, query) {
    try {
      await this.reconcile(owner);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 502) throw error;
    }
    return this.registry.events(owner, query);
  }
  async delete(owner, id) {
    const row = this.registry.get(owner, id);
    if (row.owned) await this.guac.remove(row.gatewayId);
    if (this.registry.ready(owner, id).length > 0) await this.registry.end(owner, id, "disconnected", void 0, "\u673A\u5668\u914D\u7F6E\u5DF2\u5220\u9664");
    await this.registry.suppress(owner, row.gatewayId);
    await this.registry.delete(owner, id);
  }
};

// server/rpc.mjs
var string = (value, field) => {
  if (typeof value !== "string" || !value || value.length > 200 || /[\x00-\x1f\x7f]/u.test(value)) throw new HttpError(400, `${field}\u65E0\u6548`);
  return value;
};
var reasons = { closed: "\u684C\u9762\u89C6\u56FE\u5DF2\u5173\u95ED", cancelled: "\u8FDE\u63A5\u5DF2\u53D6\u6D88", gateway: "\u8FDC\u7A0B\u684C\u9762\u7F51\u5173\u8FDE\u63A5\u5F02\u5E38", client: "\u8FDC\u7A0B\u684C\u9762\u5BA2\u6237\u7AEF\u8FDE\u63A5\u5F02\u5E38" };
function createRpcHandler(manager, owner) {
  return async (endpoint, payload, signal) => {
    try {
      if (signal?.aborted) throw new HttpError(400, "\u8BF7\u6C42\u5DF2\u53D6\u6D88");
      const value = parseObject(payload);
      if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw new HttpError(400, "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
      const result = await manager.exclusive(async () => {
        switch (endpoint) {
          case "machines/list":
            return manager.list(owner);
          case "machines/save":
            return manager.save(owner, parseMachine(value));
          case "machines/edit":
            return manager.save(owner, parseMachine(value), string(value.id, "\u673A\u5668\u7F16\u53F7"));
          case "machines/delete":
            await manager.delete(owner, string(value.id, "\u673A\u5668\u7F16\u53F7"));
            return null;
          case "machines/connect":
            return manager.connect(owner, string(value.id, "\u673A\u5668\u7F16\u53F7"), parseCredentials(value));
          case "machines/connected":
            return manager.connected(owner, string(value.id, "\u673A\u5668\u7F16\u53F7"), string(value.sessionId, "\u4F1A\u8BDD\u7F16\u53F7"));
          case "machines/event": {
            if (!["failed", "disconnected"].includes(value.event) || value.reason !== void 0 && !Object.hasOwn(reasons, value.reason)) throw new HttpError(400, "\u8FDE\u63A5\u4E8B\u4EF6\u65E0\u6548");
            const id = string(value.id, "\u673A\u5668\u7F16\u53F7"), sessionId = value.sessionId === void 0 ? void 0 : string(value.sessionId, "\u4F1A\u8BDD\u7F16\u53F7");
            await manager.event(owner, id, { event: value.event, sessionId, detail: reasons[value.reason] ?? "\u8FDC\u7A0B\u684C\u9762\u4F1A\u8BDD\u5DF2\u7ED3\u675F" });
            return null;
          }
          case "history/list":
            return manager.history(owner, { machineId: value.machineId === void 0 ? void 0 : string(value.machineId, "\u673A\u5668\u7F16\u53F7"), cursor: value.cursor === void 0 ? void 0 : string(value.cursor, "\u5386\u53F2\u6E38\u6807") });
          default:
            throw new HttpError(404, "\u63A5\u53E3\u4E0D\u5B58\u5728");
        }
      });
      return { ok: true, value: result };
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      return { ok: false, error: { code: `rdp/${status === 400 ? "bad-request" : status === 404 ? "not-found" : status === 403 ? "forbidden" : "gateway"}`, message: error instanceof HttpError ? error.message : "\u8FDC\u7A0B\u684C\u9762\u670D\u52A1\u64CD\u4F5C\u5931\u8D25", details: { status } } };
    }
  };
}

// server/fetch.mjs
var RPC_ENDPOINTS = Object.freeze(["machines/list", "machines/save", "machines/edit", "machines/delete", "machines/connect", "machines/connected", "machines/event", "history/list"]);
function fetchRoute(endpoint, handler) {
  return { path: `/api/rdp/${endpoint}`, methods: ["POST"], requestBody: "buffered", async fetch(request) {
    let rpcId = "invalid-request";
    const respond = (result) => new Response(JSON.stringify({ type: "server-response", rpcId, result }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    try {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new HttpError(400, "\u8BF7\u6C42\u5FC5\u987B\u4F7F\u7528 JSON");
      const reader = request.body?.getReader(), chunks = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) {
              await reader.cancel();
              throw new HttpError(400, "\u8BF7\u6C42\u5185\u5BB9\u8FC7\u5927");
            }
            chunks.push(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
      }
      let body;
      try {
        body = parseObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        throw new HttpError(400, "JSON \u683C\u5F0F\u65E0\u6548");
      }
      const validId = typeof body.rpcId === "string" && body.rpcId.length > 0 && body.rpcId.length <= 200;
      if (validId) rpcId = body.rpcId;
      if (!validId || body.type !== "client-request" || body.method !== `rdp/${endpoint}`) throw new HttpError(400, "\u8FDC\u7A0B\u684C\u9762\u8BF7\u6C42\u683C\u5F0F\u65E0\u6548");
      return respond(await handler(endpoint, body.payload, request.signal));
    } catch (error) {
      return respond({ ok: false, error: { code: error instanceof HttpError ? "rdp/bad-request" : "rdp/gateway", message: error instanceof HttpError ? error.message : "\u8FDC\u7A0B\u684C\u9762\u8BF7\u6C42\u5904\u7406\u5931\u8D25", details: { status: error instanceof HttpError ? error.status : 502 } } });
    }
  } };
}

// server/native.mjs
var domainSpec = defineDomain({ name: "rdp_plugin", version: 1, tables: {
  machines: domainTable(z.object({ id: z.string(), owner: z.string(), name: z.string(), username: z.string(), address: z.string(), host: z.string(), port: z.number().int(), gatewayId: z.string(), owned: z.boolean(), encryptedPassword: z.string().nullable(), lastConnectedAt: z.string().nullable(), createdAt: z.string() })),
  history: domainTable(z.object({ id: z.string(), owner: z.string(), machineId: z.string(), machineName: z.string(), address: z.string(), username: z.string(), event: z.enum(["attempt", "connected", "disconnected", "failed"]), occurredAt: z.string(), ordinal: z.number().int(), detail: z.string().optional() })),
  suppressed: domainTable(z.object({ owner: z.string(), gatewayId: z.string() })),
  sessions: domainTable(z.object({ owner: z.string(), sessionId: z.string(), machineId: z.string(), gatewayId: z.string() }))
} });
async function applyNative(context, config) {
  const owner = config.gatewayUser ?? "dshadmin", adminUser = config.adminUser ?? "guacadmin";
  if (!owner.trim() || !adminUser.trim() || /[\x00-\x1f\x7f]/u.test(owner + adminUser)) throw new Error("Invalid gateway user configuration");
  const baseUrl = config.guacamoleUrl ?? "http://127.0.0.1:18081/guacamole", parsed = new URL(baseUrl);
  if (!["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname)) throw new Error("Guacamole header authentication requires a trusted loopback URL");
  const home = process.env.DSH_HOME?.trim() ? resolve2(process.env.DSH_HOME) : join(homedir(), ".dsh");
  const credentials = new Credentials(config.keyFile || join(home, "secrets", "rdp.key"));
  let domain;
  try {
    domain = await context.storageDomain.open(domainSpec);
  } catch (error) {
    credentials.close();
    throw error;
  }
  const manager = new Manager(new Registry(domain, credentials), new Guacamole({ baseUrl, adminUser }));
  const handler = createRpcHandler(manager, owner);
  let closing = false;
  const admittedHandler = (...args) => closing ? Promise.resolve({ ok: false, error: { code: "rdp/closing", message: "\u8FDC\u7A0B\u684C\u9762\u63D2\u4EF6\u6B63\u5728\u505C\u6B62\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", details: { status: 503 } } }) : handler(...args);
  const unregister = RPC_ENDPOINTS.map((endpoint) => context.connection.fetch.register(fetchRoute(endpoint, admittedHandler)));
  context.effect(() => async () => {
    closing = true;
    try {
      await Promise.all(unregister.map((dispose) => dispose()));
    } finally {
      await manager.pending;
      try {
        await domain.close();
      } finally {
        credentials.close();
      }
    }
  });
}

// src/index.ts
var name = "rdp-plugin";
var inject = ["connection", "storageDomain"];
var Config = schema.object({
  guacamoleUrl: schema.string().default("http://127.0.0.1:18081/guacamole"),
  gatewayUser: schema.string().default("dshadmin"),
  adminUser: schema.string().default("guacadmin"),
  keyFile: schema.string()
});
function apply(context, config) {
  return applyNative(context, config);
}
export {
  Config,
  apply,
  inject,
  name
};
