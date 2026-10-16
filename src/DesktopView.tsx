import { useEffect, useRef, useState, type ReactNode } from 'react'
import { activeSessionUrl, observeFrame, submitPassword, type SessionSnapshot } from './guacamole.js'
import { watchPopupResize } from './popupResize.js'
import { button, muted, row, tokens } from './styles.js'
export type Desktop = { readonly id: string; readonly name: string; readonly url: string; readonly instance: string; readonly gatewayId: string; readonly address: string; readonly username: string }
const labels: Readonly<Record<string, string>> = { WAITING: '等待网关', CONNECTING: '连接中', WAITING_FOR_INPUT: '等待登录信息', PREPARING_DISPLAY: '等待远程桌面画面', CONNECTED: '已连接', DISCONNECTED: '已断开', CLIENT_ERROR: '远程桌面错误', TUNNEL_ERROR: '网关连接错误', UNAVAILABLE: '无法读取网关状态', TIMEOUT: '连接等待超时' }
export function DesktopView({ desktop, visible, takePassword, onConnected, onDisconnect, onState }: {
  readonly desktop: Desktop; readonly visible: boolean; readonly takePassword: (id: string) => string | undefined
  readonly onConnected: (id: string, sessionId: string) => Promise<boolean>; readonly onDisconnect: (id: string) => void; readonly onState: (id: string, state: string, sessionId?: string) => void
}): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null)
  const popups = useRef(new Map<Window, () => void>())
  useEffect(() => () => { for (const dispose of popups.current.values()) dispose(); popups.current.clear() }, [])
  const secret = useRef<string | undefined>()
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({ state: 'WAITING', uuid: null })
  const [actionError, setActionError] = useState('')
  const successful = useRef(new Set<string>())
  const pendingSuccess = useRef(new Set<string>())
  const [discoveryWarning, setDiscoveryWarning] = useState('')
  const connectedCallback = useRef(onConnected)
  connectedCallback.current = onConnected
  const stateCallback = useRef(onState)
  stateCallback.current = onState
  useEffect(() => {
    let discoveryAttempts = 0
    let warned = false
    let passwordAttempts = 0
    const timer = window.setInterval(() => {
      const iframe = frame.current
      if (!iframe) return
      const next = observeFrame(iframe)
      stateCallback.current(desktop.id, next.state, next.uuid ?? undefined)
      const pending = takePassword(desktop.id)
      if (pending) { secret.current = pending; passwordAttempts = 0 }
      setSnapshot(previous => previous.state === next.state && previous.uuid === next.uuid ? previous : next)
      if (next.state === 'CONNECTED') {
        secret.current = undefined
        if (next.uuid && !successful.current.has(next.uuid) && !pendingSuccess.current.has(next.uuid)) {
          const uuid = next.uuid
          pendingSuccess.current.add(uuid)
          void connectedCallback.current(desktop.id, uuid).then(saved => { if (saved) successful.current.add(uuid) }).finally(() => pendingSuccess.current.delete(uuid))
        }
      }
      if (secret.current && passwordAttempts++ < 120) {
        try { if (submitPassword(iframe, secret.current)) secret.current = undefined } catch { secret.current = undefined }
      }
      if (passwordAttempts >= 120) secret.current = undefined
      // NLA and display preparation may legitimately take minutes; keep observing until unmount.
      if (next.state === 'WAITING' || next.state === 'UNAVAILABLE') {
        if (++discoveryAttempts >= 600 && !warned) { warned = true; setDiscoveryWarning('暂时无法读取网关状态，仍在等待。可检查网关后重试。') }
      } else {
        discoveryAttempts = 0
        if (warned) { warned = false; setDiscoveryWarning('') }
      }
    }, 500)
    return () => { window.clearInterval(timer); secret.current = undefined }
  }, [desktop.id, takePassword])
  function popup(): void {
    const popupWindow = window.open('about:blank', '_blank', 'popup,width=1280,height=800')
    if (!popupWindow) { setActionError('浏览器阻止了弹窗。请允许此站点弹窗后重试。'); return }
    try {
      const actual = frame.current && observeFrame(frame.current)
      if (!actual?.uuid || actual.state !== 'CONNECTED') { popupWindow.close(); setActionError('当前会话尚未连接，无法加入。请先完成嵌入视图的登录。'); return }
      popupWindow.opener = null
      popupWindow.location.replace(activeSessionUrl(desktop.url, actual.uuid, window.location.origin))
      const dispose = watchPopupResize(popupWindow, actual.uuid, window.location.origin, setActionError, () => popups.current.delete(popupWindow))
      popups.current.set(popupWindow, dispose)
      setActionError('')
    } catch { popupWindow.close(); setActionError('无法加入当前会话。请保留嵌入视图，检查网关状态后重试。') }
  }
  return <section hidden={!visible} style={{ display: visible ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', gap: 8 }}>
    <div style={row}><strong>{desktop.name}</strong><span role="status" style={{ ...muted, color: snapshot.state === 'CONNECTED' ? tokens.success : 'inherit' }}>{labels[snapshot.state] ?? '网关处理中'}</span>
      <button style={button} onClick={popup} disabled={snapshot.state !== 'CONNECTED' || !snapshot.uuid}>在独立窗口加入当前会话</button><button style={button} onClick={() => onDisconnect(desktop.id)}>断开连接</button>
      <span style={muted}>保持原页面打开；关闭独立窗口不会关闭这里的会话。</span></div>
    {discoveryWarning && <div role="status" style={muted}>{discoveryWarning}</div>}
    {actionError && <div role="alert" style={{ color: tokens.error }}>{actionError}</div>}
    <iframe ref={frame} title={`${desktop.name} 远程桌面`} src={desktop.url} style={{ width: '100%', flex: 1, minHeight: 320, border: `1px solid ${tokens.border}`, borderRadius: 8, boxSizing: 'border-box' }} allow="fullscreen; clipboard-read; clipboard-write" referrerPolicy="no-referrer" />
  </section>
}
