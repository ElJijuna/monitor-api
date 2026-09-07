import SSignal, { type ComputedSignal, computed } from 'ssignal';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  ErrorCollectorConfig,
  ErrorSnapshot,
  IErrorCollector,
  MonitorError,
  MonitorErrorDetails,
  MonitorErrorSource,
} from '../core/types';

const DEFAULT_DEDUP_WINDOW_MS = 1000;
const MAX_NAME_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 1024;
const MAX_STACK_LENGTH = 8192;

let _idCounter = 0;

const uid = () => `err-${Date.now()}-${++_idCounter}`;

function limitText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' && value.length > 0 ? value : fallback;

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function detailsFromUnknown(error: unknown): MonitorErrorDetails {
  if (error instanceof Error) {
    return {
      name: limitText(error.name, 'Error', MAX_NAME_LENGTH),
      message: limitText(error.message, 'Unknown error', MAX_MESSAGE_LENGTH),
      stack: typeof error.stack === 'string' ? error.stack.slice(0, MAX_STACK_LENGTH) : null,
    };
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as { name?: unknown; message?: unknown; stack?: unknown };

    return {
      name: limitText(value.name, 'Error', MAX_NAME_LENGTH),
      message: limitText(value.message, 'Unknown error', MAX_MESSAGE_LENGTH),
      stack: typeof value.stack === 'string' ? value.stack.slice(0, MAX_STACK_LENGTH) : null,
    };
  }

  return {
    name: 'Error',
    message: limitText(String(error), 'Unknown error', MAX_MESSAGE_LENGTH),
    stack: null,
  };
}

function isSameError(left: MonitorError, right: MonitorErrorDetails, source: MonitorErrorSource) {
  return (
    left.source === source &&
    left.details.name === right.name &&
    left.details.message === right.message
  );
}

function normalizeDedupWindow(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DEDUP_WINDOW_MS;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('errors.dedupWindow must be a finite non-negative number');
  }

  return value;
}

export class ErrorCollector implements IErrorCollector {
  #destroyed = false;
  readonly snapshot: ComputedSignal<ErrorSnapshot>;
  readonly onError: SSignal<MonitorError | null>;

  #entries: SSignal<MonitorError[]>;
  #totalErrors = 0;
  #droppedErrors = 0;
  #dedupWindow: number;
  #errorListener: ((event: Event) => void) | null = null;
  #rejectionListener: ((event: Event) => void) | null = null;

  constructor(private readonly config: ErrorCollectorConfig) {
    validateMaxHistory(config.maxHistory);
    this.#dedupWindow = normalizeDedupWindow(config.dedupWindow);
    this.#entries = new SSignal<MonitorError[]>([]);
    this.onError = new SSignal<MonitorError | null>(null);
    this.snapshot = computed(
      [this.#entries],
      ([entries]): ErrorSnapshot => ({
        entries,
        totalErrors: this.#totalErrors,
        droppedErrors: this.#droppedErrors,
      }),
    );
  }

  start(): void {
    if (this.#destroyed || typeof window === 'undefined') {
      return;
    }

    if (this.#errorListener || this.#rejectionListener) {
      return;
    }

    this.#errorListener = (event) => this.#captureErrorEvent(event);
    this.#rejectionListener = (event) => this.#captureRejectionEvent(event);
    window.addEventListener('error', this.#errorListener);
    window.addEventListener('unhandledrejection', this.#rejectionListener);
  }

  stop(): void {
    if (typeof window === 'undefined') {
      this.#errorListener = null;
      this.#rejectionListener = null;

      return;
    }

    if (this.#errorListener) {
      window.removeEventListener('error', this.#errorListener);
      this.#errorListener = null;
    }

    if (this.#rejectionListener) {
      window.removeEventListener('unhandledrejection', this.#rejectionListener);
      this.#rejectionListener = null;
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.stop();
    this.snapshot.dispose();
  }

  clearLog(): void {
    this.#entries.value = [];
    this.onError.value = null;
  }

  capture(error: unknown, source: MonitorErrorSource = 'manual'): void {
    this.#record(detailsFromUnknown(error), source);
  }

  #captureErrorEvent(event: Event): void {
    const value = event as { error?: unknown; message?: unknown };

    if (value.error === undefined && value.message === undefined) {
      return;
    }

    this.#record(detailsFromUnknown(value.error ?? value.message), 'error');
  }

  #captureRejectionEvent(event: Event): void {
    this.#record(detailsFromUnknown((event as { reason?: unknown }).reason), 'unhandledrejection');
  }

  #record(rawDetails: MonitorErrorDetails, source: MonitorErrorSource): void {
    if (this.#destroyed) {
      return;
    }

    this.#totalErrors += 1;
    let details: MonitorErrorDetails | null = rawDetails;

    try {
      details = this.config.sanitize ? this.config.sanitize(rawDetails, source) : rawDetails;
    } catch {
      details = null;
    }

    if (!details) {
      this.#droppedErrors += 1;
      this.#entries.value = (prev) => [...prev];

      return;
    }

    const now = Date.now();

    this.#entries.value = (prev) => {
      const last = prev[prev.length - 1];

      if (
        last &&
        now - last.lastSeenAt <= this.#dedupWindow &&
        isSameError(last, details, source)
      ) {
        const updated = {
          ...last,
          lastSeenAt: now,
          occurrences: last.occurrences + 1,
        };
        const next = [...prev.slice(0, -1), updated];

        this.onError.value = updated;

        return next;
      }

      const entry: MonitorError = {
        id: uid(),
        source,
        details,
        timestamp: now,
        lastSeenAt: now,
        occurrences: 1,
      };

      this.onError.value = entry;

      return appendHistory(prev, [entry], this.config.maxHistory);
    };
  }
}
