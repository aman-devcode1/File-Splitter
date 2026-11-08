import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const UNREADABLE = 'This FLAC file could not be read. Byte split works for any file.';

/** Block size codes 1..15 from the frame header. Codes 6 and 7 are read from the header itself. */
function blockSizeFromCode(code: number): number {
  if (code === 1) return 192;
  if (code >= 2 && code <= 5) return 576 << (code - 2);
  if (code >= 8) return 256 << (code - 8);
  return 0;
}

/** CRC-8 (poly 0x07), used by FLAC frame headers. */
export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

interface Header {
  readonly headerLen: number;
  readonly samples: number;
  readonly number: number;
  readonly variable: boolean;
}

/** Parses and checks (CRC-8) one frame header at position p. Returns null if it is not a frame. */
function parseHeader(b: Uint8Array, p: number): Header | null {
  if (p + 6 > b.length) return null;
  const variable = (b[p + 1] & 0x01) === 1;
  const bsCode = b[p + 2] >> 4;
  if (bsCode === 0) return null;

  let q = p + 4;
  const first = b[q];
  let len = 1;
  let number = first;
  if (first >= 0x80) {
    let n = 0;
    while (n < 8 && (first & (0x80 >> n))) n++;
    if (n < 2 || n > 7) return null;
    len = n;
    number = first & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) {
      if ((b[q + k] & 0xc0) !== 0x80) return null;
      number = number * 64 + (b[q + k] & 0x3f);
    }
  }
  q += len;

  let samples = blockSizeFromCode(bsCode);
  if (bsCode === 6) { samples = b[q] + 1; q += 1; }
  if (bsCode === 7) { samples = ((b[q] << 8) | b[q + 1]) + 1; q += 2; }
  if (samples === 0 || q >= b.length) return null;

  if (crc8(b.subarray(p, q)) !== b[q]) return null;
  return { headerLen: q + 1 - p, samples, number, variable };
}

export interface FlacFrame {
  readonly start: number;
  readonly samples: number;
}

export interface FlacInfo {
  readonly sampleRate: number;
  readonly streamInfo: Uint8Array;
  readonly frames: FlacFrame[];
  readonly totalSamples: number;
  readonly duration: number;
}

/**
 * Reads STREAMINFO and finds every audio frame. A frame is accepted only if its header CRC
 * is valid and its number follows the previous frame.
 */
export async function readFlac(file: File): Promise<FlacInfo> {
  const b = new Uint8Array(await file.arrayBuffer());
  if (b[0] !== 0x66 || b[1] !== 0x4c || b[2] !== 0x61 || b[3] !== 0x43) throw new Error(UNREADABLE);

  let p = 4;
  let last = false;
  let streamInfo: Uint8Array | null = null;
  while (!last) {
    if (p + 4 > b.length) throw new Error(UNREADABLE);
    last = (b[p] & 0x80) !== 0;
    const type = b[p] & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    if (type === 0) streamInfo = b.slice(p + 4, p + 4 + len);
    p += 4 + len;
  }
  if (!streamInfo || streamInfo.length < 34) throw new Error(UNREADABLE);

  const s = streamInfo;
  const sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
  if (sampleRate <= 0) throw new Error(UNREADABLE);

  const frames: FlacFrame[] = [];
  let expected: number | null = null;
  let variable = false;
  let pos = p;
  while (pos + 6 <= b.length) {
    if (b[pos] !== 0xff || (b[pos + 1] & 0xfe) !== 0xf8) { pos++; continue; }
    const h = parseHeader(b, pos);
    if (!h || (expected !== null && (h.number !== expected || h.variable !== variable))) {
      pos++;
      continue;
    }
    frames.push({ start: pos, samples: h.samples });
    expected = h.variable ? h.number + h.samples : h.number + 1;
    variable = h.variable;
    pos += h.headerLen;
  }
  if (frames.length === 0) throw new Error(UNREADABLE);

  const totalSamples = frames.reduce((a, f) => a + f.samples, 0);
  return {
    sampleRate,
    streamInfo: s.slice(0, 34),
    frames,
    totalSamples,
    duration: totalSamples / sampleRate,
  };
}

/** "fLaC" plus one STREAMINFO block with the clip's own sample count. */
function clipHeader(info: FlacInfo, samples: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(4 + 4 + 34));
  out.set([0x66, 0x4c, 0x61, 0x43], 0);
  out[4] = 0x80;
  out[7] = 34;
  const body = out.subarray(8);
  body.set(info.streamInfo);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  body[13] = (body[13] & 0xf0) | (Math.floor(samples / 2 ** 32) & 0x0f);
  view.setUint32(14, samples % 2 ** 32);
  return out;
}

/** Cuts a FLAC file into clips of about clipSeconds. Cuts are on frame boundaries, no re-encoding. */
export async function splitFlac(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const info = await readFlac(file);
  const n = info.frames.length;

  const secs = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    secs[i] = acc / info.sampleRate;
    acc += info.frames[i].samples;
  }
  const sync = Array.from({ length: n }, (_, i) => i);
  const cuts = planCuts(secs, sync, info.duration, clipSeconds, n);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    let samples = 0;
    for (let k = from; k < to; k++) samples += info.frames[k].samples;

    const start = info.frames[from].start;
    const end = to < n ? info.frames[to].start : file.size;
    parts.push({
      name: partFileName(file.name, i, count),
      blob: new Blob([clipHeader(info, samples), file.slice(start, end)], { type: 'audio/flac' }),
    });
  }
  return parts;
}