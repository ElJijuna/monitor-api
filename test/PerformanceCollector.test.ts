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

  class TestPerformanceObserver {
    observe(): void {
      observe();
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
    requestAnimationFrame,
    restore: () => {
      Reflect.deleteProperty(globalThis, 'window');
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
      Reflect.deleteProperty(globalThis, 'PerformanceObserver');
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
