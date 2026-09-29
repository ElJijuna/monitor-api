import type { ResourceSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the optional resource snapshot and re-renders when new assets are recorded.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useResources = snapshotHook<ResourceSnapshot>((monitor) => monitor.resources.snapshot);
