export function appendHistory<T>(
  current: readonly T[],
  additions: readonly T[],
  maxHistory: number,
): T[] {
  if (maxHistory === 0) {
    return [];
  }

  return [...current, ...additions].slice(-maxHistory);
}
