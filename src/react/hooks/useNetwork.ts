import type { Monitor, NetworkSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

export function useNetwork(monitor: Monitor): NetworkSnapshot {
  return useSignal(monitor.network.snapshot)
}
