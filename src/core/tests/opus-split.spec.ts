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

/** Opus file: OpusHead + OpusTags, then 10 audio pages of 0.1 s each at 48000 Hz. */
function makeOpus(): File {
  const head = new Uint8Array(19);
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // "OpusHead"
  head[8] = 1; // version
  head[9] = 1; // channels
  new DataView(head.buffer).setUint16(10, 384, true); // pre-skip
  new DataView(head.buffer).setUint32(12, 48000, true); // sample rate

  const comment = new Uint8Array(20);
  comment[0] = 0x03;
  comment.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 1); // "OpusTags"

  const parts: Uint8Array[] = [page(0x02, 0n, 0, head), page(0x00, 0n, 1, comment)];
  for (let i = 0; i < 10; i++) {
    parts.push(page(0x00, BigInt((i + 1) * 4800), i + 2, new Uint8Array(50).fill(0xaa)));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return new File([out], 'tone.opus', { type: 'audio/ogg' });
}

describe('opus split', () => {
  it('cuts 1 second into 0.4 and 0.6 second parts, with granules restarted', async () => {
    const f = makeOpus();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 0.5);

    expect(parts.length).toBe(2);
    expect(await oggDuration(new File([parts[0].blob], 'a.opus'))).toBeCloseTo(0.4, 5);
    expect(await oggDuration(new File([parts[1].blob], 'b.opus'))).toBeCloseTo(0.6, 5);
  });
});