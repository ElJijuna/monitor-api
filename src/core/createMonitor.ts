import { computed } from 'ssignal';
import { EventCollector } from '../collectors/EventCollector';
import { NetworkCollector } from '../collectors/NetworkCollector';
import { PerformanceCollector } from '../collectors/PerformanceCollector';
import { ReactCollector } from '../collectors/ReactCollector';
import { WebVitalsCollector } from '../collectors/WebVitalsCollector';
import {
  createDisabledEventCollector,
  createDisabledNetworkCollector,
  createDisabledPerformanceCollector,
  createDisabledReactCollector,
  createDisabledWebVitalsCollector,
} from './createDisabledCollectors';
import type {
  CollectorName,
  EventCollectorConfig,
  Monitor,
  MonitorConfig,
  MonitorSnapshot,
  NetworkCollectorConfig,
  PerformanceCollectorConfig,
  ProductionReportConfig,
  ProductionReportRequest,
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
    webVitals: {
      cls: summarizeWebVital(snap.webVitals.cls),
      fcp: summarizeWebVital(snap.webVitals.fcp),
      inp: summarizeWebVital(snap.webVitals.inp),
      lcp: summarizeWebVital(snap.webVitals.lcp),
      ttfb: summarizeWebVital(snap.webVitals.ttfb),
    },
  };
}

async function deliverReport(
  report: ProductionReportConfig,
  request: Omit<ProductionReportRequest, 'signal'>,
): Promise<void> {
  const maxAttempts = report.retry?.maxAttempts ?? 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await deliverReportAttempt(report, request);

      return;
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts && (report.retry?.shouldRetry?.(error, attempt) ?? true);

      if (!shouldRetry) {
        throw error;
      }

      const configuredDelay = report.retry?.delay ?? 0;
      const delay =
        typeof configuredDelay === 'function' ? configuredDelay(attempt, error) : configuredDelay;

      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

async function deliverReportAttempt(
  report: ProductionReportConfig,
  request: Omit<ProductionReportRequest, 'signal'>,
): Promise<void> {
  const abortController = report.timeout === undefined ? undefined : new AbortController();
  const requestWithSignal: ProductionReportRequest = abortController
    ? { ...request, signal: abortController.signal }
    : request;
  const delivery = report.transport
    ? Promise.resolve(report.transport(requestWithSignal))
    : fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        ...(abortController ? { signal: abortController.signal } : {}),
      }).then((response) => {
        if (!response.ok) {
          throw new Error(`Report delivery failed with HTTP ${response.status}`);
        }
      });

  if (report.timeout === undefined) {
    await delivery;

    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      delivery,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController?.abort();
          reject(new Error('Report delivery timed out'));
        }, report.timeout);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
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

function validateReportConfig(report: ProductionReportConfig | undefined): void {
  if (!report) {
    return;
  }

  if (report.timeout !== undefined && (!Number.isFinite(report.timeout) || report.timeout < 0)) {
    throw new RangeError('report.timeout must be a finite non-negative number');
  }

  if (
    report.retry &&
    (!Number.isInteger(report.retry.maxAttempts) || report.retry.maxAttempts < 1)
  ) {
    throw new RangeError('report.retry.maxAttempts must be a positive integer');
  }

  if (
    report.retry?.delay !== undefined &&
    typeof report.retry.delay === 'number' &&
    (!Number.isFinite(report.retry.delay) || report.retry.delay < 0)
  ) {
    throw new RangeError('report.retry.delay must be a finite non-negative number');
  }
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
  const webVitalsConfig: WebVitalsCollectorConfig = { maxHistory, reportAllChanges: true };

  const perfCfg = resolveCollector('performance', config, perfConfig);
  const netCfg = excludeReportEndpoint(
    resolveCollector('network', config, netConfig),
    env === 'production' ? config.report : undefined,
  );
  const reactCfg = resolveCollector('react', config, reactConfig);
  const eventsCfg = resolveCollector('events', config, eventsConfig);
  const webVitalsCfg = resolveCollector('webVitals', config, webVitalsConfig);

  const active = {
    performance: sampledIn && perfCfg !== false,
    network: sampledIn && netCfg !== false,
    react: sampledIn && reactCfg !== false,
    events: sampledIn && eventsCfg !== false,
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
  const webVitals =
    active.webVitals && webVitalsCfg
      ? new WebVitalsCollector(webVitalsCfg)
      : createDisabledWebVitalsCollector();

  const snapshotSources = [
    ...(active.performance ? [performance.snapshot] : []),
    ...(active.network ? [network.snapshot] : []),
    ...(active.react ? [react.snapshot] : []),
    ...(active.events ? [events.snapshot] : []),
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
      webVitals: webVitals.snapshot.value,
    }),
  );

  let reporterInterval: ReturnType<typeof setInterval> | null = null;
  let reporterInFlight = false;

  function startReporter() {
    const report = config.report;

    if (!sampledIn || env !== 'production' || !report || reporterInterval !== null) {
      return;
    }

    if (typeof fetch === 'undefined' && !report.transport) {
      return;
    }

    const { endpoint, headers: configuredHeaders, interval, transform } = report;
    const headers = { 'Content-Type': 'application/json', ...configuredHeaders };

    reporterInterval = setInterval(() => {
      if (reporterInFlight) {
        return;
      }

      try {
        const snap = signal.value;
        const payload = transform ? transform(snap) : createDefaultReportPayload(snap);
        const body = JSON.stringify(payload);

        reporterInFlight = true;
        void deliverReport(report, { endpoint, payload, body, headers })
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
