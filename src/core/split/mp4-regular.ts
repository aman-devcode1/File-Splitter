import type { SplitPart } from '../types';
import { partFileName } from './byte-split';
import { planCuts } from './media-time';
import { scanFragments, trackIdOf, type Fragment } from './mp4-fragmented';
import {
  ascii,
  box,
  findBox,
  fullBox,
  parseMoov,
  payloadStart,
  readBoxes,
  runs,
  toArrayBuffer,
  topLevelBoxes,
  u32Flat,
  u64Flat,
  withDuration,
  type Movie,
  type Track,
} from './mp4';

interface Sample {
  readonly size: number;
  readonly dur: number;
  readonly cts: number;
  readonly sync: boolean;
  /** absolute byte offset in the file */
  readonly offset: number;
}

const FLAG_BASE_DATA_OFFSET = 0x1;
const FLAG_SAMPLE_DESC_INDEX = 0x2;
const FLAG_DEFAULT_DURATION = 0x8;
const FLAG_DEFAULT_SIZE = 0x10;
const FLAG_DEFAULT_FLAGS = 0x20;
const FLAG_DEFAULT_BASE_IS_MOOF = 0x20000;

/** Reads every sample of a moof (all its traf and trun boxes), per track. */
function samplesOf(bytes: Uint8Array, moofStart: number): Map<number, Sample[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<number, Sample[]>();
  let prevEnd = moofStart;
  let first = true;

  for (const traf of readBoxes(view, 8, bytes.length).filter((b) => b.type === 'traf')) {
    const kids = readBoxes(view, payloadStart(traf), traf.end);
    const tfhd = findBox(kids, 'tfhd');
    const flags = view.getUint32(tfhd.start + 8) & 0xffffff;
    const trackId = view.getUint32(tfhd.start + 12);

    let p = tfhd.start + 16;
    let explicitBase: number | null = null;
    if (flags & FLAG_BASE_DATA_OFFSET) { explicitBase = Number(view.getBigUint64(p)); p += 8; }
    if (flags & FLAG_SAMPLE_DESC_INDEX) p += 4;
    let defDur = 0;
    let defSize = 0;
    let defFlags = 0;
    if (flags & FLAG_DEFAULT_DURATION) { defDur = view.getUint32(p); p += 4; }
    if (flags & FLAG_DEFAULT_SIZE) { defSize = view.getUint32(p); p += 4; }
    if (flags & FLAG_DEFAULT_FLAGS) { defFlags = view.getUint32(p); p += 4; }

    // Where sample data of this traf starts (absolute file offset)
    const base =
      explicitBase ?? (flags & FLAG_DEFAULT_BASE_IS_MOOF || first ? moofStart : prevEnd);
    let cursor = base;

    const list = out.get(trackId) ?? [];
    for (const trun of kids.filter((b) => b.type === 'trun')) {
      const tf = view.getUint32(trun.start + 8) & 0xffffff;
      const count = view.getUint32(trun.start + 12);
      let q = trun.start + 16;
      if (tf & 0x1) { cursor = base + view.getInt32(q); q += 4; }
      let firstFlags: number | null = null;
      if (tf & 0x4) { firstFlags = view.getUint32(q); q += 4; }

      for (let i = 0; i < count; i++) {
        let dur = defDur;
        let size = defSize;
        let sflags = defFlags;
        let cts = 0;
        if (tf & 0x100) { dur = view.getUint32(q); q += 4; }
        if (tf & 0x200) { size = view.getUint32(q); q += 4; }
        if (tf & 0x400) { sflags = view.getUint32(q); q += 4; }
        if (i === 0 && firstFlags !== null) sflags = firstFlags;
        if (tf & 0x800) { cts = view.getInt32(q); q += 4; }
        list.push({ size, dur, cts, sync: (sflags & 0x10000) === 0, offset: cursor });
        cursor += size;
      }
    }
    out.set(trackId, list);
    prevEnd = cursor;
    first = false;
  }
  return out;
}

/** All samples of a clip (its fragments), per track, in time order. */
async function clipSamples(file: File, frags: Fragment[]): Promise<Map<number, Sample[]>> {
  const all = new Map<number, Sample[]>();
  for (const f of frags) {
    const bytes = new Uint8Array(await file.slice(f.start, f.moofEnd).arrayBuffer());
    for (const [id, list] of samplesOf(bytes, f.start)) {
      const acc = all.get(id) ?? [];
      for (const s of list) acc.push(s);
      all.set(id, acc);
    }
  }
  return all;
}

/** ctts box (version 1, signed offsets), grouped into runs. */
function cttsBox(samples: Sample[]): Uint8Array {
  const rs = runs(samples.map((s) => s.cts));
  const body = new Uint8Array(4 + rs.length * 8);
  const v = new DataView(body.buffer);
  v.setUint32(0, rs.length);
  rs.forEach((r, i) => {
    v.setUint32(4 + i * 8, r.count);
    v.setInt32(8 + i * 8, r.value);
  });
  return fullBox('ctts', 1, 0, body);
}

function mdatHeader(payload: number): Uint8Array {
  const large = payload + 8 > 0xffffffff;
  const out = new Uint8Array(large ? 16 : 8);
  const v = new DataView(out.buffer);
  if (large) {
    v.setUint32(0, 1);
    v.setBigUint64(8, BigInt(payload + 16));
  } else {
    v.setUint32(0, payload + 8);
  }
  out.set(ascii('mdat'), 4);
  return out;
}

