import type { NetworkSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the network snapshot and re-renders when captured requests change.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useNetwork = snapshotHook<NetworkSnapshot>((monitor) => monitor.network.snapshot);
