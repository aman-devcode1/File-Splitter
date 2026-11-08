import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const UNREADABLE = 'This MP3 could not be read. Byte split works for any file.';

/** MPEG-1 and MPEG-2 Layer III bitrate tables (kbps), indexed by the 4-bit bitrate field. */
const BITRATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
/** By MPEG version id: 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5. */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

export interface Mp3Frame {
  readonly start: number;
  readonly size: number;
  readonly samples: number;
  readonly sampleRate: number;
}

interface FrameInfo {
  readonly size: number;
  readonly samples: number;
  readonly sampleRate: number;
}

/** Reads one 4-byte MPEG audio frame header. Returns null if the bytes are not a valid header. */
export function parseFrameHeader(b: Uint8Array, p: number): FrameInfo | null {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[p + 1] >> 3) & 3;
  const layer = (b[p + 1] >> 1) & 3;
  if (version === 1 || layer !== 1) return null; // only MPEG Layer III
  const bitrateIndex = b[p + 2] >> 4;
  const rateIndex = (b[p + 2] >> 2) & 3;
  const padding = (b[p + 2] >> 1) & 1;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? BITRATE_V1 : BITRATE_V2)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const samples = mpeg1 ? 1152 : 576;
  const size = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
  return { size, samples, sampleRate };
}

/** Length of an ID3v2 tag at the start of the file (0 if there is none). */
function id3Length(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Every audio frame in the file, with its byte position and the time it covers. */
export async function readMp3(
  file: File,
): Promise<{ frames: Mp3Frame[]; lastEnd: number; duration: number }> {
  const b = new Uint8Array(await file.arrayBuffer());

  // Skip an ID3v1 tag ("TAG", last 128 bytes) at the end.
  let end = b.length;
  if (end >= 128 && b[end - 128] === 0x54 && b[end - 127] === 0x41 && b[end - 126] === 0x47) {
    end -= 128;
  }

  const frames: Mp3Frame[] = [];
  let p = id3Length(b);
  while (p < end) {
    const h = parseFrameHeader(b, p);
    if (!h) {
      p++; // not on a frame boundary, look further
      continue;
    }
    if (p + h.size > end) break; // truncated last frame
    frames.push({ start: p, size: h.size, samples: h.samples, sampleRate: h.sampleRate });
    p += h.size;
  }

  if (frames.length === 0) throw new Error(UNREADABLE);
  let duration = 0;
  for (const f of frames) duration += f.samples / f.sampleRate;
  const last = frames[frames.length - 1];
  return { frames, lastEnd: last.start + last.size, duration };
}

/** Cuts an MP3 into clips of about clipSeconds, on frame boundaries. No re-encoding. */
export async function splitMp3(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const { frames, lastEnd, duration } = await readMp3(file);
  const n = frames.length;

  const secs = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    secs[i] = acc;
    acc += frames[i].samples / frames[i].sampleRate;
  }
  // Every MP3 frame can be a cut point, so every index is a sync point.
  const sync = Array.from({ length: n }, (_, i) => i);
  const cuts = planCuts(secs, sync, duration, clipSeconds, n);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    // The first part keeps the ID3 tag (title, artist). Later parts start at their first frame.
    const start = i === 0 ? 0 : frames[from].start;
    const end = to < n ? frames[to].start : lastEnd;
    parts.push({
      name: partFileName(file.name, i, count),
      blob: file.slice(start, end, 'audio/mpeg'),
    });
  }
  return parts;
}