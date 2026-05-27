import type SSignal from 'ssignal'

// ─── Performance ─────────────────────────────────────────────────────────────

export interface MemoryInfo {
  used: number     // MB
  total: number    // MB
  percent: number  // 0-100
}

export interface LongTaskInfo {
  count: number
  lastDuration: number | null  // ms
}

export interface PerformanceSnapshot {
  fps: number
  fpsHistory: number[]
  memory: MemoryInfo | null
  memoryHistory: number[]
  longTasks: LongTaskInfo
  cls: number
}

// ─── Network ──────────────────────────────────────────────────────────────────

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

// ─── React ────────────────────────────────────────────────────────────────────

export type RenderPhase = 'mount' | 'update' | 'unmount'

export interface RenderEntry {
  component: string
  duration: number
  timestamp: number
  type: RenderPhase
  commitId: number
}

export interface ComponentStats {
  renders: number
  totalDuration: number
  avgDuration: number
  lastRender: number
}

export interface ReactSnapshot {
  totalCommits: number
  entries: RenderEntry[]
  byComponent: Record<string, ComponentStats>
  slowComponents: RenderEntry[]
}

// ─── Events ───────────────────────────────────────────────────────────────────

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

// ─── Monitor snapshot ─────────────────────────────────────────────────────────

export interface MonitorSnapshot {
  timestamp: number
  performance: PerformanceSnapshot
  network: NetworkSnapshot
  react: ReactSnapshot
  events: EventSnapshot
}

// ─── Collector interfaces ─────────────────────────────────────────────────────

export interface IPerformanceCollector {
  fps: SSignal<number>
  fpsHistory: SSignal<number[]>
  memory: SSignal<MemoryInfo | null>
  memoryHistory: SSignal<number[]>
  longTasks: SSignal<LongTaskInfo>
  cls: SSignal<number>
  snapshot: SSignal<PerformanceSnapshot>
  clearHistory(): void
  start(): void
  stop(): void
  destroy(): void
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

export interface IReactCollector {
  snapshot: SSignal<ReactSnapshot>
  onCommit: SSignal<RenderEntry | null>
  setSlowThreshold(ms: number): void
  clearLog(): void
  start(): void
  stop(): void
  destroy(): void
}

export interface IEventCollector {
  snapshot: SSignal<EventSnapshot>
  onEvent: SSignal<MonitorEvent | null>
  clearLog(): void
  start(): void
  stop(): void
  destroy(): void
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface PerformanceCollectorConfig {
  maxHistory: number
}

export interface NetworkCollectorConfig {
  maxHistory: number
  filter?: (url: string) => boolean
}

export interface ReactCollectorConfig {
  maxHistory: number
  slowThreshold: number
}

export interface EventCollectorConfig {
  maxHistory: number
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

// ─── Monitor ──────────────────────────────────────────────────────────────────

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
