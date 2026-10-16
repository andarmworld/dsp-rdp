import test from 'node:test'
import assert from 'node:assert/strict'
import { connectionIdentifier, activeSessionUrl, inspectManagedClients } from '../src/guacamole.ts'

test('Given a Guacamole URL, when decoding, then identify connection and datasource', () => {
  const value = Buffer.from('1\0c\0postgresql').toString('base64url')
  assert.deepEqual(connectionIdentifier(`/guacamole/#/client/${value}`, 'https://example.test'), { id: '1', type: 'c', dataSource: 'postgresql' })
  assert.equal(connectionIdentifier('/guacamole/#/client/invalid', 'https://example.test'), null)
})
test('Given a current tunnel, when opening a popup, then join exactly its active UUID', () => {
  const url = activeSessionUrl('/guacamole/#/client/old', 'active-uuid', 'https://example.test')
  assert.deepEqual(connectionIdentifier(url, 'https://example.test'), { id: 'active-uuid', type: 'a', dataSource: 'postgresql' })
})
test('Given multiple managed clients, when observing a route, then never claim another client is connected', () => {
  const key = Buffer.from('1\0c\0postgresql').toString('base64url')
  assert.deepEqual(inspectManagedClients({ [key]: { clientState: { connectionState: 'CONNECTING' }, tunnel: { uuid: 'x' } }, other: { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'wrong' } } }, key), { state: 'CONNECTING', uuid: null })
  assert.deepEqual(inspectManagedClients({ [key]: { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'right' }, client: { getDisplay: () => ({ getWidth: () => 1280, getHeight: () => 800 }) } } }, key), { state: 'CONNECTED', uuid: 'right' })
})

test('Given a CONNECTED client still waiting for NLA, when inspecting, then withhold success and active sharing', () => {
  const key = 'current'
  const client = { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'pending' }, requiredParameters: { password: {} }, client: { getDisplay: () => ({ getWidth: () => 1280, getHeight: () => 800 }) } }
  assert.deepEqual(inspectManagedClients({ [key]: client }, key), { state: 'WAITING_FOR_INPUT', uuid: null })
})
test('Given a joined CONNECTED client with a zero-size display, when inspecting, then withhold success and active sharing', () => {
  const key = 'current'
  const client = { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'black' }, requiredParameters: {}, client: { getDisplay: () => ({ getWidth: () => 0, getHeight: () => 0 }) } }
  assert.deepEqual(inspectManagedClients({ [key]: client }, key), { state: 'PREPARING_DISPLAY', uuid: null })
})
