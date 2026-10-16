import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject } from '../src/index.ts';
import { RPC_ENDPOINTS } from '../server/fetch.mjs';

async function mounted(t, implementation) {
  const context = new Context(), routes = [], directory = mkdtempSync(join(tmpdir(), 'rdp-inject-'));
  const empty = new Map(), table = { entries: () => empty.entries() };
  let closed = false, connection;
  // Sibling providers match Loader topology; a root-provided service would
  // accidentally allow undeclared service reads through the ancestor store.
  const webProvider = context.plugin({ apply(owner) {
    owner.provide('webServer', { register: route => {
      routes.push(route);
      return () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1); };
    } });
  } });
  await webProvider.await();
  const storageProvider = context.plugin({ apply(owner) {
    owner.provide('storageDomain', { open: async spec => {
      assert.equal(spec.name, 'rdp_plugin');
      return { table: () => table, close: async () => { closed = true; } };
    } });
  } });
  await storageProvider.await();
  const connectionProvider = context.plugin({ apply(owner) {
    // Official Connection does not inject webServer into this provider fiber.
    connection = new HostConnectionService(owner, ['localhost'], {});
    connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: 'existing-gateway' }));
  } });
  await connectionProvider.await();
  let resolveSetup, rejectSetup;
  const setup = new Promise((resolve, reject) => { resolveSetup = resolve; rejectSetup = reject; });
  const fiber = context.plugin({ inject, async apply(owner, config) {
    try { await implementation(owner, config); resolveSetup(); }
    catch (error) { rejectSetup(error); throw error; }
  } }, { keyFile: join(directory, 'rdp.key') });
  t.after(async () => {
    await fiber.dispose(); await connectionProvider.dispose();
    await storageProvider.dispose(); await webProvider.dispose();
    rmSync(directory, { recursive: true, force: true });
  });
  return { fiber, setup, routes, shared: connection.createSharedFetchHandler('/api'), isClosed: () => closed };
}

function request(endpoint, payload = null) {
  return new Request(`http://localhost/api/rdp/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-injection-test', method: `rdp/${endpoint}`, payload }) });
}

test('Given sibling service providers, when using the old dedicated RPC prefix, then reproduce the real Cordis webServer injection failure', async t => {
  const fixture = await mounted(t, owner => owner.connection.rpc.handle('/rdp', async () => ({ ok: true, value: null })));
  await assert.rejects(fixture.setup, /cannot get property "webServer" without inject/u);
  assert.equal(fixture.routes.length, 0);
});

test('Given the same sibling providers and an existing API interceptor, when production registers exact Fetch routes, then dispatch all eight endpoints and remove them on unload', async t => {
  const fixture = await mounted(t, apply);
  await fixture.setup; await fixture.fiber.await();
  assert.equal(fixture.routes.length, 0);
  for (const endpoint of RPC_ENDPOINTS) {
    const response = await fixture.shared.fetch(request(endpoint));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const envelope = await response.json();
    assert.equal(envelope.type, 'server-response'); assert.equal(envelope.rpcId, 'rpc-injection-test');
    assert.equal(envelope.result.error.details.status, 400);
  }
  const unrelated = new Request('http://localhost/api/unrelated', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'unrelated', method: 'unrelated', payload: {} }) });
  assert.equal((await (await fixture.shared.fetch(unrelated)).json()).result.value, 'existing-gateway');
  await fixture.fiber.dispose(); assert.equal(fixture.isClosed(), true);
  assert.equal((await (await fixture.shared.fetch(request('machines/save'))).json()).result.value, 'existing-gateway');
});
