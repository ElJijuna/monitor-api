import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type SSignal from 'ssignal';
import { shallowEqual } from '../../core/shallowEqual';

export { shallowEqual };

/** Decides whether two selected values are the same, so the component can skip a render. */
export type EqualityFn<S> = (previous: S, next: S) => boolean;

const NO_SELECTION = Symbol('no selection');

/**
 * Subscribes a React component to an `SSignal` value.
 *
 * This hook uses React's `useSyncExternalStore`, making it suitable for concurrent
 * rendering while keeping React components in sync with monitor signals.
 *
 * Pass a `selector` to subscribe to part of the value: the component re-renders only when
 * the selected value changes, compared with `Object.is` or the given `isEqual`. Use
 * {@link shallowEqual} when the selector builds a new object or array.
 *
 * @example
 * ```tsx
 * const errorRate = useSignal(monitor.network.snapshot, (snap) => snap.window5s.errorRate)
 * ```
 */
export function useSignal<T>(signal: SSignal<T>): T;
export function useSignal<T, S>(
  signal: SSignal<T>,
  selector: (value: T) => S,
  isEqual?: EqualityFn<S>,
): S;

export function useSignal<T, S>(
  signal: SSignal<T>,
  selector?: (value: T) => S,
  isEqual?: EqualityFn<S>,
): T | S {
  return useSelectedSignal(signal, selector, isEqual);
}

/** Non-overloaded form shared by the collector hooks. */
export function useSelectedSignal<T, S>(
  signal: SSignal<T>,
  selector: ((value: T) => S) | undefined,
  isEqual: EqualityFn<S> = Object.is,
): T | S {
  const subscribe = useCallback((notify: () => void) => signal.subscribe(() => notify()), [signal]);
  // The selection React last rendered, so a new selector closure can keep returning it.
  const rendered = useRef<T | S | typeof NO_SELECTION>(NO_SELECTION);
  const getSnapshot = useMemo((): (() => T | S) => {
    if (!selector) {
      return () => signal.value;
    }

    let lastValue: T;
    let lastSelection: S | typeof NO_SELECTION = NO_SELECTION;

    return () => {
      const { value } = signal;

      if (lastSelection !== NO_SELECTION && Object.is(value, lastValue)) {
        return lastSelection;
      }

      const next = selector(value);
      // Only selections are rendered while a selector is set, so the stored value is an S.
      const previous = (lastSelection === NO_SELECTION ? rendered.current : lastSelection) as
        | S
        | typeof NO_SELECTION;

      lastValue = value;
      // Returning the previous reference lets useSyncExternalStore bail out of the render.
      lastSelection = previous !== NO_SELECTION && isEqual(previous, next) ? previous : next;

      return lastSelection;
    };
  }, [signal, selector, isEqual]);
  const selection = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    rendered.current = selection;
  }, [selection]);

  return selection;
}
