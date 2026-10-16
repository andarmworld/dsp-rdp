import { useConnectionHistory } from './useConnectionHistory.js'
import type { HistoryMutation } from './history.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage, type RemoteMachine } from './api.js'
import type { Desktop } from './DesktopView.js'
export type FormValues = { readonly name: string; readonly username: string; readonly password: string; readonly address: string; readonly rememberPassword: boolean }
const empty: FormValues = { name: '', username: '', password: '', address: '', rememberPassword: false }
export function useMachines() {
  const history = useConnectionHistory()
  const [machines, setMachines] = useState<readonly RemoteMachine[]>([])
  const [desktops, setDesktops] = useState<readonly Desktop[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [formError, setFormError] = useState('')
  const [gatewayError, setGatewayError] = useState('')
  const [terminalError, setTerminalError] = useState('')
  const [loading, setLoading] = useState(true)
  const [listNotice, setListNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const operation = useRef(0)
  const listOperation = useRef(0)
  const alive = useRef(true)
  const secrets = useRef(new Map<string, string>())
  const states = useRef(new Map<string, string>())
  const sessionIds = useRef(new Map<string, string>())
  const terminal = useRef(new Set<string>())
  const pendingTerminal = useRef(new Map<string, Promise<boolean>>())
  const terminalJobs = useRef(new Map<string, { readonly desktop: Desktop; readonly value: HistoryMutation }>())
  const retryTimers = useRef(new Map<string, number>())
  const retryCounts = useRef(new Map<string, number>())
  const desktopsRef = useRef(desktops)
  desktopsRef.current = desktops
  const recordTerminal = useCallback(function deliver(desktop: Desktop, value: HistoryMutation): Promise<boolean> {
    if (terminal.current.has(desktop.instance)) return Promise.resolve(true)
    const pending = pendingTerminal.current.get(desktop.instance)
    if (pending) return pending
    if (retryTimers.current.has(desktop.instance)) return Promise.resolve(false)
    terminalJobs.current.set(desktop.instance, { desktop, value })
    const request = api.event(desktop.id, value).then(() => {
      terminal.current.add(desktop.instance); retryCounts.current.delete(desktop.instance); terminalJobs.current.delete(desktop.instance)
      if (alive.current) { if (!retryCounts.current.size) setTerminalError(''); history.refresh() }
      return true
    }).catch((error: unknown) => {
      if (alive.current) {
        setTerminalError(`连接记录保存失败：${errorMessage(error)}`)
        const failures = (retryCounts.current.get(desktop.instance) ?? 0) + 1
        retryCounts.current.set(desktop.instance, failures)
        const delay = Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000)
        retryTimers.current.set(desktop.instance, window.setTimeout(() => {
          retryTimers.current.delete(desktop.instance)
          if (alive.current) void deliver(desktop, value)
        }, delay))
      }
      return false
    }).finally(() => pendingTerminal.current.delete(desktop.instance))
    pendingTerminal.current.set(desktop.instance, request)
    return request
  }, [history.refresh])
  const upsert = useCallback((machine: RemoteMachine) => {
    if (alive.current) { listOperation.current++; setLoading(false); setMachines(previous => [...previous.filter(item => item.id !== machine.id), machine].sort((a, b) => (b.lastConnectedAt ?? '').localeCompare(a.lastConnectedAt ?? '') || a.name.localeCompare(b.name))) }
  }, [])
  const refresh = useCallback(async () => {
    const serial = ++listOperation.current
    setLoading(true)
    try { const next = await api.list(); if (alive.current && serial === listOperation.current) { setMachines(next.machines); setListNotice(next.warning ?? ''); setGatewayError('') } }
    catch (error) { if (alive.current && serial === listOperation.current) setGatewayError(errorMessage(error)) }
    finally { if (alive.current && serial === listOperation.current) setLoading(false) }
  }, [])
  useEffect(() => {
    alive.current = true
    void refresh()
    return () => {
      alive.current = false; operation.current++; listOperation.current++; secrets.current.clear()
      for (const timer of retryTimers.current.values()) window.clearTimeout(timer)
      retryTimers.current.clear()
      for (const desktop of desktopsRef.current) { const sessionId = sessionIds.current.get(desktop.id); recordTerminal(desktop, { event: 'disconnected', reason: sessionId ? 'closed' : 'cancelled', ...(sessionId ? { sessionId } : {}) }) }
    }
  }, [refresh, recordTerminal])
  function change(next: Partial<FormValues>): void {
    operation.current++; setBusy(false); setForm(previous => ({ ...previous, ...next })); setFormError('')
  }
  function fill(machine: RemoteMachine): void {
    operation.current++; setBusy(false); setFormError(''); setEditingId(machine.id)
    setForm({ name: machine.name, username: machine.username, password: '', address: machine.address, rememberPassword: machine.hasSavedPassword })
  }
  function newMachine(): void { operation.current++; setBusy(false); setEditingId(undefined); setForm(empty); setFormError('') }
  function disconnect(id: string): void {
    const desktop = desktopsRef.current.find(item => item.id === id)
    const sessionId = sessionIds.current.get(id)
    if (desktop) recordTerminal(desktop, { event: 'disconnected', reason: sessionId ? 'closed' : 'cancelled', ...(sessionId ? { sessionId } : {}) })
    operation.current++; setBusy(false); secrets.current.delete(id); states.current.delete(id); setDesktops(previous => previous.filter(item => item.id !== id))
  }
  const takePassword = useCallback((id: string): string | undefined => { const value = secrets.current.get(id); secrets.current.delete(id); return value }, [])
  async function open(machine: RemoteMachine, serial: number, password?: string): Promise<void> {
    let result
    try { result = await api.connect(machine.id, password ? { password } : {}) } finally { if (alive.current) history.refresh() }
    if (!alive.current || serial !== operation.current) return
    sessionIds.current.delete(machine.id); states.current.delete(machine.id)
    if (result.password) secrets.current.set(machine.id, result.password)
    setDesktops(previous => [...previous.filter(item => item.id !== machine.id), { id: machine.id, name: machine.name, url: result.url, instance: crypto.randomUUID(), gatewayId: machine.gatewayId, address: machine.address, username: machine.username }])
    setSelectedId(machine.id)
    setGatewayError('')
    setForm(previous => ({ ...previous, password: '' }))
  }
  async function select(machine: RemoteMachine): Promise<void> {
    fill(machine); setSelectedId(machine.id)
    if (desktops.some(item => item.id === machine.id)) return
    const serial = operation.current
    setBusy(true)
    try { await open(machine, serial) }
    catch (error) { if (alive.current && serial === operation.current) setGatewayError(errorMessage(error)) }
    finally { if (alive.current && serial === operation.current) setBusy(false) }
  }
  async function save(connect: boolean): Promise<void> {
    if (!form.name.trim() || !form.username.trim() || !form.address.trim()) { setFormError('请填写机器名称、登录名和连接地址。'); return }
    const serial = ++operation.current
    const values = { name: form.name.trim(), username: form.username.trim(), address: form.address.trim(), rememberPassword: form.rememberPassword, ...(form.password ? { password: form.password } : {}) }
    setBusy(true); setFormError('')
    try {
      const machine = await api.save(values, editingId)
      upsert(machine)
      const existing = desktops.find(item => item.id === machine.id)
      const changedTarget = existing && (existing.gatewayId !== machine.gatewayId || existing.address !== machine.address || existing.username !== machine.username)
      if (changedTarget && alive.current) { const sessionId = sessionIds.current.get(machine.id); recordTerminal(existing, { event: 'disconnected', reason: sessionId ? 'closed' : 'cancelled', ...(sessionId ? { sessionId } : {}) }); secrets.current.delete(machine.id); states.current.delete(machine.id); setDesktops(previous => previous.filter(item => item.id !== machine.id)) }
      if (!alive.current || serial !== operation.current) return
      setEditingId(machine.id); setSelectedId(machine.id); setGatewayError('')
      if (connect) {
        const state = states.current.get(machine.id) ?? 'WAITING'
        const retry = ['DISCONNECTED', 'CLIENT_ERROR', 'TUNNEL_ERROR', 'TIMEOUT'].includes(state)
        if (!existing || changedTarget || retry) await open(machine, serial, form.password || undefined)
        else {
          let result
          try { result = await api.connect(machine.id, form.password ? { password: form.password } : {}) } finally { if (alive.current) history.refresh() }
          if (alive.current && serial === operation.current && state !== 'CONNECTED' && result.password) secrets.current.set(machine.id, result.password)
        }
      }
      if (alive.current && serial === operation.current) setForm(previous => ({ ...previous, password: '' }))
    } catch (error) {
      if (alive.current && serial === operation.current) {
        if (error instanceof ApiError && error.status === 400) setFormError(errorMessage(error))
        else setGatewayError(errorMessage(error))
      }
    } finally { if (alive.current && serial === operation.current) setBusy(false) }
  }
  async function remove(machine: RemoteMachine): Promise<void> {
    if (!window.confirm(`删除“${machine.name}”及保存的登录信息？打开的嵌入视图也会关闭。`)) return
    const serial = ++operation.current
    setBusy(true)
    try {
      const queued = [...terminalJobs.current.values()].filter(job => job.desktop.id === machine.id)
      for (const job of queued) if (!await recordTerminal(job.desktop, job.value)) return
      const desktop = desktopsRef.current.find(item => item.id === machine.id)
      const sessionId = sessionIds.current.get(machine.id)
      if (desktop && !await recordTerminal(desktop, { event: 'disconnected', reason: sessionId ? 'closed' : 'cancelled', ...(sessionId ? { sessionId } : {}) })) return
      await api.remove(machine.id)
      if (!alive.current) return
      listOperation.current++; setLoading(false)
      setMachines(previous => previous.filter(item => item.id !== machine.id)); setDesktops(previous => previous.filter(item => item.id !== machine.id)); secrets.current.delete(machine.id)
      if (serial === operation.current) { if (selectedId === machine.id) setSelectedId(null); if (editingId === machine.id) { setEditingId(undefined); setForm(empty) } setGatewayError('') }
    } catch (error) { if (alive.current && serial === operation.current) setGatewayError(errorMessage(error)) }
    finally { if (alive.current && serial === operation.current) setBusy(false) }
  }
  const stateChanged = useCallback((id: string, state: string, sessionId?: string) => {
    states.current.set(id, state)
    if (sessionId) sessionIds.current.set(id, sessionId)
    const desktop = desktopsRef.current.find(item => item.id === id)
    if (desktop && ['CLIENT_ERROR', 'TUNNEL_ERROR', 'DISCONNECTED', 'TIMEOUT'].includes(state)) {
      const actualSession = sessionIds.current.get(id)
      recordTerminal(desktop, { event: state === 'DISCONNECTED' ? 'disconnected' : 'failed', reason: state === 'CLIENT_ERROR' ? 'client' : 'gateway', ...(actualSession ? { sessionId: actualSession } : {}) })
    }
  }, [recordTerminal])
  const connected = useCallback(async (id: string, sessionId: string): Promise<boolean> => {
    sessionIds.current.set(id, sessionId)
    try {
      const machine = await api.connected(id, sessionId)
      upsert(machine); if (alive.current) history.refresh()
      return true
    } catch (error) { if (alive.current) setGatewayError(`连接成功，但历史记录保存失败：${errorMessage(error)}`); return false }
  }, [upsert, history.refresh])
  return { history, machines, desktops, selectedId, form, editingId, formError, gatewayError: terminalError || gatewayError, listNotice, loading, busy, change, fill, newMachine, disconnect, takePassword, select, save, remove, connected, stateChanged, refresh }
}
