import { BridgeError, connectionIdentifier, inspectManagedClients, managedClientContext, record } from './guacamole.js'

// Pinned to Guacamole 1.6.0 guacClient.js mainElementResized/updateDisplayScale.
// Display.scale() and Client.sendSize() are public guacamole-common-js methods.
// https://github.com/apache/guacamole-client/blob/1.6.0/guacamole/src/main/frontend/src/app/client/directives/guacClient.js
export type PopupFit = {
  readonly document: Document; readonly display: Record<string, unknown>
  readonly viewportWidth: number; readonly viewportHeight: number
  readonly pixelWidth: number; readonly pixelHeight: number
  readonly displayWidth: number; readonly displayHeight: number; readonly scale: number
}
export function fitPopupDesktop(popup: Window, sessionId: string, origin: string, previous?: PopupFit): PopupFit | undefined {
  if (popup.location.href === 'about:blank') return undefined
  if (popup.location.origin !== origin) throw new BridgeError('独立窗口已离开当前站点，无法继续自动适配。')
  const identifier = connectionIdentifier(popup.location.href, origin)
  if (identifier?.type !== 'a' || identifier.id !== sessionId) throw new BridgeError('独立窗口已离开当前会话，已停止自动适配。')
  const context = managedClientContext(popup, origin)
  if (!context || inspectManagedClients({ current: context.client }, 'current').state !== 'CONNECTED') return undefined
  const client = context.client['client']
  const properties = context.client['clientProperties']
  if (!record(client) || typeof client['getDisplay'] !== 'function' || !record(properties)) return undefined
  const display: unknown = client['getDisplay']()
  if (!record(display) || typeof display['getWidth'] !== 'function' || typeof display['getHeight'] !== 'function' || typeof display['scale'] !== 'function') return undefined
  const width: unknown = display['getWidth'](), height: unknown = display['getHeight']()
  const viewport = popup.document.querySelector('.client-main.main')
  if (!viewport || !('offsetWidth' in viewport) || !('offsetHeight' in viewport) || typeof viewport.offsetWidth !== 'number' || typeof viewport.offsetHeight !== 'number') return undefined
  const viewportWidth = viewport.offsetWidth, viewportHeight = viewport.offsetHeight
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0 || width <= 0 || height <= 0) return undefined
  const density = Number.isFinite(popup.devicePixelRatio) && popup.devicePixelRatio > 0 ? popup.devicePixelRatio : 1
  const pixelWidth = Math.round(viewportWidth * density), pixelHeight = Math.round(viewportHeight * density)
  if (previous?.document === popup.document && previous.display === display && previous.viewportWidth === viewportWidth && previous.viewportHeight === viewportHeight && previous.displayWidth === width && previous.displayHeight === height && previous.pixelWidth === pixelWidth && previous.pixelHeight === pixelHeight) return previous
  const scale = Math.min(viewportWidth / width, viewportHeight / height)
  Object.assign(properties, { autoFit: true, minScale: scale, maxScale: Math.max(scale, 3), scale })
  display['scale'](scale)
  const rootScope: unknown = typeof context.injector['get'] === 'function' ? context.injector['get']('$rootScope') : null
  if (record(rootScope) && typeof rootScope['$evalAsync'] === 'function') rootScope['$evalAsync']()
  if (typeof client['sendSize'] === 'function' && (width !== pixelWidth || height !== pixelHeight) && (previous?.document !== popup.document || previous.pixelWidth !== pixelWidth || previous.pixelHeight !== pixelHeight)) client['sendSize'](pixelWidth, pixelHeight)
  return { document: popup.document, display, viewportWidth, viewportHeight, pixelWidth, pixelHeight, displayWidth: width, displayHeight: height, scale }
}

/** Track the navigated document, since about:blank listeners are lost on navigation. */
export function watchPopupResize(popup: Window, sessionId: string, origin: string, onError: (message: string) => void, onStopped: () => void): () => void {
  let disposed = false
  let document: Document | undefined
  let fit: PopupFit | undefined
  let resizeTimer: number | undefined
  function dispose(): void {
    if (disposed) return
    disposed = true
    window.clearInterval(pollTimer); window.clearTimeout(initialTimer)
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
    try { popup.removeEventListener('resize', resized) } catch { onError('无法继续读取独立窗口状态。') }
    onStopped()
  }
  function poll(): void {
    if (disposed) return
    if (popup.closed) { dispose(); return }
    try {
      if (popup.location.href === 'about:blank') return
      if (popup.location.origin !== origin) throw new BridgeError('独立窗口已离开当前站点，已停止自动适配。')
      if (document !== popup.document) {
        popup.removeEventListener('resize', resized)
        popup.addEventListener('resize', resized)
        document = popup.document; fit = undefined
      }
      fit = fitPopupDesktop(popup, sessionId, origin, fit)
    } catch (error) {
      onError(error instanceof BridgeError ? error.message : '无法自动适配独立窗口，请保留当前会话后重试。')
      dispose()
    }
  }
  function resized(): void {
    if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(poll, 100)
  }
  const pollTimer = window.setInterval(poll, 500)
  const initialTimer = window.setTimeout(poll, 0)
  return dispose
}
