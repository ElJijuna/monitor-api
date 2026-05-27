import SSignal, { computed } from 'ssignal'
import type {
  IEventCollector,
  MonitorEvent,
  EventSnapshot,
  EventCollectorConfig,
} from '../core/types'

const CUSTOM_EVENT_NAME = 'app:monitor:event'

let _idCounter = 0
const uid = () => `evt-${Date.now()}-${++_idCounter}`

export class EventCollector implements IEventCollector {
  readonly snapshot: SSignal<EventSnapshot>
  readonly onEvent: SSignal<MonitorEvent | null>

  #entries: SSignal<MonitorEvent[]>
  #byLabel: SSignal<Record<string, number>>
  #listener: ((e: Event) => void) | null = null

  constructor(private readonly config: EventCollectorConfig) {
    this.#entries = new SSignal<MonitorEvent[]>([])
    this.#byLabel = new SSignal<Record<string, number>>({})
    this.onEvent = new SSignal<MonitorEvent | null>(null)

    this.snapshot = computed(
      [this.#entries, this.#byLabel],
      ([entries, byLabel]): EventSnapshot => ({ entries, byLabel }),
    )
  }

  start(): void {
    if (typeof window === 'undefined') return
    this.#listener = (e: Event) => this.#handleEvent(e as CustomEvent)
    window.addEventListener(CUSTOM_EVENT_NAME, this.#listener)
  }

  stop(): void {
    if (this.#listener) {
      window.removeEventListener(CUSTOM_EVENT_NAME, this.#listener)
      this.#listener = null
    }
  }

  destroy(): void {
    this.stop()
  }

  clearLog(): void {
    this.#entries.value = []
    this.#byLabel.value = {}
  }

  emit(label: string, data?: Record<string, unknown>): void {
    this.#record(label, data ?? null)
  }

  #handleEvent(e: CustomEvent): void {
    const { label, data } = e.detail as { label?: string; data?: Record<string, unknown> }
    if (typeof label !== 'string') return
    this.#record(label, data ?? null)
  }

  #record(label: string, data: Record<string, unknown> | null): void {
    const event: MonitorEvent = {
      id: uid(),
      label,
      data,
      timestamp: Date.now(),
    }

    this.#entries.value = (prev: MonitorEvent[]) =>
      [...prev, event].slice(-this.config.maxHistory)

    this.#byLabel.value = (prev: Record<string, number>) => ({
      ...prev,
      [label]: (prev[label] ?? 0) + 1,
    })

    this.onEvent.value = event
  }
}

export function emitMonitorEvent(label: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(CUSTOM_EVENT_NAME, {
      detail: { label, data: data ?? null },
    }),
  )
}
