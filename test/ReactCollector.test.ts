import { createMonitor } from '../src/index'

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

interface TestFiber {
  tag: number
  type: unknown
  alternate: null
  child: null
  sibling: null
  flags: number
  actualDuration: number
}

interface ReactDevToolsHook {
  onCommitFiberRoot(rendererID: number, root: { current: TestFiber }): void
}

function fiberFor(type: unknown, actualDuration = 1): TestFiber {
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

function commit(type: unknown, actualDuration = 1): void {
  const testWindow = globalThis.window as unknown as {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook
  }

  testWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, {
    current: fiberFor(type, actualDuration),
  })
}

test('React byComponent is derived from retained history', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  })

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
  expect(snapshot.byComponent.Second).toBeDefined()
  expect(snapshot.byComponent.Third).toBeDefined()
  expect(snapshot.byComponent.Second?.renders).toBe(1)
  expect(snapshot.byComponent.Third?.totalDuration).toBe(3)

  monitor.destroy()
})
