# Privacy guide

`monitor-api` collects telemetry inside the page where it runs. It does not send
data until production reporting is configured and the monitor is started. The
library has no cookies, storage, fingerprinting, advertising identifiers, or
third-party analytics endpoint.

## What each collector can observe

| Collector | Data kept in memory | Data sent by the default reporter |
| --- | --- | --- |
| Performance | FPS, heap percentage when available, long-task and CLS aggregates; recent long animation frames with phase timings and, for their five longest scripts, the invoker, invoker type, source URL, and function name | Current values and aggregates; long animation frame counters only (count, total and maximum blocking duration) |
| Network | Request URL, method, status, duration, type, and timestamp | Five-second aggregate only |
| React | Component names, render durations, commits, and derived counts | Commit, truncation, and slow-render counts only |
| Events | Application labels and serializable custom payloads | Retained event count only |
| Errors | Message, stack, source location, type, and occurrence count | Error counters only |
| Resources (opt-in) | Asset URLs, types, durations, sizes, cache state, status, and origin | Totals and per-type aggregates only |
| Web Vitals | Values, deltas, ratings, IDs, navigation types, navigation IDs, the URL of the page view each metric belongs to (including SPA routes with `softNavigations`), and timestamps; with `attribution`, also CSS selectors of the LCP, INP, and CLS elements, the LCP resource URL, the longest script's URL and invoker, and phase timings | Values, deltas, and ratings; with `attribution`, phase timings, interaction type, load state, and script invoker type, but no selectors, URLs, or invokers |

All histories are held in JavaScript memory and bounded by `maxHistory`. Calling
`clearLog()` removes a collector's retained history. Calling `destroy()` stops
the instance and releases its subscriptions. The package does not persist data
across page loads.

## Reporting boundary

Reporting runs only when `env: 'production'` and `report.endpoint` or a custom
transport is provided. The built-in payload is an allowlist. It excludes request
URLs, headers and bodies; resource URLs; event labels and payloads; component names; error
messages and stacks; Web Vital IDs, navigation types, navigation IDs, and navigation URLs; Web Vitals attribution
selectors, URLs, and script invokers; long animation frame entries and their script
URLs, invokers, and function names; and all retained histories. The report endpoint is excluded from network instrumentation.

`report.transform` receives the complete in-memory snapshot and replaces that
allowlist. Treat it as a data-export boundary. Remove credentials, tokens,
personal data, query strings, route parameters, free-form text, and stable user
identifiers before returning a payload.

```ts
const monitor = createMonitor({
  env: 'production',
  collectors: ['performance', 'network', 'webVitals'],
  maxHistory: 30,
  report: {
    endpoint: '/internal/telemetry',
    transform: (snapshot) => ({
      fps: snapshot.performance.fps,
      requestHealth: snapshot.network.window5s,
      lcp: snapshot.webVitals.lcp?.value ?? null,
    }),
  },
})
```

## Deployment checklist

- Enable only the collectors required for a stated product or operational goal.
- Keep `maxHistory` and the reporting interval as small as the goal permits.
- Apply consent and notice requirements before calling `start()` where required.
- Keep telemetry endpoints first-party or document every recipient and retention period.
- Use `network.filter`, event payload limits, and error `sanitize` to reduce data before retention.
- Review every `transform` change as a privacy-sensitive API change.
- Enforce authentication, access control, retention, and deletion on the receiving service.

This guide describes library behavior and engineering controls. The application
owner remains responsible for its privacy notice, lawful basis, consent choices,
data-subject requests, and regional requirements.
