import type SSignal from 'ssignal'
import type { PerformanceSnapshot, PerformanceCollectorConfig, IPerformanceCollector } from './performance'
import type { NetworkSnapshot, NetworkCollectorConfig, INetworkCollector } from './network'
import type { ReactSnapshot, ReactCollectorConfig, IReactCollector } from './react'
import type { EventSnapshot, EventCollectorConfig, IEventCollector } from './events'

export interface MonitorSnapshot {
  timestamp: number
  performance: PerformanceSnapshot
  network: NetworkSnapshot
  react: ReactSnapshot
  events: EventSnapshot
}

export interface ProductionReportConfig {
  endpoint: string
  interval: number
  transform?: (snap: MonitorSnapshot) => unknown
}

export type CollectorName = 'performance' | 'network' | 'react' | 'events'

export interface MonitorConfig {
  collectors?: CollectorName[] | {
    performance?: boolean | Partial<PerformanceCollectorConfig>
    network?: boolean | Partial<NetworkCollectorConfig>
    react?: boolean | Partial<ReactCollectorConfig>
    events?: boolean | Partial<EventCollectorConfig>
  }
  sampleRate?: number
  maxHistory?: number
  networkFilter?: (url: string) => boolean
  env?: 'development' | 'production'
  report?: ProductionReportConfig
}

export interface Monitor {
  performance: IPerformanceCollector
  network: INetworkCollector
  react: IReactCollector
  events: IEventCollector
  signal: SSignal<MonitorSnapshot>
  getSnapshot(): MonitorSnapshot
  subscribe(cb: (snap: MonitorSnapshot) => void): () => void
  start(): void
  stop(): void
  destroy(): void
}
