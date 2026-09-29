import type { EventSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the custom event snapshot and re-renders when monitor events are recorded.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useEvents = snapshotHook<EventSnapshot>((monitor) => monitor.events.snapshot);
