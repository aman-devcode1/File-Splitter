import type { SplitPart } from '../types';
import { partFileName } from './byte-split';

const UNREADABLE = 'This WAV file could not be read. Byte split works for any file.';

interface Fmt {
  readonly blockAlign: number;
  readonly byteRate: number;
  readonly channels: number;
  readonly bits: number;
}

function ascii(view: DataView, pos: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(pos + i));
  return s;
}

/** Walks RIFF chunks and returns the fmt info and the data chunk position. */
export function readWavLayout(view: DataView): { fmt: Fmt; dataStart: number; dataSize: number } {
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') throw new Error(UNREADABLE);
  let fmt: Fmt | null = null;
  let pos = 12;
  while (pos + 8 <= view.byteLength) {
    const id = ascii(view, pos, 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: view.getUint16(body + 2, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.blockAlign === 0) throw new Error(UNREADABLE);
      const dataSize = Math.min(size, view.byteLength - body);
      return { fmt, dataStart: body, dataSize };
    }
    pos = body + size + (size % 2);
  }
  throw new Error(UNREADABLE);
}

function header(dataBytes: number, f: Fmt): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(44));
  const v = new DataView(out.buffer);
  const write = (pos: number, s: string) => { for (let i = 0; i < 4; i++) out[pos + i] = s.charCodeAt(i); };
  write(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, f.channels, true);
  // sample rate is derived from byteRate
  v.setUint32(24, f.byteRate / f.blockAlign, true);
  v.setUint32(28, f.byteRate, true);
  v.setUint16(32, f.blockAlign, true);
  v.setUint16(34, f.bits, true);
  write(36, 'data');
  v.setUint32(40, dataBytes, true);
  return out;
}

export async function splitWav(file: File, clipSeconds: number): Promise<SplitPart[]> {
  let layout: ReturnType<typeof readWavLayout>;
  try {
    layout = readWavLayout(new DataView(await file.slice(0, Math.min(file.size, 1 << 20)).arrayBuffer()));
  } catch {
    throw new Error(UNREADABLE);
  }
  const { fmt, dataStart, dataSize } = layout;
  // Cut only on whole sample frames, so no sample is split across two files.
  const clipBytes = Math.max(fmt.blockAlign, Math.floor((clipSeconds * fmt.byteRate) / fmt.blockAlign) * fmt.blockAlign);
  const count = Math.max(1, Math.ceil(dataSize / clipBytes));
  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const from = dataStart + i * clipBytes;
    const to = Math.min(dataStart + dataSize, from + clipBytes);
    const len = to - from;
    parts.push({
      name: partFileName(file.name, i, count),
            blob: new Blob([header(len, fmt), file.slice(from, to)] as BlobPart[], { type: 'audio/wav' }),
    });
  }
  return parts;
}