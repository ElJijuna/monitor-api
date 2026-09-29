# Benchmarks

Benchmark results are intended to catch large runtime regressions, not to
provide absolute performance guarantees. They run against the built package in
`dist/` using Node's `perf_hooks` timer.

## Environment

- Command: `npm run bench`
- Runtime: Node.js 26.3.1 on macOS 26.6.2 (Apple silicon)
- Build target: published `dist/` output
- Warmup per case: 100 ms (5.5 s for the network collector, see below)
- Samples per case: 5 × 300 ms; the table reports the median sample
- Spread: half the range between the slowest and fastest sample, relative to
  the median. Differences smaller than the spread are noise
- The runner yields to the event loop before each sample, outside the measured
  time, so garbage kept alive until the end of a job (such as `WeakRef` targets)
  is released between samples
- Async cases (`fetch`, reporter `flush`) await every operation, so they include
  promise and microtask costs
- React fibers carry the `PerformedWork` flag, so every fiber counts as a real
  render
- Batch size: 100 operations

## Results

Median of three runs.

| Benchmark | Throughput | Average time | Spread |
| --- | ---: | ---: | ---: |
| `createMonitor + destroy` | 40,384 ops/s | 24.76 us | ±31% |
| `emitMonitorEvent` | 205,182 ops/s | 4.87 us | ±1–28% |
| `Web Vitals subscribe + destroy` | 123,522 ops/s | 8.10 us | ±14–21% |
| `fetch baseline (unpatched)` | 38,227,735 ops/s | 26.16 ns | ±6% |
| `fetch through the network collector` | 12,586 ops/s | 79.45 us | ±9% |
| `errors.capture` | 1,972,534 ops/s | 507 ns | ±1–21% |
| `reporter flush (default payload)` | 703,745 ops/s | 1.42 us | ±1% |
| `reporter flush (32 KB transform)` | 24,564 ops/s | 40.71 us | ±0.4% |
| `React commit with 50 fibers` | 89,119 ops/s | 11.22 us | ±4–7% |
| `React commit with 1,000 deep fibers` | 13,309 ops/s | 75.14 us | ±2–3% |
| `React commit with 1,000 wide fibers` | 13,095 ops/s | 76.36 us | ±1–8% |
| `React commit with 50 fibers, 5,000 history` | 12,200 ops/s | 81.97 us | ±12% |

## Interpretation

`createMonitor + destroy` is fast enough for normal app startup. It uses the
default collectors, which exclude `errors` and `resources`. Monitor instances
are expected to be created once per app or test setup, not inside hot render
paths. The cost mainly comes from creating collector signals and the combined
computed snapshot. Its spread is high because each run creates and releases
many short-lived signals.

`emitMonitorEvent` is comfortably cheap for user-flow and business events. The
benchmark includes browser-like `CustomEvent` dispatch through an `EventTarget`,
so it measures the public event path rather than only the private collector
method.

`Web Vitals subscribe + destroy` measures monitor integration overhead after the
shared observers have been installed: creating a monitor, attaching it to the
shared channel, detaching it, and destroying its signals. It does not measure the
browser's internal metric calculation, which belongs to the platform and the
`web-vitals` package.

`fetch through the network collector` measures a request made through the
patched `fetch` against a stub that resolves at once, so nearly all of its time
is collector overhead. The baseline row is the same stub without the patch. The
collector aggregates the last 5 seconds in per-millisecond buckets, and each
request scans all of them. Its cost per request therefore grows with the number
of distinct milliseconds that saw traffic in the last 5 seconds, up to 5,001
buckets. The case warms up for 5.5 s so it measures that full-window steady
state; with 300 ms of warmup the same case varied by more than ±100%. At the
request rates of a normal page the window holds far fewer buckets, so the real
overhead is much lower. The benchmark shows the worst case.

`errors.capture` rotates 20 distinct errors, so it measures the recording path
without deduplication.

`reporter flush` measures one complete delivery through a no-op transport:
building the payload, serializing it, checking its UTF-8 size against
`maxPayloadBytes`, and running the delivery state machine. The default payload
is about 1.5 KB. The 32 KB case uses a `transform` with multi-byte text, and
serializing plus encoding that body dominates its time.

The React cases cover a normal 50-fiber commit plus deep and wide 1,000-fiber
trees. The collector walks each tree, creates render entries, trims retained
history, and derives per-component statistics. Commit counters and entries live
in one signal, so each commit recomputes the snapshot once, and the derived
statistics are reused when a commit adds no render entries. The 5,000-history
case runs the same 50-fiber commit with `maxHistory: 5000`. It is about 7 times
slower, because each commit copies the retained entries and rebuilds
`byComponent` from all of them.

## Potential Improvements

**Network window aggregation.** This is the only case whose cost grows with
load. The collector could keep running totals for the 5-second window, adding
each request and subtracting buckets as they expire. It could also rely on the
buckets being stored in time order, pruning from the oldest and scheduling the
next expiry from the first bucket instead of scanning them all. That would make
each request constant time on average.

**Incremental React statistics.** `ReactCollector.byComponent` and
`EventCollector.byLabel` are derived from retained entries to keep runtime
memory bounded. That is the right default for correctness and safety, but the
5,000-history case shows the cost grows with `maxHistory`. The collectors could
maintain aggregate maps incrementally, subtracting entries that fall out of
`maxHistory`.

**Report size check.** The reporter encodes the whole body with `TextEncoder`
only to compare its byte length with `maxPayloadBytes`. A check that decides
from the string length when possible, and counts bytes without allocating
otherwise, would reduce the cost of the 32 KB case.

For event-heavy applications, a direct `monitor.events.emit(...)` path is already
available and avoids DOM event dispatch. `emitMonitorEvent(...)` should remain
the ergonomic cross-tree API, while direct collector emission can be used in hot
instrumentation paths.

For Web Vitals, monitor instances share the standard metric observers by
`reportAllChanges` mode. Starting and destroying additional instances only adds
or removes a subscriber, avoiding repeated platform observers in apps with more
than one monitor.

React renders without profiling timings, as in standard production builds, are
already skipped by default. `includeZeroDuration: true` records them with a
duration of 0.
