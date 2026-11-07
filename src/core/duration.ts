import { findBox, parseMoov, topLevelBoxes } from './split/mp4';

/** Total duration in seconds for MP4/MOV/M4A. Returns null if it cannot be read. */
export async function mediaDuration(file: File): Promise<number | null> {
  try {
    const top = await topLevelBoxes(file);
    const moov = findBox(top, 'moov');
    const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
    const movie = parseMoov(bytes, moov.headerSize);
    const view = new DataView(movie.mvhd.buffer, movie.mvhd.byteOffset, movie.mvhd.byteLength);
    const version = view.getUint8(8);
    const duration = version === 1
      ? Number(view.getBigUint64(8 + 4 + 16))
      : view.getUint32(8 + 4 + 12);
    return movie.timescale > 0 ? duration / movie.timescale : null;
  } catch {
    return null;
  }
}

/** "4:59" for under an hour, "1:02:05" for longer. */
export function formatClock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}