import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, splitFile } from '../index';

function makeWav(seconds: number, rate = 8000): File {
  const frames = seconds * rate;
  const data = new Uint8Array(frames * 2); // 16-bit mono
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const w = (p: number, s: string) => { for (let i = 0; i < 4; i++) out[p + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, data.length, true);
  out.set(data, 44);
  return new File([out], 'tone.wav', { type: 'audio/wav' });
}

describe('wav split', () => {
  it('cuts 10 seconds into 4, 4 and 2 second clips', async () => {
    const f = makeWav(10);
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'media-time', 4);
    expect(parts.length).toBe(3);
    const sizes = await Promise.all(parts.map(async (p) => (await p.blob.arrayBuffer()).byteLength - 44));
    expect(sizes).toEqual([4 * 8000 * 2, 4 * 8000 * 2, 2 * 8000 * 2]);
  });
});