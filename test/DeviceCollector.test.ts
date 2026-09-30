import { jest } from '@jest/globals';
import { emptyDeviceSnapshot, parseUserAgent } from '../src/collectors/DeviceCollector';
import { createMonitor } from '../src/index';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
// jest.useRealTimers() can leave the interval globals undefined; restore them explicitly.
const realTimers = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
};

function installBrowser(hardwareConcurrency: unknown, onLine: unknown = true) {
  const window = new EventTarget();
  const navigator = { hardwareConcurrency, onLine };

  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });

  return {
    navigator,
    setOnline(value: boolean) {
      navigator.onLine = value;
      window.dispatchEvent(new Event(value ? 'online' : 'offline'));
    },
  };
}

class FakeMediaQueryList extends EventTarget {
  constructor(
    readonly media: string,
    public matches: boolean,
  ) {
    super();
  }
}

// A Chromium-like browser with Client Hints, Network Information, and media queries.
function installRichBrowser() {
  const window = Object.assign(new EventTarget(), {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    screen: { width: 1440, height: 900 },
    matchMedia: (query: string) => {
      let list = queries.get(query);

      if (!list) {
        list = new FakeMediaQueryList(query, false);
        queries.set(query, list);
      }

      return list;
    },
  });
  const queries = new Map<string, FakeMediaQueryList>();
  const connection = Object.assign(new EventTarget(), {
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false,
  });
  const navigator = {
    hardwareConcurrency: 8,
    onLine: true,
    deviceMemory: 8,
    language: 'es-ES',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0 Safari/537.36',
    userAgentData: {
      brands: [
        { brand: 'Chromium', version: '128' },
        { brand: 'Not;A=Brand', version: '24' },
        { brand: 'Google Chrome', version: '128' },
      ],
      mobile: false,
      platform: 'macOS',
    },
    connection,
  };

  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });

  return {
    window,
    navigator,
    connection,
    setMedia(query: string, matches: boolean) {
      const list = window.matchMedia(query);

      list.matches = matches;
      list.dispatchEvent(new Event('change'));
    },
  };
}

afterEach(() => {
  jest.useRealTimers();
  Object.assign(globalThis, realTimers);
  Reflect.deleteProperty(globalThis, 'window');

  if (originalNavigator) {
    Object.defineProperty(globalThis, 'navigator', originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('DeviceCollector reads the logical processor count on start', () => {
  installBrowser(8);

  const monitor = createMonitor({ collectors: ['device'] });

  expect(monitor.device.snapshot.value).toEqual(emptyDeviceSnapshot());

  monitor.start();
  expect(monitor.getSnapshot().device).toMatchObject({
    hardwareConcurrency: 8,
    online: true,
    offlineCount: 0,
  });

  monitor.stop();
  expect(monitor.device.snapshot.value.hardwareConcurrency).toBe(8);

  monitor.destroy();
});

test.each([undefined, 0, -2, 2.5, Number.NaN, '4'])(
  'DeviceCollector reports null for an unusable hardwareConcurrency of %p',
  (value) => {
    installBrowser(value);

    const monitor = createMonitor({ collectors: ['device'] });

    monitor.start();
    expect(monitor.device.snapshot.value.hardwareConcurrency).toBeNull();

    monitor.destroy();
  },
);

test('DeviceCollector does nothing outside a browser or after destroy', () => {
  // Node exposes navigator.hardwareConcurrency, but only a browser's value describes the user.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { hardwareConcurrency: 8 },
  });

  const server = createMonitor({ collectors: ['device'] });

  server.start();
  expect(server.device.snapshot.value.hardwareConcurrency).toBeNull();
  server.destroy();

  installBrowser(8);

  const destroyed = createMonitor({ collectors: ['device'] });

  destroyed.destroy();
  destroyed.device.start();
  expect(destroyed.device.snapshot.value.hardwareConcurrency).toBeNull();
});

test('DeviceCollector is enabled by default and disabled when omitted from collectors', () => {
  installBrowser(4);

  const byDefault = createMonitor();
  const omitted = createMonitor({ collectors: ['events'] });

  // Starts only this collector; a disabled one is an inert facade that never reads the device.
  byDefault.device.start();
  omitted.device.start();

  expect(byDefault.getSnapshot().device.hardwareConcurrency).toBe(4);
  expect(omitted.getSnapshot().device.hardwareConcurrency).toBeNull();

  byDefault.destroy();
  omitted.destroy();
});

test('DeviceCollector tracks online status and counts offline transitions', () => {
  const browser = installBrowser(8, false);
  const monitor = createMonitor({ collectors: ['device'] });
  const notify = jest.fn();

  monitor.start();
  monitor.device.snapshot.subscribe(notify);
  notify.mockClear();

  // Starting offline is a state, not a transition.
  expect(monitor.device.snapshot.value).toMatchObject({ online: false, offlineCount: 0 });

  browser.setOnline(true);
  browser.setOnline(false);
  browser.setOnline(false);
  browser.setOnline(true);
  browser.setOnline(true);
  browser.setOnline(false);

  expect(monitor.device.snapshot.value).toMatchObject({ online: false, offlineCount: 2 });
  // Repeated events that change nothing do not notify.
  expect(notify).toHaveBeenCalledTimes(4);

  monitor.stop();
  browser.setOnline(true);
  expect(monitor.device.snapshot.value).toMatchObject({ online: false, offlineCount: 2 });

  // A restart re-reads the current state without counting what happened while stopped.
  browser.navigator.onLine = false;
  monitor.start();
  monitor.start();
  browser.setOnline(true);
  browser.setOnline(false);
  expect(monitor.device.snapshot.value).toMatchObject({ online: false, offlineCount: 3 });

  monitor.destroy();
  browser.setOnline(true);
  expect(monitor.device.snapshot.value.online).toBe(false);
});

test('DeviceCollector reports null online status where navigator.onLine is unavailable', () => {
  installBrowser(8, null);

  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value.online).toBeNull();

  monitor.destroy();
});

test('DeviceCollector reads browser, locale, sizes, connection, and preferences on start', () => {
  const browser = installRichBrowser();

  browser.setMedia('(prefers-color-scheme: dark)', true);
  browser.setMedia('(prefers-reduced-motion: reduce)', true);

  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value).toEqual({
    hardwareConcurrency: 8,
    deviceMemory: 8,
    online: true,
    offlineCount: 0,
    // The vendor brand wins over "Chromium", and the placeholder brand is ignored.
    browser: { name: 'Chrome', majorVersion: 128, mobile: false, platform: 'macOS' },
    language: 'es-ES',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: { width: 1440, height: 900, pixelRatio: 2 },
    viewport: { width: 1280, height: 720 },
    connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false },
    colorScheme: 'dark',
    reducedMotion: true,
  });

  monitor.destroy();
});

