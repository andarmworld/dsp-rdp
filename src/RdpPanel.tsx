import { useState, type ReactNode } from 'react'
import { ConnectionHistory } from './ConnectionHistory.js'
import { useMachines } from './useMachines.js'
import { readMachines } from './machines.js'
import { connectionIdentifier } from './guacamole.js'
import { MachineForm } from './MachineForm.js'
import { DesktopView } from './DesktopView.js'
import { button, input, muted, row, tokens } from './styles.js'
export function RdpPanel(): ReactNode {
  const model = useMachines()
  const [search, setSearch] = useState('')
  const [legacy] = useState(() => { try { return readMachines(window.localStorage) } catch { return [] } })
  const unmatched = legacy.filter(item => {
    const url = new URL(item.url, window.location.origin)
    const parsed = connectionIdentifier(item.url, window.location.origin)
    return url.origin !== window.location.origin || !parsed || !model.machines.some(machine => machine.gatewayId === parsed.id)
  })
  const filtered = model.machines.filter(machine => `${machine.name} ${machine.address} ${machine.username}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <div className="dsh-rdp-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, color: 'inherit', padding: 16, boxSizing: 'border-box', gap: 12, fontSize: 14 }}>
    <style>{`.dsh-rdp-panel button:focus-visible,.dsh-rdp-panel input:focus-visible,.dsh-rdp-panel a:focus-visible{outline:2px solid ${tokens.focus};outline-offset:2px}.dsh-rdp-panel button:disabled{cursor:wait;opacity:.7}.dsh-rdp-panel label{line-height:1.7}.dsh-rdp-panel button:hover:not(:disabled){background:${tokens.selected}}`}</style>
    <header style={row}><h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>远程桌面</h2><span style={muted}>机器与连接历史保存在 DSH，切换机器保留会话。</span></header>
    <MachineForm values={model.form} editing={Boolean(model.editingId)} busy={model.busy} error={model.formError} onChange={model.change} onSave={connect => void model.save(connect)} onNew={model.newMachine} />
    {model.gatewayError && <div role="alert" style={{ ...row, color: tokens.error }}><span>{model.gatewayError}</span><button style={button} onClick={() => void model.refresh()}>重新加载列表</button></div>}
    <div style={row}><label style={{ ...row, flex: 1 }}>查找机器<input type="search" style={{ ...input, flex: 1, minWidth: 140 }} value={search} placeholder="名称、地址或登录名" onChange={event => setSearch(event.target.value)} /></label><button style={button} disabled={model.loading} onClick={() => void model.refresh()}>刷新列表</button></div>
    {model.listNotice && <div role="status" style={muted}>{model.listNotice}</div>}
    {model.loading && <div role="status" style={muted}>正在加载服务器机器列表…</div>}
    {!model.loading && !model.machines.length && <div style={muted}>尚无机器。填写上方配置后，添加或直接连接。</div>}
    {!model.loading && model.machines.length > 0 && !filtered.length && <div style={muted}>没有匹配的机器，请更换搜索内容。</div>}
    <div style={{ ...row, alignItems: 'stretch' }}>{filtered.map(machine => <div key={machine.id} style={{ ...row, minWidth: 0, maxWidth: '100%', border: `1px solid ${model.selectedId === machine.id ? tokens.focus : tokens.border}`, background: model.selectedId === machine.id ? tokens.selected : 'transparent', borderRadius: 8, padding: 8 }}>
      <button style={{ ...button, textAlign: 'left', overflowWrap: 'anywhere', minWidth: 0 }} aria-pressed={model.selectedId === machine.id} onClick={() => void model.select(machine)}><strong>{machine.name}</strong><div style={muted}>{machine.username} · {machine.address}</div><div style={muted}>{machine.lastConnectedAt ? `上次成功：${new Date(machine.lastConnectedAt).toLocaleString()}` : '尚无成功连接记录'}</div></button>
      <button style={button} aria-label={`编辑${machine.name}`} onClick={() => model.fill(machine)}>编辑</button><button style={button} aria-label={`删除${machine.name}`} onClick={() => void model.remove(machine)}>删除</button>
    </div>)}</div>
    {unmatched.length > 0 && <details><summary style={muted}>旧版浏览器入口（{unmatched.length}）</summary><p style={muted}>保留尚未匹配服务器机器的旧入口。可在上方添加实际机器配置；旧网关链接仍可单独打开。</p>{unmatched.map(item => <div key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a></div>)}</details>}
    <ConnectionHistory events={model.history.events} selectedId={model.selectedId} loading={model.history.loading} error={model.history.error} hasMore={Boolean(model.history.nextCursor)} onRefresh={model.history.refresh} onLoadMore={model.history.loadMore} onFilter={model.history.setMachineFilter} />
    {model.desktops.map(desktop => <DesktopView key={desktop.instance} desktop={desktop} visible={desktop.id === model.selectedId} takePassword={model.takePassword} onConnected={model.connected} onDisconnect={model.disconnect} onState={model.stateChanged} />)}
    {!model.desktops.some(desktop => desktop.id === model.selectedId) && <div style={{ ...muted, flex: 1, minHeight: 320, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: 16, boxSizing: 'border-box' }}>选择机器或填写配置后连接。密码可在网关输入。</div>}
  </div>
}
