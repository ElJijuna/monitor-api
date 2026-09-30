import { jest } from '@jest/globals';
import type { ProductionReportRequest } from '../src/index';
import { createMonitor } from '../src/index';

const originalMemoryDescriptor = Object.getOwnPropertyDescriptor(globalThis.performance, 'memory');

function installPerformanceBrowser() {
  jest.useFakeTimers();

  const frames: FrameRequestCallback[] = [];
  const requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    frames.push(callback);

    return frames.length;
  });
  const cancelAnimationFrame = jest.fn();
  const observe = jest.fn();
  const disconnect = jest.fn();
  const observers = new Map<string, PerformanceObserverCallback>();

  class TestPerformanceObserver {
    constructor(private readonly callback: PerformanceObserverCallback) {}

    observe(options: PerformanceObserverInit): void {
      observe();

      if (options.type) {
        observers.set(options.type, this.callback);
      }
    }

    disconnect(): void {
      disconnect();
    }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: requestAnimationFrame,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: cancelAnimationFrame,
  });
  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    value: TestPerformanceObserver,
  });

  return {
    cancelAnimationFrame,
    disconnect,
    frames,
    observe,
    observers,
    requestAnimationFrame,
    emit: (type: string, entries: object[]) =>
      observers.get(type)?.(
        { getEntries: () => entries } as unknown as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      ),
    restore: () => {
      Reflect.deleteProperty(globalThis, 'window');
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
      Reflect.deleteProperty(globalThis, 'PerformanceObserver');
      Reflect.deleteProperty(globalThis, 'document');
      jest.useRealTimers();
    },
  };
}

afterEach(() => {
  if (originalMemoryDescriptor) {
    Object.defineProperty(globalThis.performance, 'memory', originalMemoryDescriptor);
  } else {
    Reflect.deleteProperty(globalThis.performance, 'memory');
  }
});

test('PerformanceCollector reads browser memory when available', () => {
  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true,
    value: {
      usedJSHeapSize: 10 * 1_048_576,
      totalJSHeapSize: 20 * 1_048_576,
      jsHeapSizeLimit: 50 * 1_048_576,
    },
  });

  const monitor = createMonitor({
    collectors: { performance: true },
  });

  expect(monitor.performance.snapshot.value.memory).toEqual({
    used: 10,
    total: 50,
    percent: 20,
  });

  monitor.destroy();
});

test('PerformanceCollector clearHistory resets retained metric histories', () => {
  const monitor = createMonitor({
    collectors: { performance: true },
  });

  monitor.performance.fpsHistory.value = [55, 60];
  monitor.performance.memoryHistory.value = [10, 20];

  monitor.performance.clearHistory();

  expect(monitor.performance.snapshot.value.fpsHistory).toEqual([]);
  expect(monitor.performance.snapshot.value.memoryHistory).toEqual([]);

  monitor.destroy();
});

test('PerformanceCollector retains no metric history when maxHistory is zero', () => {
  const browser = installPerformanceBrowser();

  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true,
    value: {
      usedJSHeapSize: 10 * 1_048_576,
      totalJSHeapSize: 20 * 1_048_576,
      jsHeapSizeLimit: 50 * 1_048_576,
    },
  });

  try {
    const monitor = createMonitor({
      maxHistory: 0,
      collectors: { performance: true },
    });

    monitor.start();
    browser.frames[0]?.(1_000);
    browser.frames[1]?.(2_000);
    jest.advanceTimersByTime(2_000);

    expect(monitor.performance.fps.value).toBe(1);
    expect(monitor.performance.fpsHistory.value).toEqual([]);
    expect(monitor.performance.memory.value?.percent).toBe(20);
    expect(monitor.performance.memoryHistory.value).toEqual([]);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector start is idempotent and stop releases its browser resources', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({
      collectors: { performance: true },
    });

    monitor.start();
    monitor.start();

    expect(browser.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    // longtask, long-animation-frame and layout-shift
    expect(browser.observe).toHaveBeenCalledTimes(3);

    monitor.stop();

    expect(browser.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(browser.disconnect).toHaveBeenCalledTimes(3);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector restart establishes a fresh FPS baseline', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({
      collectors: { performance: true },
    });

    monitor.start();
    browser.frames[0]?.(1_000);
    browser.frames[1]?.(2_000);

    expect(monitor.performance.fpsHistory.value).toEqual([1]);

    monitor.stop();
    monitor.start();

    const firstFrameAfterRestart = browser.frames[browser.frames.length - 1];

    expect(firstFrameAfterRestart).toBeDefined();
    firstFrameAfterRestart?.(10_000);
    expect(monitor.performance.fpsHistory.value).toEqual([1]);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

