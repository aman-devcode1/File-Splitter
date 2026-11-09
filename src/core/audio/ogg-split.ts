import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const UNREADABLE = 'This Ogg file could not be read. Byte split works for any file.';
const FLAG_CONTINUED = 0x01;
const FLAG_EOS = 0x04;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Ogg page checksum (CRC-32, polynomial 0x04C11DB7, not reflected). */
export function oggCrc(bytes: Uint8Array): number {
  let c = 0;
  for (const b of bytes) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ b) & 0xff]) >>> 0;
  return c;
}

interface Page {
  readonly start: number;
  readonly end: number;
  readonly bodyStart: number;
  readonly headerType: number;
  readonly granule: bigint;
}

function parsePages(b: Uint8Array): Page[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pages: Page[] = [];
  let p = 0;
  while (p + 27 <= b.length) {
    if (b[p] !== 0x4f || b[p + 1] !== 0x67 || b[p + 2] !== 0x67 || b[p + 3] !== 0x53) {
      throw new Error(UNREADABLE);
    }
    const nseg = b[p + 26];
    const bodyStart = p + 27 + nseg;
    let bodyLen = 0;
    for (let i = 0; i < nseg; i++) bodyLen += b[p + 27 + i];
    const end = bodyStart + bodyLen;
    if (end > b.length) throw new Error(UNREADABLE);
    pages.push({
      start: p,
      end,
      bodyStart,
      headerType: b[p + 5],
      granule: view.getBigInt64(p + 6, true),
    });
    p = end;
  }
  return pages;
}

/** Vorbis sample rate from the identification header, or 48000 for Opus (Opus granules are always 48 kHz). */
function rateOf(b: Uint8Array, first: Page): number {
  const s = first.bodyStart;
  const text = (from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
  if (b[s] === 0x01 && text(s + 1, 6) === 'vorbis') {
    return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(s + 12, true);
  }
  if (text(s, 8) === 'OpusHead') return 48000;
  throw new Error(UNREADABLE);
}

interface OggInfo {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly pages: Page[];
  readonly headerCount: number;
  readonly rate: number;
  readonly duration: number;
}

async function readOgg(file: File): Promise<OggInfo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pages = parsePages(bytes);
  if (pages.length < 3) throw new Error(UNREADABLE);

  const rate = rateOf(bytes, pages[0]);
  // Header pages have granule 0. The first page with a positive granule starts the audio.
  const headerCount = pages.findIndex((p) => p.granule > 0n);
  if (headerCount <= 0) throw new Error(UNREADABLE);

  let last = 0n;
  for (let i = pages.length - 1; i >= 0; i--) {
    if (pages[i].granule >= 0n) {
      last = pages[i].granule;
      break;
    }
  }
  return { bytes, pages, headerCount, rate, duration: Number(last) / rate };
}

/** Seconds of audio in an Ogg Vorbis or Opus file. */
export async function oggDuration(file: File): Promise<number> {
  return (await readOgg(file)).duration;
}

/** Copies one page with a new sequence number, granule and flags, and a fresh checksum. */
function rewrite(
  bytes: Uint8Array<ArrayBuffer>,
  page: Page,
  seq: number,
  granule: bigint,
  headerType: number,
): Uint8Array<ArrayBuffer> {
  const out = bytes.slice(page.start, page.end);
  const v = new DataView(out.buffer);
  out[5] = headerType;
  v.setBigInt64(6, granule, true);
  v.setUint32(18, seq, true);
  v.setUint32(22, 0, true);
  v.setUint32(22, oggCrc(out), true);
  return out;
}

/** Cuts an Ogg Vorbis or Opus file into clips of about clipSeconds, on page boundaries. */
export async function splitOgg(file: File, clipSeconds: number): Promise<SplitPart[]> {
  const { bytes, pages, headerCount, rate, duration } = await readOgg(file);
  const headers = pages.slice(0, headerCount);
  const audio = pages.slice(headerCount);
  const n = audio.length;
  if (n === 0) throw new Error('This Ogg file has no audio to split.');

  // Time of every audio page. Pages without a granule keep the previous time.
  const secs = new Float64Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (audio[i].granule >= 0n) last = Number(audio[i].granule) / rate;
    secs[i] = last;
  }

  // Cut only where no packet is continued from the previous page.
  const sync = audio.flatMap((p, i) => ((p.headerType & FLAG_CONTINUED) === 0 ? [i] : []));
  const cuts = planCuts(secs, sync, duration, clipSeconds, n);
  const count = cuts.length - 1;

  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    // Granules restart from the end of the page before the cut, so the clip starts at 0.
    const prev = from > 0 && audio[from - 1].granule > 0n ? audio[from - 1].granule : 0n;

    const pieces: Uint8Array<ArrayBuffer>[] = headers.map((p, k) =>
      rewrite(bytes, p, k, p.granule, p.headerType),
    );

    for (let j = from; j < to; j++) {
      const p = audio[j];
      let granule = -1n;
      if (p.granule >= 0n) {
        const rel = p.granule - prev;
        granule = rel > 0n ? rel : 0n;
      }
      const isLast = j === to - 1;
      const type = isLast ? p.headerType | FLAG_EOS : p.headerType & ~FLAG_EOS;
      pieces.push(rewrite(bytes, p, headers.length + (j - from), granule, type));
    }

    parts.push({
      name: partFileName(file.name, i, count),
      blob: new Blob(pieces, { type: 'audio/ogg' }),
    });
  }
  return parts;
}

/** Which codec is inside an Ogg file: Opus or Vorbis. */
export async function oggCodec(file: File): Promise<'opus' | 'vorbis'> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  return String.fromCharCode(...head).includes('OpusHead') ? 'opus' : 'vorbis';
}