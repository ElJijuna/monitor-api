import SSignal, { computed } from 'ssignal'
import type {
  INetworkCollector,
  NetworkEntry,
  NetworkSnapshot,
  NetworkWindow5s,
  NetworkCollectorConfig,
} from '../core/types'

let _idCounter = 0
const uid = () => `net-${Date.now()}-${++_idCounter}`

export class NetworkCollector implements INetworkCollector {
  readonly snapshot: SSignal<NetworkSnapshot>
  readonly onRequest: SSignal<NetworkEntry | null>

  #entries: SSignal<NetworkEntry[]>
  #filter: (url: string) => boolean
  #originalFetch: typeof fetch | null = null
  #originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null

  constructor(private readonly config: NetworkCollectorConfig) {
    this.#filter = config.filter ?? (() => true)
    this.#entries = new SSignal<NetworkEntry[]>([])
    this.onRequest = new SSignal<NetworkEntry | null>(null)

    this.snapshot = computed(
      [this.#entries],
      ([entries]): NetworkSnapshot => ({
        entries,
        window5s: this.#computeWindow5s(entries),
      }),
    )
  }

  start(): void {
    if (typeof window === 'undefined') return
    this.#patchFetch()
    this.#patchXhr()
  }

  stop(): void {
    if (this.#originalFetch) {
      window.fetch = this.#originalFetch
      this.#originalFetch = null
    }
    if (this.#originalXhrOpen) {
      XMLHttpRequest.prototype.open = this.#originalXhrOpen
      this.#originalXhrOpen = null
    }
  }

  destroy(): void {
    this.stop()
  }

  clearLog(): void {
    this.#entries.value = []
  }

  setFilter(fn: (url: string) => boolean): void {
    this.#filter = fn
  }

  #record(entry: NetworkEntry): void {
    if (!this.#filter(entry.url)) return
    this.#entries.value = (prev: NetworkEntry[]) =>
      [...prev, entry].slice(-this.config.maxHistory)
    this.onRequest.value = entry
  }

  #patchFetch(): void {
    const original = window.fetch.bind(window)
    this.#originalFetch = window.fetch

    window.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url

      const method = (
        init?.method
        ?? (input instanceof Request ? input.method : undefined)
        ?? 'GET'
      ).toUpperCase()

      const requestSize = this.#estimateBodySize(init?.body)
      const start = performance.now()

      try {
        const response = await original(input, init)
        const latency = performance.now() - start

        response.clone().arrayBuffer().then((buf) => {
          this.#record({
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
          })
        }).catch(() => {
          this.#record({
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
          })
        })

        return response
      } catch (err) {
        this.#record({
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
        })
        throw err
      }
    }
  }

  #patchXhr(): void {
    const collector = this
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = XMLHttpRequest.prototype as any
    const originalOpen: typeof XMLHttpRequest.prototype.open = proto.open
    const originalSend: typeof XMLHttpRequest.prototype.send = proto.send

    this.#originalXhrOpen = originalOpen

    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      ;(this as any).__mon_method = method.toUpperCase()
      ;(this as any).__mon_url = typeof url === 'string' ? url : url.toString()
      return originalOpen.apply(this, [method, url as string, ...rest] as Parameters<typeof originalOpen>)
    }

    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const start = performance.now()
      const requestSize = collector.#estimateBodySize(body as BodyInit | null | undefined)
      const url = (this as any).__mon_url ?? ''
      const method = (this as any).__mon_method ?? 'GET'

      this.addEventListener('loadend', () => {
        const payloadSize = typeof this.response === 'string'
          ? new Blob([this.response]).size
          : this.response instanceof ArrayBuffer
            ? this.response.byteLength
            : 0

        collector.#record({
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
        })
      })

      return originalSend.call(this, body)
    }
  }

  #estimateBodySize(body: BodyInit | null | undefined): number {
    if (!body) return 0
    if (typeof body === 'string') return new Blob([body]).size
    if (body instanceof Blob) return body.size
    if (body instanceof ArrayBuffer) return body.byteLength
    if (ArrayBuffer.isView(body)) return body.byteLength
    return 0
  }

  #computeWindow5s(entries: NetworkEntry[]): NetworkWindow5s {
    const cutoff = Date.now() - 5000
    const recent = entries.filter(e => e.timestamp >= cutoff)
    if (recent.length === 0) {
      return { count: 0, avgLatency: 0, totalPayload: 0, errorRate: 0 }
    }
    const totalLatency = recent.reduce((s, e) => s + e.latency, 0)
    const totalPayload = recent.reduce((s, e) => s + e.payloadSize, 0)
    const errors = recent.filter(e => e.error !== null || e.status >= 400).length
    return {
      count: recent.length,
      avgLatency: Math.round(totalLatency / recent.length),
      totalPayload,
      errorRate: errors / recent.length,
    }
  }
}
