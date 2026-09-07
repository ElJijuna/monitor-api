# Privacy guide

`monitor-api` collects telemetry inside the page where it runs. It does not send
data until production reporting is configured and the monitor is started. The
library has no cookies, storage, fingerprinting, advertising identifiers, or
third-party analytics endpoint.

## What each collector can observe

| Collector | Data kept in memory | Data sent by the default reporter |
| --- | --- | --- |
| Performance | FPS, heap percentage when available, long-task and CLS aggregates | Current values and aggregates |
| Network | Request URL, method, status, duration, type, and timestamp | Five-second aggregate only |
| React | Component names, render durations, commits, and derived counts | Commit, truncation, and slow-render counts only |
| Events | Application labels and serializable custom payloads | Retained event count only |
| Errors | Message, stack, source location, type, and occurrence count | Error counters only |
| Web Vitals | Values, deltas, ratings, IDs, navigation types, and timestamps | Values, deltas, and ratings only |

All histories are held in JavaScript memory and bounded by `maxHistory`. Calling
`clearLog()` removes a collector's retained history. Calling `destroy()` stops
the instance and releases its subscriptions. The package does not persist data
across page loads.

## Reporting boundary

Reporting runs only when `env: 'production'` and `report.endpoint` or a custom
transport is provided. The built-in payload is an allowlist. It excludes request
URLs, headers and bodies; event labels and payloads; component names; error
messages and stacks; Web Vital IDs and navigation types; and all retained
histories. The report endpoint is excluded from network instrumentation.

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
