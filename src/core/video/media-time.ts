import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { lowerBound, planCuts } from '../shared/cut-plan';
import {
  ascii,
  box,
  concat,
  decodeTimes,
  expandCtts,
  findBox,
  fullBox,
  parseMoov,
  runs,
  sampleDeltas,
  sampleOffsets,
  toArrayBuffer,
  topLevelBoxes,
  u32Flat,
  u64Flat,
  withDuration,
  type Movie,
  type Track,
} from './mp4';

const FRAGMENTED =
  'This MP4 is streamed (fragmented), so it cannot be cut by length yet. Use byte split for it.';
const UNREADABLE =
  'This video or audio file could not be read as MP4 or MOV. Byte split works for any file.';

interface Prepared {
  readonly track: Track;
  readonly deltas: Uint32Array;
  /** Decode time of every sample, in seconds. */
  readonly secs: Float64Array;
  readonly offsets: Float64Array;
  readonly comp: Int32Array | null;
}

interface ClipTrack {
  readonly prep: Prepared;
  readonly from: number;
  readonly to: number;
}

async function readMovie(file: File): Promise<{ movie: Movie; ftyp: Uint8Array }> {
  try {
    const top = await topLevelBoxes(file);
    if (top.some((b) => b.type === 'moof')) throw new Error(FRAGMENTED);

    const moov = findBox(top, 'moov');
    const ftypBox = top.find((b) => b.type === 'ftyp');
    const ftyp = ftypBox
      ? new Uint8Array(await file.slice(ftypBox.start, ftypBox.end).arrayBuffer())
      : new Uint8Array(0);
    const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
    return { movie: parseMoov(bytes, moov.headerSize), ftyp };
  } catch (e) {
    if (e instanceof Error && e.message === FRAGMENTED) throw e;
    throw new Error(UNREADABLE);
  }
}

function prepare(track: Track): Prepared {
  const deltas = sampleDeltas(track);
  const secs = decodeTimes(deltas).map((x) => x / track.timescale);
  return { track, deltas, secs, offsets: sampleOffsets(track), comp: expandCtts(track) };
}

/**
 * Samples of every track for clip i. The cut track uses the index range.
 * Other tracks (audio) use the same time window, so they stay in sync.
 */
function clipTracks(tracks: Prepared[], cut: Prepared, cuts: number[], i: number): ClipTrack[] {
  const startSec = cut.secs[cuts[i]];
  const last = i + 1 === cuts.length - 1;
  const endSec = last ? Infinity : cut.secs[cuts[i + 1]];
  const out: ClipTrack[] = [];

  for (const p of tracks) {
    const n = p.deltas.length;
    const from = p === cut ? cuts[i] : lowerBound(p.secs, startSec);
    const to = p === cut ? cuts[i + 1] : last ? n : lowerBound(p.secs, endSec);
    if (to > from) out.push({ prep: p, from, to });
  }
  return out;
}

