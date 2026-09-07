import { jest } from '@jest/globals';
import type { ProductionReportConfig, ProductionReportRequest } from '../src/index';
import { createMonitor } from '../src/index';

const realTimers = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
};

function reporting(report: Partial<ProductionReportConfig> = {}) {
  return createMonitor({
    collectors: [],
    env: 'production',
    report: { endpoint: '/metrics', interval: 1000, transport: () => {}, ...report },
  });
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  globalThis.clearInterval = realTimers.clearInterval;
  globalThis.clearTimeout = realTimers.clearTimeout;
  globalThis.setInterval = realTimers.setInterval;
  globalThis.setTimeout = realTimers.setTimeout;
});

test.each([
  NaN,
  Infinity,
  -1,
  0.5,
])('rejects invalid history %s at every configuration boundary', (maxHistory) => {
  expect(() => createMonitor({ maxHistory, sampleRate: 0 })).toThrow(RangeError);
  for (const collector of ['events', 'errors', 'network', 'performance', 'react', 'webVitals']) {
    expect(() =>
      createMonitor({ collectors: { [collector]: { maxHistory } }, sampleRate: 0 }),
    ).toThrow(RangeError);
  }
});

test.each([0, -1, NaN, Infinity, 2 ** 31])('rejects unsafe report intervals %s', (interval) => {
  expect(() => reporting({ interval })).toThrow(RangeError);
});

test('flush is inert before start and after stop or destroy', async () => {
  const transport = jest.fn<() => void>();
  const monitor = reporting({ transport });

  expect(await monitor.reporter.flush()).toBe(false);
  monitor.start();
  expect(await monitor.reporter.flush()).toBe(true);
  monitor.stop();
  expect(await monitor.reporter.flush()).toBe(false);
  monitor.destroy();
  monitor.start();
  expect(await monitor.reporter.flush()).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(monitor.reporter.snapshot.value.status).toBe('destroyed');
});

test('flush coalesces concurrent calls and allows the next awaited delivery', async () => {
  let finish!: () => void;
  const transport = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const monitor = reporting({ transport });

  try {
    monitor.start();
    const first = monitor.reporter.flush();

    expect(monitor.reporter.flush()).toBe(first);
    expect(transport).toHaveBeenCalledTimes(1);
    finish();
    expect(await first).toBe(true);
    const second = monitor.reporter.flush();

    expect(transport).toHaveBeenCalledTimes(2);
    finish();
    expect(await second).toBe(true);
    expect(monitor.reporter.snapshot.value).toMatchObject({
      attempts: 2,
      sent: 2,
      failed: 0,
      status: 'idle',
      lastSuccessAt: expect.any(Number),
    });
  } finally {
    monitor.destroy();
  }
});

test.each([
  'stop',
  'destroy',
] as const)('%s cancels retry timers and resolves the pending flush', async (action) => {
  jest.useFakeTimers();
  const transport = jest.fn(async () => {
    throw new Error('secret');
  });
  const monitor = reporting({ transport, retry: { maxAttempts: 3, delay: 100 } });

  monitor.start();
  const delivery = monitor.reporter.flush();

  await jest.advanceTimersByTimeAsync(0);
  expect(monitor.reporter.snapshot.value.status).toBe('retrying');
  monitor[action]();
  expect(await delivery).toBe(false);
  await jest.advanceTimersByTimeAsync(1000);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  expect(monitor.reporter.snapshot.value.cancelled).toBe(1);
  monitor.destroy();
});

test('stop aborts a transport without timeout and restart isolates late completion', async () => {
  const requests: ProductionReportRequest[] = [];
  const completions: Array<() => void> = [];
  const monitor = reporting({
    transport: (request) => {
      requests.push(request);

      return new Promise<void>((resolve) => completions.push(resolve));
    },
  });

  try {
    monitor.start();
    const old = monitor.reporter.flush();

    monitor.stop();
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(await old).toBe(false);
    monitor.start();
    const current = monitor.reporter.flush();

    completions[0]?.();
    await Promise.resolve();
    expect(monitor.reporter.snapshot.value.status).toBe('sending');
    completions[1]?.();
    expect(await current).toBe(true);
    expect(monitor.reporter.snapshot.value).toMatchObject({ cancelled: 1, sent: 1, attempts: 2 });
  } finally {
    monitor.destroy();
  }
});

test('retry success and backpressure are observable without retaining error text', async () => {
  jest.useFakeTimers();
  const transport = jest
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('token=secret'))
    .mockResolvedValue(undefined);
  const monitor = reporting({ transport, interval: 10, retry: { maxAttempts: 2, delay: 25 } });

  try {
    monitor.start();
    const sent = monitor.reporter.flush();

    await jest.advanceTimersByTimeAsync(25);
    expect(await sent).toBe(true);
    expect(monitor.reporter.snapshot.value).toMatchObject({
      attempts: 2,
      retries: 1,
      sent: 1,
      skipped: 2,
    });
    expect(JSON.stringify(monitor.reporter.snapshot.value)).not.toContain('secret');
  } finally {
    monitor.destroy();
  }
});

test('timeout records a safe failure and releases all attempt resources', async () => {
  jest.useFakeTimers();
  const monitor = reporting({ timeout: 10, transport: () => new Promise<void>(() => {}) });

  monitor.start();
  const sent = monitor.reporter.flush();

  await jest.advanceTimersByTimeAsync(10);
  expect(await sent).toBe(false);
  expect(monitor.reporter.snapshot.value).toMatchObject({
    failed: 1,
    lastFailure: 'timeout',
    status: 'idle',
  });
  monitor.destroy();
  expect(jest.getTimerCount()).toBe(0);
});

test('UTF-8 payload limit applies to custom transforms before transport', async () => {
  const transport = jest.fn<() => void>();
  const monitor = reporting({ transport, maxPayloadBytes: 5, transform: () => '🔥' });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(monitor.reporter.snapshot.value).toMatchObject({
      dropped: 1,
      lastFailure: 'payload-too-large',
      attempts: 0,
    });
  } finally {
    monitor.destroy();
  }
});

test('invalid retry function results terminate safely without a tight retry loop', async () => {
  const transport = jest.fn(async () => {
    throw new Error('failed');
  });
  const monitor = reporting({ transport, retry: { maxAttempts: 3, delay: () => NaN } });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(monitor.reporter.snapshot.value.failed).toBe(1);
  } finally {
    monitor.destroy();
  }
});

test('destroy inside transform prevents dispatch', async () => {
  const transport = jest.fn<() => void>();
  const monitor = reporting({
    transport,
    transform: () => {
      monitor.destroy();

      return {};
    },
  });

  monitor.start();
  expect(await monitor.reporter.flush()).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});
