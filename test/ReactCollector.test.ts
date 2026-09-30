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

const realTimers = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  jest.useRealTimers();
  globalThis.clearInterval = realTimers.clearInterval;
  globalThis.clearTimeout = realTimers.clearTimeout;
  globalThis.setInterval = realTimers.setInterval;
  globalThis.setTimeout = realTimers.setTimeout;
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

function unmount(fiber: TestFiber): void {
  const testWindow = globalThis.window as unknown as {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook;
  };

  testWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberUnmount(1, fiber);
}

test('ReactCollector resolves forwardRef, memo and anonymous component names', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Rendered() {}

  const nameless = () => {};

  Object.defineProperty(nameless, 'name', { value: undefined });

  const namedRef = fiberFor({ $$typeof: Symbol.for('react.forward_ref'), displayName: 'Named' });
  const renderRef = fiberFor({
    $$typeof: Symbol.for('react.memo'),
    type: { $$typeof: Symbol.for('react.forward_ref'), render: Rendered },
  });
  const unknownObject = fiberFor({ $$typeof: Symbol.for('react.lazy') });
  const anonymous = fiberFor(nameless);
  const host = fiberFor('div');

  namedRef.sibling = renderRef;
  renderRef.sibling = unknownObject;
  unknownObject.sibling = anonymous;
  anonymous.sibling = host;

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(namedRef);

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.component)).toEqual([
      'Named',
      'Rendered',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector treats an unprofiled child as taking no time of its parent', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Parent() {}

  const parent = fiberFor(Parent, 5);

  parent.child = unprofiledFiberFor('span');

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(parent);

    expect(monitor.react.snapshot.value.entries).toEqual([
      expect.objectContaining({ component: 'Parent', duration: 5 }),
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector accepts an unlimited fiber visit budget', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Leaf() {}

  const monitor = createMonitor({
    collectors: { react: { maxFiberVisits: Number.POSITIVE_INFINITY } },
  });

  try {
    monitor.start();
    commit(Leaf);

    expect(monitor.react.snapshot.value.truncatedCommits).toBe(0);
    expect(monitor.react.snapshot.value.entries).toHaveLength(1);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector ignores empty roots and unmounts of unnamed fibers', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    unmount(fiberFor('div'));
    (
      globalThis.window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1, {
      current: null as unknown as TestFiber,
    });

    expect(monitor.react.snapshot.value).toMatchObject({ totalCommits: 1, entries: [] });
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector clearLog resets history and drops pending unmounts', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Gone() {}

  function Stays() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(Stays);
    unmount(fiberFor(Gone));
    monitor.react.clearLog();

    expect(monitor.react.snapshot.value).toMatchObject({ totalCommits: 0, entries: [] });

    commit(Stays);

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.type)).toEqual(['mount']);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector stays inert after destroy', () => {
  const monitor = createMonitor({ collectors: { react: true } });

  monitor.destroy();
  monitor.react.destroy();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  monitor.react.start();

  expect(
    (globalThis.window as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__,
  ).toBeUndefined();
});

test('ReactCollector walks past fibers without a type such as the host root', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function App() {}

  const hostRoot = fiberFor(null, 4);

  hostRoot.tag = 3;
  hostRoot.child = fiberFor(App, 4);

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(hostRoot);

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.component)).toEqual(['App']);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector aggregates renders, averages and last render time per component', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  jest.useFakeTimers({ now: 1_000 });

  function Card() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(Card, 2);
    jest.setSystemTime(2_000);
    commit(Card, 3);
    jest.setSystemTime(3_000);
    commit(Card, 3);

    expect(monitor.react.snapshot.value.byComponent.Card).toEqual({
      renders: 3,
      totalDuration: 8,
      avgDuration: 2.7,
      lastRender: 3_000,
    });
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector onCommit reports the last entry of each commit', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Parent() {}

  function Child() {}

  const root = fiberFor(Parent, 3);

  root.child = fiberFor(Child, 1);

  const monitor = createMonitor({ collectors: { react: true } });
  const seen: string[] = [];

  try {
    monitor.react.onCommit.subscribe((entry) => {
      if (entry) {
        seen.push(entry.component);
      }
    });
    monitor.start();
    commitRoot(root);
    commitRoot(unprofiledFiberFor(Parent));

    expect(seen).toEqual(['Child']);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector never lists unmounts as slow components', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Slow() {}

  function Removed() {}

  const monitor = createMonitor({ collectors: { react: { slowThreshold: 0 } } });

  try {
    monitor.start();
    unmount(fiberFor(Removed));
    commit(Slow, 1);

    expect(monitor.react.snapshot.value.slowComponents.map((entry) => entry.component)).toEqual([
      'Slow',
    ]);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector rounds self durations to one decimal', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Precise() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(Precise, 1.26);

    expect(monitor.react.snapshot.value.entries[0]?.duration).toBe(1.3);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector clamps a child reporting more time than its parent to zero', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Parent() {}

  function Child() {}

  const root = fiberFor(Parent, 1);

  root.child = fiberFor(Child, 5);

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commitRoot(root);

    expect(monitor.react.snapshot.value.entries[0]).toMatchObject({
      component: 'Parent',
      duration: 0,
    });
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector start is a no-op without a window', () => {
  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.react.start();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    expect(
      (globalThis.window as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
        .__REACT_DEVTOOLS_GLOBAL_HOOK__,
    ).toBeUndefined();
  } finally {
    monitor.destroy();
  }
});

describe('incremental statistics', () => {
  interface Entry {
    component: string;
    duration: number;
    timestamp: number;
    type: string;
  }

  /** Recomputes the statistics from scratch, in integer tenths of a millisecond. */
  function expectedStats(entries: Entry[]) {
    const totals = new Map<string, { renders: number; tenths: number; lastRender: number }>();

    for (const entry of entries) {
      if (entry.type === 'unmount') {
        continue;
      }

      const current = totals.get(entry.component);

      totals.set(entry.component, {
        renders: (current?.renders ?? 0) + 1,
        tenths: (current?.tenths ?? 0) + Math.round(entry.duration * 10),
        lastRender: entry.timestamp,
      });
    }

    return Object.fromEntries(
      [...totals].map(([name, { renders, tenths, lastRender }]) => [
        name,
        {
          renders,
          totalDuration: tenths / 10,
          avgDuration: Math.round(tenths / renders) / 10,
          lastRender,
        },
      ]),
    );
  }

  test('components a commit does not touch keep the same stats object', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

    function Stable() {}

    function Busy() {}

    const monitor = createMonitor({ collectors: { react: true } });

    try {
      monitor.start();
      commit(Stable, 2);
      commit(Busy, 1);

      const before = monitor.react.snapshot.value.byComponent;

      commit(Busy, 3);

      const after = monitor.react.snapshot.value.byComponent;

      expect(after).not.toBe(before);
      expect(after.Stable).toBe(before.Stable);
      expect(after.Busy).toEqual({
        renders: 2,
        totalDuration: 4,
        avgDuration: 2,
        lastRender: expect.any(Number),
      });
    } finally {
      monitor.destroy();
    }
  });

  test('byComponent and slowComponents match a full recomputation after every change', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    jest.useFakeTimers({ now: 0 });

    const types = ['Header', 'List', 'Row', 'constructor', 'Footer'].map((name) =>
      Object.defineProperty(function Component() {}, 'name', { value: name }),
    );
    const monitor = createMonitor({ maxHistory: 7, collectors: { react: { slowThreshold: 3 } } });

    let threshold = 3;
    let seed = 42;

    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

      return seed / 2_147_483_648;
    };
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)] as T;

    try {
      monitor.start();

      for (let step = 0; step < 400; step += 1) {
        jest.advanceTimersByTime(1 + Math.floor(random() * 5));

        const action = random();

        if (action < 0.03) {
          monitor.react.clearLog();
        } else if (action < 0.08) {
          threshold = Math.floor(random() * 6);
          monitor.react.setSlowThreshold(threshold);
        } else if (action < 0.2) {
          unmount(fiberFor(pick(types)));
        } else {
          // One to twelve sibling fibers, sometimes more than maxHistory, with 0.0–5.0 ms each.
          const count = 1 + Math.floor(random() * 12);
          const fibers = Array.from({ length: count }, () =>
            fiberFor(pick(types), Math.round(random() * 50) / 10),
          );

          fibers.forEach((fiber, index) => {
            fiber.sibling = fibers[index + 1] ?? null;
          });
          commitRoot(fibers[0] as TestFiber);
        }

        const { entries, byComponent, slowComponents } = monitor.react.snapshot.value;

        expect(byComponent).toEqual(expectedStats(entries));
        expect(slowComponents).toEqual(
          entries.filter((entry) => entry.type !== 'unmount' && entry.duration >= threshold),
        );
      }
    } finally {
      monitor.destroy();
    }
  });
});

