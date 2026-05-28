import type { Monitor, EventSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

export function useEvents(monitor: Monitor): EventSnapshot {
  return useSignal(monitor.events.snapshot)
}
