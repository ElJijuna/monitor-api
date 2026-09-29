import { jest } from '@jest/globals';
import { createMonitor } from '../src/index';

class FakeXMLHttpRequest extends EventTarget {
  static lastInstance: FakeXMLHttpRequest | null = null;

  responseHeaders = new Map<string, string>();
  response = '';
  status = 200;

  constructor() {
    super();
    FakeXMLHttpRequest.lastInstance = this;
  }

  open(): void {}

  /** When false, send leaves the request in flight until complete() is called. */
  autoComplete = true;

  send(): void {
    if (this.autoComplete) {
      this.complete();
    }
  }

  complete(): void {
    this.dispatchEvent(new Event('loadend'));
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name.toLowerCase()) ?? null;
  }
}

const realTimers = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  jest.useRealTimers();
  globalThis.clearInterval = realTimers.clearInterval;
  globalThis.clearTimeout = realTimers.clearTimeout;
  globalThis.setInterval = realTimers.setInterval;
  globalThis.setTimeout = realTimers.setTimeout;
});

test('NetworkCollector records filtered fetch requests inside maxHistory', async () => {
  const fetchMock: typeof fetch = async (input) => new Response(String(input), { status: 201 });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      fetch: jest.fn(fetchMock),
    },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: {
      network: {
        filter: (url) => url.includes('/keep'),
      },
    },
  });

  monitor.start();

  const testWindow = globalThis.window as unknown as { fetch: typeof fetch };

  await testWindow.fetch('/drop');
  await testWindow.fetch('/keep/one', { method: 'post', body: 'abc' });
  await testWindow.fetch('/keep/two');
  await testWindow.fetch('/keep/three');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshot = monitor.network.snapshot.value;

  expect(snapshot.entries.map((entry) => entry.url)).toEqual(['/keep/two', '/keep/three']);
  const [firstEntry, secondEntry] = snapshot.entries;

  expect(firstEntry).toBeDefined();
  expect(secondEntry).toBeDefined();
  expect(firstEntry?.method).toBe('GET');
  expect(secondEntry?.status).toBe(201);
  expect(snapshot.window5s.count).toBe(3);
  expect(snapshot.window5s.errorRate).toBe(0);

  monitor.destroy();
});

test('NetworkCollector expires window5s without new network traffic', async () => {
  let now = Date.parse('2026-08-07T12:00:00.000Z');
  let expireWindow: (() => void) | null = null;

  const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const originalSetTimeout = globalThis.setTimeout;
  const schedule = jest.fn((handler: TimerHandler) => {
    if (typeof handler === 'function') {
      expireWindow = handler as () => void;
    }

    return 1 as unknown as ReturnType<typeof setTimeout>;
  });

  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    writable: true,
    value: schedule as unknown as typeof setTimeout,
  });

  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

    await testWindow.fetch('/expires');
    expect(monitor.network.snapshot.value.window5s.count).toBe(1);

    now += 5001;
    (expireWindow as (() => void) | null)?.();

    expect(monitor.network.snapshot.value.window5s).toEqual({
      count: 0,
      avgLatency: 0,
      totalPayload: 0,
      errorRate: 0,
    });
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      writable: true,
      value: originalSetTimeout,
    });
    dateNow.mockRestore();
  }
});

test('NetworkCollector cancels the pending window expiration when stopped', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timerHandle = 1 as unknown as ReturnType<typeof setTimeout>;
  const schedule = jest.fn(() => timerHandle);
  const cancel: typeof clearTimeout = jest.fn();
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    writable: true,
    value: schedule as unknown as typeof setTimeout,
  });
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    writable: true,
    value: cancel,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

    await testWindow.fetch('/pending-expiration');
    expect(schedule).toHaveBeenCalledTimes(1);

    monitor.stop();
    expect(cancel).toHaveBeenCalledWith(timerHandle);
  } finally {
    monitor.destroy();
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      writable: true,
      value: originalSetTimeout,
    });
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      writable: true,
      value: originalClearTimeout,
    });
  }
});

