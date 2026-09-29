import { performance } from 'node:perf_hooks';
import { createMonitor, emitMonitorEvent } from '../dist/index.js';

const WARMUP_MS = 100;
const SAMPLE_MS = 300;
const BATCH_SIZE = 100;
const SAMPLE_COUNT = 5;

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.detail = init.detail;
    }
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatDuration(value) {
  if (value < 0.001) {
    return `${formatNumber(value * 1_000_000)} ns`;
  }

  if (value < 1) {
    return `${formatNumber(value * 1_000)} us`;
  }

  return `${formatNumber(value)} ms`;
}

/** Awaits every operation, so async cases include their promise and microtask costs. */
async function runLoopAsync(fn, durationMs) {
  let iterations = 0;
  const start = performance.now();
  let elapsed = 0;

  do {
    for (let i = 0; i < BATCH_SIZE; i++) {
      await fn();
    }

    iterations += BATCH_SIZE;
    elapsed = performance.now() - start;
  } while (elapsed < durationMs);

  return { elapsed, iterations };
}

function runLoop(fn, durationMs) {
  let iterations = 0;
  const start = performance.now();
  let elapsed = 0;

  do {
    for (let i = 0; i < BATCH_SIZE; i++) {
      fn();
    }

    iterations += BATCH_SIZE;
    elapsed = performance.now() - start;
  } while (elapsed < durationMs);

  return { elapsed, iterations };
}

/**
 * Engines keep some objects alive until the current job ends (for example WeakRef targets), so
 * one long synchronous run retains the garbage of every case. Yielding between samples lets it go;
 * the yield itself is outside the measured time.
 */
function endJob() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function bench(name, fn, { async = false, warmupMs = WARMUP_MS } = {}) {
  const loop = async ? runLoopAsync : runLoop;

  await endJob();
  await loop(fn, warmupMs);
  const samples = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    await endJob();
    const { elapsed, iterations } = await loop(fn, SAMPLE_MS);

    samples.push({
      hz: iterations / (elapsed / 1000),
      avgMs: elapsed / iterations,
      iterations,
    });
  }

  samples.sort((a, b) => a.hz - b.hz);
  const median = samples[Math.floor(samples.length / 2)];
  // Half the sample range relative to the median: a rough noise band for comparing runs.
  const spread = ((samples[samples.length - 1].hz - samples[0].hz) / 2 / median.hz) * 100;

  return { name, ...median, spread };
}

function print(results) {
  const longestName = Math.max(...results.map((result) => result.name.length));

  console.log('\nmonitor-api benchmarks\n');
  for (const result of results) {
    console.log(
      `${result.name.padEnd(longestName)}  ${formatNumber(result.hz).padStart(12)} ops/s  ${formatDuration(result.avgMs).padStart(10)} avg  ±${result.spread.toFixed(1).padStart(4)}%`,
    );
  }
  console.log('');
}

function withEventWindow() {
  globalThis.window = new EventTarget();
}

function withFetchWindow() {
  const response = new Response(null, { status: 200, headers: { 'content-length': '512' } });

  globalThis.window = { fetch: async () => response };
}

function withReactWindow() {
  globalThis.window = {};
}

function withWebVitalsBrowser() {
  const noop = () => {};

  globalThis.window = {
    addEventListener: noop,
    removeEventListener: noop,
  };
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.document = {
    prerendering: false,
    visibilityState: 'visible',
    readyState: 'complete',
    addEventListener: noop,
    removeEventListener: noop,
  };
  globalThis.PerformanceObserver = class PerformanceObserver {
    static supportedEntryTypes = [
      'event',
      'layout-shift',
      'largest-contentful-paint',
      'navigation',
      'paint',
    ];

    constructor(callback) {
      this.callback = callback;
    }

    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };

  if (!performance.getEntriesByType) {
    performance.getEntriesByType = () => [];
  }
}

function resetWebVitalsBrowser() {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'PerformanceObserver');
  Reflect.deleteProperty(globalThis, 'addEventListener');
  Reflect.deleteProperty(globalThis, 'removeEventListener');
}

// React's PerformedWork flag: every bench fiber counts as a real render, not a bailout.
const PERFORMED_WORK = 0b1;

function fiberFor(type, actualDuration = 1) {
  return {
    tag: 0,
    type,
    alternate: {},
    child: null,
    sibling: null,
    flags: PERFORMED_WORK,
    actualDuration,
  };
}

function fiberList(count) {
  const root = fiberFor(function Root() {}, 1);
  let current = root;

  for (let i = 0; i < count; i++) {
    const component = Object.defineProperty(function Component() {}, 'name', {
      value: `BenchComponent${i}`,
    });
    current.child = fiberFor(component, i % 5);
    current = current.child;
  }

  return root;
}

