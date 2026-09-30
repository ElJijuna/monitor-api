import type SSignal from 'ssignal';

/** Browser identity parsed from User-Agent Client Hints or, where absent, the User-Agent string. */
export interface BrowserInfo {
  /** Browser name such as `Chrome`, `Edge`, `Firefox`, or `Safari`, or null if unrecognized. */
  name: string | null;
  /** Major version of the browser, or null if unrecognized. */
  majorVersion: number | null;
  /** Whether the browser reports a mobile device, or null if unknown. */
  mobile: boolean | null;
  /** Operating system such as `Windows`, `macOS`, `Android`, or `iOS`, or null if unrecognized. */
  platform: string | null;
}

/** Screen size in CSS pixels and the device pixel ratio. */
export interface ScreenInfo {
  width: number | null;
  height: number | null;
  /** `window.devicePixelRatio`, which also changes with browser zoom. */
  pixelRatio: number | null;
}

/** Layout viewport size in CSS pixels (`window.innerWidth` and `innerHeight`). */
export interface ViewportInfo {
  width: number | null;
  height: number | null;
}

/** Network quality estimates from the Network Information API (Chromium only). */
export interface ConnectionInfo {
  /** Effective connection type: `slow-2g`, `2g`, `3g`, or `4g`. */
  effectiveType: string | null;
  /** Estimated round-trip time in milliseconds, rounded by the browser. */
  rtt: number | null;
  /** Estimated downlink bandwidth in megabits per second, rounded by the browser. */
  downlink: number | null;
  /** Whether the user asked the browser to reduce data usage. */
  saveData: boolean | null;
}

/** Capabilities, browser, and connectivity of the device running the page. */
export interface DeviceSnapshot {
  /**
   * Logical processor count from `navigator.hardwareConcurrency`, or null before `start()`,
   * outside browsers, or where the browser does not expose it.
   */
  hardwareConcurrency: number | null;
  /** Approximate device RAM in gigabytes from `navigator.deviceMemory` (Chromium only). */
  deviceMemory: number | null;
  /**
   * Whether the browser reports a network connection (`navigator.onLine`), or null before
   * `start()`, outside browsers, or where unavailable. `true` means only that a network is
   * reachable, not that the internet or your servers are.
   */
  online: boolean | null;
  /** Number of times the connection went offline while the collector was started. */
  offlineCount: number;
  /** Browser name, major version, mobile flag, and operating system. */
  browser: BrowserInfo;
  /** Preferred language (`navigator.language`), such as `en-US`. */
  language: string | null;
  /** IANA time zone of the browser, such as `Europe/Madrid`. */
  timeZone: string | null;
  /** Screen size and device pixel ratio, read again once a resize settles. */
  screen: ScreenInfo;
  /** Viewport size, read again once a resize settles. */
  viewport: ViewportInfo;
  /** Network quality estimates, updated when the connection changes. */
  connection: ConnectionInfo;
  /** Preferred color scheme from `prefers-color-scheme`, updated when it changes. */
  colorScheme: 'light' | 'dark' | null;
  /** Whether the user prefers reduced motion (`prefers-reduced-motion`), updated when it changes. */
  reducedMotion: boolean | null;
}

/** Public API exposed by the device collector. */
export interface IDeviceCollector {
  /** Signal containing device capabilities, browser details, and connectivity. */
  snapshot: SSignal<DeviceSnapshot>;
  /** Reads the device and listens for changes. No-ops outside browsers. */
  start(): void;
  /** Stops listening for changes. Values already read are kept. */
  stop(): void;
  /** Stops the collector and releases owned resources. */
  destroy(): void;
}
