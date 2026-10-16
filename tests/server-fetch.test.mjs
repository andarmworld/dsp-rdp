import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRoute } from '../server/fetch.mjs';

test('Given the native Fetch adapter, when malformed or mismatched envelopes arrive, then redact failures and never dispatch them', async () => {
  let calls = 0;
  const route = fetchRoute('machines/save', async () => { calls++; return { ok: true, value: null }; });
  const envelope = { type: 'client-request', rpcId: 'native-id', method: 'rdp/machines/save', payload: {} };
  for (const input of ['{', 'null', JSON.stringify({ ...envelope, method: 'machines/save' }), JSON.stringify({ ...envelope, rpcId: 42 }), JSON.stringify({ ...envelope, payload: 'private-secret'.repeat(6000) })]) {
    const response = await route.fetch(new Request('http://localhost/api/rdp/machines/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: input }));
    const value = await response.json();
    assert.equal(value.type, 'server-response'); assert.equal(value.result.error.details.status, 400);
    assert.equal(JSON.stringify(value).includes('private-secret'), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
  const response = await route.fetch(new Request('http://localhost/api/rdp/machines/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...envelope, rpcId: 'invalid-request' }) }));
  assert.equal((await response.json()).result.ok, true); assert.equal(calls, 1);
});