test('DeviceCollector falls back to the User-Agent string without Client Hints', () => {
  const browser = installRichBrowser();

  Reflect.deleteProperty(browser.navigator, 'userAgentData');
  browser.navigator.userAgent =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value.browser).toEqual({
    name: 'Safari',
    majorVersion: 17,
    mobile: true,
    platform: 'iOS',
  });
  // The raw string is never retained.
  expect(JSON.stringify(monitor.getSnapshot())).not.toContain('Mozilla');

  monitor.destroy();
});

test('DeviceCollector uses the User-Agent when Client Hints only list placeholder brands', () => {
  const browser = installRichBrowser();

  browser.navigator.userAgentData.brands = [{ brand: 'Not)A;Brand', version: '99' }];

  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value.browser).toMatchObject({
    name: 'Chrome',
    majorVersion: 128,
  });

  monitor.destroy();
});

test.each([
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
    { name: 'Edge', majorVersion: 128, mobile: false, platform: 'Windows' },
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    { name: 'Firefox', majorVersion: 131, mobile: false, platform: 'Windows' },
  ],
  [
    'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    { name: 'Firefox', majorVersion: 131, mobile: true, platform: 'Android' },
  ],
  [
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    { name: 'Samsung Internet', majorVersion: 26, mobile: true, platform: 'Android' },
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
    { name: 'Opera', majorVersion: 114, mobile: false, platform: 'Linux' },
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
    { name: 'Chrome', majorVersion: 128, mobile: true, platform: 'iOS' },
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    { name: 'Safari', majorVersion: 18, mobile: false, platform: 'macOS' },
  ],
  [
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    { name: 'Chrome', majorVersion: 128, mobile: false, platform: 'Chrome OS' },
  ],
  ['curl/8.4.0', { name: null, majorVersion: null, mobile: false, platform: null }],
])('parseUserAgent reads %s', (userAgent, expected) => {
  expect(parseUserAgent(userAgent)).toEqual(expected);
});

