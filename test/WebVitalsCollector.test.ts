import { jest } from '@jest/globals';
import type { MetricType } from 'web-vitals';

type MetricCallback = (metric: MetricType) => void;

const callbacks = new Map<string, MetricCallback>();

jest.unstable_mockModule('web-vitals', () => ({
  onCLS: jest.fn((callback: MetricCallback) => callbacks.set('CLS', callback)),
  onFCP: jest.fn((callback: MetricCallback) => callbacks.set('FCP', callback)),
  onINP: jest.fn((callback: MetricCallback) => callbacks.set('INP', callback)),
  onLCP: jest.fn((callback: MetricCallback) => callbacks.set('LCP', callback)),
  onTTFB: jest.fn((callback: MetricCallback) => callbacks.set('TTFB', callback)),
}));

const attributionCallbacks = new Map<string, MetricCallback>();
const registerAttribution = (name: string) =>
  jest.fn((callback: MetricCallback) => attributionCallbacks.set(name, callback));

jest.unstable_mockModule('web-vitals/attribution', () => ({
  onCLS: registerAttribution('CLS'),
  onFCP: registerAttribution('FCP'),
  onINP: registerAttribution('INP'),
  onLCP: registerAttribution('LCP'),
  onTTFB: registerAttribution('TTFB'),
}));

const { createMonitor } = await import('../src/index');
const webVitals = await import('web-vitals');
const webVitalsAttribution = await import('web-vitals/attribution');

function metric(name: MetricType['name'], value: number): MetricType {
  return {
    name,
    value,
    delta: value,
    rating: 'good',
    id: `${name}-${value}`,
    entries: [],
    navigationType: 'navigate',
    navigationId: 1,
  } as MetricType;
}

afterEach(() => {
  jest.clearAllMocks();
  Reflect.deleteProperty(globalThis, 'window');
});

test('WebVitalsCollector records latest metrics and retained entries', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: { webVitals: true },
  });

  monitor.start();

  expect(webVitals.onCLS).toHaveBeenCalledTimes(1);
  expect(webVitals.onFCP).toHaveBeenCalledTimes(1);
  expect(webVitals.onINP).toHaveBeenCalledTimes(1);
  expect(webVitals.onLCP).toHaveBeenCalledTimes(1);
  expect(webVitals.onTTFB).toHaveBeenCalledTimes(1);

  callbacks.get('CLS')?.(metric('CLS', 0.01));
  callbacks.get('LCP')?.(metric('LCP', 1800));
  callbacks.get('INP')?.(metric('INP', 120));

  const snapshot = monitor.webVitals.snapshot.value;

  expect(snapshot.cls?.value).toBe(0.01);
  expect(snapshot.lcp?.value).toBe(1800);
  expect(snapshot.inp?.value).toBe(120);
  expect(snapshot.entries.map((entry) => entry.name)).toEqual(['LCP', 'INP']);
  expect(monitor.webVitals.onMetric.value?.name).toBe('INP');

  monitor.destroy();
});

test('WebVitalsCollector retains no metric history when maxHistory is zero', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  const monitor = createMonitor({
    maxHistory: 0,
    collectors: { webVitals: true },
  });

  monitor.start();
  callbacks.get('CLS')?.(metric('CLS', 0.01));

  expect(monitor.webVitals.snapshot.value.cls?.value).toBe(0.01);
  expect(monitor.webVitals.snapshot.value.entries).toEqual([]);
  expect(monitor.webVitals.onMetric.value?.name).toBe('CLS');

  monitor.destroy();
});

test('WebVitalsCollector start is idempotent and stop ignores future reports', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  const monitor = createMonitor({
    collectors: { webVitals: true },
  });

  monitor.start();
  monitor.start();

  expect(webVitals.onCLS).not.toHaveBeenCalled();
  expect(webVitals.onFCP).not.toHaveBeenCalled();
  expect(webVitals.onINP).not.toHaveBeenCalled();
  expect(webVitals.onLCP).not.toHaveBeenCalled();
  expect(webVitals.onTTFB).not.toHaveBeenCalled();

  monitor.stop();
  callbacks.get('CLS')?.(metric('CLS', 0.02));

  expect(monitor.webVitals.snapshot.value.cls).toBeNull();

  monitor.destroy();
});

