let encoder: TextEncoder | null = null;

/**
 * Whether `value` encodes to at most `maxBytes` UTF-8 bytes.
 *
 * A UTF-16 code unit encodes to 1–3 bytes (a surrogate pair's two units to 4), so the string
 * length alone decides most cases. Only the ambiguous range is encoded, with the native encoder,
 * which is much faster than counting code points in JavaScript.
 */
export function fitsInUtf8Bytes(value: string, maxBytes: number): boolean {
  if (value.length * 3 <= maxBytes) {
    return true;
  }

  if (value.length > maxBytes) {
    return false;
  }

  encoder ??= new TextEncoder();

  return encoder.encode(value).byteLength <= maxBytes;
}
