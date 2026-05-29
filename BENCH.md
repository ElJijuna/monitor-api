# Benchmarks

Benchmark results are intended to catch large runtime regressions, not to
provide absolute performance guarantees. They run against the built package in
`dist/` using Node's `perf_hooks` timer.

## Environment

- Command: `npm run bench`
- Runtime: Node.js in the local development container
- Build target: published `dist/` output
- Warmup per case: 100 ms
- Sample per case: 500 ms
- Batch size: 100 operations

## Results

| Benchmark | Throughput | Average time |
| --- | ---: | ---: |
| `createMonitor + destroy` | 12,559 ops/s | 79.62 us |
| `emitMonitorEvent` | 71,957 ops/s | 13.9 us |
| `React commit with 50 fibers` | 7,178 ops/s | 139 us |

## Interpretation

`createMonitor + destroy` is fast enough for normal app startup. Monitor
instances are expected to be created once per app or test setup, not inside hot
render paths. The current cost mainly comes from creating collector signals and
the combined computed snapshot.

`emitMonitorEvent` is comfortably cheap for user-flow and business events. The
benchmark includes browser-like `CustomEvent` dispatch through an `EventTarget`,
so it measures the public event path rather than only the private collector
method.

`React commit with 50 fibers` is the most expensive benchmark, which is expected.
The collector walks the Fiber tree, creates render entries, trims retained
history, and derives per-component statistics from the retained entries. At
roughly 139 us per 50-component commit in this synthetic run, the overhead is
reasonable for a runtime monitor.

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
