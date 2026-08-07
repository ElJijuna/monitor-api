import { computed } from 'ssignal';
import { EventCollector } from '../collectors/EventCollector';
import { NetworkCollector } from '../collectors/NetworkCollector';
import { PerformanceCollector } from '../collectors/PerformanceCollector';
import { ReactCollector } from '../collectors/ReactCollector';
import { WebVitalsCollector } from '../collectors/WebVitalsCollector';
import type {
  CollectorName,
  EventCollectorConfig,
  Monitor,
  MonitorConfig,
  MonitorSnapshot,
  NetworkCollectorConfig,
  PerformanceCollectorConfig,
  ReactCollectorConfig,
  WebVitalsCollectorConfig,
} from './types';

function createDefaultReportPayload(snap: MonitorSnapshot) {
  const summarizeWebVital = (metric: MonitorSnapshot['webVitals']['cls']) =>
    metric
      ? {
          value: metric.value,
          delta: metric.delta,
          rating: metric.rating,
        }
      : null;

  return {
    timestamp: snap.timestamp,
    performance: {
      fps: snap.performance.fps,
      memoryPercent: snap.performance.memory?.percent ?? null,
      longTasks: snap.performance.longTasks,
      cls: snap.performance.cls,
    },
    network: {
      window5s: snap.network.window5s,
    },
    react: {
      totalCommits: snap.react.totalCommits,
      slowRenderCount: snap.react.slowComponents.length,
    },
    events: {
      count: snap.events.entries.length,
    },
    webVitals: {
      cls: summarizeWebVital(snap.webVitals.cls),
      fcp: summarizeWebVital(snap.webVitals.fcp),
      inp: summarizeWebVital(snap.webVitals.inp),
      lcp: summarizeWebVital(snap.webVitals.lcp),
      ttfb: summarizeWebVital(snap.webVitals.ttfb),
    },
  };
}

function excludeReportEndpoint(
  config: NetworkCollectorConfig | false,
  report: MonitorConfig['report'],
): NetworkCollectorConfig | false {
  if (config === false || !report) {
    return config;
  }

  const userFilter = config.filter;

  return {
    ...config,
    filter: (url) => url !== report.endpoint && (userFilter?.(url) ?? true),
  };
}

function resolveCollector<T>(name: CollectorName, config: MonitorConfig, defaults: T): T | false {
  const { collectors } = config;

  if (!collectors) {
    return defaults;
  } // all enabled by default

  if (Array.isArray(collectors)) {
    return collectors.includes(name) ? defaults : false;
  }

  const val = collectors[name];

  if (val === false || val === undefined) {
    return false;
  }

  if (val === true) {
    return defaults;
  }

  return { ...defaults, ...(val as object) } as T;
}

/**
 * Creates a monitor instance with performance, network, React, custom event,
 * and Web Vitals collectors.
 *
 * The returned monitor is inert until {@link Monitor.start} is called. In non-browser
 * environments, browser-only collectors safely no-op when started.
 *
 * @example
 * ```ts
 * const monitor = createMonitor({ maxHistory: 60 })
 * monitor.start()
 *
 * const unsubscribe = monitor.subscribe((snapshot) => {
 *   console.log(snapshot.network.window5s.count)
 * })
 * ```
 */
export function createMonitor(config: MonitorConfig = {}): Monitor {
  const maxHistory = config.maxHistory ?? 120;
  const env = config.env ?? 'development';

  const perfConfig: PerformanceCollectorConfig = { maxHistory };
  const netConfig: NetworkCollectorConfig = {
    maxHistory,
    ...(config.networkFilter ? { filter: config.networkFilter } : {}),
  };
  const reactConfig: ReactCollectorConfig = { maxHistory, slowThreshold: 16 };
  const eventsConfig: EventCollectorConfig = { maxHistory };
  const webVitalsConfig: WebVitalsCollectorConfig = { maxHistory, reportAllChanges: true };

  const perfCfg = resolveCollector('performance', config, perfConfig);
  const netCfg = excludeReportEndpoint(
    resolveCollector('network', config, netConfig),
    env === 'production' ? config.report : undefined,
  );
  const reactCfg = resolveCollector('react', config, reactConfig);
  const eventsCfg = resolveCollector('events', config, eventsConfig);
  const webVitalsCfg = resolveCollector('webVitals', config, webVitalsConfig);

  const performance = perfCfg
    ? new PerformanceCollector(perfCfg)
    : new PerformanceCollector(perfConfig);
  const network = netCfg ? new NetworkCollector(netCfg) : new NetworkCollector(netConfig);
  const react = reactCfg ? new ReactCollector(reactCfg) : new ReactCollector(reactConfig);
  const events = eventsCfg ? new EventCollector(eventsCfg) : new EventCollector(eventsConfig);
  const webVitals = webVitalsCfg
    ? new WebVitalsCollector(webVitalsCfg)
    : new WebVitalsCollector(webVitalsConfig);

  const signal = computed(
    [performance.snapshot, network.snapshot, react.snapshot, events.snapshot, webVitals.snapshot],
    ([perf, net, reactSnap, evts, webVitalsSnap]): MonitorSnapshot => ({
      timestamp: Date.now(),
      performance: perf,
      network: net,
      react: reactSnap,
      events: evts,
      webVitals: webVitalsSnap,
    }),
  );

  const active = {
    performance: perfCfg !== false,
    network: netCfg !== false,
    react: reactCfg !== false,
    events: eventsCfg !== false,
    webVitals: webVitalsCfg !== false,
  };

  let reporterInterval: ReturnType<typeof setInterval> | null = null;
  let reporterInFlight = false;

  function startReporter() {
    if (env !== 'production' || !config.report || reporterInterval !== null) {
      return;
    }

    if (typeof fetch === 'undefined') {
      return;
    }

    const { endpoint, interval, transform } = config.report;

    reporterInterval = setInterval(() => {
      if (reporterInFlight) {
        return;
      }

      try {
        const snap = signal.value;
        const payload = transform ? transform(snap) : createDefaultReportPayload(snap);
        const body = JSON.stringify(payload);

        reporterInFlight = true;
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
          .catch(() => {})
          .finally(() => {
            reporterInFlight = false;
          });
      } catch {
        reporterInFlight = false;
        // Monitoring must never break the host application.
      }
    }, interval);
  }

  function stopReporter() {
    if (reporterInterval !== null) {
      clearInterval(reporterInterval);
      reporterInterval = null;
    }
  }

  function startAll() {
    if (active.performance) {
      performance.start();
    }

    if (active.network) {
      network.start();
    }

    if (active.react) {
      react.start();
    }

    if (active.events) {
      events.start();
    }

    if (active.webVitals) {
      webVitals.start();
    }

    startReporter();
  }

  function stopAll() {
    performance.stop();
    network.stop();
    react.stop();
    events.stop();
    webVitals.stop();
    stopReporter();
  }

  function destroyAll() {
    stopReporter();
    performance.destroy();
    network.destroy();
    react.destroy();
    events.destroy();
    webVitals.destroy();
    signal.dispose();
  }

  const monitor: Monitor = {
    performance,
    network,
    react,
    events,
    webVitals,
    signal,
    getSnapshot: () => signal.value,
    subscribe: (cb) => signal.subscribe(cb),
    start: startAll,
    stop: stopAll,
    destroy: destroyAll,
  };

  return monitor;
}
