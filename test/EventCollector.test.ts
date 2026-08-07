import { jest } from '@jest/globals';
import { createMonitor, emitMonitorEvent } from '../src/index';

if (typeof globalThis.CustomEvent === 'undefined') {
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class TestCustomEvent<T = unknown> extends Event {
      readonly detail: T;

      constructor(type: string, init: CustomEventInit<T> = {}) {
        super(type, init);
        this.detail = init.detail as T;
      }
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

test('EventCollector keeps entries and label counts inside retained history', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: { events: true },
  });

  monitor.start();

  emitMonitorEvent('first');
  emitMonitorEvent('second');
  emitMonitorEvent('second');

  const snapshot = monitor.events.snapshot.value;

  expect(snapshot.entries.map((entry) => entry.label)).toEqual(['second', 'second']);
  expect(snapshot.byLabel).toEqual({ second: 2 });

  monitor.destroy();
});

test('EventCollector retains no history when maxHistory is zero', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    maxHistory: 0,
    collectors: { events: true },
  });

  monitor.start();
  emitMonitorEvent('first');
  emitMonitorEvent('latest');

  expect(monitor.events.snapshot.value).toEqual({
    entries: [],
    byLabel: {},
  });
  expect(monitor.events.onEvent.value?.label).toBe('latest');

  monitor.destroy();
});

test('EventCollector clearLog resets retained entries and label counts', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    maxHistory: 3,
    collectors: { events: true },
  });

  monitor.start();
  emitMonitorEvent('checkout');

  monitor.events.clearLog();

  expect(monitor.events.snapshot.value).toEqual({
    entries: [],
    byLabel: {},
  });

  monitor.destroy();
});

test('EventCollector start is idempotent', () => {
  const target = new EventTarget();
  const addEventListener = jest.spyOn(target, 'addEventListener');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });

  const monitor = createMonitor({
    collectors: { events: true },
  });

  monitor.start();
  monitor.start();

  expect(addEventListener).toHaveBeenCalledTimes(1);

  monitor.destroy();
});

test('EventCollector ignores malformed custom events without throwing', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });

  const monitor = createMonitor({ collectors: { events: true } });

  try {
    monitor.start();

    expect(() => target.dispatchEvent(new CustomEvent('app:monitor:event'))).not.toThrow();
    expect(monitor.events.snapshot.value.entries).toEqual([]);
  } finally {
    monitor.destroy();
  }
});

test('EventCollector isolates the host app from hostile event details', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });

  const monitor = createMonitor({ collectors: { events: true } });
  const detail = new Proxy(
    {},
    {
      get() {
        throw new Error('hostile detail');
      },
    },
  );

  try {
    monitor.start();

    expect(() =>
      target.dispatchEvent(new CustomEvent('app:monitor:event', { detail })),
    ).not.toThrow();
    expect(monitor.events.snapshot.value.entries).toEqual([]);
  } finally {
    monitor.destroy();
  }
});

test('EventCollector validates labels and data received at runtime', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });

  const monitor = createMonitor({ collectors: { events: true } });

  try {
    monitor.start();
    target.dispatchEvent(new CustomEvent('app:monitor:event', { detail: { label: 42, data: {} } }));
    target.dispatchEvent(
      new CustomEvent('app:monitor:event', { detail: { label: 'valid', data: 'invalid' } }),
    );

    expect(monitor.events.snapshot.value.entries).toEqual([
      expect.objectContaining({ label: 'valid', data: null }),
    ]);
  } finally {
    monitor.destroy();
  }
});

test('EventCollector ignores empty or oversized labels', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    collectors: { events: { maxLabelLength: 4 } },
  });

  try {
    monitor.start();
    emitMonitorEvent('');
    emitMonitorEvent('12345');
    emitMonitorEvent('good');

    expect(monitor.events.snapshot.value.entries.map((entry) => entry.label)).toEqual(['good']);
  } finally {
    monitor.destroy();
  }
});

test('EventCollector retains an isolated copy of event data', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({ collectors: { events: true } });
  const data = { cart: { total: 10 }, items: ['first'] };

  try {
    monitor.start();
    emitMonitorEvent('checkout', data);

    data.cart.total = 99;
    data.items.push('second');

    expect(monitor.events.snapshot.value.entries[0]?.data).toEqual({
      cart: { total: 10 },
      items: ['first'],
    });
  } finally {
    monitor.destroy();
  }
});

test('EventCollector discards event data beyond the configured depth', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    collectors: { events: { maxDataDepth: 1 } },
  });

  try {
    monitor.start();
    emitMonitorEvent('deep', { first: { second: true } });

    expect(monitor.events.snapshot.value.entries[0]).toMatchObject({
      label: 'deep',
      data: null,
    });
  } finally {
    monitor.destroy();
  }
});

test('EventCollector discards event data beyond the configured byte limit', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    collectors: { events: { maxDataBytes: 16 } },
  });

  try {
    monitor.start();
    emitMonitorEvent('large', { value: '1234567890' });

    expect(monitor.events.snapshot.value.entries[0]).toMatchObject({
      label: 'large',
      data: null,
    });
  } finally {
    monitor.destroy();
  }
});

test('EventCollector counts labels that match inherited object keys', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({ collectors: { events: true } });

  try {
    monitor.start();
    emitMonitorEvent('constructor');
    emitMonitorEvent('toString');
    emitMonitorEvent('__proto__');

    expect(monitor.events.snapshot.value.byLabel).toEqual(
      Object.fromEntries([
        ['constructor', 1],
        ['toString', 1],
        ['__proto__', 1],
      ]),
    );
  } finally {
    monitor.destroy();
  }
});
