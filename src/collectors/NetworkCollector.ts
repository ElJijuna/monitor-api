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

  let subscribed = true;

  return () => {
    if (!subscribed) {
      return;
    }

    subscribed = false;
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
  #teardown: (() => void) | null = null;
  #windowExpiry: ReturnType<typeof setTimeout> | null = null;
  // At most 5,001 millisecond buckets, independent of request volume and history size.
  #windowBuckets = new Map<
    number,
    { count: number; latency: number; payload: number; errors: number }
  >();

  constructor(private readonly config: NetworkCollectorConfig) {
    validateMaxHistory(config.maxHistory);
    this.#filter = config.filter ?? (() => true);
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
    this.#windowBuckets.clear();
    this.#entries.value = [];
    this.#clearWindowExpiry();
  }

  setFilter(fn: (url: string) => boolean): void {
    this.#filter = fn;
  }

  #record(entry: NetworkEntry): void {
    if (!this.#filter(entry.url)) {
      return;
    }

    const now = Date.now();

    this.#pruneWindow(now);
    const bucket = this.#windowBuckets.get(now) ?? { count: 0, latency: 0, payload: 0, errors: 0 };

    bucket.count += 1;
    bucket.latency += entry.latency;
    bucket.payload += entry.payloadSize;
    bucket.errors += Number(entry.error !== null || entry.status >= 400);
    this.#windowBuckets.set(now, bucket);

    this.#entries.value = (prev: NetworkEntry[]) =>
      appendHistory(prev, [entry], this.config.maxHistory);
    this.onRequest.value = entry;
    this.#scheduleWindowExpiry();
  }

  #clearWindowExpiry(): void {
    if (this.#windowExpiry !== null) {
      clearTimeout(this.#windowExpiry);
      this.#windowExpiry = null;
    }
  }

  #scheduleWindowExpiry(): void {
    this.#clearWindowExpiry();

    if (!this.#teardown) {
      return;
    }

    const now = Date.now();

    this.#pruneWindow(now);
    const nextExpiration = [...this.#windowBuckets.keys()].reduce<number | null>(
      (next, timestamp) => {
        const expiration = timestamp + NETWORK_WINDOW_MS + 1;

        if (expiration <= now) {
          return next;
        }

        return next === null ? expiration : Math.min(next, expiration);
      },
      null,
    );

    if (nextExpiration === null) {
      return;
    }

    this.#windowExpiry = setTimeout(() => {
      this.#windowExpiry = null;
      this.#windowClock.value = Date.now();
      this.#scheduleWindowExpiry();
    }, nextExpiration - now);
  }

  #pruneWindow(now: number): void {
    for (const timestamp of this.#windowBuckets.keys()) {
      if (timestamp < now - NETWORK_WINDOW_MS || timestamp > now) {
        this.#windowBuckets.delete(timestamp);
      }
    }
  }

  #computeWindow5s(): NetworkWindow5s {
    this.#pruneWindow(Date.now());
    let count = 0;
    let latency = 0;
    let payload = 0;
    let errors = 0;
    for (const bucket of this.#windowBuckets.values()) {
      count += bucket.count;
      latency += bucket.latency;
      payload += bucket.payload;
      errors += bucket.errors;
    }

    return {
      count,
      avgLatency: count ? Math.round(latency / count) : 0,
      totalPayload: payload,
      errorRate: count ? errors / count : 0,
    };
  }
}
