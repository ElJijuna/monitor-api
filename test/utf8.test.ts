import { fitsInUtf8Bytes } from '../src/core/utf8';

const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;
const samples = [
  '',
  'plain ascii',
  'ñandú',
  '€ 1.000',
  'emoji 😀 and 🚀',
  '日本語のテキスト',
  'lone surrogate \ud800 end',
  'mixed ñ€😀 text',
];

test.each(samples)('agrees with TextEncoder at every limit around %j', (value) => {
  const bytes = utf8Length(value);

  for (let maxBytes = 0; maxBytes <= bytes + 2; maxBytes += 1) {
    expect(fitsInUtf8Bytes(value, maxBytes)).toBe(bytes <= maxBytes);
  }
});

test('decides from the length alone when every code unit could take 3 bytes', () => {
  const value = '€'.repeat(10);

  // 10 units × 3 bytes: fits without encoding, including an exact fit.
  expect(fitsInUtf8Bytes(value, 30)).toBe(true);
  // More code units than bytes can never fit.
  expect(fitsInUtf8Bytes('a'.repeat(11), 10)).toBe(false);
});

test('encodes only the ambiguous range', () => {
  // 20 ASCII units: 20 bytes, below the 3-byte bound of 60.
  expect(fitsInUtf8Bytes('a'.repeat(20), 20)).toBe(true);
  expect(fitsInUtf8Bytes('a'.repeat(20), 19)).toBe(false);
  // Two 4-byte emoji are 4 units and 8 bytes.
  expect(fitsInUtf8Bytes('😀😀', 8)).toBe(true);
  expect(fitsInUtf8Bytes('😀😀', 7)).toBe(false);
});
