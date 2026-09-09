export const API_URL = import.meta.env.VITE_API_URL ?? ''

export type Level = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
export type Status = 'ONLINE' | 'OFFLINE' | 'WARNING'

export interface EventItem {
  id: string; timestamp: string; level: Level; event: string; signal: string | null
  expected: string | null; received: string | null; result: string | null
  possibleCause: string | null; evidence: string[]; loggerId: string; pieceId: string
}
export interface Part {
  id: string; pieceId: string; serialNumber: string; model: string; description?: string
  vehicleIdentifier?: string; loggerId: string; status: Status; lastSeen: string
  firmwareVersion?: string; communicationMode?: string; batteryVoltage?: number
  pendingEvents?: number; latestFailure?: EventItem | null
}
export interface Logger {
  id: string; loggerId: string; pieceId?: string; status: Status; lastSeen?: string
  firmwareVersion?: string; communicationMode?: string; batteryVoltage?: number; pendingEvents?: number
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error ?? `Erro HTTP ${response.status}`)
  }
  return response.json()
}
