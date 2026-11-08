import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

const UNREADABLE = 'This WAV file could not be read. Byte split works for any file.';
/** How much of the file start is read to find the header. Chunks before "data" are small. */
const HEAD_BYTES = 4 << 20;

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

/**
 * Walks the RIFF chunks. fileSize is the real file size, so the data size is not cut
 * down to the length of the head that was read.
 */
export function readWavLayout(
  view: DataView,
  fileSize: number,
): { fmt: Fmt; dataStart: number; dataSize: number } {
  if (view.byteLength < 12 || ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') {
    throw new Error(UNREADABLE);
  }
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
      // Size 0 or 0xFFFFFFFF means "until the end of the file" (streamed WAV).
      const declared = size === 0 || size === 0xffffffff ? fileSize - body : size;
      return { fmt, dataStart: body, dataSize: Math.max(0, Math.min(declared, fileSize - body)) };
    }
    pos = body + size + (size % 2);
  }
  throw new Error(UNREADABLE);
}

async function readLayout(file: File) {
  const head = new DataView(await file.slice(0, Math.min(file.size, HEAD_BYTES)).arrayBuffer());
  return readWavLayout(head, file.size);
}

/** Seconds of audio in a WAV file. */
export async function wavDuration(file: File): Promise<number | null> {
  const { fmt, dataSize } = await readLayout(file);
  return fmt.byteRate > 0 ? dataSize / fmt.byteRate : null;
}

function header(dataBytes: number, f: Fmt): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(44));
  const v = new DataView(out.buffer);
  const write = (pos: number, s: string) => {
    for (let i = 0; i < 4; i++) out[pos + i] = s.charCodeAt(i);
  };
  write(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, f.channels, true);
  v.setUint32(24, f.byteRate / f.blockAlign, true); // sample rate
  v.setUint32(28, f.byteRate, true);
  v.setUint16(32, f.blockAlign, true);
  v.setUint16(34, f.bits, true);
  write(36, 'data');
  v.setUint32(40, dataBytes, true);
  return out;
}

export async function splitWav(file: File, clipSeconds: number): Promise<SplitPart[]> {
  let layout: Awaited<ReturnType<typeof readLayout>>;
  try {
    layout = await readLayout(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  const { fmt, dataStart, dataSize } = layout;
  // Cut only on whole sample frames, so no sample is split across two files.
  const clipBytes = Math.max(
    fmt.blockAlign,
    Math.floor((clipSeconds * fmt.byteRate) / fmt.blockAlign) * fmt.blockAlign,
  );
  const count = Math.max(1, Math.ceil(dataSize / clipBytes));
  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const from = dataStart + i * clipBytes;
    const to = Math.min(dataStart + dataSize, from + clipBytes);
    parts.push({
      name: partFileName(file.name, i, count),
      blob: new Blob([header(to - from, fmt), file.slice(from, to)], { type: 'audio/wav' }),
    });
  }
  return parts;
}