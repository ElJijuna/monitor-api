import { computed } from 'ssignal';
import { DeviceCollector } from '../collectors/DeviceCollector';
import { ErrorCollector } from '../collectors/ErrorCollector';
import { EventCollector } from '../collectors/EventCollector';
import { NetworkCollector } from '../collectors/NetworkCollector';
import { PerformanceCollector } from '../collectors/PerformanceCollector';
import { ReactCollector } from '../collectors/ReactCollector';
import { ResourceCollector } from '../collectors/ResourceCollector';
import { WebVitalsCollector } from '../collectors/WebVitalsCollector';
import {
  createDisabledDeviceCollector,
  createDisabledErrorCollector,
  createDisabledEventCollector,
  createDisabledNetworkCollector,
  createDisabledPerformanceCollector,
  createDisabledReactCollector,
  createDisabledResourceCollector,
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
  ResourceCollectorConfig,
  WebVitalAttributionMap,
  WebVitalMetric,
  WebVitalName,
  WebVitalsCollectorConfig,
} from './types';

function summarizeWebVital<N extends WebVitalName>(
  metric: WebVitalMetric<N> | null,
  safeAttribution: (attribution: WebVitalAttributionMap[N]) => object,
) {
  if (!metric) {
    return null;
  }

  return {
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    ...(metric.attribution ? { attribution: safeAttribution(metric.attribution) } : {}),
  };
}

/** Resource Timing reports absolute URLs, while the endpoint may be relative. */
function isReportEndpoint(url: string, endpoint: string | undefined): boolean {
  if (endpoint === undefined) {
    return false;
  }

  try {
    return url === new URL(endpoint, location.href).href;
  } catch {
    return url === endpoint;
  }
}

