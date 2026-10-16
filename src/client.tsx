import type { ReactNode } from 'react'
import { ApiError, setRpcTransport } from './api.js'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RdpPanel } from './RdpPanel.js'
export { RdpPanel } from './RdpPanel.js'

const PANEL_ID = 'ligoo-rdp' as MainPanelId

function RdpIcon({ size }: { size: number }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
}

export const inject = ['slots', 'connection']

export function apply(ctx: Context): void {
  const connection: ConnectionHandle | undefined = ctx.get('connection')
  if (!connection) throw new ApiError('DSH 连接服务不可用。')
  ctx.effect(() => setRpcTransport((endpoint, payload, signal) => connection.rpc.call('/api', `rdp/${endpoint}`, payload, signal)))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, RdpPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: '远程桌面',
  }, RdpIcon))
}
