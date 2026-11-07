/**
 * Minimal MP4 / MOV (ISO BMFF) reader and writer for keyframe cutting.
 * It reads only the sample tables it needs and copies every other box byte for byte.
 * Nothing is re-encoded.
 */

export class Mp4Error extends Error {}

export interface Box {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly headerSize: number;
}

export interface Track {
  readonly handler: string;
  readonly timescale: number;
  readonly tkhd: Uint8Array;
  readonly mdhd: Uint8Array;
  readonly hdlr: Uint8Array;
  readonly minfExtras: readonly Uint8Array[];
  readonly stsd: Uint8Array;
  readonly stts: readonly { count: number; delta: number }[];
  readonly ctts: { version: number; entries: readonly { count: number; offset: number }[] } | null;
  /** 1-based numbers of key (sync) samples. null means every sample is a key sample. */
  readonly stss: readonly number[] | null;
  readonly stsc: readonly { firstChunk: number; perChunk: number }[];
  readonly sizes: Uint32Array;
  readonly chunkOffsets: readonly number[];
}

export interface Movie {
  readonly mvhd: Uint8Array;
  readonly timescale: number;
  readonly tracks: readonly Track[];
}

// ---------- Reading ----------

export function fourcc(view: DataView, pos: number): string {
  return String.fromCharCode(
    view.getUint8(pos),
    view.getUint8(pos + 1),
    view.getUint8(pos + 2),
    view.getUint8(pos + 3),
  );
}

interface Header {
  type: string;
  size: number;
  header: number;
}

function parseHeader(view: DataView, pos: number): Header {
  const size32 = view.getUint32(pos);
  const type = fourcc(view, pos + 4);
  if (size32 === 1) return { type, size: Number(view.getBigUint64(pos + 8)), header: 16 };
  return { type, size: size32, header: 8 };
}

export function payloadStart(b: Box): number {
  return b.start + b.headerSize;
}

export function findBox(boxes: readonly Box[], type: string): Box {
  const found = boxes.find((b) => b.type === type);
  if (!found) throw new Mp4Error(`Missing "${type}" box.`);
  return found;
}

export function readBoxes(view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const h = parseHeader(view, pos);
    const size = h.size === 0 ? end - pos : h.size;
    if (size < h.header || pos + size > end) throw new Mp4Error(`Broken "${h.type}" box.`);
    boxes.push({ type: h.type, start: pos, end: pos + size, headerSize: h.header });
    pos += size;
  }
  return boxes;
}

/** Reads only the header of each top-level box, so the whole file is never loaded. */
export async function topLevelBoxes(file: File): Promise<Box[]> {
  const boxes: Box[] = [];
  let pos = 0;
  while (pos + 8 <= file.size) {
    const head = new DataView(await file.slice(pos, Math.min(pos + 16, file.size)).arrayBuffer());
    const h = parseHeader(head, 0);
    const size = h.size === 0 ? file.size - pos : h.size;
    if (size < h.header || pos + size > file.size) throw new Mp4Error(`Broken "${h.type}" box.`);
    boxes.push({ type: h.type, start: pos, end: pos + size, headerSize: h.header });
    pos += size;
  }
  return boxes;
}

export function parseMoov(bytes: Uint8Array, headerSize: number): Movie {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kids = readBoxes(view, headerSize, bytes.byteLength);
  const mvhd = findBox(kids, 'mvhd');
  const mvhdVersion = view.getUint8(payloadStart(mvhd));
  const tracks = kids.filter((b) => b.type === 'trak').map((b) => parseTrak(bytes, view, b));
  if (tracks.length === 0) throw new Mp4Error('The file has no tracks.');
  return {
    mvhd: bytes.slice(mvhd.start, mvhd.end),
    timescale: view.getUint32(payloadStart(mvhd) + (mvhdVersion === 1 ? 20 : 12)),
    tracks,
  };
}

function parseTrak(bytes: Uint8Array, view: DataView, trak: Box): Track {
  const at = (b: Box): Uint8Array => bytes.slice(b.start, b.end);

  const kids = readBoxes(view, payloadStart(trak), trak.end);
  const mdia = findBox(kids, 'mdia');
  const mdiaKids = readBoxes(view, payloadStart(mdia), mdia.end);
  const mdhd = findBox(mdiaKids, 'mdhd');
  const hdlr = findBox(mdiaKids, 'hdlr');
  const minf = findBox(mdiaKids, 'minf');
  const minfKids = readBoxes(view, payloadStart(minf), minf.end);
  const stbl = findBox(minfKids, 'stbl');
  const t = readBoxes(view, payloadStart(stbl), stbl.end);

  const mdhdVersion = view.getUint8(payloadStart(mdhd));
  const timescale = view.getUint32(payloadStart(mdhd) + (mdhdVersion === 1 ? 20 : 12));
  const handler = fourcc(view, payloadStart(hdlr) + 8);
  const chunkBox = t.find((b) => b.type === 'stco') ?? findBox(t, 'co64');

  return {
    handler,
    timescale,
    tkhd: at(findBox(kids, 'tkhd')),
    mdhd: at(mdhd),
    hdlr: at(hdlr),
    minfExtras: minfKids.filter((b) => b.type !== 'stbl').map((b) => at(b)),
    stsd: at(findBox(t, 'stsd')),
    stts: readStts(view, findBox(t, 'stts')),
    ctts: readCtts(view, t.find((b) => b.type === 'ctts')),
    stss: readStss(view, t.find((b) => b.type === 'stss')),
    stsc: readStsc(view, findBox(t, 'stsc')),
    sizes: readStsz(view, findBox(t, 'stsz')),
    chunkOffsets: readChunkOffsets(view, chunkBox),
  };
}

