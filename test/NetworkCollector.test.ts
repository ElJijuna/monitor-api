import { jest } from '@jest/globals'
import { createMonitor } from '../dist/index.js'

class FakeXMLHttpRequest {
  static lastInstance

  listeners = new Map()
  response = ''
  status = 200

  constructor() {
    FakeXMLHttpRequest.lastInstance = this
  }

  open() {}

  send() {
    this.listeners.get('loadend')?.()
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener)
  }
}

afterEach(() => {
  delete globalThis.window
  delete globalThis.XMLHttpRequest
})

test('NetworkCollector records filtered fetch requests inside maxHistory', async () => {
  globalThis.window = {
    fetch: jest.fn(async (url) => new Response(url, { status: 201 })),
  }
  globalThis.XMLHttpRequest = FakeXMLHttpRequest

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: {
      network: {
        filter: (url) => url.includes('/keep'),
      },
    },
  })

  monitor.start()

  await globalThis.window.fetch('/drop')
  await globalThis.window.fetch('/keep/one', { method: 'post', body: 'abc' })
  await globalThis.window.fetch('/keep/two')
  await globalThis.window.fetch('/keep/three')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const snapshot = monitor.network.snapshot.value

  expect(snapshot.entries.map((entry) => entry.url)).toEqual(['/keep/two', '/keep/three'])
  expect(snapshot.entries[0].method).toBe('GET')
  expect(snapshot.entries[1].status).toBe(201)
  expect(snapshot.window5s.count).toBe(2)
  expect(snapshot.window5s.errorRate).toBe(0)

  monitor.destroy()
})

test('NetworkCollector restores fetch when stopped', () => {
  const fetch = jest.fn()
  globalThis.window = { fetch }
  globalThis.XMLHttpRequest = FakeXMLHttpRequest

  const monitor = createMonitor({
    collectors: { network: true },
  })

  monitor.start()
  expect(globalThis.window.fetch).not.toBe(fetch)

  monitor.stop()
  expect(globalThis.window.fetch).toBe(fetch)

  monitor.destroy()
})
