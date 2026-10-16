export interface Machine {
  id: string
  name: string
  url: string
}

export const STORAGE_KEY = 'dsh-rdp-plugin.machines.v1'

export function validGatewayUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function readMachines(storage: Pick<Storage, 'getItem'>): Machine[] {
  try {
    const data: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(data)) return []
    return data.filter((item): item is Machine => {
      if (item === null || typeof item !== 'object') return false
      const machine = item as Partial<Machine>
      return typeof machine.id === 'string' && typeof machine.name === 'string'
        && machine.name.trim().length > 0 && typeof machine.url === 'string'
        && validGatewayUrl(machine.url)
    })
  } catch {
    return []
  }
}
