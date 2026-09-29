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
