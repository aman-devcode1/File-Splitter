import { describe, expect, it } from 'vitest';
import { detectFile, modesFor, MODES, parseModeInput, percentBands, equalBands, diagonalTriangles } from '../index';

describe('percent bands', () => {
  it('gives the first part the percent and the rest to the second', () => {
    expect(percentBands(1000, 20)).toEqual([
      { index: 0, start: 0, end: 200 },
      { index: 1, start: 200, end: 1000 },
    ]);
  });

  it('rejects 0, 100, decimals and negatives', () => {
    expect(() => percentBands(1000, 0)).toThrow();
    expect(() => percentBands(1000, 100)).toThrow();
    expect(() => percentBands(1000, 1.5)).toThrow();
    expect(() => percentBands(1000, -5)).toThrow();
  });
});

describe('equal bands', () => {
  it('covers the whole size with bands differing by at most 1', () => {
    const b = equalBands(10, 3);
    expect(b.map((x) => [x.start, x.end])).toEqual([[0, 3], [3, 6], [6, 10]]);
  });

  it('rejects counts below 3 and above the size', () => {
    expect(() => equalBands(10, 2)).toThrow();
    expect(() => equalBands(3, 4)).toThrow();
  });
});

describe('diagonal triangles', () => {
  it('top-left to bottom-right uses the top-right and bottom-left halves', () => {
    const [a, b] = diagonalTriangles(100, 50, 'tl-br');
    expect(a).toContainEqual({ x: 100, y: 50 });
    expect(b).toContainEqual({ x: 0, y: 50 });
  });
});

describe('image modes and input rules', () => {
  it('offers only image modes for a PNG', async () => {
    const f = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], 'a.png');
    const d = await detectFile(f);
    const ids = modesFor(d).map((m) => m.id);
    expect(ids).toEqual([
      'image-diag-tlbr',
      'image-diag-trbl',
      'image-h-percent',
      'image-h-count',
      'image-v-percent',
      'image-v-count',
    ]);
  });

  it('rejects negative, decimal and over-limit values', () => {
    const pct = MODES.find((m) => m.id === 'image-h-percent')!;
    expect(parseModeInput(pct, '-5').ok).toBe(false);
    expect(parseModeInput(pct, '2.5').ok).toBe(false);
    expect(parseModeInput(pct, '100').ok).toBe(false);
    expect(parseModeInput(pct, '20').ok).toBe(true);

    const cnt = MODES.find((m) => m.id === 'image-h-count')!;
    expect(parseModeInput(cnt, '2', undefined, 100).ok).toBe(false);
    expect(parseModeInput(cnt, '3', undefined, 100).ok).toBe(true);
    expect(parseModeInput(cnt, '100', undefined, 50).ok).toBe(false);
    expect(parseModeInput(cnt, '10000000').ok).toBe(false);
  });
});