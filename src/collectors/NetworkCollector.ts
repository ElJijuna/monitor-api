import SSignal, { computed } from 'ssignal';
import { appendHistory } from '../core/retainHistory';
import type {
  INetworkCollector,
  NetworkCollectorConfig,
  NetworkEntry,
  NetworkSnapshot,
  NetworkWindow5s,
} from '../core/types';

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

function emitNetworkEntry(entry: NetworkEntry): void {
  for (const listener of networkListeners) {
    listener(entry);
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

function patchFetch(): void {
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

    try {
      const response = await callOriginal(input, init);
      const latency = performance.now() - start;

      response
        .clone()
        .arrayBuffer()
        .then((buf) => {
          emitNetworkEntry({
            id: uid(),
            url,
            method,
            status: response.status,
            latency: Math.round(latency),
            payloadSize: buf.byteLength,
            requestSize,
            initiator: 'fetch',
            timestamp: Date.now(),
            error: null,
          });
        })
        .catch(() => {
          emitNetworkEntry({
            id: uid(),
            url,
            method,
            status: response.status,
            latency: Math.round(latency),
            payloadSize: 0,
            requestSize,
            initiator: 'fetch',
            timestamp: Date.now(),
            error: null,
          });
        });

      return response;
    } catch (err) {
      emitNetworkEntry({
        id: uid(),
        url,
        method,
        status: 0,
        latency: Math.round(performance.now() - start),
        payloadSize: 0,
        requestSize,
        initiator: 'fetch',
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  window.fetch = patchedFetch;
}

function patchXhr(): void {
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
    this.__mon_method = method.toUpperCase();
    this.__mon_url = typeof url === 'string' ? url : url.toString();

    return callOriginalOpen.apply(this, [method, url as string, ...rest] as Parameters<
      typeof callOriginalOpen
    >);
  } as typeof XMLHttpRequest.prototype.open;
  patchedXhrOpen = proto.open;

  proto.send = function (this: XHRWithMonitor, body?: Document | XMLHttpRequestBodyInit | null) {
    const start = performance.now();
    const requestSize = estimateBodySize(body as BodyInit | null | undefined);
    const url = this.__mon_url ?? '';
    const method = this.__mon_method ?? 'GET';

    this.addEventListener('loadend', () => {
      const payloadSize =
        typeof this.response === 'string'
          ? new Blob([this.response]).size
          : this.response instanceof ArrayBuffer
            ? this.response.byteLength
            : 0;

      emitNetworkEntry({
        id: uid(),
        url,
        method,
        status: this.status,
        latency: Math.round(performance.now() - start),
        payloadSize,
        requestSize,
        initiator: 'xhr',
        timestamp: Date.now(),
        error: this.status === 0 ? 'Network error' : null,
      });
    });

    return callOriginalSend.call(this, body);
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

  const proto = XMLHttpRequest.prototype as XHRWithMonitor;

  if (patchedXhrOpen && originalXhrOpen && proto.open === patchedXhrOpen) {
    proto.open = originalXhrOpen;
  }

  if (patchedXhrSend && originalXhrSend && proto.send === patchedXhrSend) {
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
  readonly snapshot: SSignal<NetworkSnapshot>;
  readonly onRequest: SSignal<NetworkEntry | null>;

  #entries: SSignal<NetworkEntry[]>;
  #filter: (url: string) => boolean;
  #teardown: (() => void) | null = null;

  constructor(private readonly config: NetworkCollectorConfig) {
    this.#filter = config.filter ?? (() => true);
    this.#entries = new SSignal<NetworkEntry[]>([]);
    this.onRequest = new SSignal<NetworkEntry | null>(null);

    this.snapshot = computed(
      [this.#entries],
      ([entries]): NetworkSnapshot => ({
        entries,
        window5s: this.#computeWindow5s(entries),
      }),
    );
  }

  start(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.#teardown) {
      return;
    }

    this.#teardown = subscribeToNetwork((entry) => this.#record(entry));
  }

  stop(): void {
    this.#teardown?.();
    this.#teardown = null;
  }

  destroy(): void {
    this.stop();
  }

  clearLog(): void {
    this.#entries.value = [];
  }

  setFilter(fn: (url: string) => boolean): void {
    this.#filter = fn;
  }

  #record(entry: NetworkEntry): void {
    if (!this.#filter(entry.url)) {
      return;
    }

    this.#entries.value = (prev: NetworkEntry[]) =>
      appendHistory(prev, [entry], this.config.maxHistory);
    this.onRequest.value = entry;
  }

  #computeWindow5s(entries: NetworkEntry[]): NetworkWindow5s {
    const cutoff = Date.now() - 5000;
    const recent = entries.filter((e) => e.timestamp >= cutoff);

    if (recent.length === 0) {
      return { count: 0, avgLatency: 0, totalPayload: 0, errorRate: 0 };
    }

    const totalLatency = recent.reduce((s, e) => s + e.latency, 0);
    const totalPayload = recent.reduce((s, e) => s + e.payloadSize, 0);
    const errors = recent.filter((e) => e.error !== null || e.status >= 400).length;

    return {
      count: recent.length,
      avgLatency: Math.round(totalLatency / recent.length),
      totalPayload,
      errorRate: errors / recent.length,
    };
  }
}
