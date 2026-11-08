import type { SplitPart } from '../types';
import { partFileName } from './byte-split';
import { planCuts } from './media-time';
import {
  Mp4Error,
  findBox,
  parseMoov,
  payloadStart,
  readBoxes,
  toArrayBuffer,
  topLevelBoxes,
  type Box,
  type Track,
} from './mp4';

export interface Fragment {
  /** moof start in the file */
  readonly start: number;
  /** moof end, which is also the mdat start */
  readonly moofEnd: number;
  /** mdat end */
  readonly end: number;
  /** video start time, in seconds */
  readonly time: number;
  /** video duration of this fragment, in seconds */
  readonly dur: number;
  /** true when the first video sample is a key frame */
  readonly sync: boolean;
  /** tfdt (decode start time) of every track in this fragment, in that track's ticks */
  readonly baseByTrack: Map<number, number>;
}

interface TrafInfo {
  readonly trackId: number;
  readonly base: number;
  readonly dur: number;
  readonly sync: boolean;
}

/** Track ID from the tkhd box. */
export function trackIdOf(t: Track): number {
  const v = new DataView(t.tkhd.buffer, t.tkhd.byteOffset, t.tkhd.byteLength);
  return v.getUint32(v.getUint8(8) === 1 ? 28 : 20);
}

/** Reads one traf (tfhd, tfdt, trun). The view covers the whole moof. */
function parseTraf(view: DataView, traf: Box): TrafInfo {
  const kids = readBoxes(view, payloadStart(traf), traf.end);

  const tfhd = findBox(kids, 'tfhd');
  const tfhdFlags = view.getUint32(tfhd.start + 8) & 0xffffff;
  const trackId = view.getUint32(tfhd.start + 12);
  let p = tfhd.start + 16;
  if (tfhdFlags & 0x1) p += 8; // base_data_offset
  if (tfhdFlags & 0x2) p += 4; // sample_description_index
  let defDur = 0;
  let defFlags = 0;
  if (tfhdFlags & 0x8) { defDur = view.getUint32(p); p += 4; }
  if (tfhdFlags & 0x10) p += 4; // default_sample_size
  if (tfhdFlags & 0x20) { defFlags = view.getUint32(p); p += 4; }

  const tfdt = kids.find((b) => b.type === 'tfdt');
  let base = 0;
  if (tfdt) {
    base = view.getUint8(tfdt.start + 8) === 1
      ? Number(view.getBigUint64(tfdt.start + 12))
      : view.getUint32(tfdt.start + 12);
  }

  const trun = findBox(kids, 'trun');
  const f = view.getUint32(trun.start + 8) & 0xffffff;
  const count = view.getUint32(trun.start + 12);
  let q = trun.start + 16;
  if (f & 0x1) q += 4; // data_offset
  let firstFlags: number | null = null;
  if (f & 0x4) { firstFlags = view.getUint32(q); q += 4; }

  let dur = 0;
  let sync = true;
  for (let i = 0; i < count; i++) {
    let d = defDur;
    if (f & 0x100) { d = view.getUint32(q); q += 4; }
    if (f & 0x200) q += 4; // sample_size
    let flags = defFlags;
    if (f & 0x400) { flags = view.getUint32(q); q += 4; }
    if (i === 0 && firstFlags !== null) flags = firstFlags;
    if (f & 0x800) q += 4; // composition offset
    if (i === 0) sync = (flags & 0x10000) === 0;
    dur += d;
  }
  return { trackId, base, dur, sync };
}

