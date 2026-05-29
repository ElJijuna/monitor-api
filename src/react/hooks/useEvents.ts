import type { Monitor, EventSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

/** Returns the custom event snapshot and re-renders when monitor events are recorded. */
export function useEvents(monitor: Monitor): EventSnapshot {
  return useSignal(monitor.events.snapshot)
}
