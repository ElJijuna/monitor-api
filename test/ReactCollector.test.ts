import { jest } from '@jest/globals';
import { createMonitor } from '../src/index';

if (typeof globalThis.CustomEvent === 'undefined') {
  Object.defineProperty(globalThis, 'CustomEvent', {
    configurable: true,
    value: class TestCustomEvent<T = unknown> extends Event {
      readonly detail: T;

      constructor(type: string, init: CustomEventInit<T> = {}) {
        super(type, init);
        this.detail = init.detail as T;
      }
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

interface TestFiber {
  tag: number;
  type: unknown;
  alternate: TestFiber | null;
  child: TestFiber | null;
  sibling: TestFiber | null;
  flags: number;
  actualDuration: number;
}

interface ReactDevToolsHook {
  onCommitFiberRoot(
    rendererID: number,
    root: { current: TestFiber },
    priorityLevel?: unknown,
    didError?: boolean,
  ): void;
  onCommitFiberUnmount(rendererID: number, fiber: TestFiber): void;
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
  };
}

function commit(type: unknown, actualDuration = 1): void {
  commitRoot(fiberFor(type, actualDuration));
}

function commitRoot(root: TestFiber): void {
  const testWindow = globalThis.window as unknown as {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
  };

  testWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, {
    current: root,
  });
}

test('React byComponent is derived from retained history', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function First() {}
  function Second() {}
  function Third() {}

  const monitor = createMonitor({
    maxHistory: 2,
    collectors: { react: true },
  });

  monitor.start();

  commit(First, 1);
  commit(Second, 2);
  commit(Third, 3);

  const snapshot = monitor.react.snapshot.value;

  expect(snapshot.entries.map((entry) => entry.component)).toEqual(['Second', 'Third']);
  expect(Object.keys(snapshot.byComponent)).toEqual(['Second', 'Third']);
  expect(snapshot.byComponent.First).toBeUndefined();
  expect(snapshot.byComponent.Second).toBeDefined();
  expect(snapshot.byComponent.Third).toBeDefined();
  expect(snapshot.byComponent.Second?.renders).toBe(1);
  expect(snapshot.byComponent.Third?.totalDuration).toBe(3);

  monitor.destroy();
});

test('ReactCollector aggregates component names that match inherited object keys', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  const components = {
    constructor() {},
    toString() {},
    ['__proto__']() {},
  };
  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(components.constructor, 1);
    commit(components.toString, 2);
    commit(components.__proto__, 3);

    const byComponent = monitor.react.snapshot.value.byComponent;

    expect(Object.keys(byComponent)).toEqual(['constructor', 'toString', '__proto__']);
    expect(byComponent.constructor).toMatchObject({ renders: 1, totalDuration: 1 });
    expect(byComponent.toString).toMatchObject({ renders: 1, totalDuration: 2 });
    expect(byComponent.__proto__).toMatchObject({ renders: 1, totalDuration: 3 });
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector handles deeply nested fiber trees without overflowing the stack', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const root = fiberFor(Component);

  let current = root;

  for (let index = 0; index < 20_000; index++) {
    const child = fiberFor(Component);

    current.child = child;
    current = child;
  }

  const monitor = createMonitor({
    maxHistory: 1,
    collectors: { react: true },
  });

  try {
    monitor.start();

    expect(() => commitRoot(root)).not.toThrow();
    expect(monitor.react.snapshot.value.entries).toHaveLength(1);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector ignores zero-duration fibers but still counts the commit', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(Component, 0);

    expect(monitor.react.snapshot.value).toMatchObject({
      totalCommits: 1,
      entries: [],
      byComponent: {},
      slowComponents: [],
    });
    expect(monitor.react.onCommit.value).toBeNull();
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector can include zero-duration fibers explicitly', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const monitor = createMonitor({
    collectors: {
      react: { includeZeroDuration: true },
    },
  });

  try {
    monitor.start();
    commit(Component, 0);

    expect(monitor.react.snapshot.value.entries).toEqual([
      expect.objectContaining({
        component: 'Component',
        duration: 0,
      }),
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector reports commits truncated by the fiber visit limit', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function First() {}
  function Second() {}
  function Third() {}

  const root = fiberFor(First);
  const second = fiberFor(Second);

  root.child = second;
  second.child = fiberFor(Third);

  const monitor = createMonitor({
    collectors: {
      react: { maxFiberVisits: 2 },
    },
  });

  try {
    monitor.start();
    commitRoot(root);

    expect(monitor.react.snapshot.value).toMatchObject({
      totalCommits: 1,
      truncatedCommits: 1,
    });
    expect(monitor.react.snapshot.value.entries.map((entry) => entry.component)).toEqual([
      'First',
      'Second',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector does not infer unmounts from private Fiber flags', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const root = fiberFor(Component, 2);

  root.alternate = fiberFor(Component, 1);
  root.flags = 8;

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(root);

    expect(monitor.react.snapshot.value.entries[0]?.type).toBe('update');
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector records unmounts from the DevTools hook in the following commit', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Removed() {}
  function Updated() {}

  const updated = fiberFor(Updated, 2);

  updated.alternate = fiberFor(Updated, 1);

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();

    const hook = (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;

    hook.onCommitFiberUnmount(1, fiberFor(Removed));
    hook.onCommitFiberRoot(1, { current: updated });

    const entries = monitor.react.snapshot.value.entries;

    expect(entries.map((entry) => [entry.component, entry.type])).toEqual([
      ['Removed', 'unmount'],
      ['Updated', 'update'],
    ]);
    expect(entries[0]?.commitId).toBe(entries[1]?.commitId);
    expect(monitor.react.snapshot.value.totalCommits).toBe(1);
    expect(monitor.react.snapshot.value.byComponent.Removed).toBeUndefined();
    expect(monitor.react.snapshot.value.byComponent.Updated?.renders).toBe(1);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector keeps pending unmounts isolated by renderer', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Removed() {}
  function RendererOne() {}
  function RendererTwo() {}

  const rendererOne = fiberFor(RendererOne);
  const rendererTwo = fiberFor(RendererTwo);

  rendererOne.alternate = fiberFor(RendererOne);
  rendererTwo.alternate = fiberFor(RendererTwo);

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();

    const hook = (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;

    hook.onCommitFiberUnmount(1, fiberFor(Removed));
    hook.onCommitFiberRoot(2, { current: rendererTwo });

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.component)).toEqual([
      'RendererTwo',
    ]);

    hook.onCommitFiberRoot(1, { current: rendererOne });

    const lastCommit = monitor.react.snapshot.value.entries.slice(-2);

    expect(lastCommit.map((entry) => [entry.component, entry.type])).toEqual([
      ['Removed', 'unmount'],
      ['RendererOne', 'update'],
    ]);
    expect(lastCommit[0]?.commitId).toBe(lastCommit[1]?.commitId);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector records memo fibers without depending on private work tags', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function MemoizedComponent() {}

  const memoFiber = fiberFor({
    $$typeof: Symbol.for('react.memo'),
    type: MemoizedComponent,
  });

  memoFiber.tag = 14;

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(memoFiber);

    expect(monitor.react.snapshot.value.entries[0]?.component).toBe('MemoizedComponent');
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector retains no render history when maxHistory is zero', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const monitor = createMonitor({
    maxHistory: 0,
    collectors: { react: true },
  });

  monitor.start();
  commit(Component, 20);

  expect(monitor.react.snapshot.value).toEqual({
    totalCommits: 1,
    truncatedCommits: 0,
    entries: [],
    byComponent: {},
    slowComponents: [],
  });
  expect(monitor.react.onCommit.value?.component).toBe('Component');

  monitor.destroy();
});

test('ReactCollector start is idempotent', () => {
  const original = jest.fn();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        onCommitFiberRoot: original,
      },
    },
  });

  const monitor = createMonitor({
    collectors: { react: true },
  });

  monitor.start();
  const firstPatch = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot;
  const firstUnmountPatch = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount;

  monitor.start();
  const secondPatch = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot;
  const secondUnmountPatch = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount;

  expect(secondPatch).toBe(firstPatch);
  expect(secondUnmountPatch).toBe(firstUnmountPatch);

  monitor.stop();
  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot,
  ).toBe(original);
  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: Partial<ReactDevToolsHook>;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount,
  ).toBeUndefined();

  monitor.destroy();
});

