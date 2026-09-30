import SSignal, { type ComputedSignal, computed } from 'ssignal';
import { appendHistory, validateMaxHistory } from '../core/retainHistory';
import type {
  INetworkCollector,
  NetworkCollectorConfig,
  NetworkEntry,
  NetworkSnapshot,
  NetworkWindow5s,
} from '../core/types';

const NETWORK_WINDOW_MS = 5000;

interface WindowTotals {
  count: number;
  latency: number;
  payload: number;
  errors: number;
}

interface WindowBucket extends WindowTotals {
  time: number;
}

const emptyTotals = (): WindowTotals => ({ count: 0, latency: 0, payload: 0, errors: 0 });
// Expired buckets before the head are dropped in one splice once they reach this many.
const WINDOW_COMPACT_AFTER = 1024;

let _idCounter = 0;

const uid = () => `net-${Date.now()}-${++_idCounter}`;

interface XHRWithMonitor extends XMLHttpRequest {
  __mon_method?: string;
  __mon_url?: string;
}

type NetworkListener = (entry: NetworkEntry) => void;

const networkListeners = new Set<NetworkListener>();

let originalFetch: typeof fetch | null = null;
let patchedFetch: typeof fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let patchedXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
let patchedXhrSend: typeof XMLHttpRequest.prototype.send | null = null;

function emitNetworkEntry(entry: NetworkEntry, listeners: NetworkListener[]): void {
  for (const listener of listeners) {
    if (!networkListeners.has(listener)) {
      continue;
    }

    try {
      listener(entry);
    } catch {
      // A filter or subscriber must not alter a request or affect another monitor.
    }
  }
}

function estimateBodySize(body: BodyInit | null | undefined): number {
  if (!body) {
    return 0;
  }

  if (typeof body === 'string') {
    return new Blob([body]).size;
  }

  if (body instanceof Blob) {
    return body.size;
  }

  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }

  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }

  return 0;
}

function parseContentLength(contentLength: string | null): number | null {
  if (contentLength === null || !/^\d+$/.test(contentLength)) {
    return null;
  }

  const size = Number(contentLength);

  return Number.isSafeInteger(size) ? size : null;
}

function getFetchResponseSize(response: Response): number {
  try {
    return parseContentLength(response.headers.get('content-length')) ?? 0;
  } catch {
    return 0;
  }
}

function getXhrResponseSize(xhr: XMLHttpRequest): number {
  try {
    const contentLength = parseContentLength(xhr.getResponseHeader('content-length'));

    if (contentLength !== null) {
      return contentLength;
    }

    return xhr.response instanceof ArrayBuffer ? xhr.response.byteLength : 0;
  } catch {
    return 0;
  }
}

function patchFetch(): void {
  if (typeof window.fetch !== 'function') {
    return;
  }

  originalFetch = window.fetch;
  const callOriginal = originalFetch.bind(window);

  patchedFetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : undefined) ??
      'GET'
    ).toUpperCase();
    const requestSize = estimateBodySize(init?.body);
    const start = performance.now();
    const listeners = [...networkListeners];

    try {
      const response = await callOriginal(input, init);
      const latency = performance.now() - start;

      emitNetworkEntry(
        {
          id: uid(),
          url,
          method,
          status: response.status,
          latency: Math.round(latency),
          payloadSize: getFetchResponseSize(response),
          requestSize,
          initiator: 'fetch',
          timestamp: Date.now(),
          error: null,
        },
        listeners,
      );

      return response;
    } catch (err) {
      emitNetworkEntry(
        {
          id: uid(),
          url,
          method,
          status: 0,
          latency: Math.round(performance.now() - start),
          payloadSize: 0,
          requestSize,
          initiator: 'fetch',
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : 'Network error',
        },
        listeners,
      );

      throw err;
    }
  };

  window.fetch = patchedFetch;
}

const xhrCleanup = new WeakMap<XMLHttpRequest, () => void>();

