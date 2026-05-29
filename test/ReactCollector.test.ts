import { createMonitor } from '../dist/index.js'

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

function fiberFor(type, actualDuration = 1) {
  return {
    tag: 0,
    type,
    alternate: null,
    child: null,
    sibling: null,
    flags: 0,
    actualDuration,
  }
}

function commit(type, actualDuration = 1) {
  globalThis.window.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, {
    current: fiberFor(type, actualDuration),
  })
}

test('React byComponent is derived from retained history', () => {
  globalThis.window = {}

  function First() {}
  function Second() {}
  function Third() {}

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: { react: true },
  })

  monitor.start()

  commit(First, 1)
  commit(Second, 2)
  commit(Third, 3)

  const snapshot = monitor.react.snapshot.value

  expect(snapshot.entries.map((entry) => entry.component)).toEqual(['Second', 'Third'])
  expect(Object.keys(snapshot.byComponent)).toEqual(['Second', 'Third'])
  expect(snapshot.byComponent.First).toBeUndefined()
  expect(snapshot.byComponent.Second.renders).toBe(1)
  expect(snapshot.byComponent.Third.totalDuration).toBe(3)

  monitor.destroy()
})
