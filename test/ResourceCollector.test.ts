import { jest } from '@jest/globals';
import { ResourceCollector } from '../src/collectors/ResourceCollector';
import type { ProductionReportRequest } from '../src/index';
import { createMonitor } from '../src/index';

type ObserverCallback = (list: { getEntries(): unknown[] }) => void;

const observers: FakeObserver[] = [];

class FakeObserver {
  observe = jest.fn();
  disconnect = jest.fn(() => {
    this.connected = false;
  });
  connected = true;

  constructor(readonly callback: ObserverCallback) {
    observers.push(this);
  }

  deliver(entries: unknown[]) {
    if (this.connected) {
      this.callback({ getEntries: () => entries });
    }
  }
}

beforeEach(() => {
  observers.length = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('https://app.example.com/page'),
  });
  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    value: FakeObserver,
  });
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const name of ['window', 'location', 'PerformanceObserver']) {
    Reflect.deleteProperty(globalThis, name);
  }
});

function timing(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    entryType: 'resource',
    initiatorType: 'link',
    startTime: 10,
    duration: 100,
    responseEnd: 110,
    transferSize: 1_300,
    encodedBodySize: 1_000,
    decodedBodySize: 4_000,
    ...overrides,
  };
}

function resourcesMonitor(config: Record<string, unknown> = {}) {
  return createMonitor({ collectors: { resources: { ...config } } });
}

test.each([
  ['the default collectors', createMonitor],
  ['a list without it', () => createMonitor({ collectors: ['network'] })],
])('is disabled with %s', (_, create) => {
  const monitor = create();

  monitor.resources.start();
  expect(observers).toHaveLength(0);
  expect(monitor.getSnapshot().resources.totals.count).toBe(0);
  monitor.destroy();
});

test('records buffered assets with types, cache state, origin, and status', () => {
  const monitor = resourcesMonitor();
  const notify = jest.fn();

  try {
    monitor.start();
    expect(observers[0]?.observe).toHaveBeenCalledWith({ type: 'resource', buffered: true });
    monitor.resources.snapshot.subscribe(notify);

    observers[0]?.deliver([
      timing('https://app.example.com/app.js?v=1', {
        initiatorType: 'script',
        renderBlockingStatus: 'blocking',
        responseStatus: 200,
      }),
      timing('https://app.example.com/styles.css', { renderBlockingStatus: 'non-blocking' }),
      timing('https://fonts.example.net/inter.woff2', {
        initiatorType: 'css',
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
      }),
      timing('https://app.example.com/hero.png', { initiatorType: 'img', transferSize: 0 }),
      timing('https://app.example.com/missing.js', {
        initiatorType: 'script',
        responseStatus: 404,
      }),
      timing('https://app.example.com/api/data', { initiatorType: 'fetch' }),
      timing('https://app.example.com/api/xhr', { initiatorType: 'xmlhttprequest' }),
      timing('https://app.example.com/beacon', { initiatorType: 'beacon' }),
    ]);

    const snapshot = monitor.resources.snapshot.value;

    expect(notify).toHaveBeenCalledTimes(1);
    expect(snapshot.entries.map((entry) => [entry.type, entry.cache])).toEqual([
      ['script', 'miss'],
      ['stylesheet', 'miss'],
      ['font', 'unknown'],
      ['image', 'hit'],
      ['script', 'miss'],
    ]);
    expect(snapshot.entries[0]).toMatchObject({
      url: 'https://app.example.com/app.js?v=1',
      initiatorType: 'script',
      duration: 100,
      renderBlocking: true,
      status: 200,
      thirdParty: false,
      timestamp: Math.round(performance.timeOrigin + 110),
    });
    expect(snapshot.entries[1]?.renderBlocking).toBe(false);
    expect(snapshot.entries[2]).toMatchObject({ thirdParty: true, status: null });
    expect(snapshot.entries[3]?.renderBlocking).toBeNull();
    expect(snapshot.totals).toEqual({
      count: 5,
      transferSize: 3 * 1_300,
      decodedBodySize: 4 * 4_000,
      cacheHits: 1,
      totalDuration: 500,
      maxDuration: 100,
      thirdPartyCount: 1,
      thirdPartyTransferSize: 0,
      renderBlockingCount: 1,
      failedCount: 1,
    });
    expect(snapshot.byType.script).toMatchObject({ count: 2, transferSize: 2_600 });
    expect(snapshot.byType.other.count).toBe(0);
    expect(monitor.resources.onResource.value?.url).toBe('https://app.example.com/missing.js');
  } finally {
    monitor.destroy();
  }
});

