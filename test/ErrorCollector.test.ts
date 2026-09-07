import { jest } from '@jest/globals';
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
