import type { ReactNode } from 'react'
import type { FormValues } from './useMachines.js'
import { button, input, muted, row, tokens } from './styles.js'
export function MachineForm({ values, editing, busy, error, onChange, onSave, onNew }: {
  readonly values: FormValues; readonly editing: boolean; readonly busy: boolean; readonly error: string
  readonly onChange: (next: Partial<FormValues>) => void; readonly onSave: (connect: boolean) => void; readonly onNew: () => void
}): ReactNode {
  return <form onSubmit={event => { event.preventDefault(); onSave(true) }} style={{ ...row, alignItems: 'flex-end' }} autoComplete="off">
    <label style={{ flex: '1 1 140px', minWidth: 0 }}>机器名称<input style={input} value={values.name} placeholder="如：办公工作站" onChange={event => onChange({ name: event.target.value })} /></label>
    <label style={{ flex: '1 1 140px', minWidth: 0 }}>登录名<input style={input} value={values.username} placeholder="如：DOMAIN\\user" onChange={event => onChange({ username: event.target.value })} /></label>
    <label style={{ flex: '1 1 140px', minWidth: 0 }}>密码<input type="password" style={input} value={values.password} autoComplete="new-password" placeholder="可在网关中手动输入" onChange={event => onChange({ password: event.target.value })} /></label>
    <label style={{ flex: '2 1 200px', minWidth: 0 }}>连接地址<input style={input} value={values.address} placeholder="如：192.168.1.10:3389" onChange={event => onChange({ address: event.target.value })} /></label>
    <button type="submit" style={{ ...button, borderColor: tokens.focus }} disabled={busy}>{busy ? '处理中…' : '连接'}</button>
    <button type="button" style={button} disabled={busy} onClick={() => onSave(false)}>{editing ? '保存修改' : '添加机器'}</button>
    <div style={{ ...row, flexBasis: '100%' }}><label style={muted}><input type="checkbox" checked={values.rememberPassword} onChange={event => onChange({ rememberPassword: event.target.checked })} /> 在服务器加密记住密码（可选）</label>
      {editing && <button type="button" style={button} onClick={onNew}>新增机器</button>}
      <span style={muted}>地址支持主机名或 IP，可选端口，默认 3389。</span></div>
    {error && <div role="alert" style={{ color: tokens.error, width: '100%' }}>{error}</div>}
  </form>
}
