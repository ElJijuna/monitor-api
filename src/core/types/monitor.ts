import type SSignal from 'ssignal'
import type { PerformanceSnapshot, PerformanceCollectorConfig, IPerformanceCollector } from './performance'
import type { NetworkSnapshot, NetworkCollectorConfig, INetworkCollector } from './network'
import type { ReactSnapshot, ReactCollectorConfig, IReactCollector } from './react'
import type { EventSnapshot, EventCollectorConfig, IEventCollector } from './events'

/** Complete point-in-time state collected by a monitor instance. */
export interface MonitorSnapshot {
  /** Unix timestamp in milliseconds for when the combined snapshot was computed. */
  timestamp: number
  /** Browser performance metrics such as FPS, memory, long tasks, and CLS. */
  performance: PerformanceSnapshot
  /** Network request history and rolling request statistics. */
  network: NetworkSnapshot
  /** React render history and per-component render statistics. */
  react: ReactSnapshot
  /** Custom application events emitted through the monitor event API. */
  events: EventSnapshot
}

/** Configuration for periodic production reporting. */
export interface ProductionReportConfig {
  /** HTTP endpoint that receives monitor snapshots. */
  endpoint: string
  /** Reporting interval in milliseconds. */
  interval: number
  /** Optional mapper used to reduce or reshape the payload before it is posted. */
  transform?: (snap: MonitorSnapshot) => unknown
}

/** Built-in collector names accepted by {@link MonitorConfig.collectors}. */
export type CollectorName = 'performance' | 'network' | 'react' | 'events'

/** Options used when creating a monitor instance. */
export interface MonitorConfig {
  /**
   * Controls which collectors are active.
   *
   * Use an array to enable only selected collectors, or an object to enable,
   * disable, or override individual collector settings.
   */
  collectors?: CollectorName[] | {
    performance?: boolean | Partial<PerformanceCollectorConfig>
    network?: boolean | Partial<NetworkCollectorConfig>
    react?: boolean | Partial<ReactCollectorConfig>
    events?: boolean | Partial<EventCollectorConfig>
  }
  /** Reserved for future sampling support. */
  sampleRate?: number
  /** Maximum number of retained entries per collector history. Defaults to 120. */
  maxHistory?: number
  /** Convenience filter applied to network request URLs. */
  networkFilter?: (url: string) => boolean
  /** Runtime environment. Production enables periodic reporting when {@link report} is configured. */
  env?: 'development' | 'production'
  /** Optional production reporting configuration. */
  report?: ProductionReportConfig
}

/** Runtime monitor facade returned by {@link createMonitor}. */
export interface Monitor {
  /** Performance collector API. */
  performance: IPerformanceCollector
  /** Network collector API. */
  network: INetworkCollector
  /** React render collector API. */
  react: IReactCollector
  /** Custom event collector API. */
  events: IEventCollector
  /** Reactive signal containing the combined monitor snapshot. */
  signal: SSignal<MonitorSnapshot>
  /** Returns the latest combined snapshot synchronously. */
  getSnapshot(): MonitorSnapshot
  /** Subscribes to combined snapshot changes and returns an unsubscribe function. */
  subscribe(cb: (snap: MonitorSnapshot) => void): () => void
  /** Starts all enabled collectors. Safe to call in browsers; no-ops where unsupported. */
  start(): void
  /** Stops active collector hooks, timers, and patches. */
  stop(): void
  /** Stops collectors and releases signal subscriptions owned by this monitor. */
  destroy(): void
}
