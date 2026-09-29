import { jest } from '@jest/globals';
import { createMonitor } from '../src/index';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

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

afterEach(() => {
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

  expect(monitor.device.snapshot.value).toEqual({
    hardwareConcurrency: null,
    online: null,
    offlineCount: 0,
  });

  monitor.start();
  expect(monitor.getSnapshot().device).toEqual({
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
