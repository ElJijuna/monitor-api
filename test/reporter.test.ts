import { jest } from '@jest/globals';
import { createReporter } from '../src/core/createReporter';
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

test.each([NaN, Infinity, -1, 0.5])(
  'rejects invalid history %s at every configuration boundary',
  (maxHistory) => {
    expect(() => createMonitor({ maxHistory, sampleRate: 0 })).toThrow(RangeError);

    for (const collector of ['events', 'errors', 'network', 'performance', 'react', 'webVitals']) {
      expect(() =>
        createMonitor({ collectors: { [collector]: { maxHistory } }, sampleRate: 0 }),
      ).toThrow(RangeError);
    }
  },
);

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

test.each(['stop', 'destroy'] as const)(
  '%s cancels retry timers and resolves the pending flush',
  async (action) => {
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
  },
);

test('stop aborts a transport without timeout and restart isolates late completion', async () => {
  const requests: ProductionReportRequest[] = [];
  const completions: Array<() => void> = [];
  const monitor = reporting({
    timeout: false,
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

test('timeout defaults to the report interval so a hung delivery cannot block reporting', async () => {
  jest.useFakeTimers();
  const transport = jest
    .fn<() => Promise<void>>()
    .mockReturnValueOnce(new Promise<void>(() => {}))
    .mockResolvedValue(undefined);
  const monitor = reporting({ interval: 1000, transport });

  try {
    monitor.start();
    const hung = monitor.reporter.flush();

    await jest.advanceTimersByTimeAsync(999);
    expect(monitor.reporter.snapshot.value.status).toBe('sending');
    await jest.advanceTimersByTimeAsync(1);
    expect(await hung).toBe(false);
    expect(monitor.reporter.snapshot.value).toMatchObject({ failed: 1, lastFailure: 'timeout' });

    // The tick at 1000 ms coincides with the timeout and is skipped; the next one delivers.
    await jest.advanceTimersByTimeAsync(1000);
    expect(monitor.reporter.snapshot.value).toMatchObject({ sent: 1, skipped: 1 });
  } finally {
    monitor.destroy();
  }
});

test('default timeout is capped at 30 seconds for long intervals', async () => {
  jest.useFakeTimers();
  const monitor = reporting({ interval: 60_000, transport: () => new Promise<void>(() => {}) });

  try {
    monitor.start();
    const sent = monitor.reporter.flush();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(await sent).toBe(false);
    expect(monitor.reporter.snapshot.value.lastFailure).toBe('timeout');
  } finally {
    monitor.destroy();
  }
});

test('timeout: false disables the delivery timeout', async () => {
  jest.useFakeTimers();
  const monitor = reporting({
    interval: 1000,
    timeout: false,
    transport: () => new Promise<void>(() => {}),
  });

  try {
    monitor.start();
    const sent = monitor.reporter.flush();

    await jest.advanceTimersByTimeAsync(5000);
    expect(monitor.reporter.snapshot.value).toMatchObject({ status: 'sending', failed: 0 });
    monitor.stop();
    expect(await sent).toBe(false);
  } finally {
    monitor.destroy();
  }
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

describe('flushOnHide', () => {
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });

  function setVisibility(state: 'visible' | 'hidden') {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    doc.visibilityState = 'visible';
    Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  });

  test('sends one keepalive report per hide and re-arms when visible again', async () => {
    const transport = jest.fn<(request: ProductionReportRequest) => void>();
    const monitor = reporting({ transport });

    try {
      monitor.start();
      setVisibility('hidden');
      page.dispatchEvent(new Event('pagehide'));
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[0]).toMatchObject({ keepalive: true, endpoint: '/metrics' });
      expect(transport.mock.calls[0]?.[0].signal).toBeUndefined();

      setVisibility('visible');
      page.dispatchEvent(new Event('pagehide'));
      expect(transport).toHaveBeenCalledTimes(2);

      page.dispatchEvent(new Event('pageshow'));
      setVisibility('hidden');
      expect(transport).toHaveBeenCalledTimes(3);

      await Promise.resolve();
      expect(monitor.reporter.snapshot.value).toMatchObject({ attempts: 3, sent: 3 });
    } finally {
      monitor.destroy();
    }
  });

  test('interval deliveries are not marked keepalive', async () => {
    const transport = jest.fn<(request: ProductionReportRequest) => void>();
    const monitor = reporting({ transport });

    try {
      monitor.start();
      await monitor.reporter.flush();
      expect(transport.mock.calls[0]?.[0].keepalive).toBe(false);
    } finally {
      monitor.destroy();
    }
  });

  test('can be disabled', () => {
    const transport = jest.fn<() => void>();
    const monitor = reporting({ transport, flushOnHide: false });

    try {
      monitor.start();
      setVisibility('hidden');
      page.dispatchEvent(new Event('pagehide'));
      expect(transport).not.toHaveBeenCalled();
    } finally {
      monitor.destroy();
    }
  });

  test('stops listening after stop and resumes after start', () => {
    const transport = jest.fn<() => void>();
    const monitor = reporting({ transport });

    try {
      monitor.start();
      monitor.stop();
      page.dispatchEvent(new Event('pagehide'));
      expect(transport).not.toHaveBeenCalled();

      monitor.start();
      page.dispatchEvent(new Event('pagehide'));
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      monitor.destroy();
    }
  });

  test('sends even while an interval delivery is pending and survives stop', async () => {
    let finishHidden!: () => void;

    const signals: (AbortSignal | undefined)[] = [];
    const transport = jest.fn((request: ProductionReportRequest) => {
      signals.push(request.signal);

      return new Promise<void>((resolve) => {
        if (request.keepalive) {
          finishHidden = resolve;
        }
      });
    });
    const monitor = reporting({ transport });

    try {
      monitor.start();
      const pending = monitor.reporter.flush();

      page.dispatchEvent(new Event('pagehide'));
      expect(transport).toHaveBeenCalledTimes(2);

      monitor.stop();
      expect(await pending).toBe(false);
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]).toBeUndefined();

      finishHidden();
      await new Promise((resolve) => realTimers.setTimeout(resolve, 0));
      expect(monitor.reporter.snapshot.value).toMatchObject({ sent: 1, cancelled: 1 });
    } finally {
      monitor.destroy();
    }
  });

  test('records dropped and failed hidden reports', async () => {
    const tooLarge = reporting({ maxPayloadBytes: 1 });
    const failing = reporting({
      transport: async () => {
        throw new Error('offline');
      },
    });

    try {
      tooLarge.start();
      failing.start();
      page.dispatchEvent(new Event('pagehide'));
      await new Promise((resolve) => realTimers.setTimeout(resolve, 0));
      expect(tooLarge.reporter.snapshot.value).toMatchObject({
        attempts: 0,
        dropped: 1,
        lastFailure: 'payload-too-large',
      });
      expect(failing.reporter.snapshot.value).toMatchObject({
        attempts: 1,
        failed: 1,
        lastFailure: 'transport',
      });
    } finally {
      tooLarge.destroy();
      failing.destroy();
    }
  });

  test('destroy inside transform prevents the hidden dispatch', () => {
    const transport = jest.fn<() => void>();
    const monitor = reporting({
      transport,
      transform: () => {
        monitor.destroy();

        return {};
      },
    });

    monitor.start();
    page.dispatchEvent(new Event('pagehide'));
    expect(transport).not.toHaveBeenCalled();
  });

  test('the default fetch transport requests keepalive', async () => {
    const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const fetchMock = jest.fn(async () => new Response(null, { status: 204 }));

    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchMock });
    const monitor = createMonitor({
      collectors: [],
      env: 'production',
      report: { endpoint: '/metrics', interval: 1000, headers: { Authorization: 'Bearer x' } },
    });

    try {
      monitor.start();
      page.dispatchEvent(new Event('pagehide'));
      expect(fetchMock).toHaveBeenCalledWith(
        '/metrics',
        expect.objectContaining({
          method: 'POST',
          keepalive: true,
          signal: null,
          headers: expect.objectContaining({ Authorization: 'Bearer x' }),
        }),
      );
      await new Promise((resolve) => realTimers.setTimeout(resolve, 0));
      expect(monitor.reporter.snapshot.value.sent).toBe(1);
    } finally {
      monitor.destroy();

      if (realFetch) {
        Object.defineProperty(globalThis, 'fetch', realFetch);
      }
    }
  });
});

