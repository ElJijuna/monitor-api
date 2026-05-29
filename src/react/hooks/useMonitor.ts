import type { Monitor, MonitorSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

/** Returns the combined monitor snapshot and re-renders when any collector changes. */
export function useMonitor(monitor: Monitor): MonitorSnapshot {
  return useSignal(monitor.signal)
}