test('NetworkCollector measures Content-Length without cloning or changing the response', async () => {
  const response = new Response('payload', {
    headers: { 'Content-Length': '7' },
  });
  const clone = jest.spyOn(response, 'clone').mockImplementation(() => {
    throw new Error('clone failed');
  });
  const fetch: typeof globalThis.fetch = jest.fn(async () => response);

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };
    const returnedResponse = await testWindow.fetch('/large-response');

    expect(returnedResponse).toBe(response);
    expect(clone).not.toHaveBeenCalled();
    expect(monitor.network.snapshot.value.entries).toEqual([
      expect.objectContaining({
        url: '/large-response',
        status: 200,
        payloadSize: 7,
        error: null,
      }),
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector reports zero when Content-Length is unavailable or invalid', async () => {
  const responseWithoutSize = new Response('unknown');
  const responseWithInvalidSize = new Response('unknown', {
    headers: { 'Content-Length': 'invalid' },
  });
  const cloneWithoutSize = jest.spyOn(responseWithoutSize, 'clone');
  const cloneWithInvalidSize = jest.spyOn(responseWithInvalidSize, 'clone');
  const fetch: typeof globalThis.fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(responseWithoutSize)
    .mockResolvedValueOnce(responseWithInvalidSize);

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

    await testWindow.fetch('/missing-size');
    await testWindow.fetch('/invalid-size');

    expect(cloneWithoutSize).not.toHaveBeenCalled();
    expect(cloneWithInvalidSize).not.toHaveBeenCalled();
    expect(monitor.network.snapshot.value.entries.map((entry) => entry.payloadSize)).toEqual([
      0, 0,
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector measures XHR Content-Length without copying its text response', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const xhr = new XMLHttpRequest();

    (xhr as unknown as FakeXMLHttpRequest).response = 'do not measure this body';
    (xhr as unknown as FakeXMLHttpRequest).responseHeaders.set('content-length', '4096');
    xhr.open('GET', '/large-xhr');
    xhr.send();

    expect(monitor.network.snapshot.value.entries).toEqual([
      expect.objectContaining({
        url: '/large-xhr',
        status: 200,
        payloadSize: 4096,
        error: null,
      }),
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector retains no history when maxHistory is zero', async () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    maxHistory: 0,
    collectors: { network: true },
  });

  monitor.start();

  const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

  await testWindow.fetch('/latest');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(monitor.network.snapshot.value).toEqual({
    entries: [],
    window5s: { count: 1, avgLatency: expect.any(Number), totalPayload: 0, errorRate: 0 },
  });
  expect(monitor.network.onRequest.value?.url).toBe('/latest');

  monitor.destroy();
});

test('NetworkCollector excludes the production reporter endpoint by default', async () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: {
      network: {
        filter: (url) => !url.includes('/private'),
      },
    },
    report: {
      endpoint: '/monitor',
      interval: 60_000,
    },
  });

  try {
    monitor.start();

    const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

    await testWindow.fetch('/monitor');
    await testWindow.fetch('/private');
    await testWindow.fetch('/api/orders');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(monitor.network.snapshot.value.entries.map((entry) => entry.url)).toEqual([
      '/api/orders',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector keeps excluding the reporter endpoint after setFilter', async () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    env: 'production',
    collectors: ['network'],
    report: {
      endpoint: '/monitor',
      interval: 60_000,
    },
  });

  try {
    monitor.start();
    monitor.network.setFilter((url) => !url.includes('/private'));

    const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

    await testWindow.fetch('/monitor');
    await testWindow.fetch('/private');
    await testWindow.fetch('/api/orders');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(monitor.network.snapshot.value.entries.map((entry) => entry.url)).toEqual([
      '/api/orders',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector restores fetch when stopped', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    collectors: { network: true },
  });

  monitor.start();
  const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch };

  expect(testWindow.fetch).not.toBe(fetch);

  monitor.stop();
  expect(testWindow.fetch).toBe(fetch);

  monitor.destroy();
});

test('NetworkCollector restores XMLHttpRequest open and send when stopped', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());
  const originalOpen = FakeXMLHttpRequest.prototype.open;
  const originalSend = FakeXMLHttpRequest.prototype.send;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    collectors: { network: true },
  });

  monitor.start();
  expect(FakeXMLHttpRequest.prototype.open).not.toBe(originalOpen);
  expect(FakeXMLHttpRequest.prototype.send).not.toBe(originalSend);

  monitor.stop();
  expect(FakeXMLHttpRequest.prototype.open).toBe(originalOpen);
  expect(FakeXMLHttpRequest.prototype.send).toBe(originalSend);

  monitor.destroy();
});

