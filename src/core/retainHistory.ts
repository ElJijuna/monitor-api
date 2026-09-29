export function validateMaxHistory(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('maxHistory must be a finite non-negative safe integer');
  }
}

export function appendHistory<T>(
  current: readonly T[],
  additions: readonly T[],
  maxHistory: number,
): T[] {
  validateMaxHistory(maxHistory);

  if (maxHistory === 0) {
    return [];
  }

  if (additions.length >= maxHistory) {
    return additions.slice(-maxHistory);
  }

  return [...current.slice(-Math.min(current.length, maxHistory - additions.length)), ...additions];
}

/**
 * Recovers how `appendHistory` turned `previous` into `next`: the entries dropped from its front
 * and the entries appended at the end. Returns null when `next` does not continue `previous`, for
 * example after a clear or when every retained entry was replaced, so callers rebuild instead.
 * Costs O(removed + added), not O(history).
 */
export function diffHistory<T>(
  previous: readonly T[],
  next: readonly T[],
): { removed: readonly T[]; added: readonly T[] } | null {
  const dropped = next.length === 0 ? -1 : previous.indexOf(next[0] as T);

  if (dropped === -1) {
    return null;
  }

  const kept = previous.length - dropped;

  if (kept > next.length || next[kept - 1] !== previous[previous.length - 1]) {
    return null;
  }

  return { removed: previous.slice(0, dropped), added: next.slice(kept) };
}
