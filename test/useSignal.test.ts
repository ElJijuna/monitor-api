import { jest } from '@jest/globals';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import SSignal from 'ssignal';
import { useSignal } from '../src/react';

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
