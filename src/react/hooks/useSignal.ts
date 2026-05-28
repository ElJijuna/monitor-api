import { useSyncExternalStore } from 'react'
import type SSignal from 'ssignal'

export function useSignal<T>(signal: SSignal<T>): T {
  return useSyncExternalStore(
    (notify) => signal.subscribe(() => notify()),
    () => signal.value,
    () => signal.value,
  )
}
