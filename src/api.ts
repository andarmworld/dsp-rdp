import { historyPageSchema, type HistoryMutation } from './history.js'
import { object, string, boolean, nullable, optional, readonly, array, number, maxLength, union, literal, unknown as unknownSchema, type infer as Infer } from 'zod/mini'

export const machineSchema = readonly(object({
  id: string(), name: string(), username: string(), address: string(), gatewayId: string(),
  lastConnectedAt: nullable(string()), hasSavedPassword: boolean(), url: string(),
}))
export type RemoteMachine = Infer<typeof machineSchema>
export type MachineInput = { readonly name: string; readonly username: string; readonly address: string; readonly password?: string; readonly rememberPassword?: boolean }
export class ApiError extends Error {
  constructor(message: string, readonly status: number | null = null) { super(message) }
}
export type RpcTransport = (endpoint: string, payload: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<unknown>
let transport: RpcTransport | undefined
export function setRpcTransport(next: RpcTransport): () => void {
  transport = next
  return () => { if (transport === next) transport = undefined }
}
const envelope = union([
  object({ ok: literal(true), value: unknownSchema() }),
  object({ ok: literal(false), error: object({ code: string(), message: string().check(maxLength(500)), details: optional(object({ status: optional(number()) })) }) }),
])
async function request(endpoint: string, payload: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
  if (!transport) throw new ApiError('DSH 连接尚未就绪，请重新打开远程桌面面板。')
  try {
    const result = envelope.parse(await transport(endpoint, payload, AbortSignal.timeout(20000)))
    if (!result.ok) throw new ApiError(result.error.message, result.error.details?.status ?? (['BAD_REQUEST', 'VALIDATION_ERROR', 'INVALID_INPUT', '400'].includes(result.error.code) ? 400 : null))
    return result.value
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError('无法完成 DSH 远程桌面请求，请检查连接后重试。')
  }
}
export const api = {
  async list() { return object({ machines: array(machineSchema), warning: optional(string().check(maxLength(500))) }).parse(await request('machines/list')) },
  async save(values: MachineInput, id?: string): Promise<RemoteMachine> { return machineSchema.parse(await request(id ? 'machines/edit' : 'machines/save', { ...values, ...(id ? { id } : {}) })) },
  async remove(id: string): Promise<void> { await request('machines/delete', { id }) },
  async connect(id: string, values: { readonly password?: string; readonly rememberPassword?: boolean }) {
    return object({ url: string(), password: optional(string()), reused: boolean() }).parse(await request('machines/connect', { id, ...values }))
  },
  async connected(id: string, sessionId: string): Promise<RemoteMachine> { return machineSchema.parse(await request('machines/connected', { id, sessionId })) },
  async history(machineId?: string, cursor?: string) {
    return historyPageSchema.parse(await request('history/list', { ...(machineId ? { machineId } : {}), ...(cursor ? { cursor } : {}) }))
  },
  async event(id: string, value: HistoryMutation): Promise<void> { await request('machines/event', { id, ...value }) },
}
export function errorMessage(error: unknown): string { return error instanceof ApiError ? error.message : '服务返回的数据无法识别，请刷新后重试。' }