test.each([0, -1, 1.5, NaN])('rejects invalid maxPayloadBytes %s', (maxPayloadBytes) => {
  expect(() => reporting({ maxPayloadBytes })).toThrow(RangeError);
});

test('a transform that serializes to nothing is dropped as a serialization failure', async () => {
  const transport = jest.fn<() => void>();
  const monitor = reporting({ transport, transform: () => undefined });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(monitor.reporter.snapshot.value).toMatchObject({
      dropped: 1,
      lastFailure: 'serialization',
    });
  } finally {
    monitor.destroy();
  }
});

test('shouldRetry can stop retrying and the failure keeps a safe category', async () => {
  const transport = jest.fn(async () => {
    throw 'not an error';
  });
  const shouldRetry = jest.fn(() => false);
  const monitor = reporting({ transport, retry: { maxAttempts: 3, shouldRetry } });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith('not an error', 1);
    expect(monitor.reporter.snapshot.value).toMatchObject({ failed: 1, lastFailure: 'transport' });
  } finally {
    monitor.destroy();
  }
});

test('retries without a configured delay', async () => {
  const transport = jest
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('flaky'))
    .mockResolvedValueOnce(undefined);
  const monitor = reporting({ transport, retry: { maxAttempts: 2 } });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(true);
    expect(monitor.reporter.snapshot.value).toMatchObject({ retries: 1, sent: 1 });
  } finally {
    monitor.destroy();
  }
});

