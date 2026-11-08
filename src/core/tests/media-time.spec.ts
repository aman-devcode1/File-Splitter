import { describe, expect, it } from 'vitest';
import {
  ascii,
  box,
  concat,
  findBox,
  fullBox,
  parseMoov,
  sampleDeltas,
  sampleOffsets,
  toArrayBuffer,
  topLevelBoxes,
  u32Flat,
} from '../video/mp4';
import { splitMp4 } from '../video/media-time';
import { planCuts } from '../shared/cut-plan';

const SIZE = 16;

/** Synthetic MP4: one video track. Each sample is 16 bytes, all filled with its number (1-based). */
function makeMp4(deltas: number[], sync: number[], timescale: number): File {
  const n = deltas.length;
  const total = deltas.reduce((a, b) => a + b, 0);
  const payload = new Uint8Array(n * SIZE);
  for (let i = 0; i < n; i++) payload.fill(i + 1, i * SIZE, (i + 1) * SIZE);

  const ftyp = box('ftyp', ascii('isom'), u32Flat([0x200]), ascii('isom'));

  const moov = (base: number): Uint8Array =>
    box(
      'moov',
      fullBox('mvhd', 0, 0, u32Flat([0, 0, timescale, total]), new Uint8Array(76)),
      box(
        'trak',
        fullBox('tkhd', 0, 3, new Uint8Array(80)),
        box(
          'mdia',
          fullBox('mdhd', 0, 0, u32Flat([0, 0, timescale, total]), new Uint8Array(4)),
          fullBox('hdlr', 0, 0, u32Flat([0]), ascii('vide'), new Uint8Array(13)),
          box(
            'minf',
            fullBox('vmhd', 0, 1, new Uint8Array(8)),
            box(
              'stbl',
              fullBox('stsd', 0, 0, u32Flat([1]), box('avc1', new Uint8Array(78))),
              fullBox('stts', 0, 0, u32Flat([n, ...deltas.flatMap((d) => [1, d])])),
              fullBox('stss', 0, 0, u32Flat([sync.length, ...sync])),
              fullBox('stsc', 0, 0, u32Flat([1, 1, n, 1])),
              fullBox('stsz', 0, 0, u32Flat([0, n, ...new Array<number>(n).fill(SIZE)])),
              fullBox('stco', 0, 0, u32Flat([1, base])),
            ),
          ),
        ),
      ),
    );

  const moovLen = moov(0).length;
  const base = ftyp.length + moovLen + 8; // +8 is the mdat header
  const bytes = concat([ftyp, moov(base), box('mdat', payload)]);
  return new File([toArrayBuffer(bytes)], 'test.mp4', { type: 'video/mp4' });
}

async function readPart(blob: Blob) {
  const file = new File([blob], 'part.mp4');
  const moov = findBox(await topLevelBoxes(file), 'moov');
  const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
  return { file, movie: parseMoov(bytes, moov.headerSize) };
}

describe('planCuts', () => {
  it('cuts at the key sample nearest to each multiple of the clip length', () => {
    const secs = Float64Array.from({ length: 10 }, (_, i) => i);
    expect(planCuts(secs, [0, 3, 6], 10, 3, 10)).toEqual([0, 3, 6, 10]);
  });

  it('gives one clip when the clip length is longer than the file', () => {
    const secs = Float64Array.from({ length: 4 }, (_, i) => i);
    expect(planCuts(secs, [0], 4, 60, 4)).toEqual([0, 4]);
  });
});

describe('splitMp4', () => {
  it('cuts 10 one-second samples into 3, 3 and 4 second clips', async () => {
    const f = makeMp4(new Array<number>(10).fill(1000), [1, 4, 7], 1000);
    const parts = await splitMp4(f, 3);

    expect(parts.map((p) => p.name)).toEqual([
      'test_PART001.mp4',
      'test_PART002.mp4',
      'test_PART003.mp4',
    ]);

    const counts: number[] = [];
    const seconds: number[] = [];
    for (const p of parts) {
      const { movie } = await readPart(p.blob);
      const t = movie.tracks[0];
      counts.push(t.sizes.length);
      seconds.push(sampleDeltas(t).reduce((a, d) => a + d, 0) / t.timescale);
    }
    expect(counts).toEqual([3, 3, 4]);
    expect(seconds).toEqual([3, 3, 4]);
  });

  it('keeps the original sample bytes (clip 2 starts with sample 4)', async () => {
    const f = makeMp4(new Array<number>(10).fill(1000), [1, 4, 7], 1000);
    const parts = await splitMp4(f, 3);

    const { file, movie } = await readPart(parts[1].blob);
    const offsets = sampleOffsets(movie.tracks[0]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(bytes[offsets[0]]).toBe(4);
    expect(bytes[offsets[offsets.length - 1]]).toBe(6);
  });

  it('rejects a fragmented MP4 with a clear message', async () => {
    const f = new File([toArrayBuffer(concat([box('ftyp', ascii('isom')), box('moof')]))], 'frag.mp4');
    await expect(splitMp4(f, 3)).rejects.toThrow(/fragmented/);
  });
});