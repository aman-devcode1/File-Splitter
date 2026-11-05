import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from './byte-split';

const MIME_BY_KIND: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/png', // GIF ka pehla frame PNG me save hoga
  bmp: 'image/png',
};

export interface TileRange {
  readonly index: number;
  readonly start: number; // x pixel, inclusive
  readonly end: number; // x pixel, exclusive
}

/** Splits the width into `tiles` vertical strips. The last strip may be a pixel wider or narrower. */
export function planTiles(width: number, tiles: number): TileRange[] {
  if (!Number.isSafeInteger(width) || width < 1) throw new RangeError('Invalid image width.');
  if (!Number.isSafeInteger(tiles) || tiles < 1) throw new RangeError('Tiles must be at least 1.');
  const count = Math.min(tiles, width);
  const ranges: TileRange[] = [];
  for (let i = 0; i < count; i++) {
    ranges.push({
      index: i,
      start: Math.floor((i * width) / count),
      end: Math.floor(((i + 1) * width) / count),
    });
  }
  return ranges;
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be read. It may be damaged. Byte split works for any file.');
  }
}

export async function countTiles(file: File): Promise<number> {
  const img = await decode(file);
  const width = img.width;
  img.close();
  return width;
}

export const imageTilesEngine = {
  id: 'image-tiles' as const,

  async split(file: File, detected: DetectedFile, tiles: number): Promise<SplitPart[]> {
    const img = await decode(file);
    const ranges = planTiles(img.width, tiles);
    const mime = MIME_BY_KIND[detected.kind.id] ?? 'image/png';
    const parts: SplitPart[] = [];

    for (const r of ranges) {
      const w = r.end - r.start;
      const canvas = new OffscreenCanvas(w, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available in this browser.');
      ctx.drawImage(img, r.start, 0, w, img.height, 0, 0, w, img.height);
      const blob = await canvas.convertToBlob({ type: mime, quality: 0.95 });
      const name = partFileName(file.name, r.index, ranges.length);
      parts.push({ name: mime === 'image/png' && !file.name.toLowerCase().endsWith('.png')
        ? name.replace(/\.[^.]+$/, '.png')
        : name, blob });
    }

    img.close();
    return parts;
  },
};