/** Every moof+mdat pair in the file, in order. Times come from the video track. */
export async function scanFragments(file: File, videoTrack: Track): Promise<Fragment[]> {
  const videoId = trackIdOf(videoTrack);
  const top = await topLevelBoxes(file);
  const out: Fragment[] = [];

  for (let i = 0; i < top.length; i++) {
    const moof = top[i];
    if (moof.type !== 'moof') continue;
    const mdat = top[i + 1];
    if (!mdat || mdat.type !== 'mdat') throw new Mp4Error('A moof box is not followed by an mdat box.');

    const bytes = new Uint8Array(await file.slice(moof.start, moof.end).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const trafs = readBoxes(view, 8, bytes.length)
      .filter((b) => b.type === 'traf')
      .map((b) => parseTraf(view, b));
    if (trafs.length === 0) throw new Mp4Error('A moof box has no traf box.');

    const video = trafs.find((t) => t.trackId === videoId) ?? trafs[0];
    const baseByTrack = new Map<number, number>();
    for (const t of trafs) baseByTrack.set(t.trackId, t.base);

    out.push({
      start: moof.start,
      moofEnd: moof.end,
      end: mdat.end,
      time: video.base / videoTrack.timescale,
      dur: video.dur / videoTrack.timescale,
      sync: video.sync,
      baseByTrack,
    });
  }
  return out;
}

/**
 * Moves every track's decode time so that the clip starts at 0 for each track.
 * Audio and video are both rebased, so they stay in sync.
 */
function rebaseMoof(moof: Uint8Array, startByTrack: Map<number, number>): void {
  const view = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  for (const traf of readBoxes(view, 8, moof.length).filter((b) => b.type === 'traf')) {
    const kids = readBoxes(view, payloadStart(traf), traf.end);
    const tfhd = kids.find((b) => b.type === 'tfhd');
    const tfdt = kids.find((b) => b.type === 'tfdt');
    if (!tfhd || !tfdt) continue;

    const start = startByTrack.get(view.getUint32(tfhd.start + 12));
    if (start === undefined) continue;

    const version = view.getUint8(tfdt.start + 8);
    const pos = tfdt.start + 12;
    const current = version === 1 ? Number(view.getBigUint64(pos)) : view.getUint32(pos);
    const next = Math.max(0, current - start);
    if (version === 1) view.setBigUint64(pos, BigInt(next));
    else view.setUint32(pos, next);
  }
}

/** A playable MP4: ftyp, the original moov, then the fragments of this clip. */
async function buildFragClip(
  file: File,
  ftyp: Uint8Array,
  moov: Uint8Array,
  frags: Fragment[],
  firstSeq: number,
  startByTrack: Map<number, number>,
): Promise<Blob> {
  const parts: BlobPart[] = [toArrayBuffer(ftyp), toArrayBuffer(moov)];
  let seq = firstSeq;

  for (const f of frags) {
    // moof is small, so it is copied. Only its size-neutral fields change, so data_offset stays valid.
    const moof = new Uint8Array(await file.slice(f.start, f.moofEnd).arrayBuffer());
    const view = new DataView(moof.buffer);
    const mfhd = readBoxes(view, 8, moof.length).find((b) => b.type === 'mfhd');
    if (mfhd) view.setUint32(mfhd.start + 12, seq++);
    rebaseMoof(moof, startByTrack);

    parts.push(toArrayBuffer(moof));
    parts.push(file.slice(f.moofEnd, f.end)); // mdat is read from disk, not loaded into memory
  }
  return new Blob(parts, { type: 'video/mp4' });
}

export async function splitFragmentedMp4(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const top = await topLevelBoxes(file);
  const moovBox = findBox(top, 'moov');
  const ftypBox = top.find((b) => b.type === 'ftyp');
  const ftyp = ftypBox
    ? new Uint8Array(await file.slice(ftypBox.start, ftypBox.end).arrayBuffer())
    : new Uint8Array(0);
  const moov = new Uint8Array(await file.slice(moovBox.start, moovBox.end).arrayBuffer());

  const movie = parseMoov(moov, moovBox.headerSize);
  const video = movie.tracks.find((t) => t.handler === 'vide') ?? movie.tracks[0];

  const frags = await scanFragments(file, video);
  if (frags.length === 0) throw new Error('No fragments were found in this file.');

  const secs = Float64Array.from(frags, (f) => f.time);
  const syncIdx = frags.flatMap((f, i) => (f.sync ? [i] : []));
  if (syncIdx.length === 0) throw new Error('This file has no key frames, so it cannot be cut.');

  const last = frags[frags.length - 1];
  const cuts = planCuts(secs, syncIdx, last.time + last.dur, clipSeconds, frags.length);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  let seq = 1;
  for (let i = 0; i < count; i++) {
    const slice = frags.slice(cuts[i], cuts[i + 1]);
    parts.push({
      name: partFileName(file.name, i, count),
      blob: await buildFragClip(file, ftyp, moov, slice, seq, slice[0].baseByTrack),
    });
    seq += slice.length;
  }
  return parts;
}