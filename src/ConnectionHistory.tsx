import { useEffect, useState, type ReactNode } from 'react'
import { button, muted, row, tokens } from './styles.js'
import type { ConnectionEvent, ConnectionEventKind } from './history.js'
export type { ConnectionEvent, ConnectionEventKind } from './history.js'
const labels: Readonly<Record<ConnectionEventKind, string>> = { attempt: '尝试连接', connected: '桌面已就绪', disconnected: '已断开', failed: '连接失败' }
export function ConnectionHistory({ events, selectedId, loading = false, error = '', hasMore = false, onRefresh, onLoadMore, onFilter }: {
  readonly events: readonly ConnectionEvent[]
  readonly selectedId: string | null
  readonly loading?: boolean
  readonly error?: string
  readonly hasMore?: boolean
  readonly onRefresh?: () => void
  readonly onLoadMore?: () => void
  readonly onFilter?: (machineId?: string) => void
}): ReactNode {
  const [onlySelected, setOnlySelected] = useState(false)
  useEffect(() => { onFilter?.(onlySelected && selectedId ? selectedId : undefined) }, [onlySelected, selectedId, onFilter])
  const visible = onlySelected && selectedId ? events.filter(event => event.machineId === selectedId) : events
  return <details>
    <summary>连接历史（{events.length}）</summary>
    <div style={{ ...row, paddingTop: 8 }}><span style={muted}>记录每次尝试、桌面就绪、断开和失败。</span>
      {onRefresh && <button style={button} disabled={loading} onClick={onRefresh}>刷新历史</button>}
      <label style={muted}><input type="checkbox" disabled={!selectedId} checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)} /> 仅当前机器</label></div>
    {loading && <p role="status" style={muted}>正在加载连接记录…</p>}
    {error && <p role="alert" style={{ color: tokens.error }}>{error}</p>}
    {!loading && !error && !visible.length && <p style={muted}>{onlySelected && selectedId ? '当前机器暂无连接记录。' : '暂无连接记录。'}</p>}
    <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, maxHeight: 240, overflowY: 'auto' }}>
      {visible.map(event => <li key={event.id} style={{ ...row, borderTop: `1px solid ${tokens.border}`, padding: '8px 0', overflowWrap: 'anywhere' }}>
        <time dateTime={event.occurredAt} style={muted}>{new Date(event.occurredAt).toLocaleString()}</time>
        <strong>{event.machineName}</strong><span style={muted}>{event.username} · {event.address}</span><span style={{ color: event.event === 'failed' ? tokens.error : event.event === 'connected' ? tokens.success : 'inherit' }}>{labels[event.event]}</span>
        {event.detail && <span style={muted}>{event.detail}</span>}
      </li>)}
    </ol>
    {hasMore && <button style={button} disabled={loading} onClick={onLoadMore}>{loading ? '正在加载…' : '加载更早记录'}</button>}
  </details>
}
