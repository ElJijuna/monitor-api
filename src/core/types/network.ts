import type SSignal from 'ssignal'

export interface NetworkEntry {
  id: string
  url: string
  method: string
  status: number
  latency: number       // ms
  payloadSize: number   // bytes
  requestSize: number   // bytes
  initiator: 'fetch' | 'xhr'
  timestamp: number
  error: string | null
}

export interface NetworkWindow5s {
  count: number
  avgLatency: number
  totalPayload: number  // bytes
  errorRate: number     // 0-1
}

export interface NetworkSnapshot {
  entries: NetworkEntry[]
  window5s: NetworkWindow5s
}

export interface NetworkCollectorConfig {
  maxHistory: number
  filter?: (url: string) => boolean
}

export interface INetworkCollector {
  snapshot: SSignal<NetworkSnapshot>
  onRequest: SSignal<NetworkEntry | null>
  clearLog(): void
  setFilter(fn: (url: string) => boolean): void
  start(): void
  stop(): void
  destroy(): void
}
