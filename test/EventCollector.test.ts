import { createMonitor, emitMonitorEvent } from '../dist/index.js'

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    detail

    constructor(type, init = {}) {
      super(type, init)
      this.detail = init.detail
    }
  }
}

afterEach(() => {
  delete globalThis.window
})

test('EventCollector keeps entries and label counts inside retained history', () => {
  globalThis.window = new EventTarget()

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: { events: true },
  })

  monitor.start()

  emitMonitorEvent('first')
  emitMonitorEvent('second')
  emitMonitorEvent('second')

  const snapshot = monitor.events.snapshot.value

  expect(snapshot.entries.map((entry) => entry.label)).toEqual(['second', 'second'])
  expect(snapshot.byLabel).toEqual({ second: 2 })

  monitor.destroy()
})

test('EventCollector clearLog resets retained entries and label counts', () => {
  globalThis.window = new EventTarget()

  const monitor = createMonitor({
    maxHistory: 3,
    collectors: { events: true },
  })

  monitor.start()
  emitMonitorEvent('checkout')

  monitor.events.clearLog()

  expect(monitor.events.snapshot.value).toEqual({
    entries: [],
    byLabel: {},
  })

  monitor.destroy()
})