test('ReactCollector keeps byComponent when a commit only unmounts components', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Kept() {}

  function Removed() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(Kept);

    const { byComponent } = monitor.react.snapshot.value;

    unmount(fiberFor(Removed));
    commitRoot(fiberFor('div'));

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.type)).toEqual([
      'mount',
      'unmount',
    ]);
    expect(monitor.react.snapshot.value.byComponent).toBe(byComponent);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector installs a DevTools hook whose other methods React can call', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();

    const hook = (
      globalThis.window as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: ReactDevToolsHook & {
          checkDCE: () => void;
          inject: () => void;
          onPostCommitFiberRoot: () => void;
        };
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;

    // React calls these on load and after each commit; the stub must accept them.
    expect(() => {
      hook.checkDCE();
      hook.inject();
      hook.onPostCommitFiberRoot();
    }).not.toThrow();
  } finally {
    monitor.destroy();
  }
});

/** A root with `count` sibling components, each rendered for 1 ms. */
function siblings(count: number): TestFiber {
  const fibers = Array.from({ length: count }, (_, i) => {
    const Component = { [`C${i}`]: () => {} }[`C${i}`];

    return fiberFor(Component);
  });

  fibers.forEach((fiber, i) => {
    fiber.sibling = fibers[i + 1] ?? null;
  });

  return fibers[0] as TestFiber;
}

