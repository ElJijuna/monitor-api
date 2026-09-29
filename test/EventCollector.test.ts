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

test('EventCollector exposes direct emit through the monitor facade', () => {
  const monitor = createMonitor({ collectors: { events: true } });

  try {
    monitor.events.emit('direct', { source: 'facade' });

    expect(monitor.events.snapshot.value.entries[0]).toMatchObject({
      label: 'direct',
      data: { source: 'facade' },
    });
  } finally {
    monitor.destroy();
  }
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

test('EventCollector measures multi-byte UTF-8 data against the byte limit', () => {
  // {"v":"ñ€😀"} is 8 ASCII bytes plus 2 + 3 + 4 bytes for the three characters.
  const data = { v: 'ñ€😀' };
  const exact = createMonitor({ collectors: { events: { maxDataBytes: 17 } } });
  const tooSmall = createMonitor({ collectors: { events: { maxDataBytes: 16 } } });

  try {
    exact.events.emit('utf8', data);
    tooSmall.events.emit('utf8', data);

    expect(exact.events.snapshot.value.entries[0]?.data).toEqual(data);
    expect(tooSmall.events.snapshot.value.entries[0]?.data).toBeNull();
  } finally {
    exact.destroy();
    tooSmall.destroy();
  }
});

test('EventCollector drops data that cannot be serialized', () => {
  const monitor = createMonitor({ collectors: { events: true } });

  try {
    monitor.events.emit('bigint', { value: 1n });

    expect(monitor.events.snapshot.value.entries[0]).toMatchObject({ label: 'bigint', data: null });
  } finally {
    monitor.destroy();
  }
});

test('EventCollector rejects non-string labels and stays inert after destroy', () => {
  const target = new EventTarget();
  const addEventListener = jest.spyOn(target, 'addEventListener');
  const monitor = createMonitor({ collectors: { events: true } });

  monitor.events.emit(42 as unknown as string);
  expect(monitor.events.snapshot.value.entries).toEqual([]);

  monitor.destroy();
  monitor.events.destroy();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  monitor.events.start();
  monitor.events.emit('late');

  expect(addEventListener).not.toHaveBeenCalled();
  expect(monitor.events.snapshot.value.entries).toEqual([]);
});

test('emitMonitorEvent is a no-op outside the browser', () => {
  expect(() => emitMonitorEvent('server-side')).not.toThrow();
});

test('byLabel matches a full recount after every emit, drop and clear', () => {
  const monitor = createMonitor({ maxHistory: 5, collectors: { events: true } });
  const labels = ['open', 'save', 'close', 'constructor', 'toString'];

  let seed = 7;

  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

    return seed / 2_147_483_648;
  };

  try {
    for (let step = 0; step < 300; step += 1) {
      if (random() < 0.03) {
        monitor.events.clearLog();
      } else {
        monitor.events.emit(labels[Math.floor(random() * labels.length)] as string);
      }

      const { entries, byLabel } = monitor.events.snapshot.value;
      const expected = new Map<string, number>();

      for (const event of entries) {
        expected.set(event.label, (expected.get(event.label) ?? 0) + 1);
      }

      expect(byLabel).toEqual(Object.fromEntries(expected));
    }
  } finally {
    monitor.destroy();
  }
});
