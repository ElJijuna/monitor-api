import { createMonitor } from '../src/index'

const originalMemoryDescriptor = Object.getOwnPropertyDescriptor(globalThis.performance, 'memory')

afterEach(() => {
  if (originalMemoryDescriptor) {
    Object.defineProperty(globalThis.performance, 'memory', originalMemoryDescriptor)
  } else {
    Reflect.deleteProperty(globalThis.performance, 'memory')
  }
})

test('PerformanceCollector reads browser memory when available', () => {
  Object.defineProperty(globalThis.performance, 'memory', {
    configurable: true,
    value: {
      usedJSHeapSize: 10 * 1_048_576,
      totalJSHeapSize: 20 * 1_048_576,
      jsHeapSizeLimit: 50 * 1_048_576,
    },
  })

  const monitor = createMonitor({
    collectors: { performance: true },
  })

  expect(monitor.performance.snapshot.value.memory).toEqual({
    used: 10,
    total: 50,
    percent: 20,
  })

  monitor.destroy()
})

test('PerformanceCollector clearHistory resets retained metric histories', () => {
  const monitor = createMonitor({
    collectors: { performance: true },
  })

  monitor.performance.fpsHistory.value = [55, 60]
  monitor.performance.memoryHistory.value = [10, 20]

  monitor.performance.clearHistory()

  expect(monitor.performance.snapshot.value.fpsHistory).toEqual([])
  expect(monitor.performance.snapshot.value.memoryHistory).toEqual([])

  monitor.destroy()
})
