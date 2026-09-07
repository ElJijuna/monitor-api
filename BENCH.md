# Benchmarks

Benchmark results are intended to catch large runtime regressions, not to
provide absolute performance guarantees. They run against the built package in
`dist/` using Node's `perf_hooks` timer.

## Environment

- Command: `npm run bench`
- Runtime: Node.js 26.3.1 on macOS 26.6.2 (Apple silicon)
- Build target: published `dist/` output
- Warmup per case: 100 ms
- Samples per case: 5 × 300 ms; table reports the median
- Batch size: 100 operations

## Results

| Benchmark | Throughput | Average time |
| --- | ---: | ---: |
| `createMonitor + destroy` | 45,318 ops/s | 22.07 us |
| `emitMonitorEvent` | 190,914 ops/s | 5.24 us |
| `Web Vitals subscribe + destroy` | 87,436 ops/s | 11.44 us |
| `React commit with 50 fibers` | 17,103 ops/s | 58.47 us |
| `React commit with 1,000 deep fibers` | 1,704 ops/s | 587 us |
| `React commit with 1,000 wide fibers` | 1,291 ops/s | 775 us |

## Interpretation

`createMonitor + destroy` is fast enough for normal app startup. Monitor
instances are expected to be created once per app or test setup, not inside hot
render paths. The current cost mainly comes from creating collector signals and
the combined computed snapshot.

`emitMonitorEvent` is comfortably cheap for user-flow and business events. The
benchmark includes browser-like `CustomEvent` dispatch through an `EventTarget`,
so it measures the public event path rather than only the private collector
method.

`Web Vitals subscribe + destroy` measures monitor integration overhead after the
shared observers have been installed: creating a monitor, attaching it to the
shared channel, detaching it, and destroying its signals. It does not measure the
browser's internal metric calculation, which belongs to the platform and the
`web-vitals` package.

The React cases cover a normal 50-fiber commit plus deep and wide 1,000-fiber
trees. The collector walks each tree, creates render entries, trims retained
history, and derives per-component statistics. The wide case is slower because
it retains and aggregates many sibling component names.

## Potential Improvements

No urgent optimization is required based on these numbers.

The main future improvement would be to avoid recomputing aggregate maps from
retained history on every snapshot. `ReactCollector.byComponent` and
`EventCollector.byLabel` are currently derived from retained entries to keep
runtime memory bounded. That is the right default for correctness and safety.
If benchmarks show this becoming expensive in larger histories, we can maintain
incremental aggregate maps while subtracting entries that fall out of
`maxHistory`.

For React-heavy applications, another possible improvement is to make the React
collector skip entries with `actualDuration === 0` behind a config flag. That
would reduce noise and allocation cost in production builds that do not expose
profiling durations, but it would change snapshot semantics and should be added
only as an explicit option.

For event-heavy applications, a direct `monitor.events.emit(...)` path is already
available and avoids DOM event dispatch. `emitMonitorEvent(...)` should remain
the ergonomic cross-tree API, while direct collector emission can be used in hot
instrumentation paths.

For Web Vitals, monitor instances now share the standard metric observers by
`reportAllChanges` mode. Starting and destroying additional instances only adds
or removes a subscriber, avoiding repeated platform observers in apps with more
than one monitor.
