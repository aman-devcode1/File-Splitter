import JSZip from 'jszip';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from './byte-split';

export interface EntryRange {
  readonly index: number;
  readonly start: number; // inclusive
  readonly end: number; // exclusive
}

/** Groups entries (file paths inside the archive) into parts. The last group may be shorter. */
export function planEntries(totalEntries: number, entriesPerPart: number): EntryRange[] {
  if (!Number.isSafeInteger(totalEntries) || totalEntries < 0) {
    throw new RangeError('Invalid entry count.');
  }
  if (!Number.isSafeInteger(entriesPerPart) || entriesPerPart < 1) {
    throw new RangeError('Entries per part must be at least 1.');
  }
  const ranges: EntryRange[] = [];
  for (let start = 0; start < totalEntries; start += entriesPerPart) {
    ranges.push({
      index: ranges.length,
      start,
      end: Math.min(start + entriesPerPart, totalEntries),
    });
  }
  return ranges;
}

const UNREADABLE =
  'This archive could not be read. It may be damaged or password-protected. Byte split works for any file.';

export const zipEntriesEngine = {
  id: 'zip-entries' as const,

  async split(file: File, detected: DetectedFile, entriesPerPart: number): Promise<SplitPart[]> {
    let source: JSZip;
    try {
      source = await JSZip.loadAsync(file);
    } catch {
      throw new Error(UNREADABLE);
    }

    // Only real files, not folder entries.
    const names = Object.values(source.files)
      .filter((e) => !e.dir)
      .map((e) => e.name);

    if (names.length === 0) {
      throw new Error('This archive has no files inside to split.');
    }

    const ranges = planEntries(names.length, entriesPerPart);
    const parts: SplitPart[] = [];

    for (const range of ranges) {
      const output = new JSZip();
      for (const name of names.slice(range.start, range.end)) {
        const data = await source.file(name)!.async('uint8array');
        output.file(name, data);
      }
      const blob = await output.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      parts.push({
        name: partFileName(file.name, range.index, ranges.length),
        blob,
      });
    }

    return parts;
  },
};

export async function countZipEntries(file: File): Promise<number> {
  const source = await JSZip.loadAsync(file);
  return Object.values(source.files).filter((e) => !e.dir).length;
}