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
} from './mp4';

export interface Fragment {
  /** moof start in the file */
  readonly start: number;
  /** moof end, which is also the mdat start */
  readonly moofEnd: number;
  /** mdat end */
  readonly end: number;
  /** seconds from the start */
  readonly time: number;
  /** seconds covered by this fragment */
  readonly dur: number;
  /** true when the first sample is a key frame */
  readonly sync: boolean;
}

/** Reads one moof (its traf, tfhd, tfdt, trun). Times are converted with the track timescale. */
function fragmentInfo(bytes: Uint8Array, timescale: number): { time: number; dur: number; sync: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moofKids = readBoxes(view, 8, bytes.byteLength);
  const traf = findBox(moofKids, 'traf');
  const kids = readBoxes(view, payloadStart(traf), traf.end);

  // tfhd: flags at +8, track_ID at +12, optional fields after that
  const tfhd = findBox(kids, 'tfhd');
  const tfhdFlags = view.getUint32(tfhd.start + 8) & 0xffffff;
  let p = tfhd.start + 16;
  if (tfhdFlags & 0x1) p += 8; // base_data_offset
  if (tfhdFlags & 0x2) p += 4; // sample_description_index
  let defDur = 0;
  let defFlags = 0;
  if (tfhdFlags & 0x8) { defDur = view.getUint32(p); p += 4; }
  if (tfhdFlags & 0x10) p += 4; // default_sample_size
  if (tfhdFlags & 0x20) { defFlags = view.getUint32(p); p += 4; }

  // tfdt: version at +8, baseMediaDecodeTime at +12
  const tfdt = kids.find((b) => b.type === 'tfdt');
  let base = 0;
  if (tfdt) {
    base = view.getUint8(tfdt.start + 8) === 1
      ? Number(view.getBigUint64(tfdt.start + 12))
      : view.getUint32(tfdt.start + 12);
  }

  // trun: flags at +8, sample_count at +12, samples start at +16
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
    if (i === 0) sync = (flags & 0x10000) === 0; // sample_is_non_sync_sample bit
    dur += d;
  }

  return { time: base / timescale, dur: dur / timescale, sync };
}

/** Every moof+mdat pair in the file, in order. */
export async function scanFragments(file: File, timescale: number): Promise<Fragment[]> {
  const top = await topLevelBoxes(file);
  const out: Fragment[] = [];
  for (let i = 0; i < top.length; i++) {
    const moof = top[i];
    if (moof.type !== 'moof') continue;
    const mdat = top[i + 1];
    if (!mdat || mdat.type !== 'mdat') throw new Mp4Error('A moof box is not followed by an mdat box.');
    const bytes = new Uint8Array(await file.slice(moof.start, moof.end).arrayBuffer());
    const info = fragmentInfo(bytes, timescale);
    out.push({ start: moof.start, moofEnd: moof.end, end: mdat.end, ...info });
  }
  return out;
}

/** A playable MP4: ftyp, the original moov, then the fragments of this clip. */
async function buildFragClip(
  file: File,
  ftyp: Uint8Array,
  moov: Uint8Array,
  frags: Fragment[],
  firstSeq: number,
): Promise<Blob> {
  const parts: BlobPart[] = [toArrayBuffer(ftyp), toArrayBuffer(moov)];
  let seq = firstSeq;
  for (const f of frags) {
    // The moof is small, so it is copied. Only mfhd (sequence number) changes, and its size does not.
    const moof = new Uint8Array(await file.slice(f.start, f.moofEnd).arrayBuffer());
    const view = new DataView(moof.buffer);
    const mfhd = readBoxes(view, 8, moof.length).find((b) => b.type === 'mfhd');
    if (mfhd) view.setUint32(mfhd.start + 12, seq++);
    parts.push(toArrayBuffer(moof));
    parts.push(file.slice(f.moofEnd, f.end)); // mdat is not copied into memory
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
  const track = movie.tracks.find((t) => t.handler === 'vide') ?? movie.tracks[0];

  const frags = await scanFragments(file, track.timescale);
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
      blob: await buildFragClip(file, ftyp, moov, slice, seq),
    });
    seq += slice.length;
  }
  return parts;
}