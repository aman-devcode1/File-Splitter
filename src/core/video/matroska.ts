import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const UNREADABLE = 'This Matroska or WebM file could not be read. Byte split works for any file.';
const LIVE = 'This file uses unknown-size clusters (a live stream), so it cannot be cut by length yet.';

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const REFERENCE_BLOCK = 0xfb;

const SEGMENT_HEADER = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

interface El {
  readonly id: number;
  readonly start: number;
  readonly dataStart: number;
  readonly end: number;
  readonly unknown: boolean;
}

interface ClusterInfo {
  readonly el: El;
  readonly ticks: number;
  readonly tcStart: number;
  readonly tcDataStart: number;
  readonly tcEnd: number;
  readonly keyframe: boolean;
}

interface Parsed {
  readonly b: Uint8Array<ArrayBuffer>;
  readonly ebml: El;
  readonly info: El | null;
  readonly durEl: El | null;
  readonly tracks: El;
  readonly scale: number;
  /** Seconds, or null when the file has no Duration element. */
  readonly duration: number | null;
  readonly clusters: ClusterInfo[];
}

/** Length of an EBML variable-size integer, from its first byte. */
function vintLength(first: number): number {
  if (first === 0) throw new Error(UNREADABLE);
  return Math.clz32(first) - 23;
}

function element(b: Uint8Array<ArrayBuffer>, p: number, limit: number): El {
  const idLen = vintLength(b[p]);
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[p + i];

  const sLen = vintLength(b[p + idLen]);
  let size = b[p + idLen] & (0xff >> sLen);
  for (let i = 1; i < sLen; i++) size = size * 256 + b[p + idLen + i];
  const unknown = size === 2 ** (7 * sLen) - 1;

  const dataStart = p + idLen + sLen;
  const end = unknown ? limit : dataStart + size;
  if (end > limit) throw new Error(UNREADABLE);
  return { id, start: p, dataStart, end, unknown };
}

function children(b: Uint8Array<ArrayBuffer>, from: number, to: number): El[] {
  const out: El[] = [];
  let p = from;
  while (p < to) {
    const e = element(b, p, to);
    out.push(e);
    if (e.unknown) break;
    p = e.end;
  }
  return out;
}

function readUint(b: Uint8Array<ArrayBuffer>, s: number, e: number): number {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 256 + b[i];
  return v;
}

