import type { DeviceSnapshot } from '../../core/types';
import { snapshotHook } from './snapshotHook';

/**
 * Returns the device snapshot and re-renders when it changes.
 * Pass a selector to re-render only when the selected part changes.
 */
export const useDevice = snapshotHook<DeviceSnapshot>((monitor) => monitor.device.snapshot);
