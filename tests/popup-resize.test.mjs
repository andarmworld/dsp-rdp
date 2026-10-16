import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { activeSessionUrl } from '../src/guacamole.ts'
const bundle = await build({ entryPoints: ['src/popupResize.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const { fitPopupDesktop, watchPopupResize } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const origin = 'https://dsh.example', sessionId = 'original-active-session'
function fixture() {
  const calls = { scales: [], sizes: [], digests: 0 }
  const viewport = { offsetWidth: 800, offsetHeight: 600 }
  const dimensions = { width: 1600, height: 900 }
  const properties = { autoFit: false, scale: 2 }
  const display = { getWidth: () => dimensions.width, getHeight: () => dimensions.height, scale: value => calls.scales.push(value) }
  const client = { getDisplay: () => display, sendSize: (...values) => calls.sizes.push(values) }
  const managed = { clientState: { connectionState: 'CONNECTED' }, tunnel: { uuid: 'shared-view-tunnel' }, requiredParameters: {}, clientProperties: properties, client }
  const listeners = new Map()
  const popup = {
    closed: false, devicePixelRatio: 1,
    location: { href: activeSessionUrl('/guacamole/#/client/old', sessionId, origin), origin },
    document: { body: {}, querySelector: () => viewport },
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
  }
  const key = popup.location.href.split('/').at(-1)
  popup.angular = { element: () => ({ injector: () => ({ get: name => name === 'guacClientManager' ? { getManagedClients: () => ({ [key]: managed }) } : { $evalAsync: () => calls.digests++ } }) }) }
  return { popup, calls, viewport, dimensions, properties, managed, listeners, client }
}
function clock() {
  let serial = 0
  const intervals = new Map(), timers = new Map()
  const previous = globalThis.window
  globalThis.window = { setInterval: callback => { intervals.set(++serial, callback); return serial }, clearInterval: id => intervals.delete(id), setTimeout: callback => { timers.set(++serial, callback); return serial }, clearTimeout: id => timers.delete(id) }
  return { intervals, timers, tick: () => [...intervals.values()].forEach(callback => callback()), flush: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()) }, restore: () => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous } }
}
test('Given a shared popup, when its window grows, then fit proportionally and request the new pixel dimensions without changing its session', () => {
  const value = fixture()
  const first = fitPopupDesktop(value.popup, sessionId, origin)
  assert.equal(first.scale, .5)
  assert.equal(value.properties.autoFit, true)
  value.viewport.offsetWidth = 1600; value.viewport.offsetHeight = 1000; value.popup.devicePixelRatio = 2
  const larger = fitPopupDesktop(value.popup, sessionId, origin, first)
  assert.equal(larger.scale, 1)
  assert.deepEqual(value.calls.sizes, [[800, 600], [3200, 2000]])
  assert.equal(value.popup.location.href, activeSessionUrl('/guacamole/#/client/old', sessionId, origin))
  assert.equal(value.managed.tunnel.uuid, 'shared-view-tunnel')
})
test('Given a resolution response or unchanged viewport, when fitting again, then avoid redundant size requests and resize feedback loops', () => {
  const value = fixture()
  const first = fitPopupDesktop(value.popup, sessionId, origin)
  assert.equal(fitPopupDesktop(value.popup, sessionId, origin, first), first)
  value.dimensions.width = 800; value.dimensions.height = 600
  const updated = fitPopupDesktop(value.popup, sessionId, origin, first)
  assert.equal(updated.scale, 1)
  assert.deepEqual(value.calls.sizes, [[800, 600]])
})
test('Given a client without remote resizing, when adapting its popup, then retain local auto-fit without reconnecting', () => {
  const value = fixture()
  delete value.client.sendSize
  assert.equal(fitPopupDesktop(value.popup, sessionId, origin).scale, .5)
  assert.deepEqual(value.calls.scales, [.5])
  assert.deepEqual(value.calls.sizes, [])
})
test('Given a pending NLA popup or another session route, when fitting, then never resize an unready or unrelated session', () => {
  const value = fixture()
  value.managed.requiredParameters = { password: {} }
  assert.equal(fitPopupDesktop(value.popup, sessionId, origin), undefined)
  value.managed.requiredParameters = {}
  assert.throws(() => fitPopupDesktop(value.popup, 'another-session', origin))
  assert.deepEqual(value.calls.sizes, [])
})
test('Given a navigated popup, when resizing and refreshing it, then rebind the new document and clean all timers/listeners after close', () => {
  const time = clock(), value = fixture(), errors = []
  let stopped = 0
  const dispose = watchPopupResize(value.popup, sessionId, origin, error => errors.push(error), () => stopped++)
  try {
    time.flush()
    assert.equal(value.listeners.has('resize'), true)
    value.viewport.offsetWidth = 1200
    value.listeners.get('resize')()
    time.flush()
    assert.deepEqual(value.calls.sizes.at(-1), [1200, 600])
    value.popup.document = { body: {}, querySelector: () => value.viewport }; value.listeners.clear()
    time.tick()
    assert.equal(value.listeners.has('resize'), true)
    assert.equal(value.calls.sizes.length, 3)
    value.popup.closed = true; time.tick(); time.tick()
    assert.equal(stopped, 1)
    assert.equal(time.intervals.size, 0); assert.equal(time.timers.size, 0); assert.equal(value.listeners.size, 0)
    assert.deepEqual(errors, [])
  } finally { dispose(); time.restore() }
})
test('Given multiple watched popups, when the component disposes them, then stop each watcher without closing the desktop views', () => {
  const time = clock(), first = fixture(), second = fixture()
  const disposeFirst = watchPopupResize(first.popup, sessionId, origin, () => assert.fail('unexpected error'), () => {})
  const disposeSecond = watchPopupResize(second.popup, sessionId, origin, () => assert.fail('unexpected error'), () => {})
  try {
    time.flush(); disposeFirst(); disposeSecond()
    assert.equal(time.intervals.size, 0); assert.equal(time.timers.size, 0)
    assert.equal(first.popup.closed, false); assert.equal(second.popup.closed, false)
    assert.equal(first.listeners.size, 0); assert.equal(second.listeners.size, 0)
  } finally { disposeFirst(); disposeSecond(); time.restore() }
})
