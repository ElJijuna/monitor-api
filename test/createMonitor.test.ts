import { jest } from '@jest/globals';
import type { MonitorSnapshot } from '../src/core/types';
import { createMonitor, emitMonitorEvent } from '../src/index';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  jest.useRealTimers();
});

test('createMonitor exposes a combined snapshot and subscription API', () => {
  const monitor = createMonitor();
  const snapshots: MonitorSnapshot[] = [];
  const unsubscribe = monitor.subscribe((snapshot) => snapshots.push(snapshot));

  monitor.events.clearLog();

  expect(monitor.getSnapshot()).toMatchObject({
    performance: expect.any(Object),
    network: expect.any(Object),
    react: expect.any(Object),
    events: { entries: [], byLabel: {} },
  });
  expect(snapshots).toHaveLength(1);

  unsubscribe();
  monitor.destroy();
});

test('createMonitor is safe to construct and start without browser globals', () => {
  Reflect.deleteProperty(globalThis, 'window');

  const monitor = createMonitor();

  expect(() => monitor.start()).not.toThrow();
  expect(() => monitor.stop()).not.toThrow();
  expect(() => monitor.destroy()).not.toThrow();
});

test('production reporting does not start during construction', () => {
  jest.useFakeTimers();

  const monitor = createMonitor({
    env: 'production',
    report: {
      endpoint: '/monitor',
      interval: 1000,
    },
  });

  expect(jest.getTimerCount()).toBe(0);

  monitor.destroy();
});

test('production reporting does not start without fetch', () => {
  jest.useFakeTimers();

  const originalFetch = globalThis.fetch;

  Reflect.deleteProperty(globalThis, 'fetch');

  const monitor = createMonitor({
    env: 'production',
    report: {
      endpoint: '/monitor',
      interval: 1000,
    },
  });

  monitor.start();

  expect(jest.getTimerCount()).toBe(0);

  monitor.destroy();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: originalFetch,
  });
});

test('production reporting excludes raw and identifying data by default', async () => {
  jest.useFakeTimers();

  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
  );

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: ['events'],
    report: {
      endpoint: '/monitor',
      interval: 1000,
    },
  });

  try {
    monitor.start();
    emitMonitorEvent('user:login', { email: 'private@example.com' });

    await jest.advanceTimersByTimeAsync(1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = fetchMock.mock.calls[0]?.[1]?.body;
    const serialized = String(body);
    const payload = JSON.parse(serialized) as Record<string, unknown>;

    expect(payload.events).toEqual({ count: 1 });
    expect(payload).not.toHaveProperty('network.entries');
    expect(payload).not.toHaveProperty('react.slowComponents');
    expect(payload).not.toHaveProperty('performance.fpsHistory');
    expect(payload).not.toHaveProperty('webVitals.entries');
    expect(serialized).not.toContain('user:login');
    expect(serialized).not.toContain('private@example.com');
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('production reporting uses transform as an explicit opt-in to custom data', async () => {
  jest.useFakeTimers();

  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
  );

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: ['events'],
    report: {
      endpoint: '/monitor',
      interval: 1000,
      transform: (snap) => ({ event: snap.events.entries[0] }),
    },
  });

  try {
    monitor.start();
    emitMonitorEvent('user:login', { email: 'private@example.com' });

    await jest.advanceTimersByTimeAsync(1000);

    const body = fetchMock.mock.calls[0]?.[1]?.body;

    expect(JSON.parse(String(body))).toMatchObject({
      event: {
        label: 'user:login',
        data: { email: 'private@example.com' },
      },
    });
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('production reporting contains transform errors and keeps running', () => {
  jest.useFakeTimers();

  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
  );
  const transform = jest.fn(() => {
    throw new Error('transform failed');
  });

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: [],
    report: {
      endpoint: '/monitor',
      interval: 1000,
      transform,
    },
  });

  try {
    monitor.start();

    expect(() => jest.advanceTimersByTime(1000)).not.toThrow();
    expect(() => jest.advanceTimersByTime(1000)).not.toThrow();
    expect(transform).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('production reporting contains serialization errors', () => {
  jest.useFakeTimers();

  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(),
  );
  const circular: Record<string, unknown> = {};

  circular.self = circular;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: [],
    report: {
      endpoint: '/monitor',
      interval: 1000,
      transform: () => circular,
    },
  });

  try {
    monitor.start();

    expect(() => jest.advanceTimersByTime(1000)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('production reporting does not overlap pending requests', async () => {
  jest.useFakeTimers();

  const originalFetch = globalThis.fetch;

  let resolveFetch!: (response: Response) => void;
  const pendingResponse = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const fetchMock = jest.fn((_input: RequestInfo | URL, _init?: RequestInit) => pendingResponse);

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchMock,
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: [],
    report: {
      endpoint: '/monitor',
      interval: 1000,
    },
  });

  try {
    monitor.start();

    jest.advanceTimersByTime(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response());
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});
