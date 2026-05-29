import type SSignal from 'ssignal'

/** React render phase inferred from Fiber commit metadata. */
export type RenderPhase = 'mount' | 'update' | 'unmount'

/** One captured React component render entry. */
export interface RenderEntry {
  /** Component display name or function/class name. */
  component: string
  /**
   * Render duration in milliseconds.
   *
   * React only exposes meaningful `actualDuration` values in development or
   * production profiling builds. Other builds may report 0.
   */
  duration: number
  /** Unix timestamp in milliseconds for when the commit was observed. */
  timestamp: number
  /** Render phase for this entry. */
  type: RenderPhase
  /** Monotonic id shared by all entries captured from the same commit. */
  commitId: number
}

/** Aggregated render statistics for a component within retained history. */
export interface ComponentStats {
  /** Number of retained render entries for the component. */
  renders: number
  /** Sum of retained render durations in milliseconds. */
  totalDuration: number
  /** Average retained render duration in milliseconds. */
  avgDuration: number
  /** Timestamp of the latest retained render for the component. */
  lastRender: number
}

/** React render history and derived per-component statistics. */
export interface ReactSnapshot {
  /** Number of commit batches captured since the collector was started or cleared. */
  totalCommits: number
  /** Recent render entries, capped by `maxHistory`. */
  entries: RenderEntry[]
  /** Per-component statistics derived from retained entries. */
  byComponent: Record<string, ComponentStats>
  /** Retained render entries whose duration is greater than or equal to `slowThreshold`. */
  slowComponents: RenderEntry[]
}

/** Configuration for the React collector. */
export interface ReactCollectorConfig {
  /** Maximum number of render entries to retain. */
  maxHistory: number
  /** Duration in milliseconds used to classify a render as slow. */
  slowThreshold: number
}

/** Public API exposed by the React collector. */
export interface IReactCollector {
  /** Signal containing retained render history and derived statistics. */
  snapshot: SSignal<ReactSnapshot>
  /** Signal set to the latest render entry, or null before any render is captured. */
  onCommit: SSignal<RenderEntry | null>
  /** Updates the slow render threshold in milliseconds. */
  setSlowThreshold(ms: number): void
  /** Clears retained render entries, component statistics, and commit count. */
  clearLog(): void
  /** Hooks into the React DevTools global hook when running in a browser. */
  start(): void
  /** Restores the previous React DevTools hook handler. */
  stop(): void
  /** Stops the collector and releases owned resources. */
  destroy(): void
}