test.each([
  ['a fractional budget rounds down', 2.9, 2, 1],
  ['a negative budget visits nothing', -5, 0, 1],
  ['NaN falls back to the default budget', Number.NaN, 4, 0],
  ['an undefined budget uses the default', undefined, 4, 0],
])('ReactCollector maxFiberVisits: %s', (_, maxFiberVisits, recorded, truncated) => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  const monitor = createMonitor({
    collectors: { react: maxFiberVisits === undefined ? true : { maxFiberVisits } },
  });

  try {
    monitor.start();
    commitRoot(siblings(4));

    expect(monitor.react.snapshot.value.entries).toHaveLength(recorded);
    expect(monitor.react.snapshot.value.truncatedCommits).toBe(truncated);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector prefers a function component displayName over its name', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function InternalName() {}

  InternalName.displayName = 'Pretty';

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    commit(InternalName);

    expect(monitor.react.snapshot.value.entries[0]?.component).toBe('Pretty');
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector drops unmounts reported before a stop', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  function Gone() {}

  function Shown() {}

  const monitor = createMonitor({ collectors: { react: true } });

  try {
    monitor.start();
    unmount(fiberFor(Gone));
    monitor.stop();
    monitor.start();
    commit(Shown);

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.component)).toEqual(['Shown']);
  } finally {
    monitor.destroy();
  }
});

test('ReactCollector keeps only the newest pending unmounts within maxHistory', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });

  const monitor = createMonitor({ maxHistory: 2, collectors: { react: true } });

  try {
    monitor.start();

    for (const name of ['First', 'Second', 'Third']) {
      unmount(fiberFor({ [name]: () => {} }[name]));
    }

    commitRoot(fiberFor('div'));

    expect(monitor.react.snapshot.value.entries.map((entry) => entry.component)).toEqual([
      'Second',
      'Third',
    ]);
  } finally {
    monitor.destroy();
  }
});
