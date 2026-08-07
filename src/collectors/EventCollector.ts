import SSignal, { computed } from 'ssignal';
import { appendHistory } from '../core/retainHistory';
import type {
  EventCollectorConfig,
  EventSnapshot,
  IEventCollector,
  MonitorEvent,
} from '../core/types';

const CUSTOM_EVENT_NAME = 'app:monitor:event';
const DEFAULT_MAX_LABEL_LENGTH = 256;
const DEFAULT_MAX_DATA_DEPTH = 5;
const DEFAULT_MAX_DATA_BYTES = 16 * 1024;

let _idCounter = 0;
const uid = () => `evt-${Date.now()}-${++_idCounter}`;

function cloneEventData(
  data: Record<string, unknown> | null,
  maxDepth: number,
  maxBytes: number,
): Record<string, unknown> | null {
  if (data === null) {
    return null;
  }

  try {
    const serialized = JSON.stringify(data);

    if (serialized === undefined || getUtf8ByteLength(serialized) > maxBytes) {
      return null;
    }

    const clone: unknown = JSON.parse(serialized);

    return clone !== null &&
      typeof clone === 'object' &&
      !Array.isArray(clone) &&
      isWithinDataDepth(clone, maxDepth)
      ? (clone as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isWithinDataDepth(root: object, maxDepth: number): boolean {
  const stack: Array<{ depth: number; value: object }> = [{ depth: 1, value: root }];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!current) {
      continue;
    }

    if (current.depth > maxDepth) {
      return false;
    }

    for (const value of Object.values(current.value)) {
      if (value !== null && typeof value === 'object') {
        stack.push({ depth: current.depth + 1, value });
      }
    }
  }

  return true;
}

function getUtf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;

    if (codePoint > 0xffff) {
      index += 1;
    }

    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }

  return bytes;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export class EventCollector implements IEventCollector {
  readonly snapshot: SSignal<EventSnapshot>;
  readonly onEvent: SSignal<MonitorEvent | null>;

  #entries: SSignal<MonitorEvent[]>;
  #maxLabelLength: number;
  #maxDataDepth: number;
  #maxDataBytes: number;
  #listener: ((e: Event) => void) | null = null;

  constructor(private readonly config: EventCollectorConfig) {
    this.#maxLabelLength = normalizeLimit(config.maxLabelLength, DEFAULT_MAX_LABEL_LENGTH);
    this.#maxDataDepth = normalizeLimit(config.maxDataDepth, DEFAULT_MAX_DATA_DEPTH);
    this.#maxDataBytes = normalizeLimit(config.maxDataBytes, DEFAULT_MAX_DATA_BYTES);
    this.#entries = new SSignal<MonitorEvent[]>([]);
    this.onEvent = new SSignal<MonitorEvent | null>(null);

    this.snapshot = computed(
      [this.#entries],
      ([entries]): EventSnapshot => ({
        entries,
        byLabel: this.#computeByLabel(entries),
      }),
    );
  }

  start(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.#listener) {
      return;
    }

    this.#listener = (e: Event) => this.#handleEvent(e as CustomEvent);
    window.addEventListener(CUSTOM_EVENT_NAME, this.#listener);
  }

  stop(): void {
    if (this.#listener) {
      window.removeEventListener(CUSTOM_EVENT_NAME, this.#listener);
      this.#listener = null;
    }
  }

  destroy(): void {
    this.stop();
  }

  clearLog(): void {
    this.#entries.value = [];
  }

  emit(label: string, data?: Record<string, unknown>): void {
    this.#record(label, data ?? null);
  }

  #handleEvent(e: CustomEvent): void {
    try {
      if (typeof e.detail !== 'object' || e.detail === null) {
        return;
      }

      const { label, data } = e.detail as { label?: unknown; data?: unknown };

      if (typeof label !== 'string') {
        return;
      }

      this.#record(
        label,
        data && typeof data === 'object' ? (data as Record<string, unknown>) : null,
      );
    } catch {
      // Custom event input must never escape into the host application.
    }
  }

  #record(label: string, data: Record<string, unknown> | null): void {
    if (label.length === 0 || label.length > this.#maxLabelLength) {
      return;
    }

    const event: MonitorEvent = {
      id: uid(),
      label,
      data: cloneEventData(data, this.#maxDataDepth, this.#maxDataBytes),
      timestamp: Date.now(),
    };

    this.#entries.value = (prev: MonitorEvent[]) =>
      appendHistory(prev, [event], this.config.maxHistory);

    this.onEvent.value = event;
  }

  #computeByLabel(entries: MonitorEvent[]): Record<string, number> {
    const byLabel = new Map<string, number>();

    for (const event of entries) {
      byLabel.set(event.label, (byLabel.get(event.label) ?? 0) + 1);
    }

    return Object.fromEntries(byLabel);
  }
}

/**
 * Emits a custom application event that can be captured by the event collector.
 *
 * The event is dispatched on `window`, so it is ignored outside browser
 * environments or before an event collector has been started.
 *
 * @example
 * ```ts
 * emitMonitorEvent('checkout:complete', { total: 49.99 })
 * ```
 */
export function emitMonitorEvent(label: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(CUSTOM_EVENT_NAME, {
      detail: { label, data: data ?? null },
    }),
  );
}
