import { jest } from '@jest/globals'
import type { MetricType } from 'web-vitals'

type MetricCallback = (metric: MetricType) => void

const callbacks = new Map<string, MetricCallback>()

jest.unstable_mockModule('web-vitals', () => ({
  onCLS: jest.fn((callback: MetricCallback) => callbacks.set('CLS', callback)),
  onFCP: jest.fn((callback: MetricCallback) => callbacks.set('FCP', callback)),
  onINP: jest.fn((callback: MetricCallback) => callbacks.set('INP', callback)),
  onLCP: jest.fn((callback: MetricCallback) => callbacks.set('LCP', callback)),
  onTTFB: jest.fn((callback: MetricCallback) => callbacks.set('TTFB', callback)),
}))

const { createMonitor } = await import('../src/index')
const webVitals = await import('web-vitals')

function metric(name: MetricType['name'], value: number): MetricType {
  return {
    name,
    value,
    delta: value,
    rating: 'good',
    id: `${name}-${value}`,
    entries: [],
    navigationType: 'navigate',
  } as MetricType
}

afterEach(() => {
  callbacks.clear()
  jest.clearAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

test('WebVitalsCollector records latest metrics and retained entries', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  })

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: { webVitals: true },
  })

  monitor.start()

  callbacks.get('CLS')?.(metric('CLS', 0.01))
  callbacks.get('LCP')?.(metric('LCP', 1800))
  callbacks.get('INP')?.(metric('INP', 120))

  const snapshot = monitor.webVitals.snapshot.value

  expect(snapshot.cls?.value).toBe(0.01)
  expect(snapshot.lcp?.value).toBe(1800)
  expect(snapshot.inp?.value).toBe(120)
  expect(snapshot.entries.map((entry) => entry.name)).toEqual(['LCP', 'INP'])
  expect(monitor.webVitals.onMetric.value?.name).toBe('INP')

  monitor.destroy()
})

test('WebVitalsCollector start is idempotent and stop ignores future reports', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  })

  const monitor = createMonitor({
    collectors: { webVitals: true },
  })

  monitor.start()
  monitor.start()

  expect(webVitals.onCLS).toHaveBeenCalledTimes(1)
  expect(webVitals.onFCP).toHaveBeenCalledTimes(1)
  expect(webVitals.onINP).toHaveBeenCalledTimes(1)
  expect(webVitals.onLCP).toHaveBeenCalledTimes(1)
  expect(webVitals.onTTFB).toHaveBeenCalledTimes(1)

  monitor.stop()
  callbacks.get('CLS')?.(metric('CLS', 0.02))

  expect(monitor.webVitals.snapshot.value.cls).toBeNull()

  monitor.destroy()
})
