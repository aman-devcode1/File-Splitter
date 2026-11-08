import { describe, expect, it } from 'vitest';
import { detectFile, modesFor, planLines, splitFile, splitLines } from '../index';

const sample = Array.from({ length: 7 }, (_, i) => `line ${i + 1}\n`).join('');

describe('splitLines', () => {
  it('keeps line endings so joining gives the same text back', () => {
    const lines = splitLines('a\nb\nc');
    expect(lines).toEqual(['a\n', 'b\n', 'c']);
    expect(lines.join('')).toBe('a\nb\nc');
  });

  it('returns no lines for empty text', () => {
    expect(splitLines('')).toEqual([]);
  });
});

describe('planLines', () => {
  it('keeps the shorter last group', () => {
    expect(planLines(7, 3)).toEqual([
      { index: 0, start: 0, end: 3 },
      { index: 1, start: 3, end: 6 },
      { index: 2, start: 6, end: 7 },
    ]);
  });
});

describe('text-lines engine', () => {
  it('is offered for text and CSV files only', async () => {
    const txt = await detectFile(new File([sample], 'notes.txt'));
    const json = await detectFile(new File(['{"a":1}'], 'data.json'));
    expect(modesFor(txt).map((m) => m.id)).toContain('text-lines');
    expect(modesFor(json).map((m) => m.id)).not.toContain('text-lines');
  });

  it('splits 7 lines into 3, 3 and 1 line files', async () => {
    const f = new File([sample], 'notes.txt');
    const d = await detectFile(f);

    const parts = await splitFile(f, d, 'text-lines', 3);

    expect(parts.map((p) => p.name)).toEqual([
      'notes_PART001.txt',
      'notes_PART002.txt',
      'notes_PART003.txt',
    ]);
    const texts = await Promise.all(parts.map((p) => p.blob.text()));
    expect(texts.map((t) => t.split('\n').filter(Boolean).length)).toEqual([3, 3, 1]);
  });

  it('joins back to the exact original text', async () => {
    const f = new File([sample], 'notes.txt');
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'text-lines', 2);

    const rebuilt = (await Promise.all(parts.map((p) => p.blob.text()))).join('');
    expect(rebuilt).toBe(sample);
  });

  it('rejects an empty file', async () => {
    const f = new File([''], 'empty.txt');
    const d = await detectFile(f);
    await expect(splitFile(f, d, 'text-lines', 3)).rejects.toThrow(/no lines/);
  });
});