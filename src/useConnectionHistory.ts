import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from './api.js'
import type { ConnectionEvent } from './history.js'
export function useConnectionHistory() {
  const [events, setEvents] = useState<readonly ConnectionEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const filter = useRef<string | undefined>()
  const generation = useRef(0)
  const alive = useRef(true)
  const load = useCallback(async (cursor?: string) => {
    const serial = ++generation.current
    setLoading(true)
    try {
      const result = await api.history(filter.current, cursor)
      if (!alive.current || serial !== generation.current) return
      setEvents(previous => cursor ? [...new Map([...previous, ...result.events].map(event => [event.id, event])).values()] : result.events)
      setNextCursor(result.nextCursor); setError('')
    } catch (failure) { if (alive.current && serial === generation.current) setError(errorMessage(failure)) }
    finally { if (alive.current && serial === generation.current) setLoading(false) }
  }, [])
  const refresh = useCallback(() => { void load() }, [load])
  const setMachineFilter = useCallback((machineId?: string) => {
    if (filter.current === machineId) return
    filter.current = machineId; setEvents([]); setNextCursor(undefined); void load()
  }, [load])
  useEffect(() => {
    alive.current = true; refresh()
    return () => { alive.current = false; generation.current++ }
  }, [refresh])
  return { events, loading, error, nextCursor, refresh, setMachineFilter, loadMore: () => { if (nextCursor && !loading) void load(nextCursor) } }
}