test('DeviceCollector reports null for missing or invalid browser values', () => {
  installBrowser(4);
  Object.assign(globalThis.window, { innerWidth: 0, devicePixelRatio: Number.NaN });
  Object.assign(globalThis.navigator, {
    deviceMemory: -1,
    language: '',
    connection: { effectiveType: '', rtt: -5, downlink: Number.POSITIVE_INFINITY },
  });

  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value).toMatchObject({
    deviceMemory: null,
    browser: { name: null, majorVersion: null, mobile: null, platform: null },
    language: null,
    screen: { width: null, height: null, pixelRatio: null },
    viewport: { width: null, height: null },
    connection: { effectiveType: null, rtt: null, downlink: null, saveData: null },
    colorScheme: null,
    reducedMotion: null,
  });

  monitor.destroy();
});

test('DeviceCollector reports a null time zone when Intl throws', () => {
  installBrowser(4);

  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
    throw new Error('unsupported');
  });

  try {
    const monitor = createMonitor({ collectors: ['device'] });

    monitor.start();
    expect(monitor.device.snapshot.value.timeZone).toBeNull();
    monitor.destroy();
  } finally {
    spy.mockRestore();
  }
});

test('DeviceCollector reads sizes once a resize settles', () => {
  jest.useFakeTimers();

  const browser = installRichBrowser();
  const monitor = createMonitor({ collectors: ['device'] });
  const notify = jest.fn();

  monitor.start();
  monitor.device.snapshot.subscribe(notify);
  notify.mockClear();

  const { screen } = monitor.device.snapshot.value;

  // A drag fires one resize per frame; none of them updates the snapshot on its own.
  for (let width = 1200; width >= 800; width -= 100) {
    Object.assign(browser.window, { innerWidth: width, innerHeight: 600 });
    browser.window.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(16);
  }

  expect(notify).not.toHaveBeenCalled();

  jest.advanceTimersByTime(250);
  expect(monitor.device.snapshot.value.viewport).toEqual({ width: 800, height: 600 });
  // An unchanged nested object keeps its reference.
  expect(monitor.device.snapshot.value.screen).toBe(screen);
  expect(notify).toHaveBeenCalledTimes(1);

  // A read still pending when the collector stops is dropped.
  Object.assign(browser.window, { devicePixelRatio: 1.5 });
  browser.window.dispatchEvent(new Event('resize'));
  monitor.stop();
  jest.advanceTimersByTime(250);
  expect(monitor.device.snapshot.value.screen.pixelRatio).toBe(2);

  monitor.destroy();
});

test('DeviceCollector follows connection and preference changes until stopped', () => {
  const browser = installRichBrowser();
  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value).toMatchObject({ colorScheme: null, reducedMotion: false });

  Object.assign(browser.connection, { effectiveType: '3g', rtt: 300, saveData: true });
  browser.connection.dispatchEvent(new Event('change'));
  expect(monitor.device.snapshot.value.connection).toEqual({
    effectiveType: '3g',
    rtt: 300,
    downlink: 10,
    saveData: true,
  });

  browser.setMedia('(prefers-color-scheme: light)', true);
  expect(monitor.device.snapshot.value.colorScheme).toBe('light');

  browser.setMedia('(prefers-color-scheme: light)', false);
  browser.setMedia('(prefers-color-scheme: dark)', true);
  browser.setMedia('(prefers-reduced-motion: reduce)', true);
  expect(monitor.device.snapshot.value).toMatchObject({ colorScheme: 'dark', reducedMotion: true });

  monitor.stop();
  browser.setMedia('(prefers-color-scheme: dark)', false);
  browser.connection.effectiveType = '2g';
  browser.connection.dispatchEvent(new Event('change'));
  expect(monitor.device.snapshot.value).toMatchObject({
    colorScheme: 'dark',
    connection: { effectiveType: '3g' },
  });

  monitor.destroy();
});

test('DeviceCollector skips listeners the browser does not support', () => {
  const browser = installRichBrowser();
  const legacyList = { matches: true, addListener: jest.fn() };

  Object.assign(browser.window, { matchMedia: () => legacyList });
  Object.assign(browser.navigator, { connection: { effectiveType: '4g' } });

  const monitor = createMonitor({ collectors: ['device'] });

  monitor.start();
  expect(monitor.device.snapshot.value).toMatchObject({
    colorScheme: 'dark',
    reducedMotion: true,
    connection: { effectiveType: '4g' },
  });
  monitor.destroy();

  // matchMedia can throw for malformed queries in some engines.
  Object.assign(browser.window, {
    matchMedia: () => {
      throw new Error('bad query');
    },
  });

  const throwing = createMonitor({ collectors: ['device'] });

  throwing.start();
  expect(throwing.device.snapshot.value).toMatchObject({ colorScheme: null, reducedMotion: null });
  throwing.destroy();
});