function readStts(view: DataView, b: Box): { count: number; delta: number }[] {
  const p = payloadStart(b) + 4;
  const n = view.getUint32(p);
  const out: { count: number; delta: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ count: view.getUint32(p + 4 + i * 8), delta: view.getUint32(p + 8 + i * 8) });
  }
  return out;
}

function readCtts(view: DataView, b: Box | undefined): Track['ctts'] {
  if (!b) return null;
  const version = view.getUint8(payloadStart(b));
  const p = payloadStart(b) + 4;
  const n = view.getUint32(p);
  const entries: { count: number; offset: number }[] = [];
  for (let i = 0; i < n; i++) {
    const at = p + 4 + i * 8;
    entries.push({
      count: view.getUint32(at),
      offset: version === 1 ? view.getInt32(at + 4) : view.getUint32(at + 4),
    });
  }
  return { version, entries };
}

function readStss(view: DataView, b: Box | undefined): number[] | null {
  if (!b) return null;
  const p = payloadStart(b) + 4;
  const n = view.getUint32(p);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(view.getUint32(p + 4 + i * 4));
  return out;
}

function readStsc(view: DataView, b: Box): { firstChunk: number; perChunk: number }[] {
  const p = payloadStart(b) + 4;
  const n = view.getUint32(p);
  const out: { firstChunk: number; perChunk: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ firstChunk: view.getUint32(p + 4 + i * 12), perChunk: view.getUint32(p + 8 + i * 12) });
  }
  return out;
}

function readStsz(view: DataView, b: Box): Uint32Array {
  const p = payloadStart(b) + 4;
  const fixed = view.getUint32(p);
  const n = view.getUint32(p + 4);
  const sizes = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    sizes[i] = fixed !== 0 ? fixed : view.getUint32(p + 8 + i * 4);
  }
  return sizes;
}

function readChunkOffsets(view: DataView, b: Box): number[] {
  const p = payloadStart(b) + 4;
  const n = view.getUint32(p);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(b.type === 'co64' ? Number(view.getBigUint64(p + 4 + i * 8)) : view.getUint32(p + 4 + i * 4));
  }
  return out;
}

// ---------- Sample helpers ----------

/** Byte offset in the original file of every sample. */
export function sampleOffsets(t: Track): Float64Array {
  const n = t.sizes.length;
  const out = new Float64Array(n);
  let s = 0;
  for (let c = 0; c < t.chunkOffsets.length && s < n; c++) {
    const chunk = c + 1;
    let perChunk = 0;
    for (const e of t.stsc) if (e.firstChunk <= chunk) perChunk = e.perChunk;
    let off = t.chunkOffsets[c];
    for (let k = 0; k < perChunk && s < n; k++) {
      out[s] = off;
      off += t.sizes[s];
      s++;
    }
  }
  if (s < n) throw new Mp4Error('The sample table does not match the chunk table.');
  return out;
}

/** Duration of every sample, in track timescale units. */
export function sampleDeltas(t: Track): Uint32Array {
  const n = t.sizes.length;
  const out = new Uint32Array(n);
  let i = 0;
  for (const e of t.stts) {
    for (let k = 0; k < e.count && i < n; k++) out[i++] = e.delta;
  }
  if (i < n) throw new Mp4Error('The time table is shorter than the sample table.');
  return out;
}

/** Decode time of every sample, in track timescale units. */
export function decodeTimes(deltas: Uint32Array): Float64Array {
  const out = new Float64Array(deltas.length);
  let acc = 0;
  for (let i = 0; i < deltas.length; i++) {
    out[i] = acc;
    acc += deltas[i];
  }
  return out;
}

/** Composition offset of every sample, or null when the track has no ctts box. */
export function expandCtts(t: Track): Int32Array | null {
  if (!t.ctts) return null;
  const n = t.sizes.length;
  const out = new Int32Array(n);
  let i = 0;
  for (const e of t.ctts.entries) {
    for (let k = 0; k < e.count && i < n; k++) out[i++] = e.offset;
  }
  return out;
}

/** Run-length encoding: [{count, value}] for a list of numbers. */
export function runs(values: ArrayLike<number>): { count: number; value: number }[] {
  const out: { count: number; value: number }[] = [];
  for (let i = 0; i < values.length; ) {
    let j = i;
    while (j < values.length && values[j] === values[i]) j++;
    out.push({ count: j - i, value: values[i] });
    i = j;
  }
  return out;
}

// ---------- Writing ----------

export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function u32Flat(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) v.setUint32(i * 4, values[i]);
  return out;
}

export function u64Flat(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(values.length * 8);
  const v = new DataView(out.buffer);
  for (let i = 0; i < values.length; i++) v.setBigUint64(i * 8, BigInt(values[i]));
  return out;
}

function build(type: string, parts: readonly Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((s, p) => s + p.length, 0);
  if (size > 0xffffffff) throw new Mp4Error('A box is too large for this writer.');
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, size);
  out.set(ascii(type), 4);
  let pos = 8;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  return build(type, parts);
}

export function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  const head = new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]);
  return build(type, [head, ...parts]);
}

function headerLen(raw: Uint8Array): number {
  return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0) === 1 ? 16 : 8;
}

/**
 * Copy of a box (tkhd, mdhd, mvhd) with its duration field replaced.
 * v0Offset is the duration offset in the version 0 layout, counted from the start of the payload.
 * In version 1 the duration is 8 bytes and sits 8 bytes further on.
 */
export function withDuration(raw: Uint8Array, v0Offset: number, value: number): Uint8Array {
  const out = raw.slice();
  const h = headerLen(out);
  const version = out[h];
  const v = new DataView(out.buffer);
  if (version === 1) v.setBigUint64(h + v0Offset + 8, BigInt(Math.round(value)));
  else v.setUint32(h + v0Offset, Math.round(value));
  return out;
}