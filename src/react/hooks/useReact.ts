import type { Monitor, ReactSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

export function useReact(monitor: Monitor): ReactSnapshot {
  return useSignal(monitor.react.snapshot)
}
