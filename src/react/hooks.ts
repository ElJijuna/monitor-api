import { useSyncExternalStore } from 'react'
import type SSignal from 'ssignal'
import type {
  Monitor,
  MonitorSnapshot,
  PerformanceSnapshot,
  NetworkSnapshot,
  ReactSnapshot,
  EventSnapshot,
} from '../core/types'

export function useSignal<T>(signal: SSignal<T>): T {
  return useSyncExternalStore(
    (notify) => signal.subscribe(() => notify()),
    () => signal.value,
    () => signal.value,
  )
}

export function useMonitor(monitor: Monitor): MonitorSnapshot {
  return useSignal(monitor.signal)
}

export function usePerformance(monitor: Monitor): PerformanceSnapshot {
  return useSignal(monitor.performance.snapshot)
}

export function useNetwork(monitor: Monitor): NetworkSnapshot {
  return useSignal(monitor.network.snapshot)
}

export function useReact(monitor: Monitor): ReactSnapshot {
  return useSignal(monitor.react.snapshot)
}

export function useEvents(monitor: Monitor): EventSnapshot {
  return useSignal(monitor.events.snapshot)
}
