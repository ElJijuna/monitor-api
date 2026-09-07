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