/** One trak box with a complete sample table. All samples are in one chunk at `offset`. */
function trackBox(t: Track, samples: Sample[], offset: number, movieTs: number): Uint8Array {
  const n = samples.length;
  const total = samples.reduce((a, s) => a + s.dur, 0);
  const sizes = samples.map((s) => s.size);

  const pieces: Uint8Array[] = [
    t.stsd,
    fullBox('stts', 0, 0, u32Flat(flatRuns(runs(samples.map((s) => s.dur))))),
  ];
  if (samples.some((s) => s.cts !== 0)) pieces.push(cttsBox(samples));
  if (!samples.every((s) => s.sync)) {
    const keys: number[] = [];
    samples.forEach((s, i) => { if (s.sync) keys.push(i + 1); });
    pieces.push(fullBox('stss', 0, 0, u32Flat([keys.length, ...keys])));
  }
  pieces.push(fullBox('stsc', 0, 0, u32Flat([1, 1, n, 1])));
  pieces.push(fullBox('stsz', 0, 0, u32Flat([0, n, ...sizes])));
  pieces.push(fullBox('co64', 0, 0, concatBytes([u32Flat([1]), u64Flat([offset])])));

  const stbl = box('stbl', ...pieces);
  const minf = box('minf', ...t.minfExtras, stbl);
  const mdia = box('mdia', withDuration(t.mdhd, 16, total), t.hdlr, minf);
  const tkhd = withDuration(t.tkhd, 20, (total * movieTs) / t.timescale);
  return box('trak', tkhd, mdia);
}

function flatRuns(rs: { count: number; value: number }[]): number[] {
  const out = [rs.length];
  for (const r of rs) out.push(r.count, r.value);
  return out;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** File pieces for one track's samples. Neighbouring samples are merged into one slice. */
function dataPieces(file: File, samples: Sample[]): Blob[] {
  const pieces: Blob[] = [];
  let s = -1;
  let e = -1;
  for (const smp of samples) {
    if (s >= 0 && smp.offset === e) {
      e = smp.offset + smp.size;
    } else {
      if (s >= 0) pieces.push(file.slice(s, e));
      s = smp.offset;
      e = smp.offset + smp.size;
    }
  }
  if (s >= 0) pieces.push(file.slice(s, e));
  return pieces;
}

/** A regular (non-fragmented) MP4 with ftyp, a full moov index, then one mdat. */
async function buildRegularClip(
  file: File,
  ftyp: Uint8Array,
  movie: Movie,
  byId: Map<number, Track>,
  samplesById: Map<number, Sample[]>,
): Promise<Blob> {
  const ids = [...samplesById.keys()].filter(
    (id) => byId.has(id) && (samplesById.get(id)?.length ?? 0) > 0,
  );
  const sizeOf = (id: number) => samplesById.get(id)!.reduce((a, s) => a + s.size, 0);
  const payload = ids.reduce((a, id) => a + sizeOf(id), 0);

  let movieTicks = 0;
  for (const id of ids) {
    const t = byId.get(id)!;
    const secs = samplesById.get(id)!.reduce((a, s) => a + s.dur, 0) / t.timescale;
    movieTicks = Math.max(movieTicks, Math.round(secs * movie.timescale));
  }

  const buildMoov = (base: number): Uint8Array => {
    let cursor = base;
    const traks: Uint8Array[] = [];
    for (const id of ids) {
      traks.push(trackBox(byId.get(id)!, samplesById.get(id)!, cursor, movie.timescale));
      cursor += sizeOf(id);
    }
    return box('moov', withDuration(movie.mvhd, 16, movieTicks), ...traks);
  };

  // co64 sizes do not depend on the offset values, so one dry run gives the final moov length.
  const head = mdatHeader(payload);
  const moovLen = buildMoov(0).length;
  const moov = buildMoov(ftyp.length + moovLen + head.length);

  const parts: BlobPart[] = [toArrayBuffer(ftyp), toArrayBuffer(moov), toArrayBuffer(head)];
  for (const id of ids) {
    for (const piece of dataPieces(file, samplesById.get(id)!)) parts.push(piece);
  }
  return new Blob(parts, { type: 'video/mp4' });
}

/** Cuts a fragmented MP4 by length, and writes every clip as a regular MP4 (fast seek). */
export async function splitFragmentedToRegular(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const top = await topLevelBoxes(file);
  const moovBox = findBox(top, 'moov');
  const ftypBox = top.find((b) => b.type === 'ftyp');
  const ftyp = ftypBox
    ? new Uint8Array(await file.slice(ftypBox.start, ftypBox.end).arrayBuffer())
    : new Uint8Array(0);
  const moovBytes = new Uint8Array(await file.slice(moovBox.start, moovBox.end).arrayBuffer());

  const movie = parseMoov(moovBytes, moovBox.headerSize);
  const video = movie.tracks.find((t) => t.handler === 'vide') ?? movie.tracks[0];
  const byId = new Map<number, Track>(movie.tracks.map((t): [number, Track] => [trackIdOf(t), t]));

  const frags = await scanFragments(file, video);
  if (frags.length === 0) throw new Error('No fragments were found in this file.');

  const secs = Float64Array.from(frags, (f) => f.time);
  const syncIdx = frags.flatMap((f, i) => (f.sync ? [i] : []));
  if (syncIdx.length === 0) throw new Error('This file has no key frames, so it cannot be cut.');

  const last = frags[frags.length - 1];
  const cuts = planCuts(secs, syncIdx, last.time + last.dur, clipSeconds, frags.length);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const slice = frags.slice(cuts[i], cuts[i + 1]);
    const samples = await clipSamples(file, slice);
    parts.push({
      name: partFileName(file.name, i, count),
      blob: await buildRegularClip(file, ftyp, movie, byId, samples),
    });
  }
  return parts;
}