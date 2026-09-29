import SSignal from 'ssignal';
import { emptyDeviceSnapshot } from '../collectors/DeviceCollector';
import { emptyResourceSnapshot } from '../collectors/ResourceCollector';
import type {
  IDeviceCollector,
  IErrorCollector,
  IEventCollector,
  INetworkCollector,
  IPerformanceCollector,
  IReactCollector,
  IResourceCollector,
  IWebVitalsCollector,
  LongAnimationFrameInfo,
  LongTaskInfo,
  MemoryInfo,
  MonitorError,
  MonitorEvent,
  NetworkEntry,
  PerformanceSnapshot,
  ReactSnapshot,
  RenderEntry,
  ResourceEntry,
  WebVitalMetric,
  WebVitalsSnapshot,
} from './types';

const noop = () => {};

export function createDisabledPerformanceCollector(): IPerformanceCollector {
  const fps = new SSignal(0);
  const fpsHistory = new SSignal<number[]>([]);
  const memory = new SSignal<MemoryInfo | null>(null);
  const memoryHistory = new SSignal<number[]>([]);
  const longTasks = new SSignal<LongTaskInfo>({ count: 0, lastDuration: null });
  const longAnimationFrames = new SSignal<LongAnimationFrameInfo>({
    count: 0,
    totalBlockingDuration: 0,
    maxBlockingDuration: null,
    entries: [],
  });
  const cls = new SSignal(0);
  const snapshot = new SSignal<PerformanceSnapshot>({
    fps: 0,
    fpsHistory: [],
    memory: null,
    memoryHistory: [],
    longTasks: { count: 0, lastDuration: null },
    longAnimationFrames: longAnimationFrames.value,
    cls: 0,
  });

  return {
    fps,
    fpsHistory,
    memory,
    memoryHistory,
    longTasks,
    longAnimationFrames,
    cls,
    snapshot,
    clearHistory: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledNetworkCollector(): INetworkCollector {
  return {
    snapshot: new SSignal({
      entries: [],
      window5s: { count: 0, avgLatency: 0, totalPayload: 0, errorRate: 0 },
    }),
    onRequest: new SSignal<NetworkEntry | null>(null),
    clearLog: noop,
    setFilter: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledReactCollector(): IReactCollector {
  const snapshot: ReactSnapshot = {
    totalCommits: 0,
    truncatedCommits: 0,
    entries: [],
    byComponent: {},
    slowComponents: [],
  };

  return {
    snapshot: new SSignal(snapshot),
    onCommit: new SSignal<RenderEntry | null>(null),
    setSlowThreshold: noop,
    clearLog: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledEventCollector(): IEventCollector {
  return {
    snapshot: new SSignal({ entries: [], byLabel: {} }),
    onEvent: new SSignal<MonitorEvent | null>(null),
    emit: noop,
    clearLog: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledErrorCollector(): IErrorCollector {
  return {
    snapshot: new SSignal({ entries: [], totalErrors: 0, droppedErrors: 0 }),
    onError: new SSignal<MonitorError | null>(null),
    capture: noop,
    clearLog: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledResourceCollector(): IResourceCollector {
  return {
    snapshot: new SSignal(emptyResourceSnapshot()),
    onResource: new SSignal<ResourceEntry | null>(null),
    clearLog: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledWebVitalsCollector(): IWebVitalsCollector {
  const snapshot: WebVitalsSnapshot = {
    cls: null,
    fcp: null,
    inp: null,
    lcp: null,
    ttfb: null,
    entries: [],
  };

  return {
    snapshot: new SSignal(snapshot),
    onMetric: new SSignal<WebVitalMetric | null>(null),
    clearLog: noop,
    start: noop,
    stop: noop,
    destroy: noop,
  };
}

export function createDisabledDeviceCollector(): IDeviceCollector {
  return {
    snapshot: new SSignal(emptyDeviceSnapshot()),
    start: noop,
    stop: noop,
    destroy: noop,
  };
}
