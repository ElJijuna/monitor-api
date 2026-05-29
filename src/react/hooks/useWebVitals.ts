import type { Monitor, WebVitalsSnapshot } from '../../core/types'
import { useSignal } from './useSignal'

/** Returns the Web Vitals snapshot and re-renders when Web Vitals metrics are reported. */
export function useWebVitals(monitor: Monitor): WebVitalsSnapshot {
  return useSignal(monitor.webVitals.snapshot)
}