function patchXhr(): void {
  if (typeof XMLHttpRequest === 'undefined') {
    return;
  }

  const proto = XMLHttpRequest.prototype as XHRWithMonitor;
  const callOriginalOpen = proto.open;
  const callOriginalSend = proto.send;

  originalXhrOpen = callOriginalOpen;
  originalXhrSend = callOriginalSend;

  proto.open = function (
    this: XHRWithMonitor,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const result = callOriginalOpen.apply(this, [method, url as string, ...rest] as Parameters<
      typeof callOriginalOpen
    >);

    xhrCleanup.get(this)?.();
    this.__mon_method = method.toUpperCase();
    this.__mon_url = typeof url === 'string' ? url : url.toString();

    return result;
  } as typeof XMLHttpRequest.prototype.open;
  patchedXhrOpen = proto.open;

  proto.send = function (this: XHRWithMonitor, body?: Document | XMLHttpRequestBodyInit | null) {
    // Preserve the native error and the original listener for a duplicate send.
    if (xhrCleanup.has(this)) {
      return callOriginalSend.call(this, body);
    }

    const start = performance.now();
    const listeners = [...networkListeners];
    const requestSize = estimateBodySize(body as BodyInit | null | undefined);
    const url = this.__mon_url ?? '';
    const method = this.__mon_method ?? 'GET';
    const onLoadEnd = () => {
      cleanup();
      emitNetworkEntry(
        {
          id: uid(),
          url,
          method,
          status: this.status,
          latency: Math.round(performance.now() - start),
          payloadSize: getXhrResponseSize(this),
          requestSize,
          initiator: 'xhr',
          timestamp: Date.now(),
          error: this.status === 0 ? 'Network error' : null,
        },
        listeners,
      );
    };
    const cleanup = () => {
      this.removeEventListener('loadend', onLoadEnd);
      xhrCleanup.delete(this);
    };

    xhrCleanup.set(this, cleanup);
    this.addEventListener('loadend', onLoadEnd, { once: true });

    try {
      return callOriginalSend.call(this, body);
    } catch (error) {
      cleanup();

      throw error;
    }
  } as typeof XMLHttpRequest.prototype.send;
  patchedXhrSend = proto.send;
}

function installNetworkPatches(): void {
  patchFetch();
  patchXhr();
}

function restoreNetworkPatches(): void {
  if (patchedFetch && originalFetch && window.fetch === patchedFetch) {
    window.fetch = originalFetch;
  }

  const proto = typeof XMLHttpRequest === 'undefined' ? null : XMLHttpRequest.prototype;

  if (proto && patchedXhrOpen && originalXhrOpen && proto.open === patchedXhrOpen) {
    proto.open = originalXhrOpen;
  }

  if (proto && patchedXhrSend && originalXhrSend && proto.send === patchedXhrSend) {
    proto.send = originalXhrSend;
  }

  originalFetch = null;
  patchedFetch = null;
  originalXhrOpen = null;
  patchedXhrOpen = null;
  originalXhrSend = null;
  patchedXhrSend = null;
}

function subscribeToNetwork(listener: NetworkListener): () => void {
  networkListeners.add(listener);

  if (networkListeners.size === 1) {
    installNetworkPatches();
  }

  // Safe to call twice: deleting an absent listener is a no-op, and restoring already restored
  // patches changes nothing.
  return () => {
    networkListeners.delete(listener);

    if (networkListeners.size === 0) {
      restoreNetworkPatches();
    }
  };
}

export class NetworkCollector implements INetworkCollector {
  #destroyed = false;
  readonly snapshot: ComputedSignal<NetworkSnapshot>;
  readonly onRequest: SSignal<NetworkEntry | null>;

  #entries: SSignal<NetworkEntry[]>;
  #windowClock: SSignal<number>;
  #filter: (url: string) => boolean;
  // Internal exclusion (the monitor's own report endpoint) that setFilter must not replace.
  #isExcluded: (url: string) => boolean;
  #teardown: (() => void) | null = null;
  #windowExpiry: ReturnType<typeof setTimeout> | null = null;
  // A queue of at most 5,001 millisecond buckets, independent of request volume and history size.
  // Times ascend, so the oldest live bucket is at `#windowHead` and only the last can match `now`.
  // An array with a moving head avoids the cost of deleting from the front of a Map.
  #windowBuckets: WindowBucket[] = [];
  #windowHead = 0;
  // Sum of the live buckets, kept in step with additions and expirations.
  #windowTotals = emptyTotals();

