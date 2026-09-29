# Roadmap

Browser APIs that could complement the current collectors. Every item must follow
the existing collector rules: feature-detect the API, keep `null` or empty values
when it is absent, stay a no-op on the server, and expose state through signals
and a React hook.

Items are grouped by area and ordered by priority within each group.

## Memory

- [ ] **`performance.measureUserAgentSpecificMemory()`**: accurate page memory
  broken down by type (JavaScript, DOM) and by frame or worker. It replaces the
  deprecated, coarsely rounded `performance.memory`.
  - Chromium 89+ only, and only when the page is cross-origin isolated
    (`crossOriginIsolated === true`, which requires the COOP and COEP headers).
  - Returns a Promise that can take several seconds to resolve, so it cannot share
    the synchronous memory interval.
  - Fall back to `performance.memory` when it is unavailable, and record which
    source produced each value.
- [ ] **`navigator.deviceMemory`**: approximate device RAM in GB (0.25–8). Chromium
  only. Useful for segmenting metrics by device class.
- [ ] **`navigator.storage.estimate()`**: storage `usage` and `quota` (IndexedDB,
  Cache Storage, and similar). Supported by all modern engines; Chromium also
  returns `usageDetails`.

## Device and CPU

- [ ] **Compute Pressure API** (`new PressureObserver(cb).observe('cpu')`): CPU
  pressure state (`nominal`, `fair`, `serious`, `critical`). Chromium 125+.
  Useful for correlating FPS drops and long tasks with system load.
- [ ] **`navigator.hardwareConcurrency`**: logical CPU core count. Supported by all
  engines.
- [ ] **Battery Status API** (`navigator.getBattery()`): charge level and charging
  state. Chromium only.

## Network

- [ ] **Network Information API** (`navigator.connection`): `effectiveType`,
  `downlink`, `rtt`, `saveData`, and the `change` event. Chromium only. Natural
  context for `NetworkCollector`.
- [ ] **Online status** (`navigator.onLine` plus the `online` and `offline`
  events): supported by all engines.
- [ ] **Latency across a frozen page**: `NetworkCollector` measures fetch and XHR
  `latency` with `performance.now()`, which keeps advancing while the page is
  frozen or in the back/forward cache. A request that starts before `freeze` and
  settles after `resume` reports the frozen time as latency. Flag these requests
  (for example with a `suspended` field) or exclude them from latency
  aggregates.

## Performance timeline

Entry types not yet observed. `WebVitalsCollector` already covers INP, FCP, and
TTFB through `web-vitals`, so these items target the raw entries and the fields
those metrics do not expose.

- [ ] **`navigation`**: full navigation timing breakdown (DNS, TCP, TLS, request,
  response, `domContentLoaded`, `load`, redirect count, navigation type).
- [ ] **`event`**: per-interaction latency for every interaction, not only the one
  that sets INP.
- [ ] **`paint`**: first paint (FP) alongside FCP.
- [ ] **`element`**: Element Timing for elements marked with the `elementtiming`
  attribute.
- [ ] **`visibility-state`**: buffered history of visibility changes, including
  those that happened before the monitor started.

## Page lifecycle

- [x] **Pause sampling while hidden**: FPS and memory sampling pause while
  `document.visibilityState === 'hidden'`, so histories only reflect visible time.
- [x] **`freeze` and `resume` events**: `freeze` pauses sampling like `hidden`;
  `resume` and `pageshow` re-read the visibility state, so sampling restarts after a
  back/forward cache restore even when `visibilitychange` is not fired.

## Errors and reporting

- [ ] **Reporting API** (`ReportingObserver`): deprecation, intervention, and crash
  reports from the browser. Fits alongside `ErrorCollector`.

## Suggested order

1. Memory: add `measureUserAgentSpecificMemory()` with a fallback to
   `performance.memory`, and add `deviceMemory` as context.
2. A new device and network collector covering `deviceMemory`,
   `hardwareConcurrency`, `navigator.connection`, online status, and
   `storage.estimate()`. These APIs are cheap and add context to every other
   metric.
3. `navigation` timing and the Reporting API.
4. Compute Pressure, Battery, and the remaining performance entry types.

Update [COMPATIBILITY.md](COMPATIBILITY.md) as each item ships.