function flatRuns(rs: { count: number; value: number }[]): number[] {
  const out = [rs.length];
  for (const r of rs) out.push(r.count, r.value);
  return out;
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

function buildTrak(c: ClipTrack, offsets: Float64Array, dur: number, mvhdTs: number): Uint8Array {
  const t = c.prep.track;
  const m = c.to - c.from;
  const sizes = t.sizes.subarray(c.from, c.to);

  const pieces: Uint8Array[] = [
    fullBox('stts', 0, 0, u32Flat(flatRuns(runs(c.prep.deltas.subarray(c.from, c.to))))),
  ];

  if (t.ctts && c.prep.comp) {
    pieces.push(
      fullBox('ctts', t.ctts.version, 0, u32Flat(flatRuns(runs(c.prep.comp.subarray(c.from, c.to))))),
    );
  }

  if (t.stss) {
    // Original numbers are 1-based. Keep the ones inside this clip, renumbered from 1.
    const keys: number[] = [];
    for (const s of t.stss) if (s > c.from && s <= c.to) keys.push(s - c.from);
    pieces.push(fullBox('stss', 0, 0, u32Flat([keys.length, ...keys])));
  }

  // One chunk per sample keeps the sample table simple and valid.
  pieces.push(fullBox('stsc', 0, 0, u32Flat([1, 1, 1, 1])));

  const stszVals = new Uint32Array(m + 2);
  stszVals[1] = m;
  stszVals.set(sizes, 2);
  pieces.push(fullBox('stsz', 0, 0, u32Flat(stszVals)));
  pieces.push(fullBox('co64', 0, 0, concat([u32Flat([m]), u64Flat(offsets)])));

  const stbl = box('stbl', t.stsd, ...pieces);
  const minf = box('minf', ...t.minfExtras, stbl);
  const mdia = box('mdia', withDuration(t.mdhd, 16, dur), t.hdlr, minf);
  const tkhd = withDuration(t.tkhd, 20, (dur * mvhdTs) / t.timescale);
  return box('trak', tkhd, mdia);
}

function buildMoov(
  mvhd: Uint8Array,
  mvhdTs: number,
  clip: ClipTrack[],
  dataBase: number,
): Uint8Array {
  let cursor = dataBase;
  let movieDuration = 0;
  const traks: Uint8Array[] = [];

  for (const c of clip) {
    const t = c.prep.track;
    const sizes = t.sizes.subarray(c.from, c.to);
    const offsets = new Float64Array(sizes.length);
    for (let k = 0; k < sizes.length; k++) {
      offsets[k] = cursor;
      cursor += sizes[k];
    }
    const dur = c.prep.deltas.subarray(c.from, c.to).reduce((a, d) => a + d, 0);
    movieDuration = Math.max(movieDuration, (dur * mvhdTs) / t.timescale);
    traks.push(buildTrak(c, offsets, dur, mvhdTs));
  }

  return box('moov', withDuration(mvhd, 16, movieDuration), ...traks);
}

function buildClip(file: File, ftyp: Uint8Array, movie: Movie, clip: ClipTrack[]): Blob {
  let payload = 0;
  for (const c of clip) {
    for (let i = c.from; i < c.to; i++) payload += c.prep.track.sizes[i];
  }

  const mdat = mdatHeader(payload);
  // Table sizes do not depend on the offset values, so one dry run gives the final moov length.
  const moovLen = buildMoov(movie.mvhd, movie.timescale, clip, 0).length;
  const moov = buildMoov(movie.mvhd, movie.timescale, clip, ftyp.length + moovLen + mdat.length);

  const parts: Array<Blob | ArrayBuffer> = [
    toArrayBuffer(ftyp),
    toArrayBuffer(moov),
    toArrayBuffer(mdat),
  ];

  // Sample bytes, in the same order as the offsets above. Neighbouring samples are merged into one slice.
  for (const c of clip) {
    const offs = c.prep.offsets;
    const sz = c.prep.track.sizes;
    let start = -1;
    let end = -1;
    for (let i = c.from; i < c.to; i++) {
      const s = offs[i];
      const e = s + sz[i];
      if (start >= 0 && s === end) {
        end = e;
      } else {
        if (start >= 0) parts.push(file.slice(start, end));
        start = s;
        end = e;
      }
    }
    if (start >= 0) parts.push(file.slice(start, end));
  }

  return new Blob(parts, { type: file.type || 'video/mp4' });
}

/** Cuts an MP4/MOV into clips of about clipSeconds, at key frames. No re-encoding. */
export async function splitMp4(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const { movie, ftyp } = await readMovie(file);
  const tracks = movie.tracks.map(prepare);
  const cut = tracks.find((p) => p.track.handler === 'vide') ?? tracks[0];

  const n = cut.deltas.length;
  if (n === 0) throw new Error('This file has no frames or samples to split.');

  const sync = cut.track.stss
    ? cut.track.stss.map((s) => s - 1)
    : Array.from({ length: n }, (_, i) => i);
  const total = cut.deltas.reduce((a, d) => a + d, 0) / cut.track.timescale;
  const cuts = planCuts(cut.secs, sync, total, clipSeconds, n);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const clip = clipTracks(tracks, cut, cuts, i);
    parts.push({
      name: partFileName(file.name, i, count),
      blob: buildClip(file, ftyp, movie, clip),
    });
  }
  return parts;
}