import type { Result, SplitPart } from '../types';

export type ByteUnit = 'B' | 'KB' | 'MB' | 'GB' | 'KiB' | 'MiB' | 'GiB';

const UNIT_BYTES: Record<ByteUnit, bigint> = {
  B: 1n,
  KB: 1_000n,
  MB: 1_000_000n,
  GB: 1_000_000_000n,
  KiB: 1_024n,
  MiB: 1_048_576n,
  GiB: 1_073_741_824n,
};

/** Converts text like "2.5" plus a unit into bytes. Uses BigInt, so no floating-point error. */
export function toBytes(text: string, unit: ByteUnit): Result<number> {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return { ok: false, error: 'Use digits, with one decimal point if needed (for example 2.5).' };

  const [, whole, fraction = ''] = match;
  const scale = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(whole) * scale + BigInt(fraction || '0')) * UNIT_BYTES[unit];

  if (unit === 'B' && numerator % scale !== 0n) {
    return { ok: false, error: 'Bytes must be a whole number.' };
  }
  const bytes = numerator / scale;
  if (bytes < 1n) return { ok: false, error: 'The part size must be at least 1 byte.' };
  if (bytes > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, error: 'The part size is too large.' };

  return { ok: true, value: Number(bytes) };
}

export interface ByteRange {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

/** How many parts a split will create. Call this before planBytes to warn the user about huge counts. */
export function countParts(size: number, partSize: number): number {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Invalid file size.');
  if (!Number.isSafeInteger(partSize) || partSize < 1) throw new RangeError('Invalid part size.');
  return size === 0 ? 0 : Math.floor((size + partSize - 1) / partSize);
}

/** Byte ranges [start, end) for every part. The last part may be smaller. */
export function planBytes(size: number, partSize: number): ByteRange[] {
  const count = countParts(size, partSize);
  const ranges: ByteRange[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * partSize;
    ranges.push({ index: i, start, end: Math.min(start + partSize, size) });
  }
  return ranges;
}

/** example.mp4 becomes example_PART001.mp4. The number of digits grows with the part count. */
export function partFileName(name: string, index: number, total: number): string {
  const width = Math.max(3, String(total).length);
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  return `${stem}_PART${String(index + 1).padStart(width, '0')}${ext}`;
}

/** Byte split engine. Works for every file type. Parts are lazy slices, so the file is not copied. */
export const byteEngine = {
  id: 'byte' as const,
  async split(file: File, partSize: number): Promise<SplitPart[]> {
    const ranges = planBytes(file.size, partSize);
    return ranges.map((r) => ({
      name: partFileName(file.name, r.index, ranges.length),
      blob: file.slice(r.start, r.end, 'application/octet-stream'),
    }));
  },
};