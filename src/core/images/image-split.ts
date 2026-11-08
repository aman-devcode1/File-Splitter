import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

export type Axis = 'horizontal' | 'vertical';
export type Diagonal = 'tl-br' | 'tr-bl';

export interface Band {
  readonly index: number;
  readonly start: number; // inclusive, in pixels
  readonly end: number; // exclusive, in pixels
}

interface Point {
  readonly x: number;
  readonly y: number;
}

export const MIN_PARTS = 3;
export const MIN_PERCENT = 1;
export const MAX_PERCENT = 99;

const UNREADABLE =
  'This image could not be read. It may be damaged. Byte split works for any file.';

/** Output format for straight cuts. GIF keeps only the first frame, so it becomes PNG. */
const MIME_BY_KIND: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/png',
  bmp: 'image/png',
};

/** Pixel position of a cut that gives `percent` of `size` to the first part. */
export function percentCut(size: number, percent: number): number {
  if (!Number.isSafeInteger(percent) || percent < MIN_PERCENT || percent > MAX_PERCENT) {
    throw new RangeError(`Percent must be a whole number from ${MIN_PERCENT} to ${MAX_PERCENT}.`);
  }
  const cut = Math.round((size * percent) / 100);
  if (cut < 1 || cut > size - 1) {
    throw new RangeError('This image is too small to split by this percentage.');
  }
  return cut;
}

/** Two bands: the first gets `percent`, the second gets the rest. */
export function percentBands(size: number, percent: number): Band[] {
  const cut = percentCut(size, percent);
  return [
    { index: 0, start: 0, end: cut },
    { index: 1, start: cut, end: size },
  ];
}

/**
 * Equal bands. Boundaries are floor(i * size / count), so band sizes differ by at most 1 pixel.
 * The count must be at least MIN_PARTS and cannot be larger than size.
 */
export function equalBands(size: number, count: number): Band[] {
  if (!Number.isSafeInteger(count) || count < MIN_PARTS) {
    throw new RangeError(`Enter at least ${MIN_PARTS} parts.`);
  }
  if (count > size) {
    throw new RangeError(`This image is only ${size} pixels, so it cannot be split into ${count} parts.`);
  }
  const bands: Band[] = [];
  for (let i = 0; i < count; i++) {
    bands.push({
      index: i,
      start: Math.floor((i * size) / count),
      end: Math.floor(((i + 1) * size) / count),
    });
  }
  return bands;
}

/** The two triangles for a diagonal cut. Each triangle is a polygon in pixel coordinates. */
export function diagonalTriangles(w: number, h: number, dir: Diagonal): [Point[], Point[]] {
  if (dir === 'tl-br') {
    // Line from (0,0) to (w,h)
    return [
      [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }],
      [{ x: 0, y: 0 }, { x: 0, y: h }, { x: w, y: h }],
    ];
  }
  // Line from (w,0) to (0,h)
  return [
    [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }],
    [{ x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
  ];
}

function withExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${ext}`;
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error(UNREADABLE);
  }
}

function makeContext(w: number, h: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  if (w < 1 || h < 1) throw new Error('This image part has no pixels.');
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  return { canvas, ctx };
}

/** Diagonal cut: 2 PNG triangles. Outside the triangle is transparent. */
export async function splitDiagonal(file: File, dir: Diagonal): Promise<SplitPart[]> {
  const img = await decode(file);
  try {
    const triangles = diagonalTriangles(img.width, img.height, dir);
    const parts: SplitPart[] = [];

    for (let i = 0; i < triangles.length; i++) {
      const poly = triangles[i];
      const { canvas, ctx } = makeContext(img.width, img.height);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      parts.push({ name: partFileName(withExt(file.name, 'png'), i, triangles.length), blob });
    }
    return parts;
  } finally {
    img.close();
  }
}

/** Straight cut along one axis. The planner gets the size of the image on that axis. */
async function splitBands(
  file: File,
  detected: DetectedFile,
  axis: Axis,
  plan: (size: number) => Band[],
): Promise<SplitPart[]> {
  const img = await decode(file);
  try {
    const bands = plan(axis === 'horizontal' ? img.height : img.width);
    const mime = MIME_BY_KIND[detected.kind.id] ?? 'image/png';
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    const parts: SplitPart[] = [];

    for (const b of bands) {
      const len = b.end - b.start;
      const sw = axis === 'horizontal' ? img.width : len;
      const sh = axis === 'horizontal' ? len : img.height;
      const sx = axis === 'horizontal' ? 0 : b.start;
      const sy = axis === 'horizontal' ? b.start : 0;

      const { canvas, ctx } = makeContext(sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
      parts.push({ name: partFileName(withExt(file.name, ext), b.index, bands.length), blob });
    }
    return parts;
  } finally {
    img.close();
  }
}

export function splitPercent(file: File, detected: DetectedFile, axis: Axis, percent: number): Promise<SplitPart[]> {
  return splitBands(file, detected, axis, (size) => percentBands(size, percent));
}

export function splitCount(file: File, detected: DetectedFile, axis: Axis, count: number): Promise<SplitPart[]> {
  return splitBands(file, detected, axis, (size) => equalBands(size, count));
}

/** Max value for a count mode: pixels tall (horizontal) or pixels wide (vertical). */
export async function countImageAxis(file: File, axis: Axis): Promise<number> {
  const img = await decode(file);
  try {
    return axis === 'horizontal' ? img.height : img.width;
  } finally {
    img.close();
  }
}