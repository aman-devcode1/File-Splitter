import { describe, expect, it } from 'vitest';
import { detectFile, splitFile } from '../index';
import { readMp3 } from '../split/mp3-split';

/** MPEG-1 Layer III, 128 kbps, 44.1 kHz: every frame is 417 bytes and holds 1152 samples. */
function makeMp3(frameCount: number): File {
  const size = 417;
  const data = new Uint8Array(new ArrayBuffer(frameCount * size));
  for (let i = 0; i < frameCount; i++) {
    data[i * size] = 0xff;
    data[i * size + 1] = 0xfb;
    data[i * size + 2] = 0x90;
    data[i * size + 3] = 0x00;
  }
  return new File([data], 'tone.mp3', { type: 'audio/mpeg' });
}

describe('mp3 split', () => {
  it('reads 100 frames as about 2.61 seconds', async () => {
    const { frames, duration } = await readMp3(makeMp3(100));
    expect(frames.length).toBe(100);
    expect(duration).toBeCloseTo(2.612, 2);
  });

  it('splits 2.6 seconds into 1 second clips (3 parts)', async () => {
    const f = makeMp3(100);
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 1);
    expect(parts.length).toBe(3);
  });
});