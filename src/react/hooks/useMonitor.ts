import type { MonitorSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the combined monitor snapshot and re-renders when any collector changes.
 * Pass a selector to re-render only when the selected part changes.
 *
 * @example
 * ```tsx
 * const lcp = useMonitor(monitor, (snap) => snap.webVitals.lcp?.value ?? null)
 * ```
 */
export const useMonitor = snapshotHook<MonitorSnapshot>((monitor) => monitor.signal);
