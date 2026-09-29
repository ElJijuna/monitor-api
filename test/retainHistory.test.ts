import { appendHistory, diffHistory } from '../src/core/retainHistory';

const a = { id: 'a' };
const b = { id: 'b' };
const c = { id: 'c' };
const d = { id: 'd' };

test('diffHistory recovers the entries appendHistory dropped and appended', () => {
  const previous = [a, b, c];
  const next = appendHistory(previous, [d], 3);

  expect(diffHistory(previous, next)).toEqual({ removed: [a], added: [d] });
  expect(diffHistory([a], appendHistory([a], [b], 5))).toEqual({ removed: [], added: [b] });
  expect(diffHistory(previous, previous)).toEqual({ removed: [], added: [] });
});

test('diffHistory returns null when the new history does not continue the previous one', () => {
  // Cleared, replaced entirely, or reordered.
  expect(diffHistory([a, b], [])).toBeNull();
  expect(diffHistory([], [a])).toBeNull();
  expect(diffHistory([a, b], appendHistory([a, b], [c, d], 2))).toBeNull();
  expect(diffHistory([a, b, c], [b, a])).toBeNull();
  expect(diffHistory([a, b, c], [b])).toBeNull();
});
