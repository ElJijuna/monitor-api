import type { Monitor, ResourceSnapshot } from '../../core/types';
import { useSignal } from './useSignal';

/** Returns the optional resource snapshot and re-renders when new assets are recorded. */
export function useResources(monitor: Monitor): ResourceSnapshot {
  return useSignal(monitor.resources.snapshot);
}
