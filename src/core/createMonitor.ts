import { computed } from 'ssignal'
import { PerformanceCollector } from '../collectors/PerformanceCollector'
import { NetworkCollector } from '../collectors/NetworkCollector'
import { ReactCollector } from '../collectors/ReactCollector'
import { EventCollector } from '../collectors/EventCollector'
import type {
  Monitor,
  MonitorConfig,
  MonitorSnapshot,
  CollectorName,
  PerformanceCollectorConfig,
  NetworkCollectorConfig,
  ReactCollectorConfig,
  EventCollectorConfig,
} from './types'

function resolveCollector<T>(
  name: CollectorName,
  config: MonitorConfig,
  defaults: T,
): T | false {
  const { collectors } = config

  if (!collectors) return defaults  // all enabled by default

  if (Array.isArray(collectors)) {
    return collectors.includes(name) ? defaults : false
  }

  const val = collectors[name]
  if (val === false || val === undefined) return false
  if (val === true) return defaults
  return { ...defaults, ...(val as object) } as T
}

export function createMonitor(config: MonitorConfig = {}): Monitor {
  const maxHistory = config.maxHistory ?? 120
  const env = config.env ?? 'development'

  const perfConfig: PerformanceCollectorConfig = { maxHistory }
  const netConfig: NetworkCollectorConfig = {
    maxHistory,
    ...(config.networkFilter ? { filter: config.networkFilter } : {}),
  }
  const reactConfig: ReactCollectorConfig = { maxHistory, slowThreshold: 16 }
  const eventsConfig: EventCollectorConfig = { maxHistory }

  const perfCfg = resolveCollector('performance', config, perfConfig)
  const netCfg = resolveCollector('network', config, netConfig)
  const reactCfg = resolveCollector('react', config, reactConfig)
  const eventsCfg = resolveCollector('events', config, eventsConfig)

  const performance = perfCfg ? new PerformanceCollector(perfCfg) : new PerformanceCollector(perfConfig)
  const network = netCfg ? new NetworkCollector(netCfg) : new NetworkCollector(netConfig)
  const react = reactCfg ? new ReactCollector(reactCfg) : new ReactCollector(reactConfig)
  const events = eventsCfg ? new EventCollector(eventsCfg) : new EventCollector(eventsConfig)

  const signal = computed(
    [performance.snapshot, network.snapshot, react.snapshot, events.snapshot],
    ([perf, net, reactSnap, evts]): MonitorSnapshot => ({
      timestamp: Date.now(),
      performance: perf,
      network: net,
      react: reactSnap,
      events: evts,
    }),
  )

  const active = {
    performance: perfCfg !== false,
    network: netCfg !== false,
    react: reactCfg !== false,
    events: eventsCfg !== false,
  }

  let reporterInterval: ReturnType<typeof setInterval> | null = null

  if (env === 'production' && config.report) {
    const { endpoint, interval, transform } = config.report
    reporterInterval = setInterval(() => {
      const snap = signal.value
      const payload = transform ? transform(snap) : snap
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
    }, interval)
  }

  function startAll() {
    if (active.performance) performance.start()
    if (active.network) network.start()
    if (active.react) react.start()
    if (active.events) events.start()
  }

  function stopAll() {
    performance.stop()
    network.stop()
    react.stop()
    events.stop()
  }

  function destroyAll() {
    if (reporterInterval !== null) {
      clearInterval(reporterInterval)
      reporterInterval = null
    }
    performance.destroy()
    network.destroy()
    react.destroy()
    events.destroy()
    signal.dispose()
  }

  const monitor: Monitor = {
    performance,
    network,
    react,
    events,
    signal,
    getSnapshot: () => signal.value,
    subscribe: (cb) => signal.subscribe(cb),
    start: startAll,
    stop: stopAll,
    destroy: destroyAll,
  }

  return monitor
}
