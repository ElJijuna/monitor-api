import type SSignal from 'ssignal'

/** JavaScript heap usage reported by Chromium-based browsers. */
export interface MemoryInfo {
  /** Used JavaScript heap size in megabytes. */
  used: number
  /** JavaScript heap size limit in megabytes. */
  total: number
  /** Used heap percentage from 0 to 100. */
  percent: number
}

/** Aggregate information about observed long tasks. */
export interface LongTaskInfo {
  /** Number of long task entries observed since the collector started. */
  count: number
  /** Duration in milliseconds of the most recent long task, or null before any long task is observed. */
  lastDuration: number | null
}

/** Current browser performance metrics and retained histories. */
export interface PerformanceSnapshot {
  /** Latest frames-per-second measurement. */
  fps: number
  /** Recent FPS measurements, capped by `maxHistory`. */
  fpsHistory: number[]
  /** Current heap memory information, or null outside browsers that expose `performance.memory`. */
  memory: MemoryInfo | null
  /** Recent memory usage percentages, capped by `maxHistory`. */
  memoryHistory: number[]
  /** Long task counter and last observed duration. */
  longTasks: LongTaskInfo
  /** Cumulative Layout Shift value collected from layout-shift performance entries. */
  cls: number
}

/** Configuration for the performance collector. */
export interface PerformanceCollectorConfig {
  /** Maximum number of FPS and memory history points to retain. */
  maxHistory: number
}

/** Public API exposed by the performance collector. */
export interface IPerformanceCollector {
  /** Signal containing the latest FPS value. */
  fps: SSignal<number>
  /** Signal containing retained FPS history. */
  fpsHistory: SSignal<number[]>
  /** Signal containing current memory information, or null when unavailable. */
  memory: SSignal<MemoryInfo | null>
  /** Signal containing retained memory percentage history. */
  memoryHistory: SSignal<number[]>
  /** Signal containing long task summary information. */
  longTasks: SSignal<LongTaskInfo>
  /** Signal containing cumulative layout shift. */
  cls: SSignal<number>
  /** Signal containing the complete performance snapshot. */
  snapshot: SSignal<PerformanceSnapshot>
  /** Clears retained FPS and memory histories without resetting current metric values. */
  clearHistory(): void
  /** Starts collecting supported browser performance metrics. */
  start(): void
  /** Stops animation frame loops, intervals, and performance observers. */
  stop(): void
  /** Stops the collector and releases owned resources. */
  destroy(): void
}