test('NetworkCollector start is idempotent', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({
    collectors: { network: true },
  });

  monitor.start();
  const patchedFetch = (globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch;
  const patchedOpen = FakeXMLHttpRequest.prototype.open;
  const patchedSend = FakeXMLHttpRequest.prototype.send;

  monitor.start();

  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(
    patchedFetch,
  );
  expect(FakeXMLHttpRequest.prototype.open).toBe(patchedOpen);
  expect(FakeXMLHttpRequest.prototype.send).toBe(patchedSend);

  monitor.stop();
  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(fetch);

  monitor.destroy();
});

test('NetworkCollectors share global patches and stop independently', async () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());
  const originalOpen = FakeXMLHttpRequest.prototype.open;
  const originalSend = FakeXMLHttpRequest.prototype.send;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const first = createMonitor({ collectors: { network: true } });
  const second = createMonitor({ collectors: { network: true } });

  first.start();
  const sharedFetch = (globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch;

  second.start();

  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(
    sharedFetch,
  );

  await sharedFetch('/both');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(first.network.snapshot.value.entries.map((entry) => entry.url)).toEqual(['/both']);
  expect(second.network.snapshot.value.entries.map((entry) => entry.url)).toEqual(['/both']);

  first.stop();

  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(
    sharedFetch,
  );

  await sharedFetch('/second-only');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(first.network.snapshot.value.entries.map((entry) => entry.url)).toEqual(['/both']);
  expect(second.network.snapshot.value.entries.map((entry) => entry.url)).toEqual([
    '/both',
    '/second-only',
  ]);

  second.stop();

  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(fetch);
  expect(FakeXMLHttpRequest.prototype.open).toBe(originalOpen);
  expect(FakeXMLHttpRequest.prototype.send).toBe(originalSend);

  first.destroy();
  second.destroy();
});

test('NetworkCollector does not overwrite newer third-party patches when stopped', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());
  const originalOpen = FakeXMLHttpRequest.prototype.open;
  const originalSend = FakeXMLHttpRequest.prototype.send;
  const thirdPartyFetch: typeof globalThis.fetch = jest.fn(async () => new Response());
  const thirdPartyOpen = jest.fn();
  const thirdPartySend = jest.fn();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    (globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch = thirdPartyFetch;
    FakeXMLHttpRequest.prototype.open = thirdPartyOpen;
    FakeXMLHttpRequest.prototype.send = thirdPartySend;

    monitor.stop();

    expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(
      thirdPartyFetch,
    );
    expect(FakeXMLHttpRequest.prototype.open).toBe(thirdPartyOpen);
    expect(FakeXMLHttpRequest.prototype.send).toBe(thirdPartySend);
  } finally {
    monitor.destroy();
    FakeXMLHttpRequest.prototype.open = originalOpen;
    FakeXMLHttpRequest.prototype.send = originalSend;
  }
});

test('a newer chained XHR patch keeps delegating after NetworkCollector stops', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response());
  const originalOpen = FakeXMLHttpRequest.prototype.open;
  const originalSend = FakeXMLHttpRequest.prototype.send;
  const baseOpen = jest.fn(originalOpen);
  const baseSend = jest.fn(originalSend);

  FakeXMLHttpRequest.prototype.open = baseOpen;
  FakeXMLHttpRequest.prototype.send = baseSend;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const monitoredOpen = FakeXMLHttpRequest.prototype.open;
    const monitoredSend = FakeXMLHttpRequest.prototype.send;
    const thirdPartyOpen = function (this: XMLHttpRequest, ...args: unknown[]) {
      return (monitoredOpen as (...params: unknown[]) => unknown).apply(this, args);
    } as unknown as typeof FakeXMLHttpRequest.prototype.open;
    const thirdPartySend = function (this: XMLHttpRequest, ...args: unknown[]) {
      return (monitoredSend as (...params: unknown[]) => unknown).apply(this, args);
    } as unknown as typeof FakeXMLHttpRequest.prototype.send;

    FakeXMLHttpRequest.prototype.open = thirdPartyOpen;
    FakeXMLHttpRequest.prototype.send = thirdPartySend;

    monitor.stop();

    const xhr = new FakeXMLHttpRequest() as unknown as XMLHttpRequest;

    xhr.open('GET', '/chained');
    xhr.send();

    expect(baseOpen).toHaveBeenCalledTimes(1);
    expect(baseSend).toHaveBeenCalledTimes(1);
  } finally {
    monitor.destroy();
    FakeXMLHttpRequest.prototype.open = originalOpen;
    FakeXMLHttpRequest.prototype.send = originalSend;
  }
});

