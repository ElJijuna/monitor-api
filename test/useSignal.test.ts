import { jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import SSignal from 'ssignal';
import { createMonitor } from '../src/index';
import { shallowEqual, useMonitor, useNetwork, useSignal } from '../src/react';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

test('useSignal keeps its subscription stable across unrelated renders', async () => {
  const signal = new SSignal(0);
  const subscribe = jest.spyOn(signal, 'subscribe');

  let renderer: ReactTestRenderer | undefined;

  function View({ label }: { label: string }) {
    const value = useSignal(signal);

    return createElement('span', null, `${label}:${value}`);
  }

  try {
    await act(async () => {
      renderer = create(createElement(View, { label: 'first' }));
    });

    expect(subscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer?.update(createElement(View, { label: 'second' }));
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
  }
});

async function mount(element: ReturnType<typeof createElement>) {
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(element);
  });

  return renderer as ReactTestRenderer;
}

test('useSignal with a selector re-renders only when the selection changes', async () => {
  const signal = new SSignal({ fps: 60, memory: 10 });
  const renders = jest.fn();

  function View() {
    const fps = useSignal(signal, (value) => value.fps);

    renders(fps);

    return createElement('span', null, fps);
  }

  const renderer = await mount(createElement(View));

  try {
    await act(async () => {
      signal.value = { fps: 60, memory: 20 };
    });
    expect(renders).toHaveBeenCalledTimes(1);

    await act(async () => {
      signal.value = { fps: 30, memory: 20 };
    });
    expect(renders).toHaveBeenCalledTimes(2);
    expect(renderer.toJSON()).toMatchObject({ children: ['30'] });
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('shallowEqual keeps an object selection and its reference stable', async () => {
  const signal = new SSignal({ count: 1, errorRate: 0, latency: 100 });
  const selections: unknown[] = [];

  function View() {
    const selection = useSignal(
      signal,
      (value) => ({ count: value.count, errorRate: value.errorRate }),
      shallowEqual,
    );

    selections.push(selection);

    return null;
  }

  const renderer = await mount(createElement(View));

  try {
    await act(async () => {
      signal.value = { count: 1, errorRate: 0, latency: 250 };
    });
    expect(selections).toHaveLength(1);

    await act(async () => {
      signal.value = { count: 2, errorRate: 0, latency: 250 };
    });
    expect(selections).toHaveLength(2);
    expect(selections[1]).toEqual({ count: 2, errorRate: 0 });
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('an inline selector reuses an equal selection across parent renders', async () => {
  const signal = new SSignal({ a: 1, b: 2 });
  const selections: unknown[] = [];

  function View({ label }: { label: string }) {
    const selection = useSignal(signal, (value) => ({ a: value.a }), shallowEqual);

    selections.push(selection);

    return createElement('span', null, label);
  }

  const renderer = await mount(createElement(View, { label: 'first' }));

  try {
    await act(async () => {
      renderer.update(createElement(View, { label: 'second' }));
    });
    expect(selections).toHaveLength(2);
    expect(selections[1]).toBe(selections[0]);
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('changing the selector selects the new part immediately', async () => {
  const signal = new SSignal({ fps: 60, memory: 10 });

  function View({ field }: { field: 'fps' | 'memory' }) {
    return createElement(
      'span',
      null,
      useSignal(signal, (value) => value[field]),
    );
  }

  const renderer = await mount(createElement(View, { field: 'fps' }));

  try {
    expect(renderer.toJSON()).toMatchObject({ children: ['60'] });
    await act(async () => {
      renderer.update(createElement(View, { field: 'memory' }));
    });
    expect(renderer.toJSON()).toMatchObject({ children: ['10'] });
  } finally {
    await act(async () => renderer.unmount());
  }
});

test('collector hooks accept a selector and still return the full snapshot without one', async () => {
  const monitor = createMonitor({ collectors: [] });
  const network = monitor.network.snapshot;
  const selected = jest.fn();
  const full = jest.fn();

  function Selected() {
    selected(
      useNetwork(monitor, (snap) => snap.window5s.count),
      useMonitor(monitor, (snap) => snap.network.window5s.errorRate),
    );

    return null;
  }

  function Full() {
    full(useNetwork(monitor));

    return null;
  }

  const renderer = await mount(
    createElement('div', null, createElement(Selected), createElement(Full)),
  );

  try {
    expect(full).toHaveBeenLastCalledWith(network.value);
    await act(async () => {
      network.value = { ...network.value, entries: [] };
    });
    // The full snapshot changed, but neither selection did.
    expect(full).toHaveBeenCalledTimes(2);
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenLastCalledWith(0, 0);
  } finally {
    await act(async () => renderer.unmount());
    monitor.destroy();
  }
});

test('shallowEqual compares one level deep', () => {
  expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
  expect(shallowEqual([1, 2], [1, 2])).toBe(true);
  expect(shallowEqual(NaN, NaN)).toBe(true);
  expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(shallowEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
  expect(shallowEqual({ a: { nested: 1 } }, { a: { nested: 1 } })).toBe(false);
  expect(shallowEqual([1], { 0: 1 })).toBe(false);
  expect(shallowEqual(null, {})).toBe(false);
});
