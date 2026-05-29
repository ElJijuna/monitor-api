import type { Monitor, PerformanceSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

/** Returns the performance snapshot and re-renders when performance metrics change. */
export function usePerformance(monitor: Monitor): PerformanceSnapshot {
  return useSignal(monitor.performance.snapshot)
}
