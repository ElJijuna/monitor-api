import type { WebVitalsSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the Web Vitals snapshot and re-renders when Web Vitals metrics are reported.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useWebVitals = snapshotHook<WebVitalsSnapshot>(
  (monitor) => monitor.webVitals.snapshot,
);
