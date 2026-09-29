import type SSignal from 'ssignal';

/** Asset category derived from the initiator type and, when ambiguous, the URL extension. */
export type ResourceType =
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'font'
  | 'media'
  | 'iframe'
  | 'other';

/** Timing and size of one asset loaded by the page, from the Resource Timing API. */
export interface ResourceEntry {
  /** Resource URL, capped at 2,048 characters. */
  url: string;
  type: ResourceType;
  /** Raw `initiatorType` reported by the browser, such as `link`, `img`, or `css`. */
  initiatorType: string;
  /** Milliseconds from the start of the fetch to the last byte. */
  duration: number;
  /** Bytes transferred over the network, including headers. 0 when cached or cross-origin. */
  transferSize: number;
  /** Compressed body size in bytes. 0 for cross-origin resources without Timing-Allow-Origin. */
  encodedBodySize: number;
  /** Decompressed body size in bytes. 0 for cross-origin resources without Timing-Allow-Origin. */
  decodedBodySize: number;
  /**
   * `hit` when served from the HTTP cache, `miss` when downloaded, and `unknown` when a
   * cross-origin server hides sizes by not sending Timing-Allow-Origin.
   */
  cache: 'hit' | 'miss' | 'unknown';
  /** Whether the resource blocked the first render, or null where the browser does not say. */
  renderBlocking: boolean | null;
  /** HTTP status, or null where unsupported or hidden for cross-origin resources. */
  status: number | null;
  /** Whether the resource came from an origin other than the page's. */
  thirdParty: boolean;
  /** Unix timestamp in milliseconds for when the resource finished loading. */
  timestamp: number;
}

/** Cumulative statistics for one asset type. */
export interface ResourceTypeStats {
  count: number;
  transferSize: number;
  decodedBodySize: number;
  cacheHits: number;
  totalDuration: number;
  maxDuration: number;
}

/** Cumulative statistics for every observed resource, independent of `maxHistory`. */
export interface ResourceTotals extends ResourceTypeStats {
  thirdPartyCount: number;
  thirdPartyTransferSize: number;
  renderBlockingCount: number;
  /** Resources with an HTTP status of 400 or more, where the status is visible. */
  failedCount: number;
}

/** Retained resource history and cumulative statistics. */
export interface ResourceSnapshot {
  /** Recent resources, capped by `maxHistory`. */
  entries: ResourceEntry[];
  totals: ResourceTotals;
  byType: Record<ResourceType, ResourceTypeStats>;
  /** The slowest resources observed so far, longest first. */
  slowest: ResourceEntry[];
}

/** Configuration for the resource collector. */
export interface ResourceCollectorConfig {
  /** Maximum number of resource entries to retain. */
  maxHistory: number;
  /** Optional predicate used to decide whether a URL should be recorded. */
  filter?: (url: string) => boolean;
  /** Number of slowest resources to keep. Defaults to 5. */
  slowestCount?: number;
}

/** Public API exposed by the resource collector. */
export interface IResourceCollector {
  /** Signal containing retained resources and cumulative statistics. */
  snapshot: SSignal<ResourceSnapshot>;
  /** Signal set to the latest recorded resource, or null before any resource is recorded. */
  onResource: SSignal<ResourceEntry | null>;
  /** Clears retained resources and statistics. */
  clearLog(): void;
  /**
   * Starts observing resources. The first start also records assets loaded before it; later
   * starts only record resources that finish after them.
   */
  start(): void;
  /** Stops observing resources. */
  stop(): void;
  /** Stops the collector and releases owned resources. */
  destroy(): void;
}
