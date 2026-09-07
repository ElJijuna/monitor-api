import { computed } from 'ssignal';
import { ErrorCollector } from '../collectors/ErrorCollector';
import { EventCollector } from '../collectors/EventCollector';
import { NetworkCollector } from '../collectors/NetworkCollector';
import { PerformanceCollector } from '../collectors/PerformanceCollector';
import { ReactCollector } from '../collectors/ReactCollector';
import { WebVitalsCollector } from '../collectors/WebVitalsCollector';
import {
  createDisabledErrorCollector,
  createDisabledEventCollector,
  createDisabledNetworkCollector,
  createDisabledPerformanceCollector,
  createDisabledReactCollector,
  createDisabledWebVitalsCollector,
} from './createDisabledCollectors';
import { createReporter, validateReportConfig } from './createReporter';
import { validateMaxHistory } from './retainHistory';
import type {
  CollectorName,
  ErrorCollectorConfig,
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
      truncatedCommits: snap.react.truncatedCommits,
      slowRenderCount: snap.react.slowComponents.length,
    },
    events: {
      count: snap.events.entries.length,
    },
    errors: {
      totalErrors: snap.errors.totalErrors,
      droppedErrors: snap.errors.droppedErrors,
      retainedErrors: snap.errors.entries.length,
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

function resolveSampleRate(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('sampleRate must be a finite number between 0 and 1');
  }

  return value;
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
  validateReportConfig(config.report);

  const maxHistory = config.maxHistory ?? 120;

  validateMaxHistory(maxHistory);

  if (config.collectors && !Array.isArray(config.collectors)) {
    for (const collector of Object.values(config.collectors)) {
      if (
        typeof collector === 'object' &&
        collector !== null &&
        collector.maxHistory !== undefined
      ) {
        validateMaxHistory(collector.maxHistory);
      }
    }
  }

  const env = config.env ?? 'development';
  const sampleRate = resolveSampleRate(config.sampleRate);
  const sampledIn = sampleRate >= 1 || (sampleRate > 0 && Math.random() < sampleRate);
  const perfConfig: PerformanceCollectorConfig = { maxHistory };
  const netConfig: NetworkCollectorConfig = {
    maxHistory,
    ...(config.networkFilter ? { filter: config.networkFilter } : {}),
  };
  const reactConfig: ReactCollectorConfig = { maxHistory, slowThreshold: 16 };
  const eventsConfig: EventCollectorConfig = { maxHistory };
  const errorsConfig: ErrorCollectorConfig = { maxHistory };
  const webVitalsConfig: WebVitalsCollectorConfig = { maxHistory, reportAllChanges: true };
  const perfCfg = resolveCollector('performance', config, perfConfig);
  const netCfg = excludeReportEndpoint(
    resolveCollector('network', config, netConfig),
    env === 'production' ? config.report : undefined,
  );
  const reactCfg = resolveCollector('react', config, reactConfig);
  const eventsCfg = resolveCollector('events', config, eventsConfig);
  const errorsCfg = config.collectors ? resolveCollector('errors', config, errorsConfig) : false;
  const webVitalsCfg = resolveCollector('webVitals', config, webVitalsConfig);
  const active = {
    performance: sampledIn && perfCfg !== false,
    network: sampledIn && netCfg !== false,
    react: sampledIn && reactCfg !== false,
    events: sampledIn && eventsCfg !== false,
    errors: sampledIn && errorsCfg !== false,
    webVitals: sampledIn && webVitalsCfg !== false,
  };
  const performance =
    active.performance && perfCfg
      ? new PerformanceCollector(perfCfg)
      : createDisabledPerformanceCollector();
  const network =
    active.network && netCfg ? new NetworkCollector(netCfg) : createDisabledNetworkCollector();
  const react =
    active.react && reactCfg ? new ReactCollector(reactCfg) : createDisabledReactCollector();
  const events =
    active.events && eventsCfg ? new EventCollector(eventsCfg) : createDisabledEventCollector();
  const errors =
    active.errors && errorsCfg ? new ErrorCollector(errorsCfg) : createDisabledErrorCollector();
  const webVitals =
    active.webVitals && webVitalsCfg
      ? new WebVitalsCollector(webVitalsCfg)
      : createDisabledWebVitalsCollector();
  const snapshotSources = [
    ...(active.performance ? [performance.snapshot] : []),
    ...(active.network ? [network.snapshot] : []),
    ...(active.react ? [react.snapshot] : []),
    ...(active.events ? [events.snapshot] : []),
    ...(active.errors ? [errors.snapshot] : []),
    ...(active.webVitals ? [webVitals.snapshot] : []),
  ];
  const signal = computed(
    snapshotSources,
    (): MonitorSnapshot => ({
      timestamp: Date.now(),
      performance: performance.snapshot.value,
      network: network.snapshot.value,
      react: react.snapshot.value,
      events: events.snapshot.value,
      errors: errors.snapshot.value,
      webVitals: webVitals.snapshot.value,
    }),
  );

  let destroyed = false;

  const reporter = createReporter(config.report, sampledIn && env === 'production', () => {
    const snap = signal.value;

    return config.report?.transform
      ? config.report.transform(snap)
      : createDefaultReportPayload(snap);
  });

  function startAll() {
    if (destroyed) {
      return;
    }

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

    if (active.errors) {
      errors.start();
    }

    if (active.webVitals) {
      webVitals.start();
    }

    reporter.start();
  }

  function stopAll() {
    performance.stop();
    network.stop();
    react.stop();
    events.stop();
    errors.stop();
    webVitals.stop();
    reporter.stop();
  }

  function destroyAll() {
    if (destroyed) {
      return;
    }

    destroyed = true;
    reporter.destroy();
    performance.destroy();
    network.destroy();
    react.destroy();
    events.destroy();
    errors.destroy();
    webVitals.destroy();
    signal.dispose();
  }

  const monitor: Monitor = {
    reporter,
    performance,
    network,
    react,
    events,
    errors,
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
