import type SSignal from 'ssignal';

/** JavaScript heap usage reported by Chromium-based browsers. */
export interface MemoryInfo {
  /** Used JavaScript heap size in megabytes. */
  used: number;
  /** JavaScript heap size limit in megabytes. */
  total: number;
  /** Used heap percentage from 0 to 100. */
  percent: number;
}

/**
 * Memory attributed to the page by `performance.measureUserAgentSpecificMemory()`, available in
 * Chromium only when the page is cross-origin isolated.
 */
export interface MemoryMeasurement {
  /** Total memory in megabytes used by the page, its same-origin iframes, and its workers. */
  total: number;
  /**
   * Megabytes by memory type, such as `JavaScript`, `DOM`, or `Shared`. Memory the browser
   * attributes to several types is keyed by the types joined with `+`, and untyped memory by
   * `Other`.
   */
  byType: Record<string, number>;
  /** Unix timestamp in milliseconds when the measurement resolved. */
  timestamp: number;
}

/** Aggregate information about observed long tasks. */
export interface LongTaskInfo {
  /** Number of long task entries observed since the collector started. */
  count: number;
  /** Duration in milliseconds of the most recent long task, or null before any long task is observed. */
  lastDuration: number | null;
}

/**
 * A script that ran during a long animation frame. Strings are capped at 500 characters; the
 * browser's performance entries are never retained.
 */
export interface LongAnimationFrameScript {
  /** How the script was invoked, such as `event-listener`, `user-callback` or `classic-script`. */
  invokerType: string | null;
  /** What invoked the script, such as `BUTTON#save.onclick` or a script URL. */
  invoker: string | null;
  /** URL of the script source, or null when the browser does not expose it. */
  sourceURL: string | null;
  /** Name of the entry-point function, or null when unknown. */
  sourceFunctionName: string | null;
  /** Script execution time in milliseconds. */
  duration: number;
  /** Time in milliseconds the script spent in forced style and layout. */
  forcedStyleAndLayoutDuration: number;
  /** Time in milliseconds the script spent paused in synchronous operations such as `alert()`. */
  pauseDuration: number;
}

/** One frame reported by the Long Animation Frames API. */
export interface LongAnimationFrameEntry {
  /** Frame start, in milliseconds since the page's time origin. */
  startTime: number;
  /** Frame duration in milliseconds. */
  duration: number;
  /** Time in milliseconds the frame blocked input beyond 50 ms of each long task in it. */
  blockingDuration: number;
  /** When the rendering phase started, in milliseconds since the time origin, or 0 without one. */
  renderStart: number;
  /** When style and layout started, in milliseconds since the time origin, or 0 without one. */
  styleAndLayoutStart: number;
  /** Time of the first UI event handled in the frame, or 0 when none. */
  firstUIEventTimestamp: number;
  /** The longest scripts that ran in the frame, longest first, at most five. */
  scripts: LongAnimationFrameScript[];
  /** Wall-clock time when the frame ended, in milliseconds since the Unix epoch. */
  timestamp: number;
}

/** Aggregate information about long animation frames. */
export interface LongAnimationFrameInfo {
  /** Number of long animation frames observed since the collector started. */
  count: number;
  /** Sum of every observed frame's `blockingDuration`, in milliseconds. */
  totalBlockingDuration: number;
  /** Largest observed `blockingDuration` in milliseconds, or null before any frame. */
  maxBlockingDuration: number | null;
  /** Recent frames, capped by `maxHistory`. */
  entries: LongAnimationFrameEntry[];
}

/** Current browser performance metrics and retained histories. */
export interface PerformanceSnapshot {
  /** Latest frames-per-second measurement. */
  fps: number;
  /** Recent FPS measurements, capped by `maxHistory`. */
  fpsHistory: number[];
  /** Current heap memory information, or null outside browsers that expose `performance.memory`. */
  memory: MemoryInfo | null;
  /** Recent memory usage percentages, capped by `maxHistory`. */
  memoryHistory: number[];
  /**
   * Latest page memory measurement, or null before the first one resolves and where
   * `performance.measureUserAgentSpecificMemory()` is unavailable.
   */
  memoryMeasurement: MemoryMeasurement | null;
  /** Long task counter and last observed duration. */
  longTasks: LongTaskInfo;
  /**
   * Long animation frames with script attribution, in Chromium browsers that support the Long
   * Animation Frames API. Stays empty elsewhere.
   */
  longAnimationFrames: LongAnimationFrameInfo;
  /** Cumulative Layout Shift value collected from layout-shift performance entries. */
  cls: number;
}

/** Configuration for the performance collector. */
export interface PerformanceCollectorConfig {
  /** Maximum number of FPS and memory history points to retain. */
  maxHistory: number;
  /**
   * Mean delay in milliseconds between `measureUserAgentSpecificMemory()` calls. Delays are
   * randomized around this mean, as the API's authors recommend, so measurements do not align
   * with periodic application work. Defaults to 300,000 (five minutes). Use `false` to disable.
   */
  memoryMeasurementInterval?: number | false;
}

/** Public API exposed by the performance collector. */
export interface IPerformanceCollector {
  /** Signal containing the latest FPS value. */
  fps: SSignal<number>;
  /** Signal containing retained FPS history. */
  fpsHistory: SSignal<number[]>;
  /** Signal containing current memory information, or null when unavailable. */
  memory: SSignal<MemoryInfo | null>;
  /** Signal containing retained memory percentage history. */
  memoryHistory: SSignal<number[]>;
  /** Signal containing the latest page memory measurement, or null when unavailable. */
  memoryMeasurement: SSignal<MemoryMeasurement | null>;
  /** Signal containing long task summary information. */
  longTasks: SSignal<LongTaskInfo>;
  /** Signal containing long animation frame counters and recent frames. */
  longAnimationFrames: SSignal<LongAnimationFrameInfo>;
  /** Signal containing cumulative layout shift. */
  cls: SSignal<number>;
  /** Signal containing the complete performance snapshot. */
  snapshot: SSignal<PerformanceSnapshot>;
  /**
   * Clears retained FPS and memory histories and recent long animation frames, without resetting
   * current metric values or counters.
   */
  clearHistory(): void;
  /** Starts collecting supported browser performance metrics. */
  start(): void;
  /** Stops animation frame loops, intervals, and performance observers. */
  stop(): void;
  /** Stops the collector and releases owned resources. */
  destroy(): void;
}