test('the default fetch transport treats a non-OK response as a transport failure', async () => {
  const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: jest.fn(async () => new Response(null, { status: 503 })),
  });

  const monitor = createMonitor({
    collectors: [],
    env: 'production',
    report: { endpoint: '/metrics', interval: 1000, flushOnHide: false },
  });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(false);
    expect(monitor.reporter.snapshot.value).toMatchObject({ failed: 1, lastFailure: 'transport' });
  } finally {
    monitor.destroy();

    if (realFetch) {
      Object.defineProperty(globalThis, 'fetch', realFetch);
    }
  }
});

test('a status subscriber that stops the monitor cancels the delivery before the transport runs', async () => {
  const transport = jest.fn<() => void>();
  const monitor = reporting({ transport });

  try {
    monitor.start();
    monitor.reporter.snapshot.subscribe((snapshot) => {
      if (snapshot.status === 'sending') {
        monitor.stop();
      }
    });

    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(monitor.reporter.snapshot.value).toMatchObject({
      status: 'stopped',
      attempts: 1,
      cancelled: 1,
      failed: 0,
    });
  } finally {
    monitor.destroy();
  }
});

test('stopping while a retry is scheduled cancels the retry without counting a failure', async () => {
  const transport = jest.fn(async () => {
    throw new Error('down');
  });
  const monitor = reporting({ transport, retry: { maxAttempts: 3, delay: 60_000 } });

  try {
    monitor.start();
    monitor.reporter.snapshot.subscribe((snapshot) => {
      if (snapshot.status === 'retrying') {
        monitor.stop();
      }
    });

    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(monitor.reporter.snapshot.value).toMatchObject({
      status: 'stopped',
      retries: 1,
      failed: 0,
    });
  } finally {
    monitor.destroy();
  }
});

test('stopping the monitor inside transform prevents dispatch without counting a drop', async () => {
  const transport = jest.fn<() => void>();
  const ref: { monitor?: ReturnType<typeof reporting> } = {};
  const transform = jest.fn(() => {
    ref.monitor?.stop();

    throw new Error('transform failed after stop');
  });
  const monitor = reporting({ transport, transform });

  ref.monitor = monitor;

  try {
    monitor.start();

    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(monitor.reporter.snapshot.value).toMatchObject({ dropped: 0, status: 'stopped' });
  } finally {
    monitor.destroy();
  }
});