test('WebVitalsCollector shares observers across monitor instances', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  const first = createMonitor({ collectors: { webVitals: true } });
  const second = createMonitor({ collectors: { webVitals: true } });

  first.start();
  second.start();

  callbacks.get('LCP')?.(metric('LCP', 1500));

  expect(first.webVitals.snapshot.value.lcp?.value).toBe(1500);
  expect(second.webVitals.snapshot.value.lcp?.value).toBe(1500);
  expect(webVitals.onCLS).not.toHaveBeenCalled();
  expect(webVitals.onFCP).not.toHaveBeenCalled();
  expect(webVitals.onINP).not.toHaveBeenCalled();
  expect(webVitals.onLCP).not.toHaveBeenCalled();
  expect(webVitals.onTTFB).not.toHaveBeenCalled();

  first.destroy();
  callbacks.get('LCP')?.(metric('LCP', 1900));

  expect(first.webVitals.snapshot.value.lcp?.value).toBe(1500);
  expect(second.webVitals.snapshot.value.lcp?.value).toBe(1900);

  second.destroy();
});

function withAttribution(base: MetricType, attribution: Record<string, unknown>): MetricType {
  return { ...base, attribution } as unknown as MetricType;
}

/** Lets the on-demand import of the attribution build settle. */
async function loadAttributionBuild(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('attribution', () => {
  const longSelector = `div${'.x'.repeat(400)}`;

  test('loads the attribution build on demand and keeps a serializable summary', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const monitor = createMonitor({
      collectors: { webVitals: { attribution: true, reportAllChanges: false } },
    });

    try {
      monitor.start();
      expect(webVitals.onLCP).not.toHaveBeenCalled();
      await loadAttributionBuild();
      expect(webVitalsAttribution.onLCP).toHaveBeenCalledWith(expect.any(Function), {
        reportAllChanges: false,
      });

      attributionCallbacks.get('LCP')?.(
        withAttribution(metric('LCP', 2400), {
          target: longSelector,
          url: 'https://cdn.example.com/hero.jpg',
          timeToFirstByte: 300,
          resourceLoadDelay: 400,
          resourceLoadDuration: 1200,
          elementRenderDelay: 500,
          lcpEntry: { element: {} },
        }),
      );
      attributionCallbacks.get('INP')?.(
        withAttribution(metric('INP', 320), {
          interactionTarget: 'button#save',
          interactionType: 'pointer',
          interactionTime: 1500,
          inputDelay: 20,
          processingDuration: 250,
          presentationDelay: 50,
          loadState: 'complete',
          processedEventEntries: [{}],
          longAnimationFrameEntries: [{}],
          longestScript: {
            entry: {
              sourceURL: 'https://app.example.com/main.js',
              invoker: 'BUTTON#save.onclick',
              invokerType: 'event-listener',
            },
            subpart: 'processing-duration',
            intersectingDuration: 230,
          },
          totalScriptDuration: 240,
          totalStyleAndLayoutDuration: 30,
          totalPaintDuration: 10,
          totalUnattributedDuration: NaN,
        }),
      );

      const { lcp, inp } = monitor.webVitals.snapshot.value;

      expect(lcp?.attribution).toEqual({
        target: longSelector.slice(0, 500),
        url: 'https://cdn.example.com/hero.jpg',
        timeToFirstByte: 300,
        resourceLoadDelay: 400,
        resourceLoadDuration: 1200,
        elementRenderDelay: 500,
      });
      expect(inp?.attribution).toEqual({
        interactionTarget: 'button#save',
        interactionType: 'pointer',
        interactionTime: 1500,
        inputDelay: 20,
        processingDuration: 250,
        presentationDelay: 50,
        loadState: 'complete',
        longestScript: {
          url: 'https://app.example.com/main.js',
          invoker: 'BUTTON#save.onclick',
          invokerType: 'event-listener',
          subpart: 'processing-duration',
          intersectingDuration: 230,
        },
        totalScriptDuration: 240,
        totalStyleAndLayoutDuration: 30,
        totalPaintDuration: 10,
        totalUnattributedDuration: null,
      });
      expect(() => JSON.stringify(monitor.webVitals.snapshot.value)).not.toThrow();
    } finally {
      monitor.destroy();
    }
  });

  test('summarizes CLS, FCP, and TTFB attribution', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const monitor = createMonitor({
      collectors: { webVitals: { attribution: true, reportAllChanges: false } },
    });

    try {
      monitor.start();
      await loadAttributionBuild();
      attributionCallbacks.get('CLS')?.(
        withAttribution(metric('CLS', 0.2), {
          largestShiftTarget: '#banner',
          largestShiftTime: 900,
          largestShiftValue: 0.15,
          largestShiftEntry: {},
          loadState: 'dom-content-loaded',
        }),
      );
      attributionCallbacks.get('FCP')?.(
        withAttribution(metric('FCP', 900), {
          timeToFirstByte: 200,
          firstByteToFCP: 700,
          loadState: 'dom-interactive',
        }),
      );
      attributionCallbacks.get('TTFB')?.(
        withAttribution(metric('TTFB', 200), {
          waitingDuration: 10,
          cacheDuration: 0,
          dnsDuration: 20,
          connectionDuration: 30,
          requestDuration: 140,
        }),
      );

      const { cls, fcp, ttfb } = monitor.webVitals.snapshot.value;

      expect(cls?.attribution).toEqual({
        largestShiftTarget: '#banner',
        largestShiftTime: 900,
        largestShiftValue: 0.15,
        loadState: 'dom-content-loaded',
      });
      expect(fcp?.attribution).toEqual({
        timeToFirstByte: 200,
        firstByteToFCP: 700,
        loadState: 'dom-interactive',
      });
      expect(ttfb?.attribution).toEqual({
        waitingDuration: 10,
        cacheDuration: 0,
        dnsDuration: 20,
        connectionDuration: 30,
        requestDuration: 140,
      });
    } finally {
      monitor.destroy();
    }
  });

  test('is off by default and never loads the attribution build', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const monitor = createMonitor({ collectors: { webVitals: { reportAllChanges: false } } });

    try {
      monitor.start();
      await loadAttributionBuild();
      expect(webVitalsAttribution.onLCP).not.toHaveBeenCalled();
      callbacks.get('LCP')?.(withAttribution(metric('LCP', 1000), { target: '#hero' }));
      expect(monitor.webVitals.snapshot.value.lcp).not.toHaveProperty('attribution');
    } finally {
      monitor.destroy();
    }
  });

  test('the default report keeps timings but drops selectors, URLs, and invokers', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const transport = jest.fn<(request: { payload: unknown }) => void>();
    const monitor = createMonitor({
      env: 'production',
      collectors: { webVitals: { attribution: true, reportAllChanges: false } },
      report: { endpoint: '/metrics', interval: 60_000, transport, flushOnHide: false },
    });

    try {
      monitor.start();
      await loadAttributionBuild();
      attributionCallbacks.get('INP')?.(
        withAttribution(metric('INP', 320), {
          interactionTarget: 'button#save',
          interactionType: 'keyboard',
          inputDelay: 20,
          processingDuration: 250,
          presentationDelay: 50,
          loadState: 'complete',
          longestScript: {
            entry: {
              sourceURL: 'https://app.example.com/main.js',
              invoker: 'x',
              invokerType: 'event-listener',
            },
            subpart: 'processing-duration',
            intersectingDuration: 230,
          },
        }),
      );
      attributionCallbacks.get('LCP')?.(
        withAttribution(metric('LCP', 2400), {
          target: '#hero',
          url: 'https://cdn.example.com/hero.jpg?token=secret',
          timeToFirstByte: 300,
          resourceLoadDelay: 400,
          resourceLoadDuration: 1200,
          elementRenderDelay: 500,
        }),
      );

      expect(await monitor.reporter.flush()).toBe(true);

      const request = transport.mock.calls[0]?.[0] as { body: string; payload: unknown };

      expect(request.payload).toMatchObject({
        webVitals: {
          inp: {
            value: 320,
            attribution: {
              interactionType: 'keyboard',
              processingDuration: 250,
              longestScript: {
                invokerType: 'event-listener',
                subpart: 'processing-duration',
                intersectingDuration: 230,
              },
            },
          },
          lcp: { attribution: { resourceLoadDuration: 1200 } },
        },
      });
      expect(request.body).not.toMatch(/button#save|#hero|example\.com|secret/);
    } finally {
      monitor.destroy();
    }
  });
});

