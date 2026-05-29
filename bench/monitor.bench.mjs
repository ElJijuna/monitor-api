import { performance } from 'node:perf_hooks'
import { createMonitor, emitMonitorEvent } from '../dist/index.js'

const WARMUP_MS = 100
const SAMPLE_MS = 500
const BATCH_SIZE = 100

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type, init)
      this.detail = init.detail
    }
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)
}

function formatDuration(value) {
  if (value < 0.001) return `${formatNumber(value * 1_000_000)} ns`
  if (value < 1) return `${formatNumber(value * 1_000)} us`
  return `${formatNumber(value)} ms`
}

function runLoop(fn, durationMs) {
  let iterations = 0
  const start = performance.now()
  let elapsed = 0

  do {
    for (let i = 0; i < BATCH_SIZE; i++) fn()
    iterations += BATCH_SIZE
    elapsed = performance.now() - start
  } while (elapsed < durationMs)

  return { elapsed, iterations }
}

function bench(name, fn) {
  runLoop(fn, WARMUP_MS)
  const { elapsed, iterations } = runLoop(fn, SAMPLE_MS)
  const hz = iterations / (elapsed / 1000)
  const avgMs = elapsed / iterations

  return { name, hz, avgMs, iterations }
}

function print(results) {
  const longestName = Math.max(...results.map((result) => result.name.length))

  console.log('\nmonitor-api benchmarks\n')
  for (const result of results) {
    console.log(
      `${result.name.padEnd(longestName)}  ${formatNumber(result.hz).padStart(12)} ops/s  ${formatDuration(result.avgMs).padStart(10)} avg`,
    )
  }
  console.log('')
}

function withEventWindow() {
  globalThis.window = new EventTarget()
}

function withReactWindow() {
  globalThis.window = {}
}

function fiberFor(type, actualDuration = 1) {
  return {
    tag: 0,
    type,
    alternate: {},
    child: null,
    sibling: null,
    flags: 0,
    actualDuration,
  }
}

function fiberList(count) {
  const root = fiberFor(function Root() {}, 1)
  let current = root

  for (let i = 0; i < count; i++) {
    const component = Object.defineProperty(function Component() {}, 'name', {
      value: `BenchComponent${i}`,
    })
    current.child = fiberFor(component, i % 5)
    current = current.child
  }

  return root
}

function runBenchmarks() {
  const results = []

  results.push(bench('createMonitor + destroy', () => {
    const monitor = createMonitor()
    monitor.destroy()
  }))

  withEventWindow()
  const eventMonitor = createMonitor({
    maxHistory: 200,
    collectors: { events: true },
  })
  eventMonitor.start()
  let eventCount = 0
  results.push(bench('emitMonitorEvent', () => {
    emitMonitorEvent(`bench:${eventCount++ % 20}`, { index: eventCount })
  }))
  eventMonitor.destroy()

  withReactWindow()
  const reactMonitor = createMonitor({
    maxHistory: 500,
    collectors: { react: true },
  })
  reactMonitor.start()
  const hook = globalThis.window.__REACT_DEVTOOLS_GLOBAL_HOOK__
  const root = { current: fiberList(50) }
  results.push(bench('React commit with 50 fibers', () => {
    hook.onCommitFiberRoot(1, root)
  }))
  reactMonitor.destroy()

  Reflect.deleteProperty(globalThis, 'window')

  print(results)
}

runBenchmarks()
