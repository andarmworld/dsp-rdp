import { array, object, optional, string, enum as enumSchema, readonly, type infer as Infer } from 'zod/mini'
export const connectionEventSchema = readonly(object({
  id: string(), machineId: string(), machineName: string(), address: string(), username: string(),
  event: enumSchema(['attempt', 'connected', 'disconnected', 'failed']), occurredAt: string(), detail: optional(string()),
}))
export const historyPageSchema = object({ events: array(connectionEventSchema), nextCursor: optional(string()) })
export type ConnectionEvent = Infer<typeof connectionEventSchema>
export type ConnectionEventKind = ConnectionEvent['event']
export type HistoryReason = 'closed' | 'cancelled' | 'gateway' | 'client'
export type HistoryMutation = { readonly event: 'disconnected' | 'failed'; readonly sessionId?: string; readonly reason?: HistoryReason }
