import type { ReactSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the React render snapshot and re-renders when render entries change.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useReact = snapshotHook<ReactSnapshot>((monitor) => monitor.react.snapshot);
