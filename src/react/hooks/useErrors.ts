import type { ErrorSnapshot, Monitor } from '../../core/types';
import { useSignal } from './useSignal';

/** Returns the optional error snapshot and re-renders when captured errors change. */
export function useErrors(monitor: Monitor): ErrorSnapshot {
  return useSignal(monitor.errors.snapshot);
}
