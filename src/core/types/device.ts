import type SSignal from 'ssignal';

/** Static capabilities of the device running the page. */
export interface DeviceSnapshot {
  /**
   * Logical processor count from `navigator.hardwareConcurrency`, or null before `start()`,
   * outside browsers, or where the browser does not expose it.
   */
  hardwareConcurrency: number | null;
}

/** Public API exposed by the device collector. */
export interface IDeviceCollector {
  /** Signal containing the device capabilities read on start. */
  snapshot: SSignal<DeviceSnapshot>;
  /** Reads device capabilities. No-ops outside browsers. */
  start(): void;
  /** Stops the collector. Values read on start are kept. */
  stop(): void;
  /** Stops the collector and releases owned resources. */
  destroy(): void;
}