test('keeps the slowest resources and aggregates beyond the retained history', () => {
  const monitor = resourcesMonitor({ maxHistory: 0, slowestCount: 2 });

  try {
    monitor.start();
    observers[0]?.deliver([
      timing('https://app.example.com/a.js', { duration: 30 }),
      timing('https://app.example.com/b.js', { duration: 90 }),
    ]);
    observers[0]?.deliver([timing('https://app.example.com/c.js', { duration: 60 })]);

    const snapshot = monitor.resources.snapshot.value;

    expect(snapshot.entries).toEqual([]);
    expect(snapshot.totals.count).toBe(3);
    expect(snapshot.slowest.map((entry) => entry.url)).toEqual([
      'https://app.example.com/b.js',
      'https://app.example.com/c.js',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('applies the filter and excludes a relative report endpoint', () => {
  const monitor = createMonitor({
    env: 'production',
    collectors: { resources: { filter: (url) => !url.includes('analytics') } },
    report: { endpoint: '/metrics', interval: 60_000, transport: () => {}, flushOnHide: false },
  });

  try {
    monitor.start();
    observers[0]?.deliver([
      timing('https://app.example.com/metrics', { initiatorType: 'img' }),
      timing('https://cdn.example.com/analytics.js', { initiatorType: 'script' }),
      timing('https://app.example.com/app.js', { initiatorType: 'script' }),
    ]);

    expect(monitor.resources.snapshot.value.entries.map((entry) => entry.url)).toEqual([
      'https://app.example.com/app.js',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('a restart records only resources that finish after it', () => {
  const monitor = resourcesMonitor();

  try {
    monitor.start();
    observers[0]?.deliver([timing('https://app.example.com/first.js', { responseEnd: 50 })]);
    monitor.stop();
    expect(observers[0]?.disconnect).toHaveBeenCalled();

    jest.spyOn(performance, 'now').mockReturnValueOnce(1_000);
    monitor.start();
    observers[1]?.deliver([
      timing('https://app.example.com/first.js', { responseEnd: 50 }),
      timing('https://app.example.com/while-stopped.js', { responseEnd: 900 }),
      timing('https://app.example.com/after.js', { responseEnd: 1_200 }),
    ]);

    expect(monitor.resources.snapshot.value.entries.map((entry) => entry.url)).toEqual([
      'https://app.example.com/first.js',
      'https://app.example.com/after.js',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('clearLog resets entries and statistics', () => {
  const monitor = resourcesMonitor();

  try {
    monitor.start();
    observers[0]?.deliver([timing('https://app.example.com/app.js')]);
    monitor.resources.clearLog();
    expect(monitor.resources.snapshot.value.totals.count).toBe(0);
    expect(monitor.resources.snapshot.value.entries).toEqual([]);
    expect(monitor.resources.onResource.value).toBeNull();
  } finally {
    monitor.destroy();
  }
});

test('start is a no-op without Resource Timing support', () => {
  Reflect.deleteProperty(globalThis, 'PerformanceObserver');
  const monitor = resourcesMonitor();

  expect(() => monitor.start()).not.toThrow();
  monitor.destroy();
});

test('the default report sends resource aggregates without URLs, only when enabled', async () => {
  const transport = jest.fn<(request: ProductionReportRequest) => void>();
  const report = { endpoint: '/metrics', interval: 60_000, transport, flushOnHide: false };
  const enabled = createMonitor({ env: 'production', collectors: ['resources'], report });
  const disabled = createMonitor({ env: 'production', collectors: [], report });

  try {
    enabled.start();
    disabled.start();
    observers[0]?.deliver([timing('https://app.example.com/secret-path.js?token=abc')]);
    await enabled.reporter.flush();
    await disabled.reporter.flush();

    const [withResources, withoutResources] = transport.mock.calls.map(([request]) => request);

    expect(withResources?.payload).toMatchObject({
      resources: { totals: { count: 1 }, byType: { script: { count: 1 } } },
    });
    expect(withResources?.body).not.toMatch(/secret-path|token/);
    expect(withoutResources?.payload).not.toHaveProperty('resources');
  } finally {
    enabled.destroy();
    disabled.destroy();
  }
});

test('classifies extension-less and unparseable URLs and ignores batches with nothing kept', () => {
  const monitor = resourcesMonitor();

  try {
    monitor.start();
    observers[0]?.deliver([timing('https://app.example.com/asset?v=1')]);
    observers[0]?.deliver([timing('http://[bad-host/style.css')]);
    observers[0]?.deliver([timing('https://app.example.com/beacon', { initiatorType: 'beacon' })]);

    expect(
      monitor.resources.snapshot.value.entries.map(({ type, thirdParty }) => ({
        type,
        thirdParty,
      })),
    ).toEqual([
      { type: 'other', thirdParty: false },
      { type: 'stylesheet', thirdParty: false },
    ]);
  } finally {
    monitor.destroy();
  }
});

test('start tolerates an observer that rejects the resource entry type', () => {
  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    value: class {
      observe(): void {
        throw new TypeError('unsupported');
      }

      disconnect(): void {}
    },
  });

  const monitor = resourcesMonitor();

  try {
    expect(() => monitor.start()).not.toThrow();
    expect(monitor.resources.snapshot.value.entries).toEqual([]);
  } finally {
    monitor.destroy();
  }
});

test('stays inert after destroy', () => {
  const monitor = resourcesMonitor();

  monitor.destroy();
  monitor.resources.destroy();
  monitor.resources.start();

  expect(observers).toEqual([]);
});

test('ResourceCollector created on its own excludes no URL by default', () => {
  const collector = new ResourceCollector({ maxHistory: 10 });

  collector.start();
  observers[0]?.deliver([timing('https://app.example.com/metrics.css')]);

  expect(collector.snapshot.value.totals.count).toBe(1);

  collector.destroy();
});

test.each([
  ['an uppercase extension', 'https://app.example.com/STYLE.CSS', 'stylesheet'],
  ['a fragment', 'https://app.example.com/fonts/icons.woff2#iefix', 'font'],
  ['a query and a fragment', 'https://app.example.com/logo.png?v=2#top', 'image'],
  ['a query containing a dot', 'https://app.example.com/data?file=report.css', 'other'],
  ['a dotted directory without an extension', 'https://app.example.com/v1.2/fonts/inter', 'other'],
  ['an extension on a directory, not the file', 'https://app.example.com/app.js/chunk', 'other'],
  ['a module script', 'https://app.example.com/entry.mjs', 'script'],
])('classifies a link resource with %s', (_, url, type) => {
  const monitor = resourcesMonitor();

  try {
    monitor.start();
    observers[0]?.deliver([timing(url)]);

    expect(monitor.resources.snapshot.value.entries[0]?.type).toBe(type);
  } finally {
    monitor.destroy();
  }
});

test('the initiator decides the type before the URL does', () => {
  const monitor = resourcesMonitor();

  try {
    monitor.start();
    // An image element loading a .js URL is still an image, and a video element loading a .css URL is media.
    observers[0]?.deliver([
      timing('https://app.example.com/tracker.js', { initiatorType: 'img' }),
      timing('https://app.example.com/clip.css', { initiatorType: 'video' }),
    ]);

    expect(monitor.resources.snapshot.value.entries.map((entry) => entry.type)).toEqual([
      'image',
      'media',
    ]);
  } finally {
    monitor.destroy();
  }
});
