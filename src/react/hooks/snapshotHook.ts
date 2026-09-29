import type SSignal from 'ssignal';
import type { Monitor } from '../../core/types';
import { type EqualityFn, useSelectedSignal } from './useSignal';

/**
 * A hook that returns a monitor snapshot, or only the part picked by `selector`. With a
 * selector, the component re-renders only when the selected value changes.
 */
export interface SnapshotHook<T> {
  (monitor: Monitor): T;
  <S>(monitor: Monitor, selector: (snapshot: T) => S, isEqual?: EqualityFn<S>): S;
}

export function snapshotHook<T>(pick: (monitor: Monitor) => SSignal<T>): SnapshotHook<T> {
  return function useSnapshot<S>(
    monitor: Monitor,
    selector?: (snapshot: T) => S,
    isEqual?: EqualityFn<S>,
  ) {
    return useSelectedSignal(pick(monitor), selector, isEqual);
  } as SnapshotHook<T>;
}