test('throwing filters cannot reject a successful fetch or block another monitor', async () => {
  const response = new Response('ok');
  const failure = new Error('original rejection');
  const nativeFetch = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response)
    .mockRejectedValueOnce(failure);

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch: nativeFetch },
  });
  const broken = createMonitor({
    collectors: ['network'],
    networkFilter: () => {
      throw new Error('bad filter');
    },
  });
  const healthy = createMonitor({ collectors: ['network'] });

  try {
    broken.start();
    healthy.start();
    await expect(window.fetch('/ok')).resolves.toBe(response);
    await expect(window.fetch('/fail')).rejects.toBe(failure);
    expect(healthy.network.snapshot.value.entries.map((entry) => entry.status)).toEqual([200, 0]);
  } finally {
    broken.destroy();
    healthy.destroy();
  }
});

test('reusing an XMLHttpRequest records exactly one entry per send', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest,
  });
  const monitor = createMonitor({ collectors: ['network'] });

  try {
    monitor.start();
    const xhr = new XMLHttpRequest();

    xhr.open('GET', '/one');
    xhr.send();
    xhr.open('POST', '/two');
    xhr.send();
    expect(
      monitor.network.snapshot.value.entries.map((entry) => [entry.method, entry.url]),
    ).toEqual([
      ['GET', '/one'],
      ['POST', '/two'],
    ]);
  } finally {
    monitor.destroy();
  }
});

test('failed synchronous XHR sends remove instrumentation before reuse', () => {
  class FailingXHR extends FakeXMLHttpRequest {
    fail = true;
    override send(): void {
      if (this.fail) {
        throw new Error('send failed');
      }

      super.send();
    }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FailingXHR });
  const monitor = createMonitor({ collectors: ['network'] });

  try {
    monitor.start();
    const xhr = new FailingXHR();

    expect(() => xhr.send()).toThrow('send failed');
    xhr.fail = false;
    xhr.send();
    expect(monitor.network.snapshot.value.entries).toHaveLength(1);
  } finally {
    monitor.destroy();
  }
});

test('requests from an earlier lifecycle do not enter a restarted monitor', async () => {
  let finish!: (response: Response) => void;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      fetch: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    },
  });
  const monitor = createMonitor({ collectors: ['network'] });

  try {
    monitor.start();
    const pending = window.fetch('/old');

    monitor.stop();
    monitor.start();
    finish(new Response());
    await pending;
    expect(monitor.network.snapshot.value.entries).toEqual([]);
  } finally {
    monitor.destroy();
  }
});

test('window aggregates retain all traffic independently of a one-entry history', async () => {
  jest.useFakeTimers();
  const nativeFetch = jest
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockResolvedValue(new Response(''));

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch: nativeFetch },
  });
  const monitor = createMonitor({ collectors: ['network'], maxHistory: 1 });

  try {
    monitor.start();
    await window.fetch('/failed');
    await jest.advanceTimersByTimeAsync(1000);
    await window.fetch('/ok');
    expect(monitor.network.snapshot.value.entries).toHaveLength(1);
    expect(monitor.network.snapshot.value.window5s).toMatchObject({ count: 2, errorRate: 0.5 });
    await jest.advanceTimersByTimeAsync(4001);
    expect(monitor.network.snapshot.value.window5s).toMatchObject({ count: 1, errorRate: 0 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(monitor.network.snapshot.value.window5s.count).toBe(0);
  } finally {
    monitor.destroy();
    jest.useRealTimers();
  }
});

