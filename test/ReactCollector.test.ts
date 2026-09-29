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
  actualDuration?: number;
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

// React marks fibers that rendered in the current commit with this flag.
const PERFORMED_WORK = 1;

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

/** A fiber from a standard production build, where React does not time renders. */
function unprofiledFiberFor(type: unknown): TestFiber {
  const fiber = fiberFor(type);

  Reflect.deleteProperty(fiber, 'actualDuration');

  return fiber;
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
    commit(Object.getOwnPropertyDescriptor(components, '__proto__')?.value, 3);

    const { byComponent } = monitor.react.snapshot.value;
    const protoStats = Object.getOwnPropertyDescriptor(byComponent, '__proto__')?.value;

    expect(Object.keys(byComponent)).toEqual(['constructor', 'toString', '__proto__']);
    expect(byComponent.constructor).toMatchObject({ renders: 1, totalDuration: 1 });
    expect(byComponent.toString).toMatchObject({ renders: 1, totalDuration: 2 });
    expect(protoStats).toMatchObject({ renders: 1, totalDuration: 3 });
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

  const depth = 20_000;
  const root = fiberFor(Component, depth + 1);

  let current = root;

  for (let index = 0; index < depth; index++) {
    const child = fiberFor(Component, depth - index);

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

test('ReactCollector ignores renders without profiling timings but still counts the commit', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(unprofiledFiberFor(Component));

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

test('ReactCollector counts profiled renders that measure 0 ms', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(Component, 0);

    expect(monitor.react.snapshot.value.byComponent.Component).toMatchObject({
      renders: 1,
      totalDuration: 0,
    });
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector can include renders without profiling timings explicitly', () => {
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
    commitRoot(unprofiledFiberFor(Component));

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

  const root = fiberFor(First, 3);
  const second = fiberFor(Second, 2);

  root.child = second;
  second.child = fiberFor(Third, 1);

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
  root.flags = PERFORMED_WORK | 8;

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
  updated.flags = PERFORMED_WORK;

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

    const { entries } = monitor.react.snapshot.value;

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
  rendererOne.flags = PERFORMED_WORK;
  rendererTwo.flags = PERFORMED_WORK;

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

test('ReactCollector skips components that bailed out and subtrees React did not re-render', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function App() {}

  function Heavy() {}

  function Counter() {}

  // Previous commit: Heavy mounted and still carries its old duration and flags.
  const heavy = fiberFor(Heavy, 5);

  heavy.flags = PERFORMED_WORK;

  const memo = fiberFor({ $$typeof: Symbol.for('react.memo'), type: Heavy }, 5);

  memo.alternate = { ...fiberFor(memo.type, 5), child: heavy };
  memo.child = heavy;

  const counter = fiberFor(Counter, 1);

  counter.alternate = fiberFor(Counter, 1);
  counter.flags = PERFORMED_WORK;
  memo.sibling = counter;

  const app = fiberFor(App, 1.2);

  app.alternate = fiberFor(App, 6);
  app.child = memo;

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(app);

    expect(
      monitor.react.snapshot.value.entries.map((entry) => [entry.component, entry.type]),
    ).toEqual([['Counter', 'update']]);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector reports each component render without its children', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Parent() {}

  function First() {}

  function Second() {}

  const parent = fiberFor(Parent, 10);
  const first = fiberFor(First, 4);
  const second = fiberFor(Second, 3);

  parent.child = first;
  first.sibling = second;

  const monitor = createMonitor({ collectors: { react: { slowThreshold: 4 } } });

  try {
    monitor.start();
    commitRoot(parent);

    const { byComponent, slowComponents } = monitor.react.snapshot.value;

    expect(byComponent.Parent?.totalDuration).toBe(3);
    expect(byComponent.First?.totalDuration).toBe(4);
    expect(byComponent.Second?.totalDuration).toBe(3);
    expect(slowComponents.map((entry) => entry.component)).toEqual(['First']);
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

test('ReactCollector notifies once per commit and reuses stats while entries are unchanged', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Component() {}

  const monitor = createMonitor({ collectors: { react: true } });
  const notify = jest.fn();

  try {
    monitor.start();
    monitor.react.snapshot.subscribe(notify);

    commit(Component, 5);
    expect(notify).toHaveBeenCalledTimes(1);

    const withRender = monitor.react.snapshot.value;

    commitRoot(unprofiledFiberFor(Component));
    expect(notify).toHaveBeenCalledTimes(2);

    const withoutRender = monitor.react.snapshot.value;

    expect(withoutRender.totalCommits).toBe(2);
    expect(withoutRender.entries).toBe(withRender.entries);
    expect(withoutRender.byComponent).toBe(withRender.byComponent);
    expect(withoutRender.slowComponents).toBe(withRender.slowComponents);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector setSlowThreshold recomputes slow components without copying entries', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Fast() {}

  function Slow() {}

  const monitor = createMonitor({ collectors: { react: { slowThreshold: 16 } } });
  const notify = jest.fn();

  try {
    monitor.start();
    commit(Fast, 4);
    commit(Slow, 20);

    const before = monitor.react.snapshot.value;

    expect(before.slowComponents.map((entry) => entry.component)).toEqual(['Slow']);
    monitor.react.snapshot.subscribe(notify);
    monitor.react.setSlowThreshold(2);

    const after = monitor.react.snapshot.value;

    expect(notify).toHaveBeenCalledTimes(1);
    expect(after.entries).toBe(before.entries);
    expect(after.byComponent).toBe(before.byComponent);
    expect(after.slowComponents.map((entry) => entry.component)).toEqual(['Fast', 'Slow']);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector setSlowThreshold does not notify when the threshold is unchanged', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });

  function Slow() {}

  const monitor = createMonitor({ collectors: { react: { slowThreshold: 16 } } });
  const notify = jest.fn();

  try {
    monitor.start();
    commit(Slow, 20);

    const before = monitor.react.snapshot.value;

    monitor.react.snapshot.subscribe(notify);
    monitor.react.setSlowThreshold(16);

    expect(notify).not.toHaveBeenCalled();
    expect(monitor.react.snapshot.value).toBe(before);
  } finally {
    monitor.destroy();
  }
});
