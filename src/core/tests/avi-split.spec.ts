import { describe, expect, it } from 'vitest';
import { detectFile, splitFile } from '../index';
import { readAvi } from '../video/avi';

/** Minimal valid AVI: hdrl (avih + strl with a 10 fps video stream), movi with 20 frames, idx1. */
function makeAvi(): File {
  const enc = new TextEncoder();
  const u32 = (n: number) => {
    const o = new Uint8Array(4);
    new DataView(o.buffer).setUint32(0, n, true);
    return o;
  };
  const cat = (...p: Uint8Array[]) => {
    const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
    let q = 0;
    for (const x of p) {
      o.set(x, q);
      q += x.length;
    }
    return o;
  };
  const chunk = (id: string, data: Uint8Array) =>
    cat(enc.encode(id), u32(data.length), data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
  const list = (type: string, ...kids: Uint8Array[]) => {
    const body = cat(enc.encode(type), ...kids);
    return cat(enc.encode('LIST'), u32(body.length), body);
  };

  // strh: fccType 'vids', dwScale 1, dwRate 10 => 10 fps
  const strh = new Uint8Array(56);
  strh.set(enc.encode('vids'), 0);
  new DataView(strh.buffer).setUint32(20, 1, true);
  new DataView(strh.buffer).setUint32(24, 10, true);

  const hdrl = list(
    'hdrl',
    chunk('avih', new Uint8Array(56)),
    list('strl', chunk('strh', strh), chunk('strf', new Uint8Array(40))),
  );

  const frames: Uint8Array[] = [];
  const index: Uint8Array[] = [];
  let off = 4; // first chunk sits 4 bytes after the 'movi' fourcc
  for (let i = 0; i < 20; i++) {
    const c = chunk('00dc', new Uint8Array(8).fill(i + 1));
    frames.push(c);
    const e = new Uint8Array(16);
    e.set(enc.encode('00dc'), 0);
    const dv = new DataView(e.buffer);
    dv.setUint32(4, i % 10 === 0 ? 0x10 : 0, true); // keyframe every 10th frame
    dv.setUint32(8, off, true);
    dv.setUint32(12, 8, true);
    index.push(e);
    off += c.length;
  }

  const movi = list('movi', ...frames);
  const idx1 = chunk('idx1', cat(...index));
  const body = cat(enc.encode('AVI '), hdrl, movi, idx1);
  const riff = cat(enc.encode('RIFF'), u32(body.length), body);
  return new File([riff], 'tone.avi', { type: 'video/x-msvideo' });
}

describe('avi split', () => {
  it('reads 20 frames at 10 fps as 2 seconds', async () => {
    const info = await readAvi(makeAvi());
    expect(info.fps).toBe(10);
    expect(info.chunks.length).toBe(20);
  });

  it('cuts 2 seconds at 1 second into two parts', async () => {
    const f = makeAvi();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 1);
    expect(parts.length).toBe(2);
  });
});