function installDocument(visibilityState: DocumentVisibilityState = 'visible') {
  const listeners = new Map<string, () => void>();
  const document = {
    visibilityState,
    addEventListener: jest.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    }),
    removeEventListener: jest.fn((type: string) => {
      listeners.delete(type);
    }),
  };

  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });

  return { document, listeners };
}

test('PerformanceCollector does nothing outside a browser or after destroy', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    Reflect.deleteProperty(globalThis, 'window');
    monitor.start();
    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    monitor.destroy();
    monitor.destroy();
    monitor.performance.start();

    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector skips FPS sampling when requestAnimationFrame is unavailable', () => {
  const browser = installPerformanceBrowser();

  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();

    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector pauses FPS while hidden and resets the baseline on visibility change', () => {
  const browser = installPerformanceBrowser();
  const { document, listeners } = installDocument('hidden');

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    expect(document.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );

    browser.frames[browser.frames.length - 1]?.(1_000);
    expect(browser.frames).toHaveLength(2);
    expect(monitor.performance.fps.value).toBe(0);

    document.visibilityState = 'visible';
    browser.frames[browser.frames.length - 1]?.(2_000);
    browser.frames[browser.frames.length - 1]?.(2_500);
    listeners.get('visibilitychange')?.();
    browser.frames[browser.frames.length - 1]?.(3_000);
    browser.frames[browser.frames.length - 1]?.(4_000);

    expect(monitor.performance.fpsHistory.value).toEqual([1]);

    monitor.stop();
    expect(document.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );

    const framesAfterStop = browser.frames.length;

    browser.frames[browser.frames.length - 1]?.(5_000);
    expect(browser.frames).toHaveLength(framesAfterStop);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector pauses memory sampling while hidden', () => {
  const browser = installPerformanceBrowser();
  const { document, listeners } = installDocument('hidden');

  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true,
    value: {
      usedJSHeapSize: 10 * 1_048_576,
      totalJSHeapSize: 20 * 1_048_576,
      jsHeapSizeLimit: 50 * 1_048_576,
    },
  });

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    jest.advanceTimersByTime(4_000);
    expect(monitor.performance.memoryHistory.value).toEqual([]);

    document.visibilityState = 'visible';
    listeners.get('visibilitychange')?.();
    listeners.get('visibilitychange')?.();
    jest.advanceTimersByTime(2_000);
    expect(monitor.performance.memoryHistory.value).toEqual([20]);

    document.visibilityState = 'hidden';
    listeners.get('visibilitychange')?.();
    jest.advanceTimersByTime(4_000);
    expect(monitor.performance.memoryHistory.value).toEqual([20]);

    document.visibilityState = 'visible';
    listeners.get('visibilitychange')?.();
    jest.advanceTimersByTime(2_000);
    expect(monitor.performance.memoryHistory.value).toEqual([20, 20]);

    monitor.stop();
    jest.advanceTimersByTime(2_000);
    expect(monitor.performance.memoryHistory.value).toEqual([20, 20]);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector pauses sampling on freeze and resyncs on resume and pageshow', () => {
  const browser = installPerformanceBrowser();
  const { document, listeners } = installDocument('visible');
  const windowListeners = new Map<string, () => void>();
  const window = {
    addEventListener: jest.fn((type: string, listener: () => void) => {
      windowListeners.set(type, listener);
    }),
    removeEventListener: jest.fn((type: string) => {
      windowListeners.delete(type);
    }),
  };

  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true,
    value: {
      usedJSHeapSize: 10 * 1_048_576,
      totalJSHeapSize: 20 * 1_048_576,
      jsHeapSizeLimit: 50 * 1_048_576,
    },
  });

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    browser.frames[browser.frames.length - 1]?.(1_000);

    // A frozen page stays paused until it is resumed, even while still reported as visible.
    listeners.get('freeze')?.();
    jest.advanceTimersByTime(4_000);
    expect(monitor.performance.memoryHistory.value).toEqual([]);

    listeners.get('resume')?.();
    browser.frames[browser.frames.length - 1]?.(60_000);
    browser.frames[browser.frames.length - 1]?.(61_000);
    jest.advanceTimersByTime(2_000);
    expect(monitor.performance.fpsHistory.value).toEqual([1]);
    expect(monitor.performance.memoryHistory.value).toEqual([20]);

    // A back/forward cache restore that fires `pageshow` without `visibilitychange`.
    document.visibilityState = 'hidden';
    listeners.get('visibilitychange')?.();
    document.visibilityState = 'visible';
    windowListeners.get('pageshow')?.();
    jest.advanceTimersByTime(2_000);
    expect(monitor.performance.memoryHistory.value).toEqual([20, 20]);

    // Resuming a page that is still hidden keeps sampling paused.
    document.visibilityState = 'hidden';
    listeners.get('freeze')?.();
    listeners.get('resume')?.();
    jest.advanceTimersByTime(4_000);
    expect(monitor.performance.memoryHistory.value).toEqual([20, 20]);

    monitor.stop();
    expect([...listeners.keys()]).toEqual([]);
    expect([...windowListeners.keys()]).toEqual([]);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector ignores memory ticks after stop and when memory is unavailable', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    jest.advanceTimersByTime(2_000);

    expect(monitor.performance.memory.value).toBeNull();
    expect(monitor.performance.memoryHistory.value).toEqual([]);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector counts long tasks and ignores entries after stop', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    browser.emit('longtask', [{ duration: 80 }, { duration: 120 }]);

    expect(monitor.performance.longTasks.value).toEqual({ count: 2, lastDuration: 120 });

    const staleCallback = browser.observers.get('longtask');

    monitor.stop();
    staleCallback?.(
      { getEntries: () => [{ duration: 500 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    expect(monitor.performance.longTasks.value.count).toBe(2);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector tracks the largest CLS session window', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    browser.emit('layout-shift', [
      { startTime: 100, value: 0.1, hadRecentInput: false },
      { startTime: 600, value: 0.05, hadRecentInput: false },
      { startTime: 700, value: 1, hadRecentInput: true },
    ]);

    expect(monitor.performance.cls.value).toBeCloseTo(0.15);

    // A gap over one second starts a new, smaller session: the max is kept.
    browser.emit('layout-shift', [{ startTime: 3_000, value: 0.02, hadRecentInput: false }]);
    expect(monitor.performance.cls.value).toBeCloseTo(0.15);

    // A session longer than five seconds is split even without a one-second gap.
    const shifts = [3_800, 4_600, 5_400, 6_200, 7_000, 7_800, 8_600].map((startTime) => ({
      startTime,
      value: 0.04,
      hadRecentInput: false,
    }));

    browser.emit('layout-shift', shifts);
    expect(monitor.performance.cls.value).toBeCloseTo(0.26);

    const staleCallback = browser.observers.get('layout-shift');

    monitor.stop();
    staleCallback?.(
      {
        getEntries: () => [{ startTime: 9_000, value: 5, hadRecentInput: false }],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    expect(monitor.performance.cls.value).toBeCloseTo(0.26);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector tolerates unsupported PerformanceObserver entry types', () => {
  const browser = installPerformanceBrowser();

  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    value: class {
      observe(): void {
        throw new TypeError('unsupported entry type');
      }

      disconnect(): void {}
    },
  });

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    expect(() => monitor.start()).not.toThrow();

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

function frame(startTime: number, overrides: Record<string, unknown> = {}) {
  return {
    entryType: 'long-animation-frame',
    name: 'long-animation-frame',
    startTime,
    duration: 120,
    blockingDuration: 70,
    renderStart: startTime + 100,
    styleAndLayoutStart: startTime + 110,
    firstUIEventTimestamp: startTime + 5,
    scripts: [],
    ...overrides,
  };
}

function script(duration: number, overrides: Record<string, unknown> = {}) {
  return {
    invokerType: 'event-listener',
    invoker: 'BUTTON#save.onclick',
    sourceURL: 'https://app.example.com/main.js',
    sourceFunctionName: 'save',
    duration,
    forcedStyleAndLayoutDuration: 3,
    pauseDuration: 0,
    ...overrides,
  };
}

describe('long animation frames', () => {
  test('summarizes frames with their longest scripts and keeps serializable fields only', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      browser.emit('long-animation-frame', [
        frame(1_000, {
          scripts: [
            script(10, { sourceFunctionName: 'first' }),
            script(40, { sourceFunctionName: 'longest', invoker: 'x'.repeat(900) }),
            script(20, { sourceFunctionName: 'second' }),
            script(5),
            script(8),
            script(30, { sourceFunctionName: 'third', sourceURL: '' }),
          ],
        }),
      ]);

      const info = monitor.performance.longAnimationFrames.value;
      const [entry] = info.entries;

      expect(info).toMatchObject({ count: 1, totalBlockingDuration: 70, maxBlockingDuration: 70 });
      expect(entry).toMatchObject({
        startTime: 1_000,
        duration: 120,
        blockingDuration: 70,
        renderStart: 1_100,
        styleAndLayoutStart: 1_110,
        firstUIEventTimestamp: 1_005,
        timestamp: Math.round(performance.timeOrigin + 1_120),
      });
      expect(entry?.scripts.map((item) => item.duration)).toEqual([40, 30, 20, 10, 8]);
      expect(entry?.scripts[0]).toEqual({
        invokerType: 'event-listener',
        invoker: 'x'.repeat(500),
        sourceURL: 'https://app.example.com/main.js',
        sourceFunctionName: 'longest',
        duration: 40,
        forcedStyleAndLayoutDuration: 3,
        pauseDuration: 0,
      });
      expect(entry?.scripts[1]?.sourceURL).toBeNull();
      expect(monitor.performance.snapshot.value.longAnimationFrames).toBe(info);
      expect(() => JSON.stringify(info)).not.toThrow();

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('accumulates counters in one update per batch and caps entries by maxHistory', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ maxHistory: 2, collectors: { performance: true } });
      const notify = jest.fn();

      monitor.start();
      monitor.performance.longAnimationFrames.subscribe(notify);
      browser.emit('long-animation-frame', [
        frame(1_000, { blockingDuration: 10 }),
        frame(2_000, { blockingDuration: 90 }),
        frame(3_000, { blockingDuration: 40 }),
      ]);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(monitor.performance.longAnimationFrames.value).toMatchObject({
        count: 3,
        totalBlockingDuration: 140,
        maxBlockingDuration: 90,
      });
      expect(
        monitor.performance.longAnimationFrames.value.entries.map((entry) => entry.startTime),
      ).toEqual([2_000, 3_000]);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('defaults missing or invalid timings to zero and scripts to an empty list', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      browser.emit('long-animation-frame', [
        {
          entryType: 'long-animation-frame',
          name: 'long-animation-frame',
          startTime: 50,
          duration: 60,
          blockingDuration: Number.NaN,
        },
      ]);

      expect(monitor.performance.longAnimationFrames.value.entries[0]).toMatchObject({
        blockingDuration: 0,
        renderStart: 0,
        styleAndLayoutStart: 0,
        firstUIEventTimestamp: 0,
        scripts: [],
      });
      expect(monitor.performance.longAnimationFrames.value.maxBlockingDuration).toBe(0);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('clearHistory drops recent frames but keeps the counters', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      browser.emit('long-animation-frame', [frame(1_000)]);
      monitor.performance.clearHistory();

      expect(monitor.performance.longAnimationFrames.value).toEqual({
        count: 1,
        totalBlockingDuration: 70,
        maxBlockingDuration: 70,
        entries: [],
      });

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('a restart ignores buffered frames that ended before it', () => {
    const browser = installPerformanceBrowser();
    const now = jest.spyOn(performance, 'now');

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      browser.emit('long-animation-frame', [frame(1_000)]);
      monitor.stop();

      now.mockReturnValueOnce(5_000);
      monitor.start();

      const notify = jest.fn();

      monitor.performance.longAnimationFrames.subscribe(notify);
      // The buffered delivery repeats the page-load frame: nothing new, so no update.
      browser.emit('long-animation-frame', [frame(1_000)]);
      expect(notify).not.toHaveBeenCalled();

      browser.emit('long-animation-frame', [frame(1_000), frame(6_000)]);

      expect(
        monitor.performance.longAnimationFrames.value.entries.map((entry) => entry.startTime),
      ).toEqual([1_000, 6_000]);
      expect(monitor.performance.longAnimationFrames.value.count).toBe(2);

      monitor.destroy();
    } finally {
      now.mockRestore();
      browser.restore();
    }
  });

  test('the default report sends frame counters without script URLs or invokers', async () => {
    const browser = installPerformanceBrowser();
    const transport = jest.fn<(request: { body: string; payload: unknown }) => void>();

    try {
      const monitor = createMonitor({
        env: 'production',
        collectors: { performance: true },
        report: { endpoint: '/metrics', interval: 60_000, transport, flushOnHide: false },
      });

      monitor.start();
      browser.emit('long-animation-frame', [frame(1_000, { scripts: [script(40)] })]);

      expect(await monitor.reporter.flush()).toBe(true);

      const request = transport.mock.calls[0]?.[0];

      expect(request?.payload).toMatchObject({
        performance: {
          longAnimationFrames: { count: 1, totalBlockingDuration: 70, maxBlockingDuration: 70 },
        },
      });
      expect(request?.body).not.toMatch(/example\.com|BUTTON|save|entries/);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('ignores frames delivered after stop', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();

      const stale = browser.observers.get('long-animation-frame');

      monitor.stop();
      stale?.(
        { getEntries: () => [frame(1_000)] } as unknown as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );

      expect(monitor.performance.longAnimationFrames.value.count).toBe(0);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });
});

describe('paired updates', () => {
  test('an FPS tick notifies once, with the value and its history together', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ collectors: { performance: true } });
      const seen: Array<{ fps: number; fpsHistory: number[] }> = [];
      const combined = jest.fn();

      monitor.start();
      monitor.performance.snapshot.subscribe(({ fps, fpsHistory }) => {
        seen.push({ fps, fpsHistory });
      });
      monitor.subscribe(combined);
      combined.mockClear();

      browser.frames[browser.frames.length - 1]?.(1_000);
      browser.frames[browser.frames.length - 1]?.(2_000);

      expect(seen).toEqual([{ fps: 1, fpsHistory: [1] }]);
      expect(combined).toHaveBeenCalledTimes(1);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('a memory tick notifies once, with the reading and its history together', () => {
    const browser = installPerformanceBrowser();

    Object.defineProperty(globalThis.performance, 'memory', {
      configurable: true,
      value: {
        usedJSHeapSize: 10 * 1_048_576,
        totalJSHeapSize: 20 * 1_048_576,
        jsHeapSizeLimit: 50 * 1_048_576,
      },
    });

    try {
      const monitor = createMonitor({ collectors: { performance: true } });
      const seen: Array<{ percent: number | undefined; memoryHistory: number[] }> = [];

      monitor.start();
      monitor.performance.snapshot.subscribe(({ memory, memoryHistory }) => {
        seen.push({ percent: memory?.percent, memoryHistory });
      });

      // The reading equals the initial one, so only the history changes on the first tick.
      jest.advanceTimersByTime(2_000);
      Object.defineProperty(globalThis.performance, 'memory', {
        configurable: true,
        value: {
          usedJSHeapSize: 25 * 1_048_576,
          totalJSHeapSize: 30 * 1_048_576,
          jsHeapSizeLimit: 50 * 1_048_576,
        },
      });
      jest.advanceTimersByTime(2_000);

      expect(seen).toEqual([
        { percent: 20, memoryHistory: [20] },
        { percent: 50, memoryHistory: [20, 50] },
      ]);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('clearHistory notifies once', () => {
    const browser = installPerformanceBrowser();

    try {
      const monitor = createMonitor({ collectors: { performance: true } });
      const notify = jest.fn();

      monitor.start();
      browser.frames[browser.frames.length - 1]?.(1_000);
      browser.frames[browser.frames.length - 1]?.(2_000);
      browser.emit('long-animation-frame', [
        {
          entryType: 'long-animation-frame',
          name: 'long-animation-frame',
          startTime: 1,
          duration: 60,
        },
      ]);
      monitor.performance.snapshot.subscribe(notify);
      monitor.performance.clearHistory();

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fpsHistory: [],
          memoryHistory: [],
          longAnimationFrames: expect.objectContaining({ entries: [] }),
        }),
      );

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });
});

describe('memory measurement', () => {
  type Measure = () => Promise<{
    bytes: number;
    breakdown: Array<{ bytes: number; types: string[] }>;
  }>;

  const MB = 1_048_576;
  const measurement = (bytes: number) => ({
    bytes,
    breakdown: [
      { bytes: bytes / 2, types: ['JavaScript'] },
      { bytes: bytes / 4, types: ['DOM'] },
      { bytes: bytes / 8, types: ['JavaScript'] },
      { bytes: bytes / 8, types: [] },
      { bytes: 0, types: ['Shared'] },
    ],
  });

  function installMeasure(measure: Measure, isolated = true) {
    Object.defineProperty(globalThis.performance, 'measureUserAgentSpecificMemory', {
      configurable: true,
      value: jest.fn(measure),
    });
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      configurable: true,
      value: isolated,
    });

    return globalThis.performance.measureUserAgentSpecificMemory as jest.Mock<Measure>;
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis.performance, 'measureUserAgentSpecificMemory');
    Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
    jest.restoreAllMocks();
  });

  test('measures on start, summarizes by type, and repeats after a randomized delay', async () => {
    const browser = installPerformanceBrowser();
    const measure = installMeasure(async () => measurement(16 * MB));

    // An exponential delay with mean 10,000 ms: -ln(1 - 0.5) * 10,000 ≈ 6,931 ms.
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    try {
      const monitor = createMonitor({
        collectors: { performance: { memoryMeasurementInterval: 10_000 } },
      });

      monitor.start();
      expect(monitor.performance.memoryMeasurement.value).toBeNull();

      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(1);
      expect(monitor.getSnapshot().performance.memoryMeasurement).toEqual({
        total: 16,
        byType: { JavaScript: 10, DOM: 4, Other: 2 },
        byContext: [],
        timestamp: expect.any(Number),
      });

      await jest.advanceTimersByTimeAsync(6_900);
      expect(measure).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(100);
      expect(measure).toHaveBeenCalledTimes(2);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('attributes memory to frames and workers, largest first', async () => {
    const browser = installPerformanceBrowser();
    const page = { url: 'https://app.test/', scope: 'Window' };
    const worker = { url: 'https://app.test/worker.js', scope: 'DedicatedWorkerGlobalScope' };
    const embed = {
      url: 'cross-origin-url',
      scope: 'cross-origin-aggregated',
      container: { id: 'map', src: `https://maps.test/${'x'.repeat(600)}` },
    };
    const contexts = Array.from({ length: 25 }, (_, i) => ({
      url: `https://app.test/frame-${i}.html`,
      scope: 'Window',
      container: { id: '', src: `/frame-${i}.html` },
    }));

    installMeasure(async () => ({
      bytes: 100 * MB,
      breakdown: [
        { bytes: 30 * MB, types: ['JavaScript'], attribution: [page] },
        { bytes: 10 * MB, types: ['DOM'], attribution: [page] },
        { bytes: 20 * MB, types: ['JavaScript'], attribution: [worker] },
        { bytes: 5 * MB, types: ['JavaScript'], attribution: [embed] },
        // Shared between two contexts, or attributed to none: left out of byContext.
        { bytes: 15 * MB, types: ['Shared'], attribution: [page, worker] },
        { bytes: 5 * MB, types: [], attribution: [] },
        ...contexts.map((context, i) => ({
          bytes: (i + 1) * 0.01 * MB,
          types: ['DOM'],
          attribution: [context],
        })),
      ],
    }));

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      await jest.advanceTimersByTimeAsync(0);

      const byContext = monitor.performance.memoryMeasurement.value?.byContext ?? [];

      expect(byContext).toHaveLength(20);
      expect(byContext.slice(0, 4)).toEqual([
        { total: 40, url: 'https://app.test/', scope: 'Window', container: null },
        {
          total: 20,
          url: 'https://app.test/worker.js',
          scope: 'DedicatedWorkerGlobalScope',
          container: null,
        },
        {
          total: 5,
          url: null,
          scope: 'cross-origin-aggregated',
          container: { id: 'map', src: `https://maps.test/${'x'.repeat(482)}` },
        },
        {
          total: 0.3,
          url: 'https://app.test/frame-24.html',
          scope: 'Window',
          container: { id: null, src: '/frame-24.html' },
        },
      ]);
      // The five smallest frames are dropped.
      expect(byContext[byContext.length - 1]?.url).toBe('https://app.test/frame-8.html');

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('does not measure without cross-origin isolation or when disabled', async () => {
    const browser = installPerformanceBrowser();
    const measure = installMeasure(async () => measurement(MB), false);

    try {
      const notIsolated = createMonitor({ collectors: { performance: true } });

      notIsolated.start();
      await jest.advanceTimersByTimeAsync(1_000);
      notIsolated.destroy();

      Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });

      const disabled = createMonitor({
        collectors: { performance: { memoryMeasurementInterval: false } },
      });

      disabled.start();
      await jest.advanceTimersByTimeAsync(1_000);
      disabled.destroy();

      expect(measure).not.toHaveBeenCalled();
      expect(() =>
        createMonitor({ collectors: { performance: { memoryMeasurementInterval: 0 } } }),
      ).toThrow(RangeError);
    } finally {
      browser.restore();
    }
  });

  test('waits while hidden and never overlaps an in-flight measurement', async () => {
    const browser = installPerformanceBrowser();
    const { document, listeners } = installDocument('hidden');

    let resolve: (value: ReturnType<typeof measurement>) => void = () => {};

    const measure = installMeasure(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(measure).not.toHaveBeenCalled();

      document.visibilityState = 'visible';
      listeners.get('visibilitychange')?.();
      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(1);

      // Hiding and showing again while the browser has not answered starts no second call.
      document.visibilityState = 'hidden';
      listeners.get('visibilitychange')?.();
      document.visibilityState = 'visible';
      listeners.get('visibilitychange')?.();
      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(1);

      resolve(measurement(8 * MB));
      await jest.advanceTimersByTimeAsync(0);
      expect(monitor.performance.memoryMeasurement.value?.total).toBe(8);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('discards results that resolve after stop and stops retrying after a rejection', async () => {
    const browser = installPerformanceBrowser();

    let resolve: (value: ReturnType<typeof measurement>) => void = () => {};

    const measure = installMeasure(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      monitor.start();
      await jest.advanceTimersByTimeAsync(0);
      monitor.stop();
      resolve(measurement(8 * MB));
      await jest.advanceTimersByTimeAsync(0);
      expect(monitor.performance.memoryMeasurement.value).toBeNull();

      measure.mockImplementation(() => Promise.reject(new DOMException('', 'SecurityError')));
      monitor.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(3_600_000);
      expect(measure).toHaveBeenCalledTimes(2);

      // A new start() tries again.
      measure.mockImplementation(async () => measurement(4 * MB));
      monitor.stop();
      monitor.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(3);
      expect(monitor.performance.memoryMeasurement.value?.total).toBe(4);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('ignores a malformed breakdown and files entries without types under Other', async () => {
    const browser = installPerformanceBrowser();
    const measure = installMeasure(async () => ({ bytes: 4 * MB, breakdown: [] }));

    try {
      const monitor = createMonitor({ collectors: { performance: true } });

      measure.mockResolvedValueOnce({ bytes: 4 * MB, breakdown: 'none' } as never);
      monitor.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(monitor.performance.memoryMeasurement.value).toMatchObject({
        total: 4,
        byType: {},
        byContext: [],
      });
      monitor.destroy();

      const typed = createMonitor({ collectors: { performance: true } });

      measure.mockResolvedValueOnce({
        bytes: 3 * MB,
        breakdown: [
          { bytes: MB, types: null },
          { bytes: 2 * MB, types: [42, 'DOM'] },
        ],
      } as never);
      typed.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(typed.performance.memoryMeasurement.value?.byType).toEqual({ Other: 1, DOM: 2 });

      typed.destroy();
    } finally {
      browser.restore();
    }
  });

  test('the default report sends the measured total but no breakdown', async () => {
    const browser = installPerformanceBrowser();
    const transport = jest.fn<(request: ProductionReportRequest) => void>();

    installMeasure(async () => measurement(16 * MB));

    try {
      const monitor = createMonitor({
        env: 'production',
        collectors: { performance: true },
        report: { endpoint: '/metrics', interval: 60_000, transport, flushOnHide: false },
      });

      monitor.start();
      await jest.advanceTimersByTimeAsync(0);

      const sent = monitor.reporter.flush();

      await jest.advanceTimersByTimeAsync(0);
      expect(await sent).toBe(true);

      const payload = transport.mock.calls[0]?.[0].payload as
        | { performance: Record<string, unknown> }
        | undefined;

      expect(payload?.performance.measuredMemory).toBe(16);
      expect(JSON.stringify(payload)).not.toContain('byType');

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a memoryMeasurementInterval of %p',
    (memoryMeasurementInterval) => {
      expect(() =>
        createMonitor({ collectors: { performance: { memoryMeasurementInterval } } }),
      ).toThrow(RangeError);
    },
  );

  test('caps the randomized delay at ten times the mean', async () => {
    const browser = installPerformanceBrowser();
    const measure = installMeasure(async () => measurement(MB));

    // -ln(1 - 0.999999) is about 13.8 means, above the cap.
    jest.spyOn(Math, 'random').mockReturnValue(0.999_999);

    try {
      const monitor = createMonitor({
        collectors: { performance: { memoryMeasurementInterval: 10_000 } },
      });

      monitor.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(99_999);
      expect(measure).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(measure).toHaveBeenCalledTimes(2);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });

  test('never schedules beyond the largest timer delay, which would fire at once', async () => {
    const browser = installPerformanceBrowser();
    const measure = installMeasure(async () => measurement(MB));
    const maxTimeout = 2_147_483_647;

    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    try {
      const monitor = createMonitor({
        collectors: { performance: { memoryMeasurementInterval: 1e12 } },
      });
      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');

      monitor.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(measure).toHaveBeenCalledTimes(1);

      // The next measurement waits the maximum delay rather than overflowing to 1 ms.
      // (Advancing the clock that far would run the two-second memory interval a billion times.)
      expect(setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1]?.[1]).toBe(maxTimeout);
      await jest.advanceTimersByTimeAsync(3_600_000);
      expect(measure).toHaveBeenCalledTimes(1);

      monitor.destroy();
    } finally {
      browser.restore();
    }
  });
});

test('PerformanceCollector destroy is idempotent', () => {
  const browser = installPerformanceBrowser();

  try {
    const monitor = createMonitor({ collectors: { performance: true } });

    monitor.start();
    monitor.performance.destroy();

    const disconnects = browser.disconnect.mock.calls.length;

    monitor.performance.destroy();
    expect(browser.disconnect).toHaveBeenCalledTimes(disconnects);

    monitor.destroy();
  } finally {
    browser.restore();
  }
});

test('PerformanceCollector starts a new CLS session at exactly one second apart or five seconds long', () => {
  const browser = installPerformanceBrowser();
  const shift = (startTime: number, value: number) => ({ startTime, value, hadRecentInput: false });

  try {
    const gap = createMonitor({ collectors: { performance: true } });

    gap.start();
    // 999 ms apart: one session of 0.2. Then exactly 1,000 ms apart: a new session of 0.15.
    browser.emit('layout-shift', [shift(0, 0.1), shift(999, 0.1), shift(1_999, 0.15)]);
    expect(gap.performance.cls.value).toBeCloseTo(0.2);
    gap.destroy();

    const long = createMonitor({ collectors: { performance: true } });

    long.start();
    // Shifts 900 ms apart; the one at 5,000 ms is not within the first session's five seconds.
    browser.emit(
      'layout-shift',
      [0, 900, 1_800, 2_700, 3_600, 4_500].map((startTime) => shift(startTime, 0.01)),
    );
    expect(long.performance.cls.value).toBeCloseTo(0.06);
    browser.emit('layout-shift', [shift(5_000, 0.05)]);
    expect(long.performance.cls.value).toBeCloseTo(0.06);
    browser.emit('layout-shift', [shift(5_000, 0.02)]);
    expect(long.performance.cls.value).toBeCloseTo(0.07);
    long.destroy();
  } finally {
    browser.restore();
  }
});