describe('attribution edge cases', () => {
  test('fills missing optional attribution fields with null and skips absent attribution', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const monitor = createMonitor({
      collectors: { webVitals: { attribution: true, reportAllChanges: false } },
    });

    try {
      monitor.start();
      await loadAttributionBuild();
      attributionCallbacks.get('INP')?.(
        withAttribution(metric('INP', 100), {
          interactionTarget: '',
          inputDelay: 1,
          processingDuration: 2,
          presentationDelay: 3,
        }),
      );
      attributionCallbacks.get('CLS')?.(withAttribution(metric('CLS', 0.1), {}));
      attributionCallbacks.get('FCP')?.(
        withAttribution(metric('FCP', 800), { timeToFirstByte: 100, firstByteToFCP: 700 }),
      );
      attributionCallbacks.get('LCP')?.(metric('LCP', 1200));
      attributionCallbacks.get('TTFB')?.(
        withAttribution({ ...metric('TTFB', 90), name: 'FID' } as unknown as MetricType, {}),
      );

      const snapshot = monitor.webVitals.snapshot.value;

      expect(snapshot.inp?.attribution).toMatchObject({
        interactionTarget: null,
        interactionType: null,
        interactionTime: null,
        loadState: null,
        longestScript: null,
      });
      expect(snapshot.cls?.attribution).toEqual({
        largestShiftTarget: null,
        largestShiftTime: null,
        largestShiftValue: null,
        loadState: null,
      });
      expect(snapshot.fcp?.attribution).toMatchObject({ loadState: null });
      expect(snapshot.lcp).not.toHaveProperty('attribution');
      expect(snapshot.entries[snapshot.entries.length - 1]).not.toHaveProperty('attribution');
    } finally {
      monitor.destroy();
    }
  });

  test('a failed attribution build registration is retried on the next start', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    (webVitalsAttribution.onCLS as jest.Mock).mockImplementationOnce(() => {
      throw new Error('chunk failed');
    });

    const monitor = createMonitor({
      collectors: { webVitals: { attribution: true, reportAllChanges: true } },
    });

    try {
      monitor.start();
      await loadAttributionBuild();
      expect(webVitalsAttribution.onCLS).toHaveBeenCalledTimes(1);
      expect(webVitalsAttribution.onLCP).not.toHaveBeenCalled();

      monitor.stop();
      monitor.start();
      await loadAttributionBuild();

      expect(webVitalsAttribution.onCLS).toHaveBeenCalledTimes(2);
      expect(webVitalsAttribution.onLCP).toHaveBeenCalledWith(expect.any(Function), {
        reportAllChanges: true,
      });
    } finally {
      monitor.destroy();
    }
  });
});

