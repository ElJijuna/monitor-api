import type { Monitor, NetworkSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

/** Returns the network snapshot and re-renders when captured requests change. */
export function useNetwork(monitor: Monitor): NetworkSnapshot {
  return useSignal(monitor.network.snapshot)
}
