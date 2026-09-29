import type { ErrorSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the optional error snapshot and re-renders when captured errors change.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useErrors = snapshotHook<ErrorSnapshot>((monitor) => monitor.errors.snapshot);
