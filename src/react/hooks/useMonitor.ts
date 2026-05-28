import type { Monitor, MonitorSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

export function useMonitor(monitor: Monitor): MonitorSnapshot {
  return useSignal(monitor.signal)
}
