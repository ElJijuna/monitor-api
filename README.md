# monitor-api

[![npm version](https://img.shields.io/npm/v/monitor-api.svg)](https://www.npmjs.com/package/monitor-api)
[![npm downloads](https://img.shields.io/npm/dm/monitor-api.svg)](https://www.npmjs.com/package/monitor-api)
[![bundle size](https://img.shields.io/bundlephobia/minzip/monitor-api)](https://bundlephobia.com/package/monitor-api)
[![License: MIT](https://img.shields.io/npm/l/monitor-api)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)
[![GitHub issues](https://img.shields.io/github/issues/ElJijuna/monitor-api)](https://github.com/ElJijuna/monitor-api/issues)
[![GitHub stars](https://img.shields.io/github/stars/ElJijuna/monitor-api)](https://github.com/ElJijuna/monitor-api/stargazers)

Lightweight, **signal-based** web app monitoring library.  
Captures FPS, JS heap, long tasks, Web Vitals, network requests, React renders, and custom events — all reactive via [ssignal](https://github.com/ElJijuna/ssignal).

## Features

- **Signal-based** — subscribe to exactly what you need, no polling
- **5 collectors** — Performance, Network, React, Events, Web Vitals
- **Web Vitals** — CLS, FCP, INP, LCP, and TTFB via `web-vitals`
- **React integration** — `useSignal`, `usePerformance`, `useNetwork`, `useReact`, `useEvents`, `useWebVitals`
- **Zero config** — works out of the box, tree-shakeable
- **SSR safe** — browser collectors no-op outside the browser
- **Production-ready lifecycle** — `start()` is idempotent and `stop()` restores runtime patches
- **TypeScript-first** — fully typed, zero `any` in the public API
- **Small runtime** — depends on [ssignal](https://www.npmjs.com/package/ssignal) and [web-vitals](https://www.npmjs.com/package/web-vitals)

## Installation

```sh
npm install monitor-api
```

## Quick start

```ts
import { createMonitor } from 'monitor-api'

const monitor = createMonitor()
monitor.start()

// Subscribe to FPS changes
monitor.performance.fps.subscribe((fps) => {
  console.log('FPS:', fps)
})

// Subscribe to full performance snapshot
monitor.performance.snapshot.subscribe((snap) => {
  console.log('Performance snapshot:', snap)
  // { fps: 60, fpsHistory: [...], memory: { used: 45.2, total: 2048, percent: 2.2 }, ... }
})
```

---

## API

### `createMonitor(config?)`

Creates and returns a `Monitor` instance. Does **not** start collecting — call `monitor.start()` explicitly.

```ts
import { createMonitor } from 'monitor-api'

const monitor = createMonitor({
  collectors: ['performance', 'network', 'react', 'events', 'webVitals'], // default: all
  maxHistory: 120,       // data points kept per metric (default: 120)
  networkFilter: (url) => !url.includes('analytics'),        // optional
  env: 'development',    // 'development' | 'production' (default: 'development')
})

monitor.start()    // start all collectors
monitor.stop()     // pause (keeps data)
monitor.destroy()  // stop + dispose all signals
```

`monitor.start()` is idempotent. Calling it more than once does not duplicate
event listeners, network patches, or React commit hooks.

---

## Runtime safety

`monitor-api` is designed to run in development, staging, and production browser
apps.

- Importing and creating a monitor is SSR-safe.
- Browser collectors no-op when `window` is unavailable.
- Collection starts only after `monitor.start()`.
- `monitor.stop()` and `monitor.destroy()` restore patched browser APIs.
- Histories are bounded by `maxHistory`.
- Production reporting starts only after `monitor.start()` and only when `fetch`
  is available.

For production apps, prefer a conservative `maxHistory`, select only the
collectors you need, and use `report.transform` to send a compact payload.

---

## Collectors

### PerformanceCollector

Captures FPS, JS heap memory, Long Tasks, and Cumulative Layout Shift (CLS).

```ts
monitor.start()

// Granular signals — subscribe to only what you need
monitor.performance.fps.subscribe((fps) => {
  console.log('Current FPS:', fps)
})

monitor.performance.memory.subscribe((mem) => {
  if (mem) {
    console.log(`Memory: ${mem.used}MB / ${mem.total}MB (${mem.percent}%)`)
  } else {
    console.log('Memory API not available (non-Chrome browser)')
  }
})

monitor.performance.longTasks.subscribe(({ count, lastDuration }) => {
  console.log(`Long tasks: ${count} total, last was ${lastDuration}ms`)
})

monitor.performance.cls.subscribe((cls) => {
  console.log('Cumulative Layout Shift:', cls.toFixed(4))
})

// Or subscribe to the full snapshot
monitor.performance.snapshot.subscribe((snap) => {
  console.log('Performance snapshot:', JSON.stringify(snap, null, 2))
  /*
  {
    fps: 58,
    fpsHistory: [60, 59, 58],
    memory: { used: 45.2, total: 2048, percent: 2.2 },
    memoryHistory: [2.1, 2.2, 2.2],
    longTasks: { count: 3, lastDuration: 82.5 },
    cls: 0.0023
  }
  */
})

// Utilities
monitor.performance.clearHistory()  // reset fpsHistory + memoryHistory
```

**Snapshot shape:**

```ts
interface PerformanceSnapshot {
  fps: number
  fpsHistory: number[]
  memory: { used: number; total: number; percent: number } | null
  memoryHistory: number[]
  longTasks: { count: number; lastDuration: number | null }
  cls: number
}
```

> **Note:** `memory` is `null` on non-Chrome browsers. `actualDuration` for React components requires a dev build or `react-dom/profiling` in production.

---

### NetworkCollector

Intercepts `fetch` and `XMLHttpRequest` transparently. `stop()`/`destroy()`
restore the original `fetch`, `XMLHttpRequest.prototype.open`, and
`XMLHttpRequest.prototype.send` implementations.

```ts
monitor.start()

// Fire on every new request
monitor.network.onRequest.subscribe((entry) => {
  if (!entry) return
  console.log(`[${entry.initiator.toUpperCase()}] ${entry.method} ${entry.url}`)
  console.log(`  Status: ${entry.status} | Latency: ${entry.latency}ms | Size: ${entry.payloadSize} bytes`)
  if (entry.error) console.warn('  Error:', entry.error)
})

// Full snapshot with rolling log + 5-second window metrics
monitor.network.snapshot.subscribe((snap) => {
  const { window5s } = snap
  console.log(`Last 5s: ${window5s.count} requests, avg latency ${window5s.avgLatency}ms, error rate ${(window5s.errorRate * 100).toFixed(1)}%`)
  console.log('All entries:', snap.entries)
})

// Dynamic filter
monitor.network.setFilter((url) => !url.includes('/health'))

// Clear log
monitor.network.clearLog()
```

**Entry shape:**

```ts
interface NetworkEntry {
  id: string
  url: string
  method: string          // 'GET' | 'POST' | ...
  status: number          // 0 if network error
  latency: number         // ms
  payloadSize: number     // response bytes
  requestSize: number     // request body bytes
  initiator: 'fetch' | 'xhr'
  timestamp: number       // Date.now()
  error: string | null
}
```

---

### ReactCollector

Hooks into `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` to capture React renders **without touching the component tree**.

Compatible with React 18 and React 19, dev and production builds.

```ts
monitor.start()

// Fire on every commit batch
monitor.react.onCommit.subscribe((entry) => {
  if (!entry) return
  console.log(`[React] ${entry.type} <${entry.component}> — ${entry.duration}ms`)
})

// Full snapshot with per-component aggregation over retained history
monitor.react.snapshot.subscribe((snap) => {
  console.log(`Total commits: ${snap.totalCommits}`)

  console.log('Slow components (>16ms):')
  snap.slowComponents.forEach((e) => {
    console.log(`  <${e.component}> ${e.duration}ms [${e.type}]`)
  })

  console.log('By component:')
  Object.entries(snap.byComponent).forEach(([name, stats]) => {
    console.log(`  ${name}: ${stats.renders} renders, avg ${stats.avgDuration}ms`)
  })
})

// Adjust slow threshold
monitor.react.setSlowThreshold(8)  // flag components slower than 8ms

monitor.react.clearLog()
```

**Render entry shape:**

```ts
interface RenderEntry {
  component: string         // displayName or function.name
  duration: number          // ms (actualDuration — 0 in prod without profiling build)
  timestamp: number
  type: 'mount' | 'update' | 'unmount'
  commitId: number
}
```

> **Tip:** `duration` is always `0` in production unless you use `react-dom/profiling`. In dev mode it's automatically available.

---

### EventCollector

Custom event bus. The app can emit events without importing the library.

**Emitting events:**

```ts
// Option A — import the helper
import { emitMonitorEvent } from 'monitor-api'

emitMonitorEvent('user:login', { userId: 42 })
emitMonitorEvent('route:change', { from: '/home', to: '/settings' })
emitMonitorEvent('error:caught', { message: 'Network timeout' })

// Option B — native CustomEvent (no import needed)
window.dispatchEvent(new CustomEvent('app:monitor:event', {
  detail: { label: 'cache:miss', data: { key: 'user_profile' } }
}))
```

**Subscribing:**

```ts
monitor.start()

// Fire on each event
monitor.events.onEvent.subscribe((event) => {
  if (!event) return
  console.log(`[Event] ${event.label}`, event.data)
})

// Full snapshot with count by label
monitor.events.snapshot.subscribe((snap) => {
  console.log('Event log:', snap.entries)
  console.log('Counts by label:', snap.byLabel)
  // { 'user:login': 3, 'route:change': 7, 'error:caught': 1 }
})

monitor.events.clearLog()
```

---

### WebVitalsCollector

Collects standard Web Vitals metrics using the
[`web-vitals`](https://www.npmjs.com/package/web-vitals) package:

- `CLS` — Cumulative Layout Shift
- `FCP` — First Contentful Paint
- `INP` — Interaction to Next Paint
- `LCP` — Largest Contentful Paint
- `TTFB` — Time to First Byte

```ts
monitor.start()

monitor.webVitals.onMetric.subscribe((metric) => {
  if (!metric) return
  console.log(`[Web Vital] ${metric.name}: ${metric.value} (${metric.rating})`)
})

monitor.webVitals.snapshot.subscribe((snap) => {
  console.log('Latest CLS:', snap.cls)
  console.log('Latest INP:', snap.inp)
  console.log('Recent Web Vitals reports:', snap.entries)
})

monitor.webVitals.clearLog()
```

**Metric shape:**

```ts
interface WebVitalMetric {
  name: 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB'
  value: number
  delta: number
  rating: 'good' | 'needs-improvement' | 'poor'
  id: string
  navigationType: string
  timestamp: number
}
```

`CLS` is unitless. `FCP`, `INP`, `LCP`, and `TTFB` are reported in milliseconds.

---

## Unified snapshot

Subscribe to all collectors at once:

```ts
monitor.subscribe((snap) => {
  console.log('Full monitor snapshot at', new Date(snap.timestamp).toISOString())
  console.log('  FPS:', snap.performance.fps)
  console.log('  Pending requests:', snap.network.entries.filter(e => !e.error).length)
  console.log('  LCP:', snap.webVitals.lcp?.value ?? 'n/a')
  console.log('  React commits:', snap.react.totalCommits)
  console.log('  Custom events:', snap.events.entries.length)
})

// Or read synchronously
const snap = monitor.getSnapshot()
```

---

## React integration

```tsx
import { createMonitor } from 'monitor-api'
import { useSignal, usePerformance, useNetwork, useReact, useEvents, useWebVitals } from 'monitor-api/react'

const monitor = createMonitor()
monitor.start()

// Generic — subscribe to any signal
function FpsDisplay() {
  const fps = useSignal(monitor.performance.fps)
  console.log('Rendering FpsDisplay, fps =', fps)
  return <span>FPS: {fps}</span>
}

// Collector-specific hooks
function PerfPanel() {
  const { fps, memory, cls, longTasks } = usePerformance(monitor)
  console.log('Rendering PerfPanel:', { fps, memory, cls })
  return (
    <div>
      <p>FPS: {fps}</p>
      <p>Memory: {memory ? `${memory.used}MB (${memory.percent}%)` : 'n/a'}</p>
      <p>CLS: {cls.toFixed(4)}</p>
      <p>Long tasks: {longTasks.count}</p>
    </div>
  )
}

function NetworkPanel() {
  const { window5s, entries } = useNetwork(monitor)
  console.log('Rendering NetworkPanel, requests in last 5s:', window5s.count)
  return (
    <div>
      <p>{window5s.count} requests / 5s — avg {window5s.avgLatency}ms</p>
      <ul>
        {entries.slice(-5).map(e => (
          <li key={e.id}>{e.method} {e.url} — {e.status} ({e.latency}ms)</li>
        ))}
      </ul>
    </div>
  )
}

function ReactPanel() {
  const { slowComponents, byComponent, totalCommits } = useReact(monitor)
  console.log('Rendering ReactPanel, total commits:', totalCommits)
  return (
    <div>
      <p>Total commits: {totalCommits}</p>
      <p>Slow components:</p>
      <ul>
        {slowComponents.map((e, i) => (
          <li key={i}>{e.component} — {e.duration}ms [{e.type}]</li>
        ))}
      </ul>
    </div>
  )
}

function WebVitalsPanel() {
  const { cls, inp, lcp } = useWebVitals(monitor)
  return (
    <div>
      <p>CLS: {cls?.value ?? 'n/a'}</p>
      <p>INP: {inp ? `${inp.value}ms (${inp.rating})` : 'n/a'}</p>
      <p>LCP: {lcp ? `${lcp.value}ms (${lcp.rating})` : 'n/a'}</p>
    </div>
  )
}
```

---

## Production mode

```ts
const monitor = createMonitor({
  env: 'production',
  maxHistory: 60,
  report: {
    endpoint: 'https://my-api.com/metrics',
    interval: 30_000,  // send every 30s
    transform: (snap) => ({
      fps: snap.performance.fps,
      memory: snap.performance.memory?.percent ?? null,
      errorRate: snap.network.window5s.errorRate,
      webVitals: {
        cls: snap.webVitals.cls,
        inp: snap.webVitals.inp,
        lcp: snap.webVitals.lcp,
      },
    }),
  },
})

monitor.start()
```

Production reporting is intentionally best-effort: failed report requests are
ignored so monitoring never breaks the application. If `fetch` is unavailable,
the reporter does not start.

---

## Collector config

```ts
createMonitor({
  // Enable only specific collectors
  collectors: ['performance', 'network'],

  // Or configure each individually
  collectors: {
    performance: true,
    network: { filter: (url) => !url.includes('/analytics') },
    react: { slowThreshold: 8 },   // default 16ms
    events: false,                  // disabled
    webVitals: { reportAllChanges: true },
  },

  maxHistory: 60,   // data points per metric
})
```

---

## Package structure

```
monitor-api/
├── dist/
│   ├── index.js          ← ESM core
│   ├── index.cjs         ← CJS core
│   ├── index.d.ts        ← types
│   └── react/
│       ├── index.js      ← React hooks (ESM)
│       ├── index.cjs     ← React hooks (CJS)
│       └── index.d.ts
```

---

## Development

```sh
npm run typecheck
npm test
npm run build
npm run docs:build
npm run bench
```

- `docs:build` generates TypeDoc HTML in `docs/`.
- `bench` builds the package and runs runtime benchmarks from `bench/`.
- Benchmark notes are tracked in `BENCH.md`.

---

## License

MIT — see [LICENSE](LICENSE).

---

Repository: [github.com/ElJijuna/monitor-api](https://github.com/ElJijuna/monitor-api)
