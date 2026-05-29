import { createMonitor, emitMonitorEvent } from '../src/index'

if (typeof globalThis.CustomEvent === 'undefined') {
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class TestCustomEvent<T = unknown> extends Event {
      readonly detail: T

      constructor(type: string, init: CustomEventInit<T> = {}) {
        super(type, init)
        this.detail = init.detail as T
      }
    },
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

test('EventCollector keeps entries and label counts inside retained history', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  })

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
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: new EventTarget(),
  })

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