test('a successful transform that stops the monitor also prevents dispatch', async () => {
  const transport = jest.fn<() => void>();
  const ref: { monitor?: ReturnType<typeof reporting> } = {};
  const monitor = reporting({
    transport,
    transform: (snapshot) => {
      ref.monitor?.stop();

      return { at: snapshot.timestamp };
    },
  });

  ref.monitor = monitor;

  try {
    monitor.start();

    expect(await monitor.reporter.flush()).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  } finally {
    monitor.destroy();
  }
});

test('a transport completing after its timeout does not count as sent', async () => {
  jest.useFakeTimers();

  let finish!: () => void;

  const monitor = reporting({
    timeout: 10,
    transport: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });

  try {
    monitor.start();
    const sent = monitor.reporter.flush();

    await jest.advanceTimersByTimeAsync(10);
    finish();
    await Promise.resolve();

    expect(await sent).toBe(false);
    expect(monitor.reporter.snapshot.value).toMatchObject({ sent: 0, failed: 1 });
  } finally {
    monitor.destroy();
  }
});

test('the request carries the endpoint, JSON body, payload and non-keepalive flag', async () => {
  const transport = jest.fn<(request: ProductionReportRequest) => void>();
  const monitor = reporting({ transport, transform: () => ({ ok: true }) });

  try {
    monitor.start();
    await monitor.reporter.flush();

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/metrics',
        payload: { ok: true },
        body: '{"ok":true}',
        headers: { 'Content-Type': 'application/json' },
        keepalive: false,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(monitor.reporter.snapshot.value.lastSuccessAt).toEqual(expect.any(Number));
  } finally {
    monitor.destroy();
  }
});

test('a successful delivery clears the previous failure', async () => {
  const transport = jest
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('down'))
    .mockResolvedValueOnce(undefined);
  const monitor = reporting({ transport });

  try {
    monitor.start();
    expect(await monitor.reporter.flush()).toBe(false);
    expect(monitor.reporter.snapshot.value.lastFailure).toBe('transport');
    expect(await monitor.reporter.flush()).toBe(true);
    expect(monitor.reporter.snapshot.value).toMatchObject({
      lastFailure: null,
      failed: 1,
      sent: 1,
    });
  } finally {
    monitor.destroy();
  }
});

