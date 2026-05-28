import type SSignal from 'ssignal'

export interface MonitorEvent {
  id: string
  label: string
  data: Record<string, unknown> | null
  timestamp: number
}

export interface EventSnapshot {
  entries: MonitorEvent[]
  byLabel: Record<string, number>
}

export interface EventCollectorConfig {
  maxHistory: number
}

export interface IEventCollector {
  snapshot: SSignal<EventSnapshot>
  onEvent: SSignal<MonitorEvent | null>
  clearLog(): void
  start(): void
  stop(): void
  destroy(): void
}
