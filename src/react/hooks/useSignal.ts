import { useCallback, useSyncExternalStore } from 'react';
import type SSignal from 'ssignal';

/**
 * Subscribes a React component to an `SSignal` value.
 *
 * This hook uses React's `useSyncExternalStore`, making it suitable for concurrent
 * rendering while keeping React components in sync with monitor signals.
 */
export function useSignal<T>(signal: SSignal<T>): T {
  const subscribe = useCallback((notify: () => void) => signal.subscribe(() => notify()), [signal]);
  const getSnapshot = useCallback(() => signal.value, [signal]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
