import { describe, expect, it } from 'vitest';
import {
  detectFile,
  modesFor,
  parseModeInput,
  splitFile,
  MODES,
  planBytes,
  toBytes,
  partFileName,
} from '../index';

const file = (name: string, bytes: number[] | string) =>
  new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name);

describe('detectFile', () => {
  it('uses the signature even when the extension is wrong', async () => {
    const d = await detectFile(file('photo.jpg', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
    expect(d.kind.id).toBe('png');
    expect(d.method).toBe('signature');
  });

  it('detects MP4 from the ftyp box', async () => {
    const bytes = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
    const d = await detectFile(file('movie.mp4', bytes));
    expect(d.kind.id).toBe('mp4');
  });

  it('picks the ZIP-based kind by extension', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0];
    expect((await detectFile(file('report.docx', bytes))).kind.id).toBe('docx');
    expect((await detectFile(file('data.zip', bytes))).kind.id).toBe('zip');
  });

  it('falls back to extension, then to text heuristic, then to unknown', async () => {
    expect((await detectFile(file('data.csv', 'a,b\n1,2'))).method).toBe('extension');
    expect((await detectFile(file('notes', 'just some text'))).method).toBe('text-heuristic');
    expect((await detectFile(file('blob', [0, 1, 2, 0, 255]))).kind.id).toBe('unknown');
  });
});

describe('modesFor', () => {
  it('always includes byte split first', async () => {
    const d = await detectFile(file('blob', [0, 1, 2, 0, 255]));
    const modes = modesFor(d);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes[0].id).toBe('bytes');
  });

      it('shows only structure modes for PDF, without byte split', async () => {
    const d = await detectFile(file('report.pdf', '%PDF-1.4'));
    expect(modesFor(d).map((m) => m.id)).toEqual(['pdf-pages']);
  });

  it('keeps byte split for text, because text parts stay readable', async () => {
    const d = await detectFile(file('notes.txt', 'hello world'));
    expect(modesFor(d).map((m) => m.id)).toContain('bytes');
  });
});

describe('byte split', () => {
  it('plans ranges that cover the whole file', () => {
    expect(planBytes(10, 4)).toEqual([
      { index: 0, start: 0, end: 4 },
      { index: 1, start: 4, end: 8 },
      { index: 2, start: 8, end: 10 },
    ]);
  });

  it('converts units exactly', () => {
    expect(toBytes('2.5', 'MB')).toEqual({ ok: true, value: 2_500_000 });
    expect(toBytes('1', 'MiB')).toEqual({ ok: true, value: 1_048_576 });
    expect(toBytes('1.5', 'B').ok).toBe(false);
    expect(toBytes('0', 'KB').ok).toBe(false);
  });

  it('names parts with padding and keeps the extension', () => {
    expect(partFileName('movie.mp4', 0, 3)).toBe('movie_PART001.mp4');
    expect(partFileName('README', 11, 20)).toBe('README_PART012');
  });

  it('rebuilds the exact original bytes from all parts', async () => {
    const original = Uint8Array.from({ length: 10_007 }, (_, i) => (i * 31) % 256);
    const f = new File([original], 'data.bin');
    const d = await detectFile(f);
    const input = parseModeInput(MODES[0], '2.5', 'KB');
    if (!input.ok) throw new Error(input.error);

    const parts = await splitFile(f, d, 'bytes', input.value);
    expect(parts.length).toBe(5);

    const rebuilt = new Uint8Array(await new Blob(parts.map((p) => p.blob)).arrayBuffer());
    expect(rebuilt).toEqual(original);
  });
});