function createDefaultReportPayload(snap: MonitorSnapshot, includeResources: boolean) {
  return {
    timestamp: snap.timestamp,
    performance: {
      fps: snap.performance.fps,
      memoryPercent: snap.performance.memory?.percent ?? null,
      // Total megabytes only: the per-type breakdown stays local.
      measuredMemory: snap.performance.memoryMeasurement?.total ?? null,
      longTasks: snap.performance.longTasks,
      // Counters only: script URLs and invokers stay local.
      longAnimationFrames: {
        count: snap.performance.longAnimationFrames.count,
        totalBlockingDuration: snap.performance.longAnimationFrames.totalBlockingDuration,
        maxBlockingDuration: snap.performance.longAnimationFrames.maxBlockingDuration,
      },
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
    // Aggregates only: resource URLs stay local. Omitted unless the collector is enabled.
    ...(includeResources
      ? { resources: { totals: snap.resources.totals, byType: snap.resources.byType } }
      : {}),
    // Attribution keeps timings and categories only: selectors, URLs, and invokers stay local.
    webVitals: {
      cls: summarizeWebVital(snap.webVitals.cls, (a) => ({
        largestShiftValue: a.largestShiftValue,
        largestShiftTime: a.largestShiftTime,
        loadState: a.loadState,
      })),
      fcp: summarizeWebVital(snap.webVitals.fcp, (a) => ({
        timeToFirstByte: a.timeToFirstByte,
        firstByteToFCP: a.firstByteToFCP,
        loadState: a.loadState,
      })),
      inp: summarizeWebVital(snap.webVitals.inp, (a) => ({
        interactionType: a.interactionType,
        inputDelay: a.inputDelay,
        processingDuration: a.processingDuration,
        presentationDelay: a.presentationDelay,
        loadState: a.loadState,
        longestScript: a.longestScript && {
          invokerType: a.longestScript.invokerType,
          subpart: a.longestScript.subpart,
          intersectingDuration: a.longestScript.intersectingDuration,
        },
        totalScriptDuration: a.totalScriptDuration,
        totalStyleAndLayoutDuration: a.totalStyleAndLayoutDuration,
        totalPaintDuration: a.totalPaintDuration,
        totalUnattributedDuration: a.totalUnattributedDuration,
      })),
      lcp: summarizeWebVital(snap.webVitals.lcp, (a) => ({
        timeToFirstByte: a.timeToFirstByte,
        resourceLoadDelay: a.resourceLoadDelay,
        resourceLoadDuration: a.resourceLoadDuration,
        elementRenderDelay: a.elementRenderDelay,
      })),
      ttfb: summarizeWebVital(snap.webVitals.ttfb, (a) => ({
        waitingDuration: a.waitingDuration,
        cacheDuration: a.cacheDuration,
        dnsDuration: a.dnsDuration,
        connectionDuration: a.connectionDuration,
        requestDuration: a.requestDuration,
      })),
    },
    // Low-entropy fields only: platform, language, time zone, sizes, connection, and
    // preferences stay local, because together they narrow down a user.
    device: {
      hardwareConcurrency: snap.device.hardwareConcurrency,
      online: snap.device.online,
      offlineCount: snap.device.offlineCount,
      browser: {
        name: snap.device.browser.name,
        majorVersion: snap.device.browser.majorVersion,
        mobile: snap.device.browser.mobile,
      },
    },
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
  const resourcesConfig: ResourceCollectorConfig = { maxHistory };
  const webVitalsConfig: WebVitalsCollectorConfig = { maxHistory, reportAllChanges: true };
  const perfCfg = resolveCollector('performance', config, perfConfig);
  const netCfg = resolveCollector('network', config, netConfig);
  const reportEndpoint = env === 'production' ? config.report?.endpoint : undefined;
  const reactCfg = resolveCollector('react', config, reactConfig);
  const eventsCfg = resolveCollector('events', config, eventsConfig);
  const errorsCfg = config.collectors ? resolveCollector('errors', config, errorsConfig) : false;
  const resourcesCfg = config.collectors
    ? resolveCollector('resources', config, resourcesConfig)
    : false;
  const webVitalsCfg = resolveCollector('webVitals', config, webVitalsConfig);
  const deviceCfg = resolveCollector('device', config, true);
  const active = {
    performance: sampledIn && perfCfg !== false,
    network: sampledIn && netCfg !== false,
    react: sampledIn && reactCfg !== false,
    events: sampledIn && eventsCfg !== false,
    errors: sampledIn && errorsCfg !== false,
    resources: sampledIn && resourcesCfg !== false,
    webVitals: sampledIn && webVitalsCfg !== false,
    device: sampledIn && deviceCfg !== false,
  };
  const performance =
    active.performance && perfCfg
      ? new PerformanceCollector(perfCfg)
      : createDisabledPerformanceCollector();
  const network =
    active.network && netCfg
      ? new NetworkCollector(netCfg, (url) => url === reportEndpoint)
      : createDisabledNetworkCollector();
  const react =
    active.react && reactCfg ? new ReactCollector(reactCfg) : createDisabledReactCollector();
  const events =
    active.events && eventsCfg ? new EventCollector(eventsCfg) : createDisabledEventCollector();
  const errors =
    active.errors && errorsCfg ? new ErrorCollector(errorsCfg) : createDisabledErrorCollector();
  const resources =
    active.resources && resourcesCfg
      ? new ResourceCollector(resourcesCfg, (url) => isReportEndpoint(url, reportEndpoint))
      : createDisabledResourceCollector();
  const webVitals =
    active.webVitals && webVitalsCfg
      ? new WebVitalsCollector(webVitalsCfg)
      : createDisabledWebVitalsCollector();
  const device = active.device ? new DeviceCollector() : createDisabledDeviceCollector();
  const snapshotSources = [
    ...(active.performance ? [performance.snapshot] : []),
    ...(active.network ? [network.snapshot] : []),
    ...(active.react ? [react.snapshot] : []),
    ...(active.events ? [events.snapshot] : []),
    ...(active.errors ? [errors.snapshot] : []),
    ...(active.resources ? [resources.snapshot] : []),
    ...(active.webVitals ? [webVitals.snapshot] : []),
    ...(active.device ? [device.snapshot] : []),
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
      resources: resources.snapshot.value,
      webVitals: webVitals.snapshot.value,
      device: device.snapshot.value,
    }),
  );

  let destroyed = false;

  const reporter = createReporter(config.report, sampledIn && env === 'production', () => {
    const snap = signal.value;

    return config.report?.transform
      ? config.report.transform(snap)
      : createDefaultReportPayload(snap, active.resources);
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

    if (active.resources) {
      resources.start();
    }

    if (active.webVitals) {
      webVitals.start();
    }

    if (active.device) {
      device.start();
    }

    reporter.start();
  }

  function stopAll() {
    performance.stop();
    network.stop();
    react.stop();
    events.stop();
    errors.stop();
    resources.stop();
    webVitals.stop();
    device.stop();
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
    resources.destroy();
    webVitals.destroy();
    device.destroy();
    signal.dispose();
  }

  const monitor: Omit<Monitor, typeof Symbol.dispose> & Partial<Monitor> = {
    reporter,
    performance,
    network,
    react,
    events,
    errors,
    resources,
    webVitals,
    device,
    signal,
    getSnapshot: () => signal.value,
    subscribe: (cb) => signal.subscribe(cb),
    start: startAll,
    stop: stopAll,
    destroy: destroyAll,
  };

  // Older runtimes have no Symbol.dispose, and `using` is unavailable there as well.
  if (typeof Symbol.dispose === 'symbol') {
    monitor[Symbol.dispose] = destroyAll;
  }

  return monitor as Monitor;
}
