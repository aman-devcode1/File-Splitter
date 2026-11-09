import { describe, expect, it } from 'vitest';
import { detectFile, splitFile } from '../index';
import { mkvDuration } from '../video/matroska';

function size8(n: number): number[] {
  const s = [0x01];
  for (let i = 6; i >= 0; i--) s.push(Math.floor(n / 256 ** i) & 0xff);
  return s;
}

function el(id: number[], data: number[]): number[] {
  return [...id, ...size8(data.length), ...data];
}

function uintBytes(v: number, len: number): number[] {
  const out: number[] = [];
  for (let i = len - 1; i >= 0; i--) out.push(Math.floor(v / 256 ** i) & 0xff);
  return out;
}

/** Two clusters, at 0 ms and 1000 ms (scale 1 ms), each with one key frame. Total 2 seconds. */
function makeMkv(): File {
  const dur = new Uint8Array(8);
  new DataView(dur.buffer).setFloat64(0, 2000);

  const info = el([0x15, 0x49, 0xa9, 0x66], [
    ...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]),
    ...el([0x44, 0x89], [...dur]),
  ]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], []);
  const cluster = (tc: number, len: number) =>
    el([0x1f, 0x43, 0xb6, 0x75], [
      ...el([0xe7], uintBytes(tc, len)),
      ...el([0xa3], [0x81, 0x00, 0x00, 0x80, 1, 2, 3]),
    ]);

  const seg = el([0x18, 0x53, 0x80, 0x67], [...info, ...tracks, ...cluster(0, 1), ...cluster(1000, 2)]);
  const header = el([0x1a, 0x45, 0xdf, 0xa3], []);
  return new File([Uint8Array.from([...header, ...seg])], 'tone.mkv', { type: 'video/x-matroska' });
}

describe('matroska split', () => {
  it('cuts 2 seconds at 1 second into two 1 second parts', async () => {
    const f = makeMkv();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 1);

    expect(parts.length).toBe(2);
    expect(await mkvDuration(new File([parts[0].blob], 'a.mkv'))).toBeCloseTo(1, 3);
    expect(await mkvDuration(new File([parts[1].blob], 'b.mkv'))).toBeCloseTo(1, 3);
  });
}); 