import { jest } from '@jest/globals';
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
