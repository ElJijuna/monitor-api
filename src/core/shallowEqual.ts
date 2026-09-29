/**
 * Compares two values one level deep: equal primitives, or objects and arrays whose own
 * properties are `Object.is`-equal. Use it as `isEqual` when a selector returns a new object.
 */
export function shallowEqual<S>(previous: S, next: S): boolean {
  if (Object.is(previous, next)) {
    return true;
  }

  if (
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    previous === null ||
    next === null ||
    Array.isArray(previous) !== Array.isArray(next)
  ) {
    return false;
  }

  const previousKeys = Object.keys(previous);

  return (
    previousKeys.length === Object.keys(next).length &&
    previousKeys.every(
      (key) =>
        Object.prototype.propertyIsEnumerable.call(next, key) &&
        Object.is(
          (previous as Record<string, unknown>)[key],
          (next as Record<string, unknown>)[key],
        ),
    )
  );
}
