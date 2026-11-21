import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planLines } from './text-lines';

/** Splits CSV text into records. A line break inside quotes stays inside its record. */
export function splitRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes; // an escaped "" flips twice, so it stays inside quotes
    } else if (ch === '\n' && !inQuotes) {
      records.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) records.push(text.slice(start));
  return records;
}

export const csvRowsEngine = {
  id: 'csv-rows' as const,

  async split(file: File, _detected: DetectedFile, rowsPerPart: number): Promise<SplitPart[]> {
    const records = splitRecords(await file.text());
    if (records.length < 2) {
      throw new Error('This CSV file has no data rows to split. Only a header row was found.');
    }

    const header = records[0]!;
    const rows = records.slice(1);
    const ranges = planLines(rows.length, rowsPerPart);

    return ranges.map((r) => ({
      name: partFileName(file.name, r.index, ranges.length),
      blob: new Blob([header + rows.slice(r.start, r.end).join('')], { type: 'text/csv;charset=utf-8' }),
    }));
  },
};

export async function countCsvRows(file: File): Promise<number> {
  return Math.max(0, splitRecords(await file.text()).length - 1);
}