function fiberSiblings(count) {
  const root = fiberFor(function Root() {}, 1);
  let current = null;

  for (let i = 0; i < count; i++) {
    const component = Object.defineProperty(function Component() {}, 'name', {
      value: `BenchSibling${i}`,
    });
    const sibling = fiberFor(component, i % 5);

    if (current) {
      current.sibling = sibling;
    } else {
      root.child = sibling;
    }

    current = sibling;
  }

  return root;
}

async function runBenchmarks() {
  const results = [];

  results.push(
    await bench('createMonitor + destroy', () => {
      const monitor = createMonitor();
      monitor.destroy();
    }),
  );

  withEventWindow();
  const eventMonitor = createMonitor({
    maxHistory: 200,
    collectors: { events: true },
  });
  eventMonitor.start();
  let eventCount = 0;
  results.push(
    await bench('emitMonitorEvent', () => {
      emitMonitorEvent(`bench:${eventCount++ % 20}`, { index: eventCount });
    }),
  );
  eventMonitor.destroy();

  withWebVitalsBrowser();
  results.push(
    await bench('Web Vitals subscribe + destroy', () => {
      const monitor = createMonitor({
        collectors: { webVitals: true },
      });
      monitor.start();
      monitor.destroy();
    }),
  );
  resetWebVitalsBrowser();

  withFetchWindow();
  const unpatchedFetch = globalThis.window.fetch;
  results.push(
    await bench('fetch baseline (unpatched)', () => unpatchedFetch('/api/items'), { async: true }),
  );
  const networkMonitor = createMonitor({ collectors: { network: true } });
  networkMonitor.start();
  // The collector aggregates the last 5 s in per-millisecond buckets. Warming up past 5 s measures
  // the steady state, where every request also expires the oldest buckets.
  results.push(
    await bench(
      'fetch through the network collector',
      () => globalThis.window.fetch('/api/items'),
      {
        async: true,
        warmupMs: 5_500,
      },
    ),
  );
  networkMonitor.destroy();
  Reflect.deleteProperty(globalThis, 'window');

  const errorMonitor = createMonitor({ collectors: { errors: true } });
  const errors = Array.from({ length: 20 }, (_, i) => new Error(`bench error ${i}`));
  let errorCount = 0;
  results.push(
    await bench('errors.capture', () => {
      errorMonitor.errors.capture(errors[errorCount++ % errors.length]);
    }),
  );
  errorMonitor.destroy();

  const noopTransport = () => {};
  const defaultReportMonitor = createMonitor({
    env: 'production',
    report: { endpoint: '/metrics', interval: 60_000, transport: noopTransport },
  });
  defaultReportMonitor.start();
  results.push(
    await bench('reporter flush (default payload)', () => defaultReportMonitor.reporter.flush(), {
      async: true,
    }),
  );
  defaultReportMonitor.destroy();

  // About 32 KB of JSON with multi-byte text, below the default 64 KB payload limit.
  const largePayload = {
    items: Array.from({ length: 740 }, (_, i) => ({ id: i, label: `évènement ${i} — ok` })),
  };
  const largeReportMonitor = createMonitor({
    collectors: [],
    env: 'production',
    report: {
      endpoint: '/metrics',
      interval: 60_000,
      transport: noopTransport,
      transform: () => largePayload,
    },
  });
  largeReportMonitor.start();
  results.push(
    await bench('reporter flush (32 KB transform)', () => largeReportMonitor.reporter.flush(), {
      async: true,
    }),
  );
  largeReportMonitor.destroy();

  withReactWindow();
  const reactMonitor = createMonitor({
    maxHistory: 500,
    collectors: { react: true },
  });
  reactMonitor.start();
  const hook = globalThis.window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const root = { current: fiberList(50) };
  results.push(
    await bench('React commit with 50 fibers', () => {
      hook.onCommitFiberRoot(1, root);
    }),
  );
  const deepRoot = { current: fiberList(1_000) };
  results.push(
    await bench('React commit with 1,000 deep fibers', () => {
      hook.onCommitFiberRoot(1, deepRoot);
    }),
  );
  const wideRoot = { current: fiberSiblings(1_000) };
  results.push(
    await bench('React commit with 1,000 wide fibers', () => {
      hook.onCommitFiberRoot(1, wideRoot);
    }),
  );
  reactMonitor.destroy();

  // A long history makes each commit copy the retained entries and rebuild byComponent from them.
  const longHistoryMonitor = createMonitor({
    maxHistory: 5_000,
    collectors: { react: true },
  });
  longHistoryMonitor.start();
  const longHistoryHook = globalThis.window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  results.push(
    await bench('React commit with 50 fibers, 5,000 history', () => {
      longHistoryHook.onCommitFiberRoot(1, root);
    }),
  );
  longHistoryMonitor.destroy();

  Reflect.deleteProperty(globalThis, 'window');

  print(results);
}

await runBenchmarks();
