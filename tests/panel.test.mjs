import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import { build } from 'esbuild'
import React from 'react'
import { create, act } from 'react-test-renderer'

const machine = (id, name) => ({ id, name, username: 'alice', address: `${name}.example`, gatewayId: id, lastConnectedAt: null, hasSavedPassword: true, url: `/guacamole/#/client/${Buffer.from(`${id}\0c\0postgresql`).toString('base64url')}` })
const first = machine('one', 'Work'), second = machine('two', 'Lab')
const rpcCalls = []
let historyEvents = []
let moreHistory = []
const rpc = async (endpoint, payload) => {
  rpcCalls.push({ endpoint, payload })
  const value = data => ({ ok: true, value: data })
  if (endpoint === 'machines/list') return value({ machines: [first, second] })
  if (endpoint === 'history/list') {
    const events = payload.cursor ? moreHistory : historyEvents
    return value({ events: payload.machineId ? events.filter(event => event.machineId === payload.machineId) : events, ...(!payload.cursor && moreHistory.length ? { nextCursor: 'next-page' } : {}) })
  }
  if (endpoint === 'machines/connect') return value({ url: payload.id === first.id ? first.url : second.url, reused: true, ...(payload.password ? { password: payload.password } : {}) })
  if (endpoint === 'machines/event') return value(null)
  if (endpoint === 'machines/connected') return value(first)
  if (payload.address === 'invalid/path') return { ok: false, error: { code: 'rdp/bad-request', message: '机器地址格式无效。', details: { status: 400 } } }
  if (endpoint === 'machines/save') return { ok: false, error: { code: 'rdp/storage', message: '保存失败，请重试。', details: { status: 502 } } }
  return value({ ...first, ...payload, password: undefined })
}
globalThis.window = { location: { origin: 'https://example.test' }, localStorage: { getItem: () => null }, setInterval, clearInterval, setTimeout, clearTimeout, confirm: () => true }
const path = new URL(`../.rdp-component-test-${process.pid}.mjs`, import.meta.url)
const bundle = await build({ stdin: { contents: "export { RdpPanel } from './src/RdpPanel.tsx'; export { useMachines } from './src/useMachines.ts'; export { ConnectionHistory } from './src/ConnectionHistory.tsx'; export { setRpcTransport } from './src/api.ts'; export { useConnectionHistory } from './src/useConnectionHistory.ts'; export { apply as applyClient } from './src/client.tsx'; export { api } from './src/api.ts'; export { DesktopView } from './src/DesktopView.tsx'", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'node', external: ['react', 'react/jsx-runtime', 'ky', 'zod'] })
await writeFile(path, bundle.outputFiles[0].text)
const { RdpPanel, useMachines, ConnectionHistory, setRpcTransport, useConnectionHistory, applyClient, api, DesktopView } = await import(path.href)
const disposeTransport = setRpcTransport(rpc)
const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)) }) }
const text = node => typeof node === 'string' ? node : node?.children?.map(text).join('') ?? ''
function button(view, label) { return view.root.findAllByType('button').find(node => text(node).startsWith(label)) }
async function waitFor(predicate) { for (let count = 0; count < 100; count++) { if (predicate()) return; await flush() } assert.fail('Component did not reach expected state') }
test('Given an invalid form, when edited, then validation clears while actual save failures remain visible', async () => {
    let view
    await act(async () => { view = create(React.createElement(RdpPanel)) })
    try {
      await waitFor(() => button(view, 'Work'))
      await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
      assert.match(text(view.toJSON()), /请填写机器名称/)
      const fields = view.root.findAllByType('input').filter(node => node.props.type !== 'checkbox' && node.props.type !== 'search')
      await act(async () => fields[0].props.onChange({ target: { value: 'New' } }))
      assert.doesNotMatch(text(view.toJSON()), /请填写机器名称/)
      await act(async () => { fields[1].props.onChange({ target: { value: 'alice' } }); fields[3].props.onChange({ target: { value: 'host' } }) })
      await act(async () => button(view, '添加机器').props.onClick())
      await waitFor(() => /保存失败/.test(text(view.toJSON())))
      await act(async () => fields[0].props.onChange({ target: { value: 'Rename' } }))
      assert.match(text(view.toJSON()), /保存失败/)
    } finally { await act(async () => view.unmount()) }
  })
  test('Given two machines, when switching between them, then retain both iframe instances without sending saved-password flags', async () => {
    let view
    await act(async () => { view = create(React.createElement(RdpPanel)) })
    try {
      await waitFor(() => button(view, 'Work'))
      await act(async () => button(view, 'Work').props.onClick())
      await waitFor(() => view.root.findAllByType('iframe').length === 1)
      const work = view.root.findByType('iframe')
      await act(async () => button(view, 'Lab').props.onClick())
      await waitFor(() => view.root.findAllByType('iframe').length === 2)
      assert.equal(view.root.findAllByType('iframe')[0], work)
      await act(async () => button(view, 'Work').props.onClick())
      assert.equal(view.root.findAllByType('iframe').length, 2)
      assert.equal(view.root.findAllByType('iframe')[0], work)
      assert.doesNotMatch(text(view.toJSON()), /已连接/)
    } finally { await act(async () => view.unmount()) }
  })
  test('Given a server validation error, when editing or selecting a valid machine, then clear only the form error', async () => {
    let current, view
    function Harness() { current = useMachines(); return null }
    await act(async () => { view = create(React.createElement(Harness)) })
    try {
      await waitFor(() => current.machines.length === 2)
      await act(async () => current.change({ name: 'New', username: 'alice', address: 'invalid/path' }))
      await act(async () => current.save(false))
      await waitFor(() => !current.busy)
      assert.match(current.formError, /机器地址格式无效/)
      assert.equal(current.gatewayError, '')
      await act(async () => current.change({ address: 'host' }))
      assert.equal(current.formError, '')
      await act(async () => current.change({ address: 'invalid/path' }))
      await act(async () => current.save(false))
      await waitFor(() => !current.busy)
      await act(async () => current.select(first))
      assert.equal(current.formError, '')
    } finally { await act(async () => view.unmount()) }
  })
  test('Given a pending iframe, when explicitly connecting with a new password, then hand it to that view once', async () => {
    let current, view
    function Harness() { current = useMachines(); return null }
    await act(async () => { view = create(React.createElement(Harness)) })
    try {
      await waitFor(() => current.machines.length === 2)
      await act(async () => current.select(first))
      await waitFor(() => current.desktops.length === 1)
      const instance = current.desktops[0].instance
      await act(async () => current.change({ password: 'transient-test-value' }))
      await act(async () => current.save(true))
      await waitFor(() => !current.busy)
      assert.equal(current.desktops[0].instance, instance)
      assert.equal(current.takePassword(first.id), 'transient-test-value')
      assert.equal(current.takePassword(first.id), undefined)
      assert.equal(current.form.password, '')
    } finally { await act(async () => view.unmount()) }
  })
  test('Given an opened target, when its address is saved, then close the stale iframe and connect a fresh instance', async () => {
    let current, view
    function Harness() { current = useMachines(); return null }
    await act(async () => { view = create(React.createElement(Harness)) })
    try {
      await waitFor(() => current.machines.length === 2)
      await act(async () => current.select(first))
      await waitFor(() => current.desktops.length === 1)
      const instance = current.desktops[0].instance
      await act(async () => current.change({ address: 'changed.example' }))
      await act(async () => current.save(false))
      await waitFor(() => !current.busy)
      assert.equal(current.desktops.length, 0)
      await act(async () => current.save(true))
      await waitFor(() => !current.busy)
      assert.equal(current.desktops[0].address, 'changed.example')
      assert.notEqual(current.desktops[0].instance, instance)
    } finally { await act(async () => view.unmount()) }
  })
  test('Given a disconnected view, when Connect is clicked, then replace it with a fresh iframe instance', async () => {
    let current, view
    function Harness() { current = useMachines(); return null }
    await act(async () => { view = create(React.createElement(Harness)) })
    try {
      await waitFor(() => current.machines.length === 2)
      await act(async () => current.select(first))
      await waitFor(() => current.desktops.length === 1)
      const instance = current.desktops[0].instance
      current.stateChanged(first.id, 'DISCONNECTED')
      await act(async () => current.save(true))
      await waitFor(() => !current.busy)
      assert.notEqual(current.desktops[0].instance, instance)
    } finally { await act(async () => view.unmount()) }
  })
