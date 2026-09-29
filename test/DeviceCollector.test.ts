import { createMonitor } from '../src/index';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function installBrowser(hardwareConcurrency: unknown) {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { hardwareConcurrency },
  });
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

  expect(monitor.device.snapshot.value).toEqual({ hardwareConcurrency: null });

  monitor.start();
  expect(monitor.getSnapshot().device).toEqual({ hardwareConcurrency: 8 });

  monitor.stop();
  expect(monitor.device.snapshot.value).toEqual({ hardwareConcurrency: 8 });

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
