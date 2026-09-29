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
    expect(browser.observe).toHaveBeenCalledTimes(2);

    monitor.stop();

    expect(browser.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(browser.disconnect).toHaveBeenCalledTimes(2);

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
