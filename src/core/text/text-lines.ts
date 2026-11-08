import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

/** Splits text into lines and keeps each line ending, so joining the lines gives the same text back. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Groups lines into parts. The last part may be shorter. */
export function planLines(totalLines: number, linesPerPart: number): { index: number; start: number; end: number }[] {
  if (!Number.isSafeInteger(totalLines) || totalLines < 0) {
    throw new RangeError('Invalid line count.');
  }
  if (!Number.isSafeInteger(linesPerPart) || linesPerPart < 1) {
    throw new RangeError('Lines per part must be at least 1.');
  }
  const ranges: { index: number; start: number; end: number }[] = [];
  for (let start = 0; start < totalLines; start += linesPerPart) {
    ranges.push({ index: ranges.length, start, end: Math.min(start + linesPerPart, totalLines) });
  }
  return ranges;
}

export const textLinesEngine = {
  id: 'text-lines' as const,

  async split(file: File, _detected: DetectedFile, linesPerPart: number): Promise<SplitPart[]> {
    const lines = splitLines(await file.text());
    if (lines.length === 0) {
      throw new Error('This file has no lines to split.');
    }

    const ranges = planLines(lines.length, linesPerPart);
    return ranges.map((r) => ({
      name: partFileName(file.name, r.index, ranges.length),
      blob: new Blob([lines.slice(r.start, r.end).join('')], { type: 'text/plain;charset=utf-8' }),
    }));
  },
};

export async function countLines(file: File): Promise<number> {
  return splitLines(await file.text()).length;
}