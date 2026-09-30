import { appendHistory, diffHistory, validateMaxHistory } from '../src/core/retainHistory';

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

test('appendHistory keeps the newest entries within maxHistory without mutating its input', () => {
  const current = Object.freeze([a, b]);
  const additions = Object.freeze([c]);

  expect(appendHistory(current, additions, 5)).toEqual([a, b, c]);
  expect(appendHistory(current, additions, 2)).toEqual([b, c]);
  expect(appendHistory(current, [c, d], 2)).toEqual([c, d]);
  // More additions than room: only the newest additions survive.
  expect(appendHistory(current, [a, b, c, d], 3)).toEqual([b, c, d]);
  expect(appendHistory(current, additions, 0)).toEqual([]);
  expect(appendHistory([], [], 3)).toEqual([]);
  expect(current).toEqual([a, b]);
});

test('appendHistory matches concatenating and keeping the tail', () => {
  // A small deterministic generator keeps the case list reproducible.
  let seed = 7;

  const random = (max: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

    return seed % (max + 1);
  };

  for (let run = 0; run < 500; run += 1) {
    const current = Array.from({ length: random(8) }, (_, i) => `c${i}`);
    const additions = Array.from({ length: random(8) }, (_, i) => `a${i}`);
    const maxHistory = random(10);
    const expected = maxHistory === 0 ? [] : [...current, ...additions].slice(-maxHistory);

    expect(appendHistory(current, additions, maxHistory)).toEqual(expected);
  }
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
  'validateMaxHistory rejects %p',
  (value) => {
    expect(() => validateMaxHistory(value)).toThrow(RangeError);
    expect(() => appendHistory([], [a], value)).toThrow(RangeError);
  },
);

test.each([0, 1, Number.MAX_SAFE_INTEGER])('validateMaxHistory accepts %p', (value) => {
  expect(() => validateMaxHistory(value)).not.toThrow();
});