test('ReactCollector preserves all onCommitFiberRoot arguments for existing hooks', () => {
  const original = jest.fn();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        onCommitFiberRoot: original,
      },
    },
  });

  function Component() {}

  const root = { current: fiberFor(Component) };
  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();

    const hook = (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;

    hook.onCommitFiberRoot(7, root, 'priority', true);

    expect(original).toHaveBeenCalledWith(7, root, 'priority', true);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollectors share the global hook and stop independently', () => {
  const original = jest.fn();
  const originalUnmount = jest.fn();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        onCommitFiberRoot: original,
        onCommitFiberUnmount: originalUnmount,
      },
    },
  });

  function Component() {}

  const first = createMonitor({ collectors: { react: true } });
  const second = createMonitor({ collectors: { react: true } });

  first.start();
  const sharedHook = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot;
  const sharedUnmountHook = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount;

  second.start();

  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot,
  ).toBe(sharedHook);
  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount,
  ).toBe(sharedUnmountHook);

  commit(Component);

  expect(first.react.snapshot.value.totalCommits).toBe(1);
  expect(second.react.snapshot.value.totalCommits).toBe(1);

  first.stop();

  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot,
  ).toBe(sharedHook);

  commit(Component);

  expect(first.react.snapshot.value.totalCommits).toBe(1);
  expect(second.react.snapshot.value.totalCommits).toBe(2);

  second.stop();

  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot,
  ).toBe(original);
  expect(
    (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount,
  ).toBe(originalUnmount);

  first.destroy();
  second.destroy();
});

test('ReactCollector does not overwrite a newer hook handler when stopped', () => {
  const original = jest.fn();
  const thirdPartyHandler = jest.fn();
  const thirdPartyUnmountHandler = jest.fn();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        onCommitFiberRoot: original,
      },
    },
  });

  const monitor = createMonitor({ collectors: { react: true } });

  monitor.start();

  const hook = (
    globalThis.window as unknown as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
    }
  ).__REACT_DEVTOOLS_GLOBAL_HOOK__;

  hook.onCommitFiberRoot = thirdPartyHandler;
  hook.onCommitFiberUnmount = thirdPartyUnmountHandler;
  monitor.stop();

  expect(hook.onCommitFiberRoot).toBe(thirdPartyHandler);
  expect(hook.onCommitFiberUnmount).toBe(thirdPartyUnmountHandler);

  monitor.destroy();
});