describe('createReporter lifecycle', () => {
  function reporter(report: Partial<ProductionReportConfig> = {}, enabled = true) {
    return createReporter(
      {
        endpoint: '/metrics',
        interval: 60_000,
        flushOnHide: false,
        transport: () => {},
        ...report,
      },
      enabled,
      () => ({ ok: true }),
    );
  }

  test('stop and destroy are no-ops once destroyed', () => {
    const instance = reporter();

    instance.start();
    instance.destroy();

    const destroyed = instance.snapshot.value;

    instance.stop();
    instance.destroy();
    instance.start();

    expect(instance.snapshot.value).toBe(destroyed);
    expect(destroyed.status).toBe('destroyed');
  });

  test('is disabled when not enabled or without a report config', async () => {
    const disabled = reporter({}, false);
    const unconfigured = createReporter(undefined, true, () => ({}));

    disabled.start();
    unconfigured.start();

    expect(disabled.snapshot.value.status).toBe('disabled');
    expect(unconfigured.snapshot.value.status).toBe('disabled');
    expect(await disabled.flush()).toBe(false);
    expect(await unconfigured.flush()).toBe(false);

    disabled.stop();
    expect(disabled.snapshot.value.status).toBe('disabled');
    disabled.destroy();
    unconfigured.destroy();
  });

  test('a stop right after the transport resolves does not count the delivery as sent', async () => {
    const holder: { stop?: () => void } = {};
    const instance = reporter({
      transport: () => {
        // Stops after the transport settles but before the delivery is recorded as sent.
        void (async () => {
          await null;
          await null;
          holder.stop?.();
        })();
      },
    });

    holder.stop = () => instance.stop();

    try {
      instance.start();

      expect(await instance.flush()).toBe(false);
      expect(instance.snapshot.value).toMatchObject({
        status: 'stopped',
        sent: 0,
        failed: 0,
        cancelled: 1,
      });
    } finally {
      instance.destroy();
    }
  });

  test('a stop observed from the success update does not also count the delivery as cancelled', async () => {
    const instance = reporter();

    try {
      instance.start();
      instance.snapshot.subscribe((snapshot) => {
        if (snapshot.sent === 1 && snapshot.status === 'idle') {
          instance.stop();
        }
      });

      expect(await instance.flush()).toBe(true);
      expect(instance.snapshot.value).toMatchObject({
        status: 'stopped',
        sent: 1,
        cancelled: 0,
      });
    } finally {
      instance.destroy();
    }
  });

  test('a stop observed from the failure update does not also count the delivery as cancelled', async () => {
    const instance = reporter({
      transport: () => {
        throw new Error('down');
      },
    });

    try {
      instance.start();
      instance.snapshot.subscribe((snapshot) => {
        if (snapshot.failed === 1 && snapshot.status === 'idle') {
          instance.stop();
        }
      });

      expect(await instance.flush()).toBe(false);
      expect(instance.snapshot.value).toMatchObject({
        status: 'stopped',
        failed: 1,
        cancelled: 0,
      });
    } finally {
      instance.destroy();
    }
  });

  test('a flush requested while the outcome is recorded reuses the settling delivery', async () => {
    const transport = jest.fn<() => void>();
    const instance = reporter({ transport });
    const reentrant: Array<Promise<boolean>> = [];

    try {
      instance.start();
      instance.snapshot.subscribe((snapshot) => {
        if (snapshot.sent === 1 && reentrant.length === 0) {
          reentrant.push(instance.flush());
        }
      });

      const first = instance.flush();

      expect(await first).toBe(true);
      expect(reentrant[0]).toBe(first);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      instance.destroy();
    }
  });
});

describe('flushOnHide with the default transport', () => {
  const page = new EventTarget();

  test('records a non-OK hidden delivery as a transport failure', async () => {
    const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

    Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn(async () => new Response(null, { status: 500 })),
    });

    const monitor = createMonitor({
      collectors: [],
      env: 'production',
      report: { endpoint: '/metrics', interval: 60_000 },
    });

    try {
      monitor.start();
      page.dispatchEvent(new Event('pagehide'));
      await new Promise((resolve) => realTimers.setTimeout(resolve, 0));

      expect(monitor.reporter.snapshot.value).toMatchObject({
        attempts: 1,
        failed: 1,
        lastFailure: 'transport',
      });
    } finally {
      monitor.destroy();
      Reflect.deleteProperty(globalThis, 'window');

      if (realFetch) {
        Object.defineProperty(globalThis, 'fetch', realFetch);
      }
    }
  });
});

test('exhausting every attempt consults shouldRetry and delay between attempts only', async () => {
  jest.useFakeTimers();

  const transport = jest.fn(async () => {
    throw new Error('down');
  });
  const shouldRetry = jest.fn<(error: unknown, attempt: number) => boolean>(() => true);
  const delay = jest.fn((attempt: number) => attempt * 100);
  const monitor = reporting({ transport, retry: { maxAttempts: 3, shouldRetry, delay } });

  try {
    monitor.start();

    const result = monitor.reporter.flush();

    await jest.advanceTimersByTimeAsync(300);
    expect(await result).toBe(false);
    expect(transport).toHaveBeenCalledTimes(3);
    // Not after the last attempt: there is nothing left to retry.
    expect(shouldRetry.mock.calls.map(([, attempt]) => attempt)).toEqual([1, 2]);
    expect(delay.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
    expect(monitor.reporter.snapshot.value).toMatchObject({
      status: 'idle',
      attempts: 3,
      retries: 2,
      failed: 1,
      sent: 0,
      lastFailure: 'transport',
    });
  } finally {
    monitor.destroy();
  }
});
