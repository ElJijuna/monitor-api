import type SSignal from 'ssignal';
import type { EventCollectorConfig, EventSnapshot, IEventCollector } from './events';
import type { INetworkCollector, NetworkCollectorConfig, NetworkSnapshot } from './network';
import type {
  IPerformanceCollector,
  PerformanceCollectorConfig,
  PerformanceSnapshot,
} from './performance';
import type { IReactCollector, ReactCollectorConfig, ReactSnapshot } from './react';
import type { IWebVitalsCollector, WebVitalsCollectorConfig, WebVitalsSnapshot } from './webVitals';

/** Complete point-in-time state collected by a monitor instance. */
export interface MonitorSnapshot {
  /** Unix timestamp in milliseconds for when the combined snapshot was computed. */
  timestamp: number;
  /** Browser performance metrics such as FPS, memory, long tasks, and CLS. */
  performance: PerformanceSnapshot;
  /** Network request history and rolling request statistics. */
  network: NetworkSnapshot;
  /** React render history and per-component render statistics. */
  react: ReactSnapshot;
  /** Custom application events emitted through the monitor event API. */
  events: EventSnapshot;
  /** Standard Web Vitals metrics collected from the browser. */
  webVitals: WebVitalsSnapshot;
}

/** Serialized report handed to a custom production transport. */
export interface ProductionReportRequest {
  /** Configured destination identifier or URL. */
  endpoint: string;
  /** Transformed report value before JSON serialization. */
  payload: unknown;
  /** JSON-serialized report body. */
  body: string;
  /** Final headers after applying monitor defaults and user overrides. */
  headers: Readonly<Record<string, string>>;
  /** Aborted when the configured report timeout elapses. */
  signal?: AbortSignal;
}

/** Sends one serialized production report. */
export type ProductionReportTransport = (
  request: ProductionReportRequest,
) => void | PromiseLike<void>;

/** Retry policy for failed or timed-out report deliveries. */
export interface ProductionReportRetryPolicy {
  /** Total delivery attempts, including the initial attempt. */
  maxAttempts: number;
  /** Delay before each retry, or a function of the failed attempt and error. Defaults to 0. */
  delay?: number | ((failedAttempt: number, error: unknown) => number);
  /** Optional predicate that can stop retries early. */
  shouldRetry?: (error: unknown, failedAttempt: number) => boolean;
}

/** Configuration for periodic production reporting. */
export interface ProductionReportConfig {
  /** HTTP endpoint that receives monitor snapshots. */
  endpoint: string;
  /** Reporting interval in milliseconds. */
  interval: number;
  /** Additional HTTP headers, including authorization or tenant headers. */
  headers?: Record<string, string>;
  /** Custom report transport. Defaults to an HTTP POST through `fetch`. */
  transport?: ProductionReportTransport;
  /** Maximum delivery time in milliseconds. Omit to disable timeouts. */
  timeout?: number;
  /** Optional policy for retrying failed or timed-out deliveries. */
  retry?: ProductionReportRetryPolicy;
  /**
   * Optional mapper used to customize the payload before it is posted. It receives the full,
   * potentially sensitive snapshot; without it, the reporter sends only bounded aggregates.
   */
  transform?: (snap: MonitorSnapshot) => unknown;
}

/** Built-in collector names accepted by {@link MonitorConfig.collectors}. */
export type CollectorName = 'performance' | 'network' | 'react' | 'events' | 'webVitals';

/** Options used when creating a monitor instance. */
export interface MonitorConfig {
  /**
   * Controls which collectors are active.
   *
   * Use an array to enable only selected collectors, or an object to enable,
   * disable, or override individual collector settings.
   */
  collectors?:
    | CollectorName[]
    | {
        performance?: boolean | Partial<PerformanceCollectorConfig>;
        network?: boolean | Partial<NetworkCollectorConfig>;
        react?: boolean | Partial<ReactCollectorConfig>;
        events?: boolean | Partial<EventCollectorConfig>;
        webVitals?: boolean | Partial<WebVitalsCollectorConfig>;
      };
  /** Per-monitor sampling probability from 0 to 1. Defaults to 1. */
  sampleRate?: number;
  /** Maximum number of retained entries per collector history. Use 0 to disable history. Defaults to 120. */
  maxHistory?: number;
  /** Convenience filter applied to network request URLs. */
  networkFilter?: (url: string) => boolean;
  /** Runtime environment. Production enables periodic reporting when {@link report} is configured. */
  env?: 'development' | 'production';
  /** Optional production reporting configuration. */
  report?: ProductionReportConfig;
}

/** Runtime monitor facade returned by {@link createMonitor}. */
export interface Monitor {
  /** Performance collector API. */
  performance: IPerformanceCollector;
  /** Network collector API. */
  network: INetworkCollector;
  /** React render collector API. */
  react: IReactCollector;
  /** Custom event collector API. */
  events: IEventCollector;
  /** Web Vitals collector API. */
  webVitals: IWebVitalsCollector;
  /** Reactive signal containing the combined monitor snapshot. */
  signal: SSignal<MonitorSnapshot>;
  /** Returns the latest combined snapshot synchronously. */
  getSnapshot(): MonitorSnapshot;
  /** Subscribes to combined snapshot changes and returns an unsubscribe function. */
  subscribe(cb: (snap: MonitorSnapshot) => void): () => void;
  /** Starts all enabled collectors. Safe to call in browsers; no-ops where unsupported. */
  start(): void;
  /** Stops active collector hooks, timers, and patches. */
  stop(): void;
  /** Stops collectors and releases signal subscriptions owned by this monitor. */
  destroy(): void;
}
