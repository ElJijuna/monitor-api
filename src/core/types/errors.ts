import type SSignal from 'ssignal';

export type MonitorErrorSource = 'error' | 'unhandledrejection' | 'manual';

/** Sanitized error details retained by the optional error collector. */
export interface MonitorErrorDetails {
  name: string;
  message: string;
  stack: string | null;
}

/** Captured error entry. Consecutive duplicates are folded into one entry. */
export interface MonitorError {
  id: string;
  source: MonitorErrorSource;
  details: MonitorErrorDetails;
  timestamp: number;
  lastSeenAt: number;
  occurrences: number;
}

/** Retained error history and lifetime counters. */
export interface ErrorSnapshot {
  entries: MonitorError[];
  totalErrors: number;
  droppedErrors: number;
}

/** Configuration for the optional error collector. */
export interface ErrorCollectorConfig {
  /** Maximum number of error entries to retain. */
  maxHistory: number;
  /** Milliseconds during which consecutive identical errors are deduplicated. Defaults to 1,000. */
  dedupWindow?: number;
  /** Optional sanitizer. Return null to drop the error. */
  sanitize?: (
    details: MonitorErrorDetails,
    source: MonitorErrorSource,
  ) => MonitorErrorDetails | null;
}

/** Public API exposed by the optional error collector. */
export interface IErrorCollector {
  /** Signal containing retained errors and lifetime counters. */
  snapshot: SSignal<ErrorSnapshot>;
  /** Signal set to the latest captured error, or null before any error is captured. */
  onError: SSignal<MonitorError | null>;
  /** Captures an unknown thrown value manually. */
  capture(error: unknown, source?: MonitorErrorSource): void;
  /** Clears retained entries while preserving lifetime counters. */
  clearLog(): void;
  /** Starts browser error and unhandled rejection listeners. */
  start(): void;
  /** Stops browser listeners. */
  stop(): void;
  /** Stops the collector and releases owned resources. */
  destroy(): void;
}
