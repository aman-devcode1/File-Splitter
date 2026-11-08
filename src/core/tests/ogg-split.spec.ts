import { describe, expect, it } from 'vitest';
import { detectFile, splitFile } from '../index';
import { oggCrc, oggDuration } from '../audio/ogg-split';

function page(type: number, granule: bigint, seq: number, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(28 + body.length));
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, type], 0);
  v.setBigInt64(6, granule, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, seq, true);
  out[26] = 1;
  out[27] = body.length;
  out.set(body, 28);
  v.setUint32(22, oggCrc(out), true);
  return out;
}

/** Vorbis-like file: 2 header pages (granule 0), then 10 audio pages of 0.1 s each at 44100 Hz. */
function makeOgg(): File {
  const ident = new Uint8Array(30);
  ident[0] = 0x01;
  ident.set([0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 1);
  new DataView(ident.buffer).setUint32(12, 44100, true);

  const comment = new Uint8Array(20);
  comment[0] = 0x03;
  comment.set([0x76, 0x6f, 0x72, 0x62, 0x69, 0x73], 1);

  const parts: Uint8Array[] = [page(0x02, 0n, 0, ident), page(0x00, 0n, 1, comment)];
  for (let i = 0; i < 10; i++) {
    parts.push(page(0x00, BigInt((i + 1) * 4410), i + 2, new Uint8Array(50).fill(0x55)));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return new File([out], 'tone.ogg', { type: 'audio/ogg' });
}

describe('ogg split', () => {
  it('cuts 1 second into 0.4 and 0.6 second parts, with granules restarted', async () => {
    const f = makeOgg();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 0.5);

    expect(parts.length).toBe(2);
    expect(await oggDuration(new File([parts[0].blob], 'a.ogg'))).toBeCloseTo(0.4, 5);
    expect(await oggDuration(new File([parts[1].blob], 'b.ogg'))).toBeCloseTo(0.6, 5);
  });
});