test('WebVitalsCollector clearLog resets metrics and stays inert after destroy', () => {
  const monitor = createMonitor({ collectors: { webVitals: { reportAllChanges: false } } });

  monitor.start();
  expect(webVitals.onLCP).not.toHaveBeenCalled();

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  monitor.start();
  callbacks.get('LCP')?.(metric('LCP', 1000));
  expect(monitor.webVitals.snapshot.value.lcp?.value).toBe(1000);

  monitor.webVitals.clearLog();
  expect(monitor.webVitals.snapshot.value.lcp).toBeNull();
  expect(monitor.webVitals.snapshot.value.entries).toEqual([]);
  expect(monitor.webVitals.onMetric.value).toBeNull();

  monitor.destroy();
  monitor.webVitals.destroy();
  monitor.webVitals.start();
  callbacks.get('LCP')?.(metric('LCP', 2000));

  expect(monitor.webVitals.snapshot.value.lcp).toBeNull();
});

test('the default report summarizes CLS, FCP and TTFB attribution and memory usage', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true,
    value: {
      usedJSHeapSize: 25 * 1_048_576,
      totalJSHeapSize: 50 * 1_048_576,
      jsHeapSizeLimit: 100 * 1_048_576,
    },
  });

  const transport = jest.fn<(request: { payload: unknown }) => void>();
  const monitor = createMonitor({
    env: 'production',
    collectors: {
      performance: true,
      // The attribution mocks keep the callback of the channel registered last (all changes).
      webVitals: { attribution: true, reportAllChanges: true },
    },
    report: { endpoint: '/metrics', interval: 60_000, transport, flushOnHide: false },
  });

  try {
    monitor.start();
    await loadAttributionBuild();
    attributionCallbacks.get('CLS')?.(
      withAttribution(metric('CLS', 0.2), {
        largestShiftTarget: '#banner',
        largestShiftTime: 900,
        largestShiftValue: 0.15,
        loadState: 'complete',
      }),
    );
    attributionCallbacks.get('FCP')?.(
      withAttribution(metric('FCP', 900), {
        timeToFirstByte: 200,
        firstByteToFCP: 700,
        loadState: 'dom-interactive',
      }),
    );
    attributionCallbacks.get('TTFB')?.(
      withAttribution(metric('TTFB', 200), {
        waitingDuration: 10,
        cacheDuration: 0,
        dnsDuration: 20,
        connectionDuration: 30,
        requestDuration: 140,
      }),
    );

    expect(await monitor.reporter.flush()).toBe(true);

    const request = transport.mock.calls[0]?.[0] as { body: string; payload: unknown };

    expect(request.payload).toMatchObject({
      performance: { memoryPercent: 25 },
      webVitals: {
        cls: {
          value: 0.2,
          attribution: { largestShiftValue: 0.15, largestShiftTime: 900, loadState: 'complete' },
        },
        fcp: {
          attribution: { timeToFirstByte: 200, firstByteToFCP: 700, loadState: 'dom-interactive' },
        },
        ttfb: {
          attribution: {
            waitingDuration: 10,
            cacheDuration: 0,
            dnsDuration: 20,
            connectionDuration: 30,
            requestDuration: 140,
          },
        },
        inp: null,
        lcp: null,
      },
    });
    expect(request.body).not.toContain('#banner');
  } finally {
    monitor.destroy();
    Reflect.deleteProperty(globalThis.performance, 'memory');
  }
});

