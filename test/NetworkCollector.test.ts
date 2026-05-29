import { jest } from '@jest/globals'
import { createMonitor } from '../src/index'

class FakeXMLHttpRequest {
  static lastInstance: FakeXMLHttpRequest | null = null

  listeners = new Map<string, () => void>()
  response = ''
  status = 200

  constructor() {
    FakeXMLHttpRequest.lastInstance = this
  }

  open(): void {}

  send(): void {
    this.listeners.get('loadend')?.()
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener)
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'XMLHttpRequest')
})

test('NetworkCollector records filtered fetch requests inside maxHistory', async () => {
  const fetchMock: typeof fetch = async (input) => new Response(String(input), { status: 201 })

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      fetch: jest.fn(fetchMock),
    },
  })
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  })

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: {
      network: {
        filter: (url) => url.includes('/keep'),
      },
    },
  })

  monitor.start()

  const testWindow = globalThis.window as unknown as { fetch: typeof fetch }

  await testWindow.fetch('/drop')
  await testWindow.fetch('/keep/one', { method: 'post', body: 'abc' })
  await testWindow.fetch('/keep/two')
  await testWindow.fetch('/keep/three')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const snapshot = monitor.network.snapshot.value

  expect(snapshot.entries.map((entry) => entry.url)).toEqual(['/keep/two', '/keep/three'])
  const [firstEntry, secondEntry] = snapshot.entries
  expect(firstEntry).toBeDefined()
  expect(secondEntry).toBeDefined()
  expect(firstEntry?.method).toBe('GET')
  expect(secondEntry?.status).toBe(201)
  expect(snapshot.window5s.count).toBe(2)
  expect(snapshot.window5s.errorRate).toBe(0)

  monitor.destroy()
})

test('NetworkCollector restores fetch when stopped', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response())

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  })
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  })

  const monitor = createMonitor({
    collectors: { network: true },
  })

  monitor.start()
  const testWindow = globalThis.window as unknown as { fetch: typeof globalThis.fetch }

  expect(testWindow.fetch).not.toBe(fetch)

  monitor.stop()
  expect(testWindow.fetch).toBe(fetch)

  monitor.destroy()
})

test('NetworkCollector restores XMLHttpRequest open and send when stopped', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response())
  const originalOpen = FakeXMLHttpRequest.prototype.open
  const originalSend = FakeXMLHttpRequest.prototype.send

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  })
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  })

  const monitor = createMonitor({
    collectors: { network: true },
  })

  monitor.start()
  expect(FakeXMLHttpRequest.prototype.open).not.toBe(originalOpen)
  expect(FakeXMLHttpRequest.prototype.send).not.toBe(originalSend)

  monitor.stop()
  expect(FakeXMLHttpRequest.prototype.open).toBe(originalOpen)
  expect(FakeXMLHttpRequest.prototype.send).toBe(originalSend)

  monitor.destroy()
})

test('NetworkCollector start is idempotent', () => {
  const fetch: typeof globalThis.fetch = jest.fn(async () => new Response())

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { fetch },
  })
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
  })

  const monitor = createMonitor({
    collectors: { network: true },
  })

  monitor.start()
  const patchedFetch = (globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch
  const patchedOpen = FakeXMLHttpRequest.prototype.open
  const patchedSend = FakeXMLHttpRequest.prototype.send

  monitor.start()

  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(patchedFetch)
  expect(FakeXMLHttpRequest.prototype.open).toBe(patchedOpen)
  expect(FakeXMLHttpRequest.prototype.send).toBe(patchedSend)

  monitor.stop()
  expect((globalThis.window as unknown as { fetch: typeof globalThis.fetch }).fetch).toBe(fetch)

  monitor.destroy()
})
