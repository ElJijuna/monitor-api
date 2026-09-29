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
| `emitMonitorEvent` | 652,404 ops/s | 1.53 us | ±1–31% |
| `Web Vitals subscribe + destroy` | 123,522 ops/s | 8.10 us | ±14–21% |
| `fetch baseline (unpatched)` | 38,227,735 ops/s | 26.16 ns | ±6% |
| `fetch through the network collector` | 1,166,950 ops/s | 857 ns | ±1–4% |
| `errors.capture` | 1,972,534 ops/s | 507 ns | ±1–21% |
| `reporter flush (default payload)` | 805,604 ops/s | 1.24 us | ±0.4% |
| `reporter flush (32 KB transform)` | 24,393 ops/s | 41.00 us | ±0.3–4.5% |
| `React commit with 50 fibers` | 138,638 ops/s | 7.21 us | ±2–4% |
| `React commit with 1,000 deep fibers` | 11,161 ops/s | 89.60 us | ±1–2% |
| `React commit with 1,000 wide fibers` | 10,946 ops/s | 91.36 us | ±1–5% |
| `React commit with 50 fibers, 5,000 history` | 81,192 ops/s | 12.32 us | ±2–7% |

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
collector aggregates the last 5 seconds in per-millisecond buckets, held in a
time-ordered queue with running totals: each request adds to the newest bucket
and expires buckets from the oldest end, so its cost does not depend on how many
buckets are live. The case warms up for 5.5 s so it measures the steady state,
where buckets expire on every request. An earlier implementation scanned every
bucket on each request and measured 79 us per request in this case.

`errors.capture` rotates 20 distinct errors, so it measures the recording path
without deduplication.

`reporter flush` measures one complete delivery through a no-op transport:
building the payload, serializing it, checking its UTF-8 size against
`maxPayloadBytes`, and running the delivery state machine. The default payload
is about 1.5 KB. The size check decides from the string length when it can: a
body of at most a third of `maxPayloadBytes` in UTF-16 units always fits, and one
longer than `maxPayloadBytes` never does. Only bodies in between are encoded,
with the native `TextEncoder`. Skipping that encoding made the default-payload
case about 14% faster. The 32 KB case falls in the ambiguous range, so it is
still encoded, and serializing plus encoding its multi-byte body dominates its
time.

The React cases cover a normal 50-fiber commit plus deep and wide 1,000-fiber
trees. The collector walks each tree, creates render entries, trims retained
history, and derives per-component statistics. Commit counters and entries live
in one signal, so each commit recomputes the snapshot once.

`byComponent`, `slowComponents` and the events collector's `byLabel` are updated
from what each change appended to and dropped from the retained history, instead
of being recomputed from all of it. A commit therefore costs time proportional
to its own entries and the number of components, not to `maxHistory`: the
5,000-history case now runs within a factor of two of the 500-history one, where
it used to be seven times slower. Components a commit does not touch keep the
same stats object, so selectors on them stay stable. Durations are summed in
integer tenths of a millisecond, which also removes floating-point noise such as
`10.100000000000001` from `totalDuration`.

The 1,000-fiber cases are the exception. Each commit adds more entries than
`maxHistory: 500` retains, so the history is replaced entirely and the
statistics are rebuilt from scratch. That rebuild keeps the running totals the
incremental path needs, which made these two cases about 15% slower than the
previous full recomputation. Commits larger than the whole retained history are
rare in practice, and every other case got faster: `emitMonitorEvent` about 3
times, the 50-fiber commit about 1.5 times, and the 5,000-history commit about
6.7 times.

## Potential Improvements

**History copies.** Each change still copies the retained history array, so
that React sees a new reference. A ring buffer that shares storage between
snapshots could avoid the copy, but it must keep exposing new, immutable arrays.

**Report size check.** Bodies in the ambiguous length range are still encoded
in full only to read their byte length. `TextEncoder.encodeInto` with a reused
buffer is about twice as fast, but it would keep a buffer of `maxPayloadBytes`
alive for the page's lifetime. Counting bytes in JavaScript is not an option:
it measured 5 to 25 times slower than the native encoder.

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
