import type { Monitor, ReactSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

/** Returns the React render snapshot and re-renders when render entries change. */
export function useReact(monitor: Monitor): ReactSnapshot {
  return useSignal(monitor.react.snapshot)
}
