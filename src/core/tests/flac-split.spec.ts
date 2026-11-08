import { describe, expect, it } from 'vitest';
import { detectFile, splitFile } from '../index';
import { crc8, readFlac } from '../audio/flac-split';

const SAMPLE_RATE = 44100;
const BLOCK = 4096;
const FRAMES = 100;

function makeFlac(): File {
  const frameBytes: number[] = [];
  for (let i = 0; i < FRAMES; i++) {
    const head = [0xff, 0xf8, 0xc9, 0x08, i];
    frameBytes.push(...head, crc8(Uint8Array.from(head)), ...new Array<number>(200).fill(0));
  }

  const info = new Uint8Array(34);
  const v = new DataView(info.buffer);
  v.setUint16(0, BLOCK);
  v.setUint16(2, BLOCK);
  info[10] = (SAMPLE_RATE >> 12) & 0xff;
  info[11] = (SAMPLE_RATE >> 4) & 0xff;
  info[12] = ((SAMPLE_RATE & 0x0f) << 4) | 0x00;
  info[13] = 0xf0;
  v.setUint32(14, FRAMES * BLOCK);

  const header = [0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 34];
  const bytes = Uint8Array.from([...header, ...info, ...frameBytes]);
  return new File([bytes], 'tone.flac', { type: 'audio/flac' });
}

describe('flac split', () => {
  it('reads every frame and the total sample count', async () => {
    const info = await readFlac(makeFlac());
    expect(info.frames.length).toBe(FRAMES);
    expect(info.totalSamples).toBe(FRAMES * BLOCK);
  });

  it('splits the clip into 3 second parts and keeps every sample', async () => {
    const f = makeFlac();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 3);
    expect(parts.length).toBe(4);

    let total = 0;
    for (const p of parts) {
      const info = await readFlac(new File([p.blob], 'x.flac'));
      total += info.totalSamples;
    }
    expect(total).toBe(FRAMES * BLOCK);
  });
});