  constructor(
    private readonly config: NetworkCollectorConfig,
    isExcluded: (url: string) => boolean = () => false,
  ) {
    validateMaxHistory(config.maxHistory);
    this.#filter = config.filter ?? (() => true);
    this.#isExcluded = isExcluded;
    this.#entries = new SSignal<NetworkEntry[]>([]);
    this.#windowClock = new SSignal(Date.now());
    this.onRequest = new SSignal<NetworkEntry | null>(null);

    this.snapshot = computed(
      [this.#entries, this.#windowClock],
      ([entries]): NetworkSnapshot => ({
        entries,
        window5s: this.#computeWindow5s(),
      }),
    );
  }

  start(): void {
    if (this.#destroyed) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    if (this.#teardown) {
      return;
    }

    this.#teardown = subscribeToNetwork((entry) => this.#record(entry));
    this.#windowClock.value = Date.now();
    this.#scheduleWindowExpiry();
  }

  stop(): void {
    this.#teardown?.();
    this.#teardown = null;
    this.#clearWindowExpiry();
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
    this.#windowBuckets = [];
    this.#windowHead = 0;
    this.#windowTotals = emptyTotals();
    this.#entries.value = [];
    this.#clearWindowExpiry();
  }

  setFilter(fn: (url: string) => boolean): void {
    this.#filter = fn;
  }

  #record(entry: NetworkEntry): void {
    if (this.#isExcluded(entry.url) || !this.#filter(entry.url)) {
      return;
    }

    const now = Date.now();

    this.#pruneWindow(now);
    // After pruning, the queue is either empty or ends with a live bucket.
    const newest = this.#windowBuckets[this.#windowBuckets.length - 1];

    let bucket: WindowBucket;

    if (newest?.time === now) {
      bucket = newest;
    } else {
      bucket = { time: now, ...emptyTotals() };
      this.#windowBuckets.push(bucket);
    }

    const errors = Number(entry.error !== null || entry.status >= 400);

    for (const totals of [bucket, this.#windowTotals]) {
      totals.count += 1;
      totals.latency += entry.latency;
      totals.payload += entry.payloadSize;
      totals.errors += errors;
    }

    this.#entries.value = (prev: NetworkEntry[]) =>
      appendHistory(prev, [entry], this.config.maxHistory);
    this.onRequest.value = entry;

    // A pending timer already targets the oldest bucket, which a newer request cannot change.
    if (this.#windowExpiry === null) {
      this.#scheduleWindowExpiry();
    }
  }

  #clearWindowExpiry(): void {
    if (this.#windowExpiry !== null) {
      clearTimeout(this.#windowExpiry);
      this.#windowExpiry = null;
    }
  }

  #scheduleWindowExpiry(): void {
    this.#clearWindowExpiry();

    // A filter or onRequest subscriber may have stopped the collector while a request was recorded.
    if (!this.#teardown) {
      return;
    }

    const now = Date.now();

    this.#pruneWindow(now);
    // After pruning, the oldest bucket expires first and always in the future.
    const oldest = this.#windowBuckets[this.#windowHead]?.time;

    if (oldest === undefined) {
      return;
    }

    this.#windowExpiry = setTimeout(
      () => {
        this.#windowExpiry = null;
        this.#windowClock.value = Date.now();
        this.#scheduleWindowExpiry();
      },
      oldest + NETWORK_WINDOW_MS + 1 - now,
    );
  }

  #subtract(bucket: WindowTotals): void {
    this.#windowTotals.count -= bucket.count;
    this.#windowTotals.latency -= bucket.latency;
    this.#windowTotals.payload -= bucket.payload;
    this.#windowTotals.errors -= bucket.errors;
  }

  /** Amortized O(1): expires buckets from the head and compacts the queue now and then. */
  #pruneWindow(now: number): void {
    const buckets = this.#windowBuckets;

    // The clock moved backwards: buckets from the future are the newest, at the tail.
    while (buckets.length > this.#windowHead) {
      const newest = buckets[buckets.length - 1] as WindowBucket;

      if (newest.time <= now) {
        break;
      }

      buckets.pop();
      this.#subtract(newest);
    }

    while (this.#windowHead < buckets.length) {
      const oldest = buckets[this.#windowHead] as WindowBucket;

      if (oldest.time >= now - NETWORK_WINDOW_MS) {
        break;
      }

      this.#subtract(oldest);
      this.#windowHead += 1;
    }

    if (this.#windowHead === buckets.length) {
      buckets.length = 0;
      this.#windowHead = 0;
    } else if (this.#windowHead >= WINDOW_COMPACT_AFTER) {
      buckets.splice(0, this.#windowHead);
      this.#windowHead = 0;
    }
  }

  #computeWindow5s(): NetworkWindow5s {
    this.#pruneWindow(Date.now());
    const { count, latency, payload, errors } = this.#windowTotals;

    return {
      count,
      avgLatency: count ? Math.round(latency / count) : 0,
      totalPayload: payload,
      errorRate: count ? errors / count : 0,
    };
  }
}
