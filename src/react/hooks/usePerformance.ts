import type { PerformanceSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the performance snapshot and re-renders when performance metrics change.
 * Pass a selector to re-render only when the selected part changes.
 */
export const usePerformance = snapshotHook<PerformanceSnapshot>(
  (monitor) => monitor.performance.snapshot,
);