function readFloat(b: Uint8Array<ArrayBuffer>, s: number, e: number): number {
  const view = new DataView(b.buffer, b.byteOffset + s, e - s);
  return e - s === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

function analyze(b: Uint8Array<ArrayBuffer>, c: El): ClusterInfo {
  if (c.unknown) throw new Error(LIVE);
  const kids = children(b, c.dataStart, c.end);
  const tc = kids.find((k) => k.id === TIMECODE);
  if (!tc) throw new Error(UNREADABLE);

  const ticks = readUint(b, tc.dataStart, tc.end);

  // Keyframe check uses the first block of the cluster.
  let keyframe = false;
  const block = kids.find((k) => k.id === SIMPLE_BLOCK || k.id === BLOCK_GROUP);
  if (block?.id === SIMPLE_BLOCK) {
    const flagPos = block.dataStart + vintLength(b[block.dataStart]) + 2;
    keyframe = (b[flagPos] & 0x80) !== 0;
  } else if (block) {
    const inner = children(b, block.dataStart, block.end);
    keyframe = !inner.some((k) => k.id === REFERENCE_BLOCK);
  }

  return { el: c, ticks, tcStart: tc.start, tcDataStart: tc.dataStart, tcEnd: tc.end, keyframe };
}

async function parse(file: File): Promise<Parsed> {
  const b = new Uint8Array(await file.arrayBuffer());
  try {
    const top = children(b, 0, b.length);
    const ebml = top.find((e) => e.id === EBML);
    const seg = top.find((e) => e.id === SEGMENT);
    if (!ebml || !seg) throw new Error(UNREADABLE);

    const segKids = children(b, seg.dataStart, seg.end);
    const info = segKids.find((e) => e.id === INFO) ?? null;
    const tracks = segKids.find((e) => e.id === TRACKS);
    if (!tracks) throw new Error(UNREADABLE);

    let scale = 1_000_000; // default: 1 ms per tick
    let duration: number | null = null;
    let durEl: El | null = null;
    if (info) {
      const ik = children(b, info.dataStart, info.end);
      const sc = ik.find((e) => e.id === TIMECODE_SCALE);
      if (sc) scale = readUint(b, sc.dataStart, sc.end);
      durEl = ik.find((e) => e.id === DURATION) ?? null;
      if (durEl) duration = (readFloat(b, durEl.dataStart, durEl.end) * scale) / 1e9;
    }

    const clusters = segKids.filter((e) => e.id === CLUSTER).map((c) => analyze(b, c));
    if (clusters.length === 0) throw new Error(UNREADABLE);
    return { b, ebml, info, durEl, tracks, scale, duration, clusters };
  } catch (e) {
    if (e instanceof Error && e.message === LIVE) throw e;
    throw new Error(UNREADABLE);
  }
}

/** Duration in seconds, or null if the file does not state one. */
export async function mkvDuration(file: File): Promise<number | null> {
  return (await parse(file)).duration;
}

/** Writes a number into exactly `len` bytes (big endian), so the element size does not change. */
function encodeUint(v: number, len: number): Uint8Array<ArrayBuffer> {
  if (v >= 2 ** (8 * len)) throw new RangeError('Timecode does not fit in its original size.');
  const out = new Uint8Array(new ArrayBuffer(len));
  let x = v;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = x % 256;
    x = Math.floor(x / 256);
  }
  return out;
}

/** Cuts an MKV/WebM into clips of about clipSeconds, at key frames. No re-encoding. */
export async function splitMkv(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const { b, ebml, info, durEl, tracks, scale, duration, clusters } = await parse(file);
  const n = clusters.length;

  const secs = Float64Array.from(clusters, (c) => (c.ticks * scale) / 1e9);
  const sync = clusters.flatMap((c, i) => (c.keyframe ? [i] : []));
  if (sync.length === 0) throw new Error('This file has no key frames, so it cannot be cut.');

  const lastStep = n > 1 ? secs[n - 1] - secs[n - 2] : 1;
  const totalSec = duration ?? secs[n - 1] + lastStep;
  const totalTicks = Math.round((totalSec * 1e9) / scale);

  const cuts = planCuts(secs, sync, totalSec, clipSeconds, n);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    const base = clusters[from].ticks;
    const endTicks = to < n ? clusters[to].ticks : totalTicks;

    const pieces: Uint8Array<ArrayBuffer>[] = [b.slice(ebml.start, ebml.end), SEGMENT_HEADER.slice()];

    if (info) {
      const infoBytes = b.slice(info.start, info.end);
      // Duration of this clip, so players show the right total time.
      if (durEl) {
        const off = durEl.dataStart - info.start;
        const view = new DataView(infoBytes.buffer);
        const len = durEl.end - durEl.dataStart;
        if (len === 8) view.setFloat64(off, endTicks - base);
        else if (len === 4) view.setFloat32(off, endTicks - base);
      }
      pieces.push(infoBytes);
    }

    pieces.push(b.slice(tracks.start, tracks.end));

    for (let k = from; k < to; k++) {
      const c = clusters[k];
      pieces.push(b.slice(c.el.start, c.tcStart)); // cluster header and anything before Timecode
      pieces.push(b.slice(c.tcStart, c.tcDataStart)); // Timecode id and size
      pieces.push(encodeUint(c.ticks - base, c.tcEnd - c.tcDataStart)); // new Timecode value
      pieces.push(b.slice(c.tcEnd, c.el.end)); // rest of the cluster
    }

    parts.push({
      name: partFileName(file.name, i, count),
      blob: new Blob(pieces, { type: 'video/x-matroska' }),
    });
  }
  return parts;
}