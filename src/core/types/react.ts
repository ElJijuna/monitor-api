import type SSignal from 'ssignal'

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

export interface ReactCollectorConfig {
  maxHistory: number
  slowThreshold: number
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