describe('soft navigations', () => {
  function onNavigation(
    base: MetricType,
    navigationId: number,
    navigationURL?: string,
    navigationType: MetricType['navigationType'] = 'soft-navigation',
  ): MetricType {
    return { ...base, navigationId, navigationType, navigationURL } as MetricType;
  }

  test('registers a separate observer channel with reportSoftNavs', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const soft = createMonitor({
      collectors: { webVitals: { softNavigations: true, reportAllChanges: false } },
    });

    try {
      soft.start();

      expect(webVitals.onLCP).toHaveBeenCalledTimes(1);
      expect(webVitals.onLCP).toHaveBeenCalledWith(expect.any(Function), {
        reportAllChanges: false,
        reportSoftNavs: true,
      });
    } finally {
      soft.destroy();
    }
  });

  test('keeps the newest navigation as the latest value and older reports in the history', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const monitor = createMonitor({
      collectors: { webVitals: { softNavigations: true, reportAllChanges: true } },
    });

    try {
      monitor.start();
      callbacks.get('CLS')?.(
        onNavigation(metric('CLS', 0.05), 1, 'https://app.example.com/', 'navigate'),
      );
      callbacks.get('LCP')?.(onNavigation(metric('LCP', 800), 2, 'https://app.example.com/cart'));
      callbacks.get('CLS')?.(onNavigation(metric('CLS', 0.01), 2, 'https://app.example.com/cart'));
      // The first page's final CLS arrives after the soft navigation started.
      callbacks.get('CLS')?.(
        onNavigation(metric('CLS', 0.2), 1, 'https://app.example.com/', 'navigate'),
      );

      const snapshot = monitor.webVitals.snapshot.value;

      expect(snapshot.cls).toMatchObject({
        value: 0.01,
        navigationId: 2,
        navigationType: 'soft-navigation',
        navigationURL: 'https://app.example.com/cart',
      });
      expect(snapshot.lcp).toMatchObject({ value: 800, navigationId: 2 });
      expect(
        snapshot.entries.map(({ name, value, navigationId }) => [name, value, navigationId]),
      ).toEqual([
        ['CLS', 0.05, 1],
        ['LCP', 800, 2],
        ['CLS', 0.01, 2],
        ['CLS', 0.2, 1],
      ]);
      expect(monitor.webVitals.onMetric.value).toMatchObject({ value: 0.2, navigationId: 1 });
    } finally {
      monitor.destroy();
    }
  });

  test('caps navigation URLs and reports null when the browser omits them', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const monitor = createMonitor({
      collectors: { webVitals: { softNavigations: true, reportAllChanges: true } },
    });

    try {
      monitor.start();
      callbacks.get('FCP')?.(
        onNavigation(metric('FCP', 300), 3, `https://app.example.com/${'a'.repeat(900)}`),
      );
      callbacks.get('TTFB')?.(onNavigation(metric('TTFB', 0), 3));

      const { fcp, ttfb } = monitor.webVitals.snapshot.value;

      expect(fcp?.navigationURL).toHaveLength(500);
      expect(ttfb?.navigationURL).toBeNull();
    } finally {
      monitor.destroy();
    }
  });

  test('the default report leaves navigation URLs and ids out', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    const transport = jest.fn<(request: { body: string }) => void>();
    const monitor = createMonitor({
      env: 'production',
      collectors: { webVitals: { softNavigations: true, reportAllChanges: true } },
      report: { endpoint: '/metrics', interval: 60_000, transport, flushOnHide: false },
    });

    try {
      monitor.start();
      callbacks.get('LCP')?.(
        onNavigation(metric('LCP', 900), 4, 'https://app.example.com/orders/42?token=secret'),
      );

      expect(await monitor.reporter.flush()).toBe(true);

      const body = transport.mock.calls[0]?.[0].body ?? '';

      expect(JSON.parse(body)).toMatchObject({ webVitals: { lcp: { value: 900 } } });
      expect(body).not.toMatch(/example\.com|secret|navigationId|soft-navigation/);
    } finally {
      monitor.destroy();
    }
  });
});
