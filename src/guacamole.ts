// Bridge pinned to Apache Guacamole 1.6.0's Angular client manager.
export type SessionSnapshot = { readonly state: string; readonly uuid: string | null }
type Identifier = { readonly id: string; readonly type: string; readonly dataSource: string }
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' }
export function clientKey(value: string, origin: string): string | null {
  try { return new URL(value, origin).hash.match(/^#\/client\/([^/?]+)/)?.[1] ?? null } catch { return null }
}
export function connectionIdentifier(value: string, origin: string): Identifier | null {
  const key = clientKey(value, origin)
  if (!key) return null
  try {
    const [id, type, dataSource, extra] = atob(key.replace(/-/g, '+').replace(/_/g, '/')).split('\0')
    return id && (type === 'c' || type === 'a') && dataSource && extra === undefined ? { id, type, dataSource } : null
  } catch { return null }
}
export function activeSessionUrl(value: string, uuid: string, origin: string): string {
  const url = new URL(value, origin)
  if (url.origin !== origin || !uuid) throw new BridgeError('当前网关无法安全复用会话，请保留嵌入视图。')
  const key = btoa(`${uuid}\0a\0postgresql`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  url.hash = `/client/${key}`
  url.search = ''
  return url.href
}
export class BridgeError extends Error {}
export function inspectManagedClients(clients: unknown, key: string): SessionSnapshot {
  if (!record(clients)) return { state: 'WAITING', uuid: null }
  const client = clients[key]
  if (!record(client) || !record(client['clientState'])) return { state: 'WAITING', uuid: null }
  const state = client['clientState']['connectionState']
  const tunnel = client['tunnel']
  const required = client['requiredParameters']
  if (record(required) && Object.keys(required).length > 0) return { state: 'WAITING_FOR_INPUT', uuid: null }
  if (state === 'CONNECTED') {
    const guacamoleClient = client['client']
    const display: unknown = record(guacamoleClient) && typeof guacamoleClient['getDisplay'] === 'function' ? guacamoleClient['getDisplay']() : null
    const width: unknown = record(display) && typeof display['getWidth'] === 'function' ? display['getWidth']() : null
    const height: unknown = record(display) && typeof display['getHeight'] === 'function' ? display['getHeight']() : null
    if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { state: 'PREPARING_DISPLAY', uuid: null }
  }
  return { state: typeof state === 'string' ? state : 'WAITING', uuid: state === 'CONNECTED' && record(tunnel) && typeof tunnel['uuid'] === 'string' ? tunnel['uuid'] : null }
}
export function managedClientContext(win: Window, origin: string): { readonly client: Record<string, unknown>; readonly injector: Record<string, unknown> } | null {
  if (win.location.origin !== origin) return null
  const angular: unknown = Reflect.get(win, 'angular')
  if (!record(angular) || typeof angular['element'] !== 'function') return null
  const element: unknown = angular['element'](win.document.body)
  if (!record(element) || typeof element['injector'] !== 'function') return null
  const injector: unknown = element['injector']()
  if (!record(injector) || typeof injector['get'] !== 'function') return null
  const manager: unknown = injector['get']('guacClientManager')
  const key = clientKey(win.location.href, origin)
  if (!key || !record(manager) || typeof manager['getManagedClients'] !== 'function') return null
  const clients: unknown = manager['getManagedClients']()
  const client = record(clients) ? clients[key] : null
  return record(client) ? { client, injector } : null
}
export function observeFrame(frame: HTMLIFrameElement): SessionSnapshot {
  try {
    const win = frame.contentWindow
    if (!win || win.location.origin !== window.location.origin) return { state: 'UNAVAILABLE', uuid: null }
    const context = managedClientContext(win, window.location.origin)
    return context ? inspectManagedClients({ current: context.client }, 'current') : { state: 'WAITING', uuid: null }
  } catch { return { state: 'UNAVAILABLE', uuid: null } }
}
/** Submit only a visible NLA password prompt, once. The caller consumes its secret first. */
export function submitPassword(frame: HTMLIFrameElement, password: string): boolean {
  const doc = frame.contentDocument
  const field = doc?.querySelector('input[name="password"]')
  if (!field || field.tagName !== 'INPUT' || !field.getClientRects().length || !doc) return false
  const form = field.closest('form')
  const button = form?.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
  if (!button) return false
  const win = doc.defaultView
  const inputConstructor: unknown = win && Reflect.get(win, 'HTMLInputElement')
  if (typeof inputConstructor !== 'function') return false
  Object.getOwnPropertyDescriptor(inputConstructor.prototype, 'value')?.set?.call(field, password)
  const event = doc.createEvent('Event')
  event.initEvent('input', true, false)
  field.dispatchEvent(event)
  if ('click' in button && typeof button.click === 'function') button.click()
  return true
}