test('Given recorded connection events, when filtering current machine, then retain each event and its timestamp', async () => {
  const events = ['attempt', 'connected', 'disconnected', 'failed'].map((event, index) => ({ id: String(index), machineId: index === 3 ? 'two' : 'one', machineName: index === 3 ? 'Lab' : 'Work', username: 'alice', address: 'host', event, occurredAt: `2026-10-15T01:00:0${index}.000Z` }))
  let view
  await act(async () => { view = create(React.createElement(ConnectionHistory, { events, selectedId: 'one' })) })
  try {
    assert.equal(view.root.findAllByType('li').length, 4)
    assert.match(text(view.toJSON()), /尝试连接/)
    assert.match(text(view.toJSON()), /桌面已就绪/)
    assert.match(text(view.toJSON()), /已断开/)
    assert.match(text(view.toJSON()), /连接失败/)
    await act(async () => view.root.findByType('input').props.onChange({ target: { checked: true } }))
    assert.equal(view.root.findAllByType('li').length, 3)
    assert.equal(view.root.findAllByType('time')[0].props.dateTime, events[0].occurredAt)
    assert.doesNotMatch(text(view.toJSON()), /Lab/)
  } finally { await act(async () => view.unmount()) }
})
test('Given paged instance history, when loading earlier entries and filtering, then preserve each event and query the selected machine', async () => {
  const event = (id, kind) => ({ id, machineId: 'one', machineName: 'Work', username: 'alice', address: 'host', event: kind, occurredAt: '2026-10-15T01:00:00.000Z' })
  historyEvents = [event('latest', 'connected')]; moreHistory = [event('earlier', 'attempt')]
  let current, view
  function Harness() { current = useConnectionHistory(); return null }
  await act(async () => { view = create(React.createElement(Harness)) })
  try {
    await waitFor(() => current.events.length === 1)
    await act(async () => current.loadMore())
    await waitFor(() => current.events.length === 2)
    assert.deepEqual(current.events.map(entry => entry.id), ['latest', 'earlier'])
    assert.ok(rpcCalls.some(call => call.endpoint === 'history/list' && call.payload.cursor === 'next-page'))
    await act(async () => current.setMachineFilter('two'))
    await waitFor(() => !current.loading)
    assert.equal(current.events.length, 0)
    assert.equal(rpcCalls.at(-1).payload.machineId, 'two')
  } finally { await act(async () => view.unmount()); historyEvents = []; moreHistory = [] }
})
test('Given a gateway failure, when duplicate terminal states and manual close occur, then save exactly one sanitized failure event', async () => {
  let current, view
  function Harness() { current = useMachines(); return null }
  await act(async () => { view = create(React.createElement(Harness)) })
  const start = rpcCalls.length
  try {
    await waitFor(() => current.machines.length === 2)
    await act(async () => current.select(first))
    await waitFor(() => current.desktops.length === 1)
    await act(async () => { current.stateChanged(first.id, 'TUNNEL_ERROR'); current.stateChanged(first.id, 'TUNNEL_ERROR'); current.stateChanged(first.id, 'DISCONNECTED'); current.disconnect(first.id) })
    const records = rpcCalls.slice(start).filter(call => call.endpoint === 'machines/event')
    assert.equal(records.length, 1)
    assert.deepEqual(records[0].payload, { id: first.id, event: 'failed', reason: 'gateway' })
  } finally { await act(async () => view.unmount()) }
  assert.equal(rpcCalls.slice(start).filter(call => call.endpoint === 'machines/event').length, 1)
})
test('Given an observed ready tunnel, when recording success and unmounting, then send the exact UUID and a single close event', async () => {
  let current, view
  function Harness() { current = useMachines(); return null }
  await act(async () => { view = create(React.createElement(Harness)) })
  const start = rpcCalls.length
  try {
    await waitFor(() => current.machines.length === 2)
    await act(async () => current.select(first))
    await waitFor(() => current.desktops.length === 1)
    await act(async () => { current.stateChanged(first.id, 'CONNECTED', 'ready-tunnel'); current.connected(first.id, 'ready-tunnel') })
    assert.deepEqual(rpcCalls.slice(start).find(call => call.endpoint === 'machines/connected').payload, { id: first.id, sessionId: 'ready-tunnel' })
  } finally { await act(async () => view.unmount()) }
  const records = rpcCalls.slice(start).filter(call => call.endpoint === 'machines/event')
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].payload, { id: first.id, event: 'disconnected', reason: 'closed', sessionId: 'ready-tunnel' })
})
test('Given the native DSH connection, when the plugin initializes, then call its existing RPC prefix with a bounded signal', async () => {
  let captured, dispose
  applyClient({
    get: () => ({ rpc: { call: async (...args) => { captured = args; return { ok: true, value: { machines: [first], warning: '网关暂时不可用，显示 DSH 已保存的机器' } } } } }),
    effect: callback => { dispose = callback() },
    slots: { inject() {} },
  })
  try {
    const machines = await api.list()
    assert.equal(machines.machines[0].id, first.id)
    assert.match(machines.warning, /网关暂时不可用/)
    assert.equal(captured[0], '/api')
    assert.equal(captured[1], 'rdp/machines/list')
    assert.deepEqual(captured[2], {})
    assert.ok(captured[3] instanceof AbortSignal)
  } finally { dispose(); setRpcTransport(rpc) }
})
test('Given NLA remains pending beyond five minutes, when the desktop later becomes ready, then detect success and enable session sharing', async () => {
  const originalSetInterval = window.setInterval, originalClearInterval = window.clearInterval
  let tick, active = true, ready = false, view
  const successes = []
  const key = first.url.split('/').at(-1)
  const managed = { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'late-ready' }, get requiredParameters() { return ready ? {} : { password: {} } }, client: { getDisplay: () => ({ getWidth: () => ready ? 1280 : 0, getHeight: () => ready ? 800 : 0 }) } }
  const iframe = { contentWindow: { location: { origin: window.location.origin, href: first.url }, document: { body: {} }, angular: { element: () => ({ injector: () => ({ get: () => ({ getManagedClients: () => ({ [key]: managed }) }) }) }) } } }
  window.setInterval = callback => { tick = () => { if (active) callback() }; return 1 }
  window.clearInterval = () => { active = false }
  await act(async () => { view = create(React.createElement(DesktopView, { desktop: { ...first, instance: 'late-view' }, visible: true, takePassword: () => undefined, onConnected: (...args) => { successes.push(args); return Promise.resolve(true) }, onState() {}, onDisconnect() {} }), { createNodeMock: element => element.type === 'iframe' ? iframe : null }) })
  try {
    await act(async () => { for (let index = 0; index < 650; index++) tick() })
    assert.match(text(view.toJSON()), /等待登录信息/)
    ready = true
    await act(async () => tick())
    assert.deepEqual(successes, [[first.id, 'late-ready']])
    assert.equal(button(view, '在独立窗口').props.disabled, false)
  } finally { await act(async () => view.unmount()); window.setInterval = originalSetInterval; window.clearInterval = originalClearInterval }
})
test('Given a terminal history write fails temporarily, when the same state is observed again, then retry after failure and deduplicate pending and acknowledged requests', async () => {
  const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout
  let current, view, completeFirst, retry, attempts = 0
  window.setTimeout = callback => { retry = callback; return 1 }; window.clearTimeout = () => {}
  setRpcTransport(async (endpoint, payload, signal) => {
    if (endpoint === 'machines/event') {
      attempts++
      if (attempts === 1) return new Promise(resolve => { completeFirst = resolve })
    }
    return rpc(endpoint, payload, signal)
  })
  function Harness() { current = useMachines(); return null }
  await act(async () => { view = create(React.createElement(Harness)) })
  try {
    await waitFor(() => current.machines.length === 2)
    await act(async () => current.select(first))
    await act(async () => { current.stateChanged(first.id, 'TUNNEL_ERROR'); current.stateChanged(first.id, 'TUNNEL_ERROR') })
    assert.equal(attempts, 1)
    await act(async () => completeFirst({ ok: false, error: { code: 'rdp/storage', message: '暂时无法保存。', details: { status: 502 } } }))
    assert.match(current.gatewayError, /连接记录保存失败/)
    await act(async () => { current.stateChanged(first.id, 'TUNNEL_ERROR'); current.stateChanged(first.id, 'DISCONNECTED') })
    assert.equal(attempts, 1)
    await act(async () => retry())
    assert.equal(attempts, 2)
    await act(async () => current.stateChanged(first.id, 'DISCONNECTED'))
    assert.equal(attempts, 2)
  } finally { await act(async () => view.unmount()); setRpcTransport(rpc); window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout }
})
test('Given a ready desktop whose success record fails, when readiness is polled again, then retry until acknowledged once', async () => {
  const originalSetInterval = window.setInterval, originalClearInterval = window.clearInterval
  let tick, view, settleFirst, calls = 0
  const key = first.url.split('/').at(-1)
  const managed = { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'record-retry' }, requiredParameters: {}, client: { getDisplay: () => ({ getWidth: () => 1280, getHeight: () => 800 }) } }
  const iframe = { contentWindow: { location: { origin: window.location.origin, href: first.url }, document: { body: {} }, angular: { element: () => ({ injector: () => ({ get: () => ({ getManagedClients: () => ({ [key]: managed }) }) }) }) } } }
  window.setInterval = callback => { tick = callback; return 1 }; window.clearInterval = () => {}
  await act(async () => { view = create(React.createElement(DesktopView, { desktop: { ...first, instance: 'success-record-retry' }, visible: true, takePassword: () => undefined, onConnected: () => { calls++; return calls === 1 ? new Promise(resolve => { settleFirst = resolve }) : Promise.resolve(true) }, onState() {}, onDisconnect() {} }), { createNodeMock: element => element.type === 'iframe' ? iframe : null }) })
  try {
    await act(async () => { tick(); tick() })
    assert.equal(calls, 1)
    await act(async () => settleFirst(false))
    await act(async () => tick())
    assert.equal(calls, 2)
    await act(async () => tick())
    assert.equal(calls, 2)
  } finally { await act(async () => view.unmount()); window.setInterval = originalSetInterval; window.clearInterval = originalClearInterval }
})
test('Given an explicit disconnect closes its iframe, when its first history write fails, then retry independently and retain the error across list refresh', async () => {
  const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout
  let retry, current, view, attempts = 0
  window.setTimeout = callback => { retry = callback; return 1 }; window.clearTimeout = () => {}
  setRpcTransport(async (endpoint, payload, signal) => {
    if (endpoint === 'machines/event' && ++attempts === 1) return { ok: false, error: { code: 'rdp/storage', message: '暂时无法保存。', details: { status: 502 } } }
    return rpc(endpoint, payload, signal)
  })
  function Harness() { current = useMachines(); return null }
  await act(async () => { view = create(React.createElement(Harness)) })
  try {
    await waitFor(() => current.machines.length === 2)
    await act(async () => current.select(first))
    await act(async () => current.disconnect(first.id))
    assert.equal(current.desktops.length, 0)
    assert.equal(attempts, 1)
    assert.match(current.gatewayError, /连接记录保存失败/)
    await act(async () => current.refresh())
    assert.match(current.gatewayError, /连接记录保存失败/)
    assert.equal(typeof retry, 'function')
    await act(async () => retry())
    assert.equal(attempts, 2)
    assert.equal(current.gatewayError, '')
  } finally { await act(async () => view.unmount()); setRpcTransport(rpc); window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout }
})
test('Given closing history cannot be acknowledged, when deleting a machine, then preserve the machine and show the failure', async () => {
  const originalSetTimeout = window.setTimeout, originalClearTimeout = window.clearTimeout
  let current, view
  window.setTimeout = () => 1; window.clearTimeout = () => {}
  setRpcTransport(async (endpoint, payload, signal) => endpoint === 'machines/event' ? { ok: false, error: { code: 'rdp/storage', message: '暂时无法保存。', details: { status: 502 } } } : rpc(endpoint, payload, signal))
  function Harness() { current = useMachines(); return null }
  await act(async () => { view = create(React.createElement(Harness)) })
  const start = rpcCalls.length
  try {
    await waitFor(() => current.machines.length === 2)
    await act(async () => current.select(first))
    await act(async () => current.remove(first))
    assert.ok(current.machines.some(machine => machine.id === first.id))
    assert.match(current.gatewayError, /连接记录保存失败/)
    assert.equal(rpcCalls.slice(start).filter(call => call.endpoint === 'machines/delete').length, 0)
    assert.equal(current.busy, false)
    await act(async () => current.disconnect(first.id))
    assert.equal(current.desktops.length, 0)
    await act(async () => current.remove(first))
    assert.ok(current.machines.some(machine => machine.id === first.id))
    assert.equal(rpcCalls.slice(start).filter(call => call.endpoint === 'machines/delete').length, 0)
  } finally { await act(async () => view.unmount()); setRpcTransport(rpc); window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout }
})
test.after(async () => { disposeTransport(); delete globalThis.window; await unlink(path) })
