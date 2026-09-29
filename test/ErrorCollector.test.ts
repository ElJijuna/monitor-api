import { jest } from '@jest/globals';
import type { MonitorErrorDetails, MonitorErrorSource } from '../src/index';
import { createMonitor } from '../src/index';

const realTimers = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  jest.useRealTimers();
  jest.restoreAllMocks();
  globalThis.clearInterval = realTimers.clearInterval;
  globalThis.clearTimeout = realTimers.clearTimeout;
  globalThis.setInterval = realTimers.setInterval;
  globalThis.setTimeout = realTimers.setTimeout;
});

test('ErrorCollector captures manual errors with bounded details', () => {
  const monitor = createMonitor({ collectors: { errors: true } });

  try {
    monitor.errors.capture(new Error('boom'));

    expect(monitor.errors.snapshot.value).toMatchObject({
      totalErrors: 1,
      droppedErrors: 0,
      entries: [
        expect.objectContaining({
          source: 'manual',
          details: expect.objectContaining({ name: 'Error', message: 'boom' }),
          occurrences: 1,
        }),
      ],
    });
    expect(monitor.errors.onError.value?.details.message).toBe('boom');
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector notifies onError after the entry is retained', () => {
  const monitor = createMonitor({ collectors: { errors: { dedupWindow: 60_000 } } });
  const seen: Array<{ occurrences: number; retained: number | undefined }> = [];

  try {
    monitor.errors.onError.subscribe((error) => {
      const snapshot = monitor.errors.snapshot.value;

      seen.push({
        occurrences: error?.occurrences ?? 0,
        retained: snapshot.entries.find((entry) => entry.id === error?.id)?.occurrences,
      });
    });

    monitor.errors.capture(new Error('boom'));
    monitor.errors.capture(new Error('boom'));

    expect(seen).toEqual([
      { occurrences: 1, retained: 1 },
      { occurrences: 2, retained: 2 },
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector is disabled by default and inert when sampled out', () => {
  const implicit = createMonitor();
  const sampledOut = createMonitor({ sampleRate: 0, collectors: ['errors'] });

  try {
    implicit.errors.capture(new Error('implicit'));
    sampledOut.errors.capture(new Error('sampled-out'));

    expect(implicit.errors.snapshot.value.entries).toEqual([]);
    expect(sampledOut.errors.snapshot.value.entries).toEqual([]);
  } finally {
    implicit.destroy();
    sampledOut.destroy();
  }
});

test('ErrorCollector listens for browser errors only while started', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });

  const monitor = createMonitor({ collectors: ['errors'] });

  try {
    monitor.start();
    target.dispatchEvent(Object.assign(new Event('error'), { error: new TypeError('broken') }));
    monitor.stop();
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('ignored') }));

    expect(monitor.errors.snapshot.value.entries.map((entry) => entry.details.message)).toEqual([
      'broken',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector captures unhandled rejections', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });

  const monitor = createMonitor({ collectors: { errors: true } });

  try {
    monitor.start();
    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('async failed') }),
    );

    expect(monitor.errors.snapshot.value.entries[0]).toMatchObject({
      source: 'unhandledrejection',
      details: expect.objectContaining({ message: 'async failed' }),
    });
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector deduplicates consecutive matching errors inside the window', () => {
  jest.useFakeTimers();
  jest.setSystemTime(1000);
  const monitor = createMonitor({ collectors: { errors: { dedupWindow: 500 } } });

  try {
    monitor.errors.capture(new Error('repeat'));
    jest.setSystemTime(1200);
    monitor.errors.capture(new Error('repeat'));
    jest.setSystemTime(1800);
    monitor.errors.capture(new Error('repeat'));

    expect(monitor.errors.snapshot.value.totalErrors).toBe(3);
    expect(monitor.errors.snapshot.value.entries).toHaveLength(2);
    expect(monitor.errors.snapshot.value.entries[0]).toMatchObject({
      occurrences: 2,
      timestamp: 1000,
      lastSeenAt: 1200,
    });
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector retains no entries when maxHistory is zero but keeps counters', () => {
  const monitor = createMonitor({ collectors: { errors: { maxHistory: 0 } } });

  try {
    monitor.errors.capture(new Error('latest'));

    expect(monitor.errors.snapshot.value).toMatchObject({
      entries: [],
      totalErrors: 1,
      droppedErrors: 0,
    });
    expect(monitor.errors.onError.value?.details.message).toBe('latest');
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector sanitizer can redact or drop entries safely', () => {
  const monitor = createMonitor({
    collectors: {
      errors: {
        sanitize(details) {
          if (details.message.includes('drop')) {
            return null;
          }

          return { ...details, message: 'redacted', stack: null };
        },
      },
    },
  });

  try {
    monitor.errors.capture(new Error('token=secret'));
    monitor.errors.capture(new Error('drop me'));

    expect(monitor.errors.snapshot.value).toMatchObject({
      totalErrors: 2,
      droppedErrors: 1,
      entries: [
        expect.objectContaining({ details: { name: 'Error', message: 'redacted', stack: null } }),
      ],
    });
    expect(JSON.stringify(monitor.errors.snapshot.value)).not.toContain('secret');
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector rejects invalid dedup windows', () => {
  for (const dedupWindow of [-1, NaN, Infinity]) {
    expect(() => createMonitor({ collectors: { errors: { dedupWindow } } })).toThrow(RangeError);
  }
});

test('ErrorCollector normalizes non-Error values into bounded details', () => {
  const monitor = createMonitor({ collectors: { errors: { dedupWindow: 0 } } });

  try {
    const errorWithoutStack = new Error('no stack');

    errorWithoutStack.name = '';
    Reflect.deleteProperty(errorWithoutStack, 'stack');

    monitor.errors.capture({ name: 'ApiError', message: 'bad gateway', stack: 'at fetch' });
    monitor.errors.capture({ code: 42 });
    monitor.errors.capture('x'.repeat(2_000));
    monitor.errors.capture('');
    monitor.errors.capture(errorWithoutStack);

    expect(monitor.errors.snapshot.value.entries.map((entry) => entry.details)).toEqual([
      { name: 'ApiError', message: 'bad gateway', stack: 'at fetch' },
      { name: 'Error', message: 'Unknown error', stack: null },
      { name: 'Error', message: 'x'.repeat(1_024), stack: null },
      { name: 'Error', message: 'Unknown error', stack: null },
      { name: 'Error', message: 'no stack', stack: null },
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector reads error events by message and ignores empty ones', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });

  const monitor = createMonitor({ collectors: { errors: true } });

  try {
    monitor.start();
    monitor.start();
    target.dispatchEvent(new Event('error'));
    target.dispatchEvent(Object.assign(new Event('error'), { message: 'Script error.' }));

    expect(monitor.errors.snapshot.value.entries.map((entry) => entry.details.message)).toEqual([
      'Script error.',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector stays inert after destroy and when no window exists', () => {
  const monitor = createMonitor({ collectors: { errors: true } });

  monitor.start();
  monitor.stop();
  monitor.destroy();
  monitor.destroy();
  monitor.errors.capture(new Error('late'));

  expect(monitor.errors.snapshot.value.totalErrors).toBe(0);

  const target = new EventTarget();
  const addEventListener = jest.spyOn(target, 'addEventListener');

  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  monitor.errors.start();

  expect(addEventListener).not.toHaveBeenCalled();
});

test('ErrorCollector clears listener references when stopped without a window', () => {
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });

  const monitor = createMonitor({ collectors: { errors: true } });
  const addEventListener = jest.spyOn(target, 'addEventListener');

  try {
    monitor.start();
    Reflect.deleteProperty(globalThis, 'window');
    monitor.stop();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
    monitor.start();

    expect(addEventListener).toHaveBeenCalledTimes(4);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector does not deduplicate different sources or expired windows', () => {
  jest.useFakeTimers();

  const monitor = createMonitor({ collectors: { errors: { dedupWindow: 1_000 } } });

  try {
    monitor.errors.capture(new Error('same'));
    monitor.errors.capture(new Error('same'), 'error');
    jest.advanceTimersByTime(1_001);
    monitor.errors.capture(new Error('same'), 'error');

    expect(monitor.errors.snapshot.value.entries.map((entry) => entry.occurrences)).toEqual([
      1, 1, 1,
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector drops an error when the sanitizer throws', () => {
  const monitor = createMonitor({
    collectors: {
      errors: {
        sanitize() {
          throw new Error('sanitizer bug');
        },
      },
    },
  });
  const notify = jest.fn();

  try {
    monitor.errors.snapshot.subscribe(notify);
    monitor.errors.capture(new Error('token=secret'));

    expect(monitor.errors.snapshot.value).toMatchObject({
      totalErrors: 1,
      droppedErrors: 1,
      entries: [],
    });
    expect(monitor.errors.onError.value).toBeNull();
    // Counters changed, so subscribers still hear about the dropped error.
    expect(notify).toHaveBeenCalledTimes(1);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector passes the capture source to the sanitizer', () => {
  const sanitize = jest.fn((details: MonitorErrorDetails, _source: MonitorErrorSource) => details);
  const target = new EventTarget();

  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });

  const monitor = createMonitor({ collectors: { errors: { sanitize } } });

  try {
    monitor.start();
    monitor.errors.capture(new Error('manual'));
    monitor.errors.capture(new Error('explicit'), 'error');
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'rejected' }));

    expect(sanitize.mock.calls.map(([, source]) => source)).toEqual([
      'manual',
      'error',
      'unhandledrejection',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector clearLog empties entries and onError but keeps lifetime counters', () => {
  const monitor = createMonitor({
    collectors: { errors: { sanitize: (d) => (d.message === 'drop' ? null : d) } },
  });

  try {
    monitor.errors.capture(new Error('kept'));
    monitor.errors.capture(new Error('drop'));
    monitor.errors.clearLog();

    expect(monitor.errors.snapshot.value).toEqual({
      entries: [],
      totalErrors: 2,
      droppedErrors: 1,
    });
    expect(monitor.errors.onError.value).toBeNull();
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector truncates long names and stacks', () => {
  const monitor = createMonitor({ collectors: { errors: true } });

  try {
    monitor.errors.capture({ name: 'N'.repeat(500), message: 'long', stack: 's'.repeat(10_000) });

    const details = monitor.errors.snapshot.value.entries[0]?.details;

    expect(details?.name).toHaveLength(128);
    expect(details?.stack).toHaveLength(8192);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector deduplication only merges with the most recent entry', () => {
  const monitor = createMonitor({ collectors: { errors: { dedupWindow: 60_000 } } });

  try {
    monitor.errors.capture(new Error('A'));
    monitor.errors.capture(new Error('B'));
    monitor.errors.capture(new Error('A'));
    monitor.errors.capture(new Error('A'));

    expect(
      monitor.errors.snapshot.value.entries.map(({ details, occurrences }) => [
        details.message,
        occurrences,
      ]),
    ).toEqual([
      ['A', 1],
      ['B', 1],
      ['A', 2],
    ]);
    expect(monitor.errors.snapshot.value.totalErrors).toBe(4);
  } finally {
    monitor.destroy();
  }
});

test('ErrorCollector destroy is idempotent at the collector level', () => {
  const target = new EventTarget();
  const removeEventListener = jest.spyOn(target, 'removeEventListener');

  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });

  const monitor = createMonitor({ collectors: { errors: true } });

  monitor.start();
  monitor.errors.destroy();
  monitor.errors.destroy();

  expect(removeEventListener).toHaveBeenCalledTimes(2);
  monitor.destroy();
});
