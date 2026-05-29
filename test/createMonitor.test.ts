import { createMonitor } from '../src/index'
import type { MonitorSnapshot } from '../src/core/types'

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
