import { jest } from '@jest/globals'
import { createMonitor } from '../src/index'
import type { MonitorSnapshot } from '../src/core/types'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  jest.useRealTimers()
})

test('createMonitor exposes a combined snapshot and subscription API', () => {
  const monitor = createMonitor()
  const snapshots: MonitorSnapshot[] = []
  const unsubscribe = monitor.subscribe((snapshot) => snapshots.push(snapshot))

  monitor.events.clearLog()

  expect(monitor.getSnapshot()).toMatchObject({
    performance: expect.any(Object),
    network: expect.any(Object),
    react: expect.any(Object),
    events: { entries: [], byLabel: {} },
  })
  expect(snapshots).toHaveLength(1)

  unsubscribe()
  monitor.destroy()
})

test('createMonitor is safe to construct and start without browser globals', () => {
  Reflect.deleteProperty(globalThis, 'window')

  const monitor = createMonitor()

  expect(() => monitor.start()).not.toThrow()
  expect(() => monitor.stop()).not.toThrow()
  expect(() => monitor.destroy()).not.toThrow()
})

test('production reporting does not start during construction', () => {
  jest.useFakeTimers()

  const monitor = createMonitor({
    env: 'production',
    report: {
      endpoint: '/monitor',
      interval: 1000,
    },
  })

  expect(jest.getTimerCount()).toBe(0)

  monitor.destroy()
})
