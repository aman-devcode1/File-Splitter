import { readMp3 } from './audio/mp3-split';
import { wavDuration } from './audio/wav-split';
import { findBox, parseMoov, topLevelBoxes } from './video/mp4';
import { scanFragments } from './video/mp4-fragmented';
import { readFlac } from './audio/flac-split';
import { oggDuration } from './audio/ogg-split';
import { mkvDuration } from './video/matroska';

async function mp4Duration(file: File): Promise<number | null> {
  const top = await topLevelBoxes(file);
  const moov = findBox(top, 'moov');
  const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
  const movie = parseMoov(bytes, moov.headerSize);
  const view = new DataView(movie.mvhd.buffer, movie.mvhd.byteOffset, movie.mvhd.byteLength);
  const version = view.getUint8(8);
  const duration = version === 1 ? Number(view.getBigUint64(32)) : view.getUint32(24);

  if (duration === 0) {
    const video = movie.tracks.find((t) => t.handler === 'vide') ?? movie.tracks[0];
    const frags = await scanFragments(file, video);
    const last = frags[frags.length - 1];
    return last ? last.time + last.dur : null;
  }
  return movie.timescale > 0 ? duration / movie.timescale : null;
}

/** Total seconds for MP4/MOV/M4A, WAV, MP3. Returns null if it cannot be read. */
export async function mediaDuration(file: File, kindId: string): Promise<number | null> {
  try {
    if (kindId === 'wav') return await wavDuration(file);
    if (kindId === 'mp3') return (await readMp3(file)).duration;
    if (kindId === 'flac') return (await readFlac(file)).duration;
    if (kindId === 'ogg') return await oggDuration(file);
    if (kindId === 'mkv' || kindId === 'webm') return await mkvDuration(file);
    return await mp4Duration(file);
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