function installNetworkBrowser(fetchImpl: typeof fetch) {
  const fetchMock = jest.fn(fetchImpl);

  Object.defineProperty(globalThis, 'window', { configurable: true, value: { fetch: fetchMock } });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });

  return globalThis.window as unknown as { fetch: typeof fetch };
}

test('NetworkCollector measures every supported fetch body and input shape', async () => {
  const testWindow = installNetworkBrowser(async () => new Response(null, { status: 404 }));
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();
    await testWindow.fetch(new URL('https://example.test/blob'), {
      method: 'PUT',
      body: new Blob(['12345']),
    });
    await testWindow.fetch(new Request('https://example.test/request', { method: 'DELETE' }), {
      body: new ArrayBuffer(8),
    });
    await testWindow.fetch('/view', { method: 'POST', body: new Uint8Array(3) });
    await testWindow.fetch('/params', { method: 'POST', body: new URLSearchParams('a=1') });

    const snapshot = monitor.network.snapshot.value;

    expect(
      snapshot.entries.map(({ url, method, requestSize }) => ({ url, method, requestSize })),
    ).toEqual([
      { url: 'https://example.test/blob', method: 'PUT', requestSize: 5 },
      { url: 'https://example.test/request', method: 'DELETE', requestSize: 8 },
      { url: '/view', method: 'POST', requestSize: 3 },
      { url: '/params', method: 'POST', requestSize: 0 },
    ]);
    expect(snapshot.window5s.errorRate).toBe(1);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector records failed fetches and rethrows the original error', async () => {
  let failure: unknown = new TypeError('offline');

  const testWindow = installNetworkBrowser(async () => {
    throw failure;
  });
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();
    await expect(testWindow.fetch('/offline')).rejects.toThrow('offline');
    failure = 'aborted';
    await expect(testWindow.fetch('/aborted')).rejects.toBe('aborted');

    expect(
      monitor.network.snapshot.value.entries.map(({ status, error }) => ({ status, error })),
    ).toEqual([
      { status: 0, error: 'offline' },
      { status: 0, error: 'Network error' },
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector reports zero payload when response headers cannot be read', async () => {
  const response = new Response('body');

  Object.defineProperty(response, 'headers', {
    get() {
      throw new Error('opaque');
    },
  });

  const testWindow = installNetworkBrowser(async () => response);
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();
    await testWindow.fetch('/opaque');

    expect(monitor.network.snapshot.value.entries[0]?.payloadSize).toBe(0);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector records XHR defaults, binary sizes and network failures', () => {
  installNetworkBrowser(async () => new Response());
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const unopened = new XMLHttpRequest();

    unopened.send();

    const binary = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;

    (binary as unknown as { response: unknown }).response = new ArrayBuffer(16);
    (binary as unknown as XMLHttpRequest).open('post', new URL('https://example.test/binary'));
    (binary as unknown as XMLHttpRequest).send('abc');

    const failed = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;

    failed.status = 0;

    failed.getResponseHeader = () => {
      throw new Error('not available');
    };

    (failed as unknown as XMLHttpRequest).open('GET', '/failed');
    (failed as unknown as XMLHttpRequest).send();

    expect(
      monitor.network.snapshot.value.entries.map(({ url, method, payloadSize, error }) => ({
        url,
        method,
        payloadSize,
        error,
      })),
    ).toEqual([
      { url: '', method: 'GET', payloadSize: 0, error: null },
      { url: 'https://example.test/binary', method: 'POST', payloadSize: 16, error: null },
      { url: '/failed', method: 'GET', payloadSize: 0, error: 'Network error' },
    ]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector starts without fetch or XMLHttpRequest and stays inert after destroy', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  const monitor = createMonitor({ collectors: { network: true } });

  monitor.start();
  expect(monitor.network.snapshot.value.entries).toEqual([]);
  monitor.destroy();
  monitor.destroy();

  const testWindow = installNetworkBrowser(async () => new Response());

  monitor.network.start();
  await testWindow.fetch('/after-destroy');

  expect(monitor.network.snapshot.value.entries).toEqual([]);
});

test('NetworkCollector ignores Content-Length values beyond the safe integer range', async () => {
  const response = new Response('x', { headers: { 'content-length': '99999999999999999999' } });
  const testWindow = installNetworkBrowser(async () => response);
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();
    await testWindow.fetch('/huge');

    expect(monitor.network.snapshot.value.entries[0]?.payloadSize).toBe(0);
  } finally {
    monitor.destroy();
  }
});

test('a duplicate XHR send while in flight is passed through without a second entry', () => {
  installNetworkBrowser(async () => new Response());
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;
    const send = jest.spyOn(FakeXMLHttpRequest.prototype, 'send');

    xhr.autoComplete = false;
    (xhr as unknown as XMLHttpRequest).open('GET', '/pending');
    (xhr as unknown as XMLHttpRequest).send();
    (xhr as unknown as XMLHttpRequest).send();

    expect(send).toHaveBeenCalledTimes(2);
    expect(monitor.network.snapshot.value.entries).toEqual([]);

    xhr.complete();

    expect(monitor.network.snapshot.value.entries.map((entry) => entry.url)).toEqual(['/pending']);
  } finally {
    monitor.destroy();
  }
});

test('reopening an in-flight XHR abandons the previous request', () => {
  installNetworkBrowser(async () => new Response());
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    const xhr = new XMLHttpRequest() as unknown as FakeXMLHttpRequest;

    xhr.autoComplete = false;
    (xhr as unknown as XMLHttpRequest).open('GET', '/first');
    (xhr as unknown as XMLHttpRequest).send();
    (xhr as unknown as XMLHttpRequest).open('POST', '/second');
    (xhr as unknown as XMLHttpRequest).send('body');
    xhr.complete();

    expect(
      monitor.network.snapshot.value.entries.map(({ url, method, requestSize }) => ({
        url,
        method,
        requestSize,
      })),
    ).toEqual([{ url: '/second', method: 'POST', requestSize: 4 }]);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector counts HTTP error statuses in the window error rate', async () => {
  const statuses = [200, 404, 500, 204];
  const testWindow = installNetworkBrowser(
    async () => new Response(null, { status: statuses.shift() ?? 200 }),
  );
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();

    for (let index = 0; index < 4; index += 1) {
      await testWindow.fetch(`/r${index}`);
    }

    expect(monitor.network.snapshot.value.window5s).toMatchObject({ count: 4, errorRate: 0.5 });
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector notifies onRequest with every recorded entry', async () => {
  const testWindow = installNetworkBrowser(async () => new Response());
  const monitor = createMonitor({ collectors: { network: { filter: (url) => url !== '/skip' } } });
  const seen: string[] = [];

  try {
    monitor.network.onRequest.subscribe((entry) => {
      if (entry) {
        seen.push(entry.url);
      }
    });
    monitor.start();
    await testWindow.fetch('/a');
    await testWindow.fetch('/skip');
    await testWindow.fetch('/b');

    expect(seen).toEqual(['/a', '/b']);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector clearLog resets entries and the rolling window', async () => {
  jest.useFakeTimers();

  const testWindow = installNetworkBrowser(async () => new Response());
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.start();
    await testWindow.fetch('/before');
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    monitor.network.clearLog();

    expect(monitor.network.snapshot.value).toEqual({
      entries: [],
      window5s: { count: 0, avgLatency: 0, totalPayload: 0, errorRate: 0 },
    });
    expect(jest.getTimerCount()).toBe(0);

    await testWindow.fetch('/after');
    expect(monitor.network.snapshot.value.window5s.count).toBe(1);
  } finally {
    monitor.destroy();
  }
});

test('NetworkCollector destroy is idempotent at the collector level', () => {
  const testWindow = installNetworkBrowser(async () => new Response());
  const originalFetch = testWindow.fetch;
  const monitor = createMonitor({ collectors: { network: true } });

  monitor.start();
  expect(testWindow.fetch).not.toBe(originalFetch);

  monitor.network.destroy();
  monitor.network.destroy();

  expect(testWindow.fetch).toBe(originalFetch);
  monitor.destroy();
});

test('NetworkCollector start is a no-op without a window', () => {
  const monitor = createMonitor({ collectors: { network: true } });

  try {
    monitor.network.start();
    installNetworkBrowser(async () => new Response());
    monitor.network.stop();

    expect(monitor.network.snapshot.value.entries).toEqual([]);
  } finally {
    monitor.destroy();
  }
});
