import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { applyNative, domainSpec } from '../server/native.mjs';
import { Credentials } from '../server/credentials.mjs';
import { Registry } from '../server/registry.mjs';
import { RPC_ENDPOINTS } from '../server/fetch.mjs';
import { parseAddress, parseMachine } from '../server/input.mjs';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rdp-native-')), file = join(dir, 'domain.json'), requests = [], effects = [];
  const connections = new Map([['1', { identifier: '1', name: 'Imported', protocol: 'rdp', parameters: { hostname: 'imported', port: '3389', username: 'admin', 'cert-fingerprints': 'pinned', password: 'external-secret' } }]]);
  const grants = new Map([['alice', new Set(['1'])], ['bob', new Set()]]), active = {};
  const routes = new Map();
  let next = 2, failGrant = false, failList = false, failActive = false, handler, createGate;
  const fake = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const url = new URL(req.url, 'http://localhost'), path = url.pathname.replace('/guacamole/api', '');
    requests.push({ method: req.method, path, query: url.search, header: req.headers['x-dsh-user'], token: req.headers['guacamole-token'], body: raw });
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (path === '/tokens') {
      assert.equal(raw, ''); const user = req.headers['x-dsh-user'];
      return send(200, { authToken: user === 'guacadmin' ? 'admin' : `user:${user}`, availableDataSources: ['postgresql'] });
    }
    const token = req.headers['guacamole-token'], user = token?.startsWith('user:') ? token.slice(5) : null;
    if (path.endsWith('/activeConnections')) return failActive ? send(500, { error: 'gateway-secret' }) : send(200, active);
    if (path === '/session/data/postgresql/connections' && req.method === 'GET') {
      if (failList) return send(500, { error: 'external-secret' });
      assert.equal(url.searchParams.get('permission'), 'READ');
      return send(200, Object.fromEntries([...connections].filter(([id]) => grants.get(user)?.has(id)).map(([id, value]) => [id, { ...value, parameters: undefined }])));
    }
    if (path.endsWith('/connections') && req.method === 'POST') {
      if (createGate) { createGate.startedResolve(); await createGate.pending; }
      assert.equal(token, 'admin'); const body = JSON.parse(raw), identifier = String(next++);
      connections.set(identifier, { ...body, identifier }); return send(200, { ...body, identifier });
    }
    const permissions = /^\/session\/data\/postgresql\/users\/([^/]+)\/permissions$/u.exec(path);
    if (permissions) {
      assert.equal(token, 'admin'); if (failGrant) return send(500, { error: 'external-secret' });
      const owner = decodeURIComponent(permissions[1]), patch = JSON.parse(raw)[0];
      assert.deepEqual({ op: patch.op, value: patch.value }, { op: 'add', value: 'READ' });
      if (!grants.has(owner)) grants.set(owner, new Set()); grants.get(owner).add(patch.path.split('/').at(-1)); return send(204);
    }
    const match = /^\/session\/data\/postgresql\/connections\/([^/]+)(\/parameters)?$/u.exec(path);
    if (match) {
      assert.equal(token, 'admin'); const row = connections.get(match[1]); if (!row) return send(404, {});
      if (req.method === 'DELETE') { connections.delete(match[1]); return send(204); }
      return send(200, match[2] ? row.parameters : row);
    }
    send(404, {});
  });
  fake.listen(0, '127.0.0.1'); await once(fake, 'listening');
  const snapshot = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tables: {}, global: null };
  const persist = () => writeFileSync(file, JSON.stringify(snapshot));
  const unit = { loadAll: async () => snapshot, putRecord: async (table, key, value) => { snapshot.tables[table] ??= {}; snapshot.tables[table][key] = value; persist(); }, deleteRecord: async (table, key) => { delete snapshot.tables[table][key]; persist(); }, close: async () => {} };
  const context = { emit() {}, logger: { warn() {} }, storage: { backend: { get: () => ({ kv: { open: async () => unit } }) } }, effect: effect => effects.push(effect()), connection: { fetch: { register: route => { routes.set(route.path, route); return async () => { routes.delete(route.path); }; } } } };
  context.storageDomain = new DomainFacility(context, { backend: 'test' });
  await applyNative(context, { gatewayUser: 'alice', guacamoleUrl: `http://127.0.0.1:${fake.address().port}/guacamole`, keyFile: join(dir, 'secrets', 'rdp.key') });
  const domain = context.storageDomain.get('rdp_plugin');
  async function rpc(endpoint, payload = {}) {
    const route = routes.get(`/api/rdp/${endpoint}`);
    if (!route) return { ok: false, error: { code: 'rdp/closing', details: { status: 503 } } };
    const response = await route.fetch(new Request(`http://localhost${route.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc-id', method: `rdp/${endpoint}`, payload }) }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const envelope = await response.json(); assert.ok(envelope.rpcId === 'test-rpc-id' || envelope.rpcId === 'invalid-request'); assert.equal(envelope.type, 'server-response'); return envelope.result;
  }
  async function call(endpoint, payload = {}) { const result = await rpc(endpoint, payload); assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
  t.after(async () => { for (const effect of effects.reverse()) await effect(); await new Promise(resolve => fake.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  assert.equal(routes.size, RPC_ENDPOINTS.length);
  return { dir, file, domain, context, routes, rpc, call, connections, grants, active, requests, dispose: async () => { for (const effect of effects) await effect(); }, pauseCreate: () => { let startedResolve, release; const started = new Promise(resolve => { startedResolve = resolve; }), pending = new Promise(resolve => { release = resolve; }); createGate = { startedResolve, pending }; return { started, release }; }, failGrant: () => { failGrant = true; }, failList: () => { failList = true; }, failActive: () => { failActive = true; } };
}
const machine = { name: 'Work', username: 'user', address: 'host:3390', password: 'rdp-secret', rememberPassword: true };

test('Given native plugin registration, when importing and deleting, then preserve external config and suppress its bookmark', async t => {
  const f = await fixture(t), imported = (await f.call('machines/list')).machines[0];
  assert.equal(imported.hasSavedPassword, false); assert.equal(JSON.stringify(imported).includes('external-secret'), false);
  assert.equal((await f.call('machines/edit', { id: imported.id, name: 'Renamed', username: 'admin', address: 'imported' })).gatewayId, '1');
  await f.call('machines/delete', { id: imported.id });
  assert.equal(f.connections.get('1').parameters['cert-fingerprints'], 'pinned');
  assert.deepEqual((await f.call('machines/list')).machines, []);
});

test('Given pending NLA versus ready sessions, when connecting, then join only registered ready UUID and record explicit success', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), id = added.id;
  assert.equal(added.lastConnectedAt, null); assert.equal(added.hasSavedPassword, true);
  assert.equal(f.connections.get(added.gatewayId).parameters.password, undefined);
  assert.equal(f.connections.get(added.gatewayId).parameters['cert-tofu'], 'true');
  assert.equal((await f.call('machines/save', machine)).id, id);
  f.active.pending = { identifier: 'pending', connectionIdentifier: added.gatewayId, username: 'alice', connectable: true };
  assert.equal((await f.call('machines/connect', { id })).reused, false);
  assert.equal(f.domain.table('machines').get(id).lastConnectedAt, null);
  await f.call('machines/connected', { id, sessionId: 'pending' });
  const joined = await f.call('machines/connect', { id });
  assert.equal(joined.reused, true); assert.equal(joined.password, undefined);
  assert.equal(Buffer.from(joined.url.split('/').at(-1), 'base64url').toString(), 'pending\0a\0postgresql');
  await f.call('machines/connected', { id, sessionId: 'pending' });
  const events = (await f.call('history/list')).events;
  assert.deepEqual(events.map(event => event.event), ['attempt', 'connected', 'attempt']);
});

test('Given a browser vanishes, when list/history reconciles known ready sessions, then append disconnected once and retain history after deletion', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), id = added.id;
  f.active.ready = { identifier: 'ready', connectionIdentifier: added.gatewayId, username: 'alice', connectable: true };
  await f.call('machines/connected', { id, sessionId: 'ready' }); delete f.active.ready;
  await f.call('machines/list'); await f.call('history/list');
  await f.call('machines/delete', { id });
  assert.deepEqual((await f.call('history/list', { machineId: id })).events.map(event => event.event), ['disconnected', 'connected']);
});

test('Given revoked permissions or repointed metadata, when connecting, then reject saved-secret disclosure', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), id = added.id;
  f.grants.get('alice').delete(added.gatewayId);
  assert.equal((await f.rpc('machines/connect', { id })).error.details.status, 403);
  f.grants.get('alice').add(added.gatewayId); f.connections.get(added.gatewayId).parameters.hostname = 'repointed';
  assert.equal((await f.rpc('machines/connect', { id })).error.details.status, 400);
  const edited = await f.call('machines/edit', { id, name: 'Work', username: 'user', address: 'repointed:3390' });
  assert.equal(edited.hasSavedPassword, false);
  assert.equal((await f.call('machines/connect', { id })).password, undefined);
});

test('Given explicit credential choices, when using native storage, then encrypt only opted-in values with owner/id AAD', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), id = added.id;
  assert.equal(readFileSync(f.file, 'utf8').includes('rdp-secret'), false);
  assert.equal(statSync(join(f.dir, 'secrets', 'rdp.key')).mode & 0o777, 0o600);
  const credentials = new Credentials(join(f.dir, 'secrets', 'rdp.key')), registry = new Registry(f.domain, credentials), row = registry.get('alice', id);
  assert.throws(() => registry.get('bob', id), { status: 404 }); assert.equal(registry.password(row), 'rdp-secret');
  assert.throws(() => registry.password({ ...row, owner: 'bob' }));
  assert.notEqual(credentials.encrypt('same', 'identity'), credentials.encrypt('same', 'identity'));
  const encrypted = row.encryptedPassword; assert.throws(() => credentials.decrypt(`${encrypted.slice(0, -3)}xxx`, `alice\0${id}`));
  assert.equal((await f.call('machines/connect', { id })).password, 'rdp-secret');
  await f.call('machines/connect', { id, rememberPassword: false });
  assert.equal((await f.call('machines/connect', { id, password: 'ephemeral' })).password, 'ephemeral');
  assert.equal(f.domain.table('machines').get(id).encryptedPassword, null); credentials.close();
});

test('Given downstream grant failure and hostile payloads, when dispatching native RPC, then cleanup and return redacted typed failures', async t => {
  const f = await fixture(t); f.failGrant();
  const failed = await f.rpc('machines/save', machine); assert.equal(failed.error.details.status, 502);
  assert.equal([...f.connections.values()].some(row => row.parameters.hostname === 'host'), false);
  assert.equal(JSON.stringify(failed).includes('secret'), false);
  for (const payload of [null, [], undefined, { ...machine, rememberPassword: 'yes' }, { ...machine, password: 'x'.repeat(66000) }]) assert.equal((await f.rpc('machines/save', payload)).error.details.status, 400);
  assert.equal((await f.rpc('machines/event', { id: 'id', event: 'failed', reason: 'password-secret' })).error.details.status, 400);
  assert.equal((await f.rpc('machines/connected', { id: 'id' })).error.details.status, 400);
  f.failList(); assert.equal((await f.call('machines/list')).warning, '网关暂时不可用，显示 DSH 已保存的机器');
  assert.ok(f.requests.every(request => !request.query.includes('secret') && !request.path.includes('secret')));
});

test('Given 205 retained events, when querying pages, then return every event once and preserve instance owner isolation', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), credentials = new Credentials(join(f.dir, 'secrets', 'rdp.key')), registry = new Registry(f.domain, credentials), row = registry.get('alice', added.id);
  for (let index = 0; index < 205; index++) await registry.append(row, 'attempt');
  await registry.append({ ...row, owner: 'bob' }, 'failed');
  const first = await f.call('history/list'), second = await f.call('history/list', { cursor: first.nextCursor }), third = await f.call('history/list', { cursor: second.nextCursor });
  assert.deepEqual([first.events.length, second.events.length, third.events.length], [100, 100, 5]);
  assert.equal(new Set([...first.events, ...second.events, ...third.events].map(event => event.id)).size, 205);
  assert.equal(third.nextCursor, undefined); assert.equal(JSON.stringify(first).includes('"owner"'), false);
  assert.equal((await f.rpc('history/list', { cursor: 'bad-cursor' })).error.details.status, 400);
  await f.domain.close(); const reopened = await f.context.storageDomain.open(domainSpec);
  assert.equal(reopened.table('history').size, 206); assert.equal(new Registry(reopened, credentials).password(reopened.table('machines').get(added.id)), 'rdp-secret');
  await reopened.close(); credentials.close();
});

test('Given address input, when parsing, then normalize IPv6 and reject URLs credentials and invalid ports', () => {
  assert.deepEqual(parseAddress('[2001:0DB8:0:0:0:0:0:1]'), { host: '2001:db8::1', port: 3389, address: '[2001:db8::1]' });
  for (const address of ['https://host', 'user:pw@host', 'host/path', 'host?x=y', 'host:0', 'host:65536', 'host:abc', 'host:', '', 'a b', '127.0.0.999']) assert.throws(() => parseAddress(address), { status: 400 });
  assert.throws(() => parseMachine({ name: 'n', username: 'u', address: 'host', rememberPassword: 'yes' }), { status: 400 });
});


test('Given stored history and a ready session, when the gateway goes offline, then history remains available without inventing disconnects', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine);
  f.active.ready = { identifier: 'ready', connectionIdentifier: added.gatewayId, username: 'alice', connectable: true };
  await f.call('machines/connected', { id: added.id, sessionId: 'ready' }); f.failActive();
  assert.deepEqual((await f.call('history/list')).events.map(event => event.event), ['connected']);
  assert.equal(f.domain.table('sessions').size, 1);
});


test('Given browser A ready and browser B pending, when B cancels without a UUID, then retain A readiness and keep joining its session', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), id = added.id;
  f.active.browserA = { identifier: 'browser-a', connectionIdentifier: added.gatewayId, username: 'alice', connectable: true };
  await f.call('machines/connected', { id, sessionId: 'browser-a' });
  await f.call('machines/event', { id, event: 'disconnected', reason: 'cancelled' });
  assert.equal((await f.call('machines/connect', { id })).reused, true);
  assert.equal(f.domain.table('sessions').size, 1);
});

test('Given a ready session shared by two views, when one view closes, then retain the live session readiness for another browser', async t => {
  const f = await fixture(t), added = await f.call('machines/save', machine), id = added.id;
  f.active.shared = { identifier: 'shared', connectionIdentifier: added.gatewayId, username: 'alice', connectable: true };
  await f.call('machines/connected', { id, sessionId: 'shared' });
  await f.call('machines/event', { id, event: 'disconnected', sessionId: 'shared', reason: 'closed' });
  assert.equal((await f.call('machines/connect', { id })).reused, true);
  assert.equal(f.domain.table('sessions').size, 1);
  delete f.active.shared; await f.call('history/list');
  assert.equal(f.domain.table('sessions').size, 0);
});


test('Given an admitted RPC awaiting Guacamole, when the plugin unloads, then stop admission and drain storage writes before closing', async t => {
  const f = await fixture(t), pause = f.pauseCreate(), request = f.rpc('machines/save', machine);
  await pause.started;
  const disposal = f.dispose();
  assert.equal((await f.rpc('machines/list')).error.details.status, 503);
  assert.equal(f.domain.table('machines').size, 0);
  pause.release(); const result = await request; await disposal;
  assert.equal(result.ok, true);
  assert.ok(JSON.parse(readFileSync(f.file, 'utf8')).tables.machines[result.value.id]);
  assert.throws(() => f.domain.table('machines').size);
});
