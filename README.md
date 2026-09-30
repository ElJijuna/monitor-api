# monitor-api

[![npm version](https://img.shields.io/npm/v/monitor-api.svg)](https://www.npmjs.com/package/monitor-api)
[![npm downloads](https://img.shields.io/npm/dm/monitor-api.svg)](https://www.npmjs.com/package/monitor-api)
[![bundle size](https://img.shields.io/bundlephobia/minzip/monitor-api)](https://bundlephobia.com/package/monitor-api)
[![License: MIT](https://img.shields.io/npm/l/monitor-api)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org)
[![GitHub issues](https://img.shields.io/github/issues/ElJijuna/monitor-api)](https://github.com/ElJijuna/monitor-api/issues)
[![GitHub stars](https://img.shields.io/github/stars/ElJijuna/monitor-api)](https://github.com/ElJijuna/monitor-api/stargazers)

Lightweight, **signal-based** web app monitoring library.  
Captures FPS, JS heap, long tasks, Web Vitals, network requests, React renders, custom events, and optional errors and asset timings — all reactive via [ssignal](https://github.com/ElJijuna/ssignal).

## Features

- **Signal-based** — subscribe to exactly what you need, no polling
- **8 collectors** — Performance, Network, React, Events, Web Vitals, Device, optional Errors and Resources
- **Web Vitals** — CLS, FCP, INP, LCP, and TTFB via `web-vitals`
- **React integration** — selector-aware `useSignal`, `usePerformance`, `useNetwork`, `useReact`, `useEvents`, `useErrors`, `useResources`, `useWebVitals`, `useDevice`
- **Zero config** — works out of the box, tree-shakeable
- **SSR safe** — browser collectors no-op outside the browser
- **Production-ready lifecycle** — `start()` is idempotent and `stop()` restores runtime patches
- **TypeScript-first** — fully typed, zero `any` in the public API
- **Small runtime** — depends on [ssignal](https://www.npmjs.com/package/ssignal) and [web-vitals](https://www.npmjs.com/package/web-vitals)
- **Documented boundaries** — see the [privacy guide](PRIVACY.md) and [browser compatibility matrix](COMPATIBILITY.md)

## Installation

```sh
npm install monitor-api
```

<details>
<summary>Installing from GitHub Packages instead</summary>

Every release is also published to GitHub Packages as `@eljijuna/monitor-api`. GitHub
requires authentication even for public packages: add this `.npmrc` next to your
`package.json`, with a token that has the `read:packages` scope in `GITHUB_TOKEN`:

```ini
@eljijuna:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```sh
npm install @eljijuna/monitor-api
```

Import from `@eljijuna/monitor-api` (and `@eljijuna/monitor-api/react`) instead.

</details>

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
  collectors: ['performance', 'network', 'react', 'events', 'webVitals'], // default collectors
  sampleRate: 1,          // per-monitor sampling probability from 0 to 1 (default: 1)
  maxHistory: 120,       // data points kept per metric; 0 disables history (default: 120)
  networkFilter: (url) => !url.includes('analytics'),        // optional
  env: 'development',    // 'development' | 'production' (default: 'development')
})

monitor.start()    // start all collectors
monitor.stop()     // pause (keeps data)
monitor.destroy()  // stop + dispose all signals
```

`monitor.start()` is idempotent. Calling it more than once does not duplicate
event listeners, network patches, or React commit hooks.

Where the runtime supports explicit resource management, a monitor can be
declared with `using`, which calls `destroy()` when the block ends. This is
handy in tests and scripts:

```ts
{
  using monitor = createMonitor({ collectors: ['events'] })
  monitor.start()
  // ...
} // monitor.destroy() runs here
```

---

## Runtime safety

`monitor-api` is designed to run in development, staging, and production browser
apps.

- Importing and creating a monitor is SSR-safe.
- Browser collectors no-op when `window` is unavailable.
- Collection starts only after `monitor.start()`.
- `monitor.stop()` and `monitor.destroy()` restore patched browser APIs.
- Multiple monitor instances share network and React global hooks; the last active instance restores them.
- Multiple monitor instances with the same `reportAllChanges`, `attribution`, and `softNavigations` settings share Web Vitals observers.
- Histories are bounded by `maxHistory`.
- Custom event payloads are copied before retention and bounded by depth and UTF-8 byte size.
- Error collection is opt-in. Default reporting sends only error counts, not messages or stacks.
- Production reporting starts only after `monitor.start()` and requires either
  `fetch` or a custom transport.

For production apps, prefer a conservative `maxHistory`, select only the
collectors you need, and use `report.transform` to send a compact payload.

---

## Collectors

### PerformanceCollector

Captures FPS, JS heap memory, Long Tasks, Long Animation Frames (LoAF), and Cumulative Layout Shift (CLS).

FPS and memory are sampled only while the page is visible: memory is read every two seconds, and both
samplers pause while `document.visibilityState` is `hidden` or the page is frozen, so `fpsHistory` and
`memoryHistory` reflect visible time only. Sampling resumes on `visibilitychange`, `resume`, or `pageshow`.

In cross-origin isolated pages (served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` or `credentialless`), Chromium also exposes
[`performance.measureUserAgentSpecificMemory()`](https://developer.mozilla.org/docs/Web/API/Performance/measureUserAgentSpecificMemory).
It counts all the memory the page uses, including the DOM, same-origin iframes, and workers, not only
the JavaScript heap. `memoryMeasurement` reports the total in megabytes, broken down by memory type
and by the frames and workers that hold it (the 20 largest, with URLs capped at 500 characters). The
first measurement runs on `start()`, and later ones follow at randomized delays averaging
`memoryMeasurementInterval` (five minutes by default; `false` disables it) while the page is visible.
The browser answers at its next garbage collection, so each result can take tens of seconds. See
[Enabling page memory measurement](#enabling-page-memory-measurement) before adding these headers:
they can break cross-origin content.

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

// Cross-origin isolated Chromium pages only; null elsewhere and until the first result
monitor.performance.memoryMeasurement.subscribe((measurement) => {
  if (measurement) {
    console.log(`Page memory: ${measurement.total}MB`, measurement.byType) // { JavaScript: 38.2, DOM: 6.1, ... }

    for (const { total, scope, url } of measurement.byContext) {
      console.log(`  ${total}MB in ${scope}: ${url ?? 'cross-origin frame'}`)
    }
  }
})

monitor.performance.longTasks.subscribe(({ count, lastDuration }) => {
  console.log(`Long tasks: ${count} total, last was ${lastDuration}ms`)
})

// Long Animation Frames: which scripts made a frame slow (Chromium 123+)
monitor.performance.longAnimationFrames.subscribe(({ count, maxBlockingDuration, entries }) => {
  const latest = entries[entries.length - 1]
  const culprit = latest?.scripts[0]

  console.log(`Long frames: ${count}, worst blocked input for ${maxBlockingDuration}ms`)

  if (culprit) {
    console.log(`Longest script: ${culprit.invoker} (${culprit.sourceURL}) took ${culprit.duration}ms`)
  }
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
    memoryMeasurement: {
      total: 52.4,
      byType: { JavaScript: 44.3, DOM: 8.1 },
      byContext: [{ total: 41.2, url: 'https://app.example/', scope: 'Window', container: null }, ...],
      timestamp: 1767225600000
    },
    longTasks: { count: 3, lastDuration: 82.5 },
    longAnimationFrames: { count: 2, totalBlockingDuration: 140, maxBlockingDuration: 90, entries: [...] },
    cls: 0.0023
  }
  */
})

// Utilities
monitor.performance.clearHistory()  // reset fpsHistory, memoryHistory and recent long animation frames
```

**Snapshot shape:**

```ts
interface PerformanceSnapshot {
  fps: number
  fpsHistory: number[]
  memory: { used: number; total: number; percent: number } | null
  memoryHistory: number[]
  memoryMeasurement: {
    total: number
    byType: Record<string, number>
    byContext: {
      total: number
      url: string | null   // null for cross-origin frames
      scope: string | null // 'Window', 'DedicatedWorkerGlobalScope', 'cross-origin-aggregated', …
      container: { id: string | null; src: string | null } | null // the iframe element, if any
    }[] // the 20 largest, largest first; shared or unattributed memory is left out
    timestamp: number
  } | null
  longTasks: { count: number; lastDuration: number | null }
  longAnimationFrames: {
    count: number
    totalBlockingDuration: number
    maxBlockingDuration: number | null
    entries: LongAnimationFrameEntry[] // recent frames, capped by maxHistory
  }
  cls: number
}

interface LongAnimationFrameEntry {
  startTime: number
  duration: number
  blockingDuration: number
  renderStart: number
  styleAndLayoutStart: number
  firstUIEventTimestamp: number
  scripts: {
    invokerType: string | null // 'event-listener', 'user-callback', 'classic-script', …
    invoker: string | null     // 'BUTTON#save.onclick', a script URL, …
    sourceURL: string | null
    sourceFunctionName: string | null
    duration: number
    forcedStyleAndLayoutDuration: number
    pauseDuration: number
  }[] // the five longest scripts, longest first
  timestamp: number
}
```

> **Long Animation Frames** need a browser with the [Long Animation Frames API](https://developer.chrome.com/docs/web-platform/long-animation-frames) (Chromium 123+); elsewhere `longAnimationFrames` stays empty. Frames from page load are included on the first `start()`. Script strings are capped at 500 characters and stay in the browser: the default production report sends only `count`, `totalBlockingDuration` and `maxBlockingDuration`.

> **Note:** `memory` is `null` on non-Chrome browsers. `actualDuration` for React components requires a dev build or `react-dom/profiling` in production.

#### Enabling page memory measurement

`memoryMeasurement` needs a cross-origin isolated page. Serve the HTML document with both headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers change how the whole page loads, not only the monitor. Check the effects below before
enabling them in production; the library works without them, with `memoryMeasurement` left `null`.

**What can break:**

- **`Cross-Origin-Embedder-Policy: require-corp`** blocks every cross-origin image, font, script,
  stylesheet, and iframe unless its server opts in, either with `Cross-Origin-Resource-Policy:
  cross-origin` or through CORS (a `crossorigin` attribute plus `Access-Control-Allow-Origin`).
  Third-party CDNs, analytics tags, ads, and embedded videos or maps often do not. Worker scripts
  need the `Cross-Origin-Embedder-Policy` header too.
- **`Cross-Origin-Embedder-Policy: credentialless`** is the less strict alternative: cross-origin
  requests without CORS still load, but without cookies. It is supported in Chromium 96+ and
  Firefox 119+, which covers `measureUserAgentSpecificMemory()` since that API is Chromium-only,
  but not Safari. Content that depends on third-party cookies stops working.
- **`Cross-Origin-Opener-Policy: same-origin`** separates the page from cross-origin windows it
  opens or was opened by. Popups for OAuth sign-in or payments that report back through
  `window.opener` lose that reference.

To find breakages without enforcing anything, send the report-only variants first
(`Cross-Origin-Embedder-Policy-Report-Only` and `Cross-Origin-Opener-Policy-Report-Only`) and watch
the DevTools console for violations.

**Configuration examples:**

```js
// Express
app.use((req, res, next) => {
  res.set('Cross-Origin-Opener-Policy', 'same-origin')
  res.set('Cross-Origin-Embedder-Policy', 'require-corp')
  next()
})
```

```nginx
# nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

```js
// vite.config.js (dev server and `vite preview`)
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default { server: { headers: isolation }, preview: { headers: isolation } }
```

```text
# Netlify and Cloudflare Pages: _headers
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Verifying:**

Run `self.crossOriginIsolated` in the DevTools console of the page: it must return `true`. In
Chromium, the **Application › Frames** panel also shows the isolation status and which resources
were blocked. Once isolated, `monitor.performance.memoryMeasurement` receives its first value
within about 20 seconds of `start()`.

---

### NetworkCollector

Intercepts `fetch` and `XMLHttpRequest` transparently. `stop()`/`destroy()`
restore the original `fetch`, `XMLHttpRequest.prototype.open`, and
`XMLHttpRequest.prototype.send` implementations.

Response bodies are never cloned or consumed for instrumentation. `payloadSize`
uses a valid `Content-Length` header when available; XHR can also use the
`byteLength` of an already-materialized `ArrayBuffer`. Otherwise it reports `0`
to represent an unknown size.

While the collector is running, `window5s` updates when requests enter and leave
the five-second window. A one-shot timer targets only the next expiration; it is
released by `stop()`, `destroy()`, or `clearLog()`.

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
  payloadSize: number     // known response bytes; 0 when unknown
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
  console.log(`Truncated commits: ${snap.truncatedCommits}`)

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

Traversal is iterative and visits at most 10,000 fibers per commit by default.
Set `maxFiberVisits` to another limit (`Infinity` disables the cap). Commits that
reach the cap increment `truncatedCommits`. Only components that actually rendered
in a commit are recorded: memoized components and subtrees that React skipped are
not counted. `duration` is the component's own render time, excluding its children,
so a slow child is not also blamed on its parents. Builds without React profiling
timings record nothing unless `includeZeroDuration: true` is configured, which
records renders with a duration of 0. Unmounts come from the
dedicated React DevTools hook rather than private Fiber flags. They remain in
`entries`/`onCommit`, but do not inflate render aggregates or `slowComponents`.

**Render entry shape:**

```ts
interface RenderEntry {
  component: string         // displayName or function.name
  duration: number          // ms of the component's own render, excluding children (0 without profiling)
  timestamp: number
  type: 'mount' | 'update' | 'unmount'
  commitId: number
}
```

> **Tip:** profiling duration is unavailable in standard production builds. Use
> `react-dom/profiling` for production measurements, or opt into zero-duration
> entries explicitly when only component/phase information is needed.

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

// Or record directly through the typed monitor facade
monitor.events.emit('checkout:complete', { total: 49.99 })

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

Event data is retained as a serializable copy. Malformed, circular, or oversized
data is recorded as `null`, while malformed events without a non-empty, bounded
string `label` are ignored. The defaults allow 256 characters per label, up to
5 nested object/array levels, and 16 KiB per payload; all limits can be
overridden in the collector config.

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
  navigationType: string       // 'navigate', 'reload', 'back-forward-cache', 'soft-navigation', …
  navigationId: number         // groups reports per page view
  navigationURL: string | null // URL of that page view, capped at 500 characters
  timestamp: number
  attribution?: ... // only with `attribution: true`, see below
}
```

`CLS` is unitless. `FCP`, `INP`, `LCP`, and `TTFB` are reported in milliseconds.

**Attribution (diagnostics).** Set `attribution: true` to learn *why* a metric
has its value: which element was the LCP, which interaction caused INP, which
element shifted most for CLS, and how each metric splits into phases.

```ts
const monitor = createMonitor({
  collectors: { webVitals: { attribution: true } },
})

monitor.webVitals.snapshot.subscribe(({ lcp, inp }) => {
  console.log('LCP element:', lcp?.attribution?.target)          // 'main > img.hero'
  console.log('LCP render delay:', lcp?.attribution?.elementRenderDelay)
  console.log('INP target:', inp?.attribution?.interactionTarget) // 'button#save'
  console.log('INP longest script:', inp?.attribution?.longestScript?.invoker)
})
```

| Metric | Attribution fields |
| --- | --- |
| `LCP` | `target`, `url`, `timeToFirstByte`, `resourceLoadDelay`, `resourceLoadDuration`, `elementRenderDelay` |
| `INP` | `interactionTarget`, `interactionType`, `interactionTime`, `inputDelay`, `processingDuration`, `presentationDelay`, `loadState`, `longestScript`, and script/style/paint totals |
| `CLS` | `largestShiftTarget`, `largestShiftTime`, `largestShiftValue`, `loadState` |
| `FCP` | `timeToFirstByte`, `firstByteToFCP`, `loadState` |
| `TTFB` | `waitingDuration`, `cacheDuration`, `dnsDuration`, `connectionDuration`, `requestDuration` |

The larger `web-vitals/attribution` build is loaded with a dynamic `import()`
only when a monitor enables the option, so bundles without it do not grow. The
snapshot keeps a serializable summary: selectors, URLs, and invokers are capped
at 500 characters, and performance entries and DOM nodes are never retained.
The default production report includes only the timings and categories; see
[PRIVACY.md](PRIVACY.md). `longestScript` requires Long Animation Frame support
(Chromium), and fields the browser cannot provide are `null`.

**Soft navigations (SPAs).** Set `softNavigations: true` to measure Web Vitals
for each route change of a single-page app, not only for the first page load.
Browsers that detect soft navigations (Chromium 151+) treat an interaction that
changes the URL and paints new content as a new page view: CLS and INP restart,
FCP and LCP measure the new content, and TTFB is 0.

```ts
const monitor = createMonitor({
  collectors: { webVitals: { softNavigations: true } },
})

monitor.webVitals.onMetric.subscribe((metric) => {
  if (metric) {
    console.log(metric.name, metric.value, metric.navigationType, metric.navigationURL)
    // 'LCP' 820 'soft-navigation' 'https://app.example.com/cart'
  }
})
```

The latest value of each metric (`snapshot.lcp`, `snapshot.inp`, …) belongs to
the newest navigation. The previous page's final CLS or INP can be reported
after the new page's first metrics; it is kept in `entries` with its own
`navigationId` but does not replace the latest value. Group `entries` by
`navigationId` to see every page view. Other browsers ignore the option and keep
reporting the first page load only. Enabling it also finalizes the first page's
metrics when the first soft navigation happens.

---

### ErrorCollector

Error collection is disabled by default because error messages and stacks can
include user data. Enable it explicitly by adding `errors` to `collectors`.

> **Note:** once `collectors` is set, only the collectors it lists are enabled.
> `collectors: ['errors']` or `collectors: { errors: true }` alone disables every
> other collector. List the defaults you still want alongside `errors`.

```ts
const monitor = createMonitor({
  collectors: {
    performance: true,
    network: true,
    react: true,
    events: true,
    webVitals: true,
    errors: {
      maxHistory: 20,
      sanitize: (details) => ({
        ...details,
        message: details.message.replace(/token=[^ ]+/g, 'token=[redacted]'),
        stack: null,
      }),
    },
  },
})

monitor.start()

monitor.errors.onError.subscribe((entry) => {
  if (!entry) return
  console.log(`[${entry.source}] ${entry.details.name}: ${entry.details.message}`)
})

try {
  await loadDashboard()
} catch (error) {
  monitor.errors.capture(error)
}
```

The collector listens for browser `error` and `unhandledrejection` events while
started, and `capture(error)` can be used manually in any environment.
Consecutive matching errors inside `dedupWindow` are folded into one entry with
an `occurrences` count. `clearLog()` removes retained entries but preserves
lifetime counters.

---

### ResourceCollector

Records how the page's own assets load — scripts, stylesheets, images, fonts,
media, and iframes — from the browser's Resource Timing API. `fetch` and
`XMLHttpRequest` calls are left to the NetworkCollector, and beacons are
ignored, so nothing is counted twice. Like errors, it is disabled by default:
add `resources` to `collectors` to enable it.

```ts
const monitor = createMonitor({
  collectors: ['performance', 'network', 'webVitals', 'resources'],
})

monitor.start() // also records the assets loaded before start()

monitor.resources.snapshot.subscribe(({ totals, byType, slowest }) => {
  console.log('Assets:', totals.count, 'bytes:', totals.transferSize)
  console.log('Cache hits:', totals.cacheHits, 'render-blocking:', totals.renderBlockingCount)
  console.log('Scripts:', byType.script.count, 'third-party:', totals.thirdPartyCount)
  console.log('Slowest:', slowest.map((r) => `${r.url} ${r.duration}ms`))
})
```

**Entry shape:**

```ts
interface ResourceEntry {
  url: string                 // capped at 2,048 characters
  type: 'script' | 'stylesheet' | 'image' | 'font' | 'media' | 'iframe' | 'other'
  initiatorType: string       // raw browser value: 'link', 'img', 'css', ...
  duration: number            // ms from fetch start to last byte
  transferSize: number        // bytes over the network, 0 when cached
  encodedBodySize: number
  decodedBodySize: number
  cache: 'hit' | 'miss' | 'unknown'
  renderBlocking: boolean | null
  status: number | null
  thirdParty: boolean
  timestamp: number           // when the resource finished loading
}
```

`totals` and `byType` are cumulative for the monitor's lifetime and do not
depend on `maxHistory`; `clearLog()` resets them. `slowest` keeps the
`slowestCount` (default 5) longest loads.

Cross-origin servers that do not send `Timing-Allow-Origin` hide sizes and
status, so those entries report `cache: 'unknown'`, zero sizes, and a `null`
status; their duration is still accurate. `renderBlocking` and `status` depend
on browser support and are `null` elsewhere. The first `start()` includes the
assets the browser buffered before it (the default buffer holds 250 entries);
after `stop()`, a new `start()` records only resources that finish after it.

---

### DeviceCollector

Reports the capabilities, browser, preferences, and connectivity of the device
running the page, useful for segmenting the other metrics by browser and device
class and for explaining failed requests. It is enabled by default.

```ts
monitor.start()

monitor.device.snapshot.subscribe(({ browser, hardwareConcurrency, connection, online, offlineCount }) => {
  console.log(`${browser.name ?? 'Unknown'} ${browser.majorVersion ?? ''} on ${browser.platform ?? 'n/a'}`)
  console.log('Logical processors:', hardwareConcurrency ?? 'n/a')
  console.log('Connection:', connection.effectiveType ?? 'n/a')
  console.log(online === false ? 'Offline' : 'Online', `(went offline ${offlineCount} times)`)
})
```

```ts
interface DeviceSnapshot {
  hardwareConcurrency: number | null // navigator.hardwareConcurrency
  deviceMemory: number | null        // navigator.deviceMemory in GB (Chromium only)
  online: boolean | null             // navigator.onLine, updated on online/offline events
  offlineCount: number               // offline transitions while started
  browser: {
    name: string | null              // 'Chrome', 'Edge', 'Firefox', 'Safari', 'Opera', 'Samsung Internet'
    majorVersion: number | null
    mobile: boolean | null
    platform: string | null          // 'Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Chrome OS'
  }
  language: string | null            // navigator.language, e.g. 'es-ES'
  timeZone: string | null            // IANA time zone, e.g. 'Europe/Madrid'
  screen: { width: number | null; height: number | null; pixelRatio: number | null }
  viewport: { width: number | null; height: number | null }
  connection: {                      // navigator.connection (Chromium only)
    effectiveType: string | null     // 'slow-2g' | '2g' | '3g' | '4g'
    rtt: number | null               // ms
    downlink: number | null          // Mbps
    saveData: boolean | null
  }
  colorScheme: 'light' | 'dark' | null // prefers-color-scheme
  reducedMotion: boolean | null      // prefers-reduced-motion
}
```

`browser` comes from User-Agent Client Hints (`navigator.userAgentData`) where
available and otherwise from the User-Agent string. Only the parsed fields are
kept; the User-Agent string itself is never stored. `hardwareConcurrency`,
`deviceMemory`, `browser`, `language`, and `timeZone` are read once on `start()`.
`screen` and `viewport` follow `resize` events (at most once per animation frame),
`connection` follows the Network Information `change` event, and `colorScheme` and
`reducedMotion` follow their media queries. `online` follows the browser's
`online` and `offline` events; `true` means only that a network is reachable, not
that the internet or your servers are. `offlineCount` counts transitions to
offline while the collector is started, so a page that starts offline reports
`0`. Values are `null` before `start()`, outside browsers, and where the browser
does not expose them. `stop()` stops listening and keeps the values already read.

The default reporter sends `hardwareConcurrency`, `online`, `offlineCount`, and the
browser `name`, `majorVersion`, and `mobile` flag. The platform, language, time
zone, sizes, connection, and preferences stay in memory: combined, they narrow
down a user. Use `report.transform` to send any of them.

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
  console.log('  Errors:', snap.errors.totalErrors)
  console.log('  Assets:', snap.resources.totals.count)
  console.log('  CPU cores:', snap.device.hardwareConcurrency)
  console.log('  Browser:', snap.device.browser.name, snap.device.browser.majorVersion)
  console.log('  Online:', snap.device.online)
})

// Or read synchronously
const snap = monitor.getSnapshot()
```

---

## React integration

```tsx
import { createMonitor } from 'monitor-api'
import { useSignal, usePerformance, useNetwork, useReact, useEvents, useErrors, useResources, useWebVitals, useDevice } from 'monitor-api/react'

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

function ErrorPanel() {
  const { totalErrors, entries } = useErrors(monitor)
  return (
    <div>
      <p>Total errors: {totalErrors}</p>
      <ul>
        {entries.slice(-5).map(e => (
          <li key={e.id}>{e.details.name}: {e.details.message}</li>
        ))}
      </ul>
    </div>
  )
}

function DeviceBadge() {
  const cores = useDevice(monitor, (snap) => snap.hardwareConcurrency)
  return <span>{cores ?? 'n/a'} cores</span>
}
```

### Selecting part of a snapshot

Collector hooks re-render on every change to their snapshot: `usePerformance`
updates once per second for FPS, and `useMonitor` updates whenever any collector
does. Pass a selector to subscribe to just what the component shows. It then
re-renders only when the selected value changes, compared with `Object.is`:

```tsx
import { shallowEqual, useMonitor, useNetwork, usePerformance, useSignal } from 'monitor-api/react'

function FpsBadge() {
  const fps = usePerformance(monitor, (snap) => snap.fps)
  return <span>{fps} FPS</span>
}

function LcpBadge() {
  // Ignores FPS ticks, requests, renders, and every other collector update.
  const lcp = useMonitor(monitor, (snap) => snap.webVitals.lcp?.value ?? null)
  return <span>LCP: {lcp ?? 'n/a'}</span>
}

function NetworkHealth() {
  // A selector that builds an object needs shallowEqual, or it would re-render every time.
  const { count, errorRate } = useNetwork(
    monitor,
    (snap) => ({ count: snap.window5s.count, errorRate: snap.window5s.errorRate }),
    shallowEqual,
  )
  return <span>{count} requests, {(errorRate * 100).toFixed(0)}% errors</span>
}

// The same selector and equality arguments work on any signal.
const slowCount = useSignal(monitor.react.snapshot, (snap) => snap.slowComponents.length)
```

Selectors can be inline functions; an equal selection keeps its previous
reference across renders. The third argument accepts any
`(previous, next) => boolean` comparison, and `shallowEqual` compares objects
and arrays one level deep.

---

## Production mode

```ts
const monitor = createMonitor({
  env: 'production',
  maxHistory: 60,
  report: {
    endpoint: 'https://my-api.com/metrics',
    interval: 30_000,  // send every 30s
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5_000,    // per attempt; default: interval, capped at 30s; false disables
    retry: {
      maxAttempts: 3,
      delay: (failedAttempt) => failedAttempt * 1_000,
    },
    transform: (snap) => ({
      fps: snap.performance.fps,
      memory: snap.performance.memory?.percent ?? null,
      errorRate: snap.network.window5s.errorRate,
      errors: snap.errors.totalErrors,
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
ignored after the optional retry policy is exhausted, so monitoring never breaks
the application. Errors from `transform`, serialization, timeout, and transport
setup are contained as well. The reporter keeps at most one delivery in flight
and skips interval ticks while it is pending, so each attempt times out after
`interval` (at most 30 seconds) unless `timeout` says otherwise. Authentication can be supplied
through `headers`. A custom `transport({ endpoint, payload, body, headers,
keepalive, signal })` can replace `fetch`; without either transport, the reporter does not
start.

Without `transform`, the reporter sends a bounded, privacy-safe allowlist: the
snapshot timestamp; current FPS, memory percentage, measured page memory total,
long-task and CLS aggregates;
the five-second network aggregate; React commit counts; the retained custom-event
count; retained error counters; Web Vital values, deltas, and ratings; and the
logical processor count, online status, and offline transition count. It
does not send request URLs, error messages or stacks, histories, event labels or
data, component names, Web Vital IDs, or navigation types. The reporter endpoint
is also excluded from NetworkCollector, while any configured network filter
continues to apply.

When the page is hidden or unloaded (`visibilitychange` to `hidden`, or
`pagehide`), the reporter sends one final report so data captured since the
last interval is not lost. That report is fire-and-forget: a single attempt with
no timeout or retries, not cancelled by `stop()`, and sent even while an
interval delivery is still pending. The default transport posts it with
`fetch(..., { keepalive: true })`, which keeps authentication `headers` and is
limited by browsers to about 64 KiB in flight. Custom transports receive
`keepalive: true` on that request and should use a mechanism that outlives the
page, such as `fetch` with `keepalive` or `navigator.sendBeacon`. Set
`flushOnHide: false` to disable it.

`monitor.reporter.snapshot` exposes delivery diagnostics such as `sent`,
`failed`, `dropped`, `retries`, `cancelled`, `skipped`, and `lastFailure`.
`monitor.reporter.flush()` triggers an immediate best-effort delivery while the
monitor is started.

`transform` is an explicit opt-in to a custom payload and receives the full
snapshot, including potentially sensitive application data. Redact secrets and
bound the returned payload before enabling it in production.

See [PRIVACY.md](PRIVACY.md) for the field-by-field data inventory, retention
behavior, reporting boundary, and deployment checklist.

---

## Collector config

```ts
createMonitor({
  // Enable only specific collectors
  collectors: ['performance', 'network', 'errors'],

  // Or configure each individually. Collectors missing from the object are
  // disabled, so list every collector you want to keep.
  collectors: {
    performance: {
      memoryMeasurementInterval: 300_000, // default 5 min mean; false disables
    },
    network: { filter: (url) => !url.includes('/analytics') },
    react: {
      slowThreshold: 8,            // default 16ms
      maxFiberVisits: 10_000,      // default 10,000
      includeZeroDuration: false,  // default false; record renders without profiling timings
    },
    events: {
      maxLabelLength: 256,          // default 256 characters
      maxDataDepth: 5,             // default 5 nested object/array levels
      maxDataBytes: 16 * 1024,     // default 16 KiB of UTF-8 JSON
    },
    errors: {
      dedupWindow: 1000,            // default 1000ms
      sanitize: (details) => details,
    },
    resources: {
      filter: (url) => !url.includes('/analytics'),
      slowestCount: 5,             // default 5
    },
    webVitals: {
      reportAllChanges: true,  // default true
      attribution: false,      // default false; diagnostic breakdown per metric
      softNavigations: false,  // default false; report metrics per SPA route change
    },
    device: true,
  },

  maxHistory: 60,   // data points per metric
  sampleRate: 0.25, // one sampling decision per monitor instance
})
```

Collectors that are disabled—or belong to a sampled-out monitor—use inert
facades with empty snapshots. Their concrete collectors are not constructed and
their signals are not dependencies of the combined snapshot.

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
npm run test:browser
npm run build
npm run docs:build
npm run bench
```

- `demo` builds the package and serves the live browser demo at `http://127.0.0.1:4177`. Besides network, events, errors and reporting, it has buttons to block the main thread (a long animation frame attributed to the click handler) and to soft navigate between views (Web Vitals per page view in Chromium 151+).
- `test:browser` builds the package and runs the Playwright demo smoke test in Chromium, Firefox, and WebKit.
- The supported feature matrix and fallbacks are documented in [COMPATIBILITY.md](COMPATIBILITY.md).
- `docs:build` generates TypeDoc HTML in `docs/`.
- `bench` builds the package and runs runtime benchmarks from `bench/`.
- Benchmark notes are tracked in `BENCH.md`.

---

## License

MIT — see [LICENSE](LICENSE).

---

Repository: [github.com/ElJijuna/monitor-api](https://github.com/ElJijuna/monitor-api)
