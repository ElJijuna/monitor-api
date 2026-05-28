import type { Monitor, PerformanceSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

export function usePerformance(monitor: Monitor): PerformanceSnapshot {
  return useSignal(monitor.performance.snapshot)
}
