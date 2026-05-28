import type SSignal from 'ssignal'

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

export interface PerformanceCollectorConfig {
  maxHistory: number
}

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
