import type SSignal from 'ssignal';

/** Capabilities and connectivity of the device running the page. */
export interface DeviceSnapshot {
  /**
   * Logical processor count from `navigator.hardwareConcurrency`, or null before `start()`,
   * outside browsers, or where the browser does not expose it.
   */
  hardwareConcurrency: number | null;
  /**
   * Whether the browser reports a network connection (`navigator.onLine`), or null before
   * `start()`, outside browsers, or where unavailable. `true` means only that a network is
   * reachable, not that the internet or your servers are.
   */
  online: boolean | null;
  /** Number of times the connection went offline while the collector was started. */
  offlineCount: number;
}

/** Public API exposed by the device collector. */
export interface IDeviceCollector {
  /** Signal containing device capabilities and connectivity. */
  snapshot: SSignal<DeviceSnapshot>;
  /** Reads device capabilities and listens for connectivity changes. No-ops outside browsers. */
  start(): void;
  /** Stops listening for connectivity changes. Values already read are kept. */
  stop(): void;
  /** Stops the collector and releases owned resources. */
  destroy(): void;
}
