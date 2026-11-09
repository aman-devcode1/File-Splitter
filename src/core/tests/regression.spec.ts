import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, modesFor, parseModeInput, MODES } from '../index';
import { ascii, box, toArrayBuffer, u32Flat } from '../video/mp4';

async function modeIds(f: File): Promise<string[]> {
  return modesFor(await detectFile(f)).map((m) => m.id);
}

async function zipBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const z = new JSZip();
  z.file('a.txt', 'x');
  const bytes = await z.generateAsync({ type: 'uint8array' });
  return new Uint8Array(bytes);
}

describe('modes per format (regression)', () => {
  it('PDF offers only the page split', async () => {
    expect(await modeIds(new File(['%PDF-1.4\n'], 'a.pdf'))).toEqual(['pdf-pages']);
  });

  it('plain ZIP offers only the file-count split', async () => {
    const f = new File([await zipBytes()], 'a.zip');
    expect(await modeIds(f)).toEqual(['zip-entries']);
  });

  it('DOCX offers only the paragraph split', async () => {
    const f = new File([await zipBytes()], 'a.docx');
    expect(await modeIds(f)).toEqual(['docx-paragraphs']);
  });

  it('text offers byte split and line split', async () => {
    expect(await modeIds(new File(['hello\nworld'], 'a.txt'))).toEqual(['bytes', 'text-lines']);
  });

  it('JSON offers byte split only', async () => {
    expect(await modeIds(new File(['{"a":1}'], 'a.json'))).toEqual(['bytes']);
  });

  it('MP4 offers length clips only', async () => {
    const ftyp = box('ftyp', ascii('isom'), u32Flat([0x200]));
    expect(await modeIds(new File([toArrayBuffer(ftyp)], 'a.mp4'))).toEqual(['media-time']);
  });

  it('MKV offers length clips only (byte parts do not open)', async () => {
    const f = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])], 'a.mkv');
    expect(await modeIds(f)).toEqual(['media-time']);
  });
});

describe('input limits (regression)', () => {
  it('count modes reject 0, negatives, decimals and values above the total', () => {
    const mode = MODES.find((m) => m.id === 'pdf-pages')!;
    expect(parseModeInput(mode, '0', undefined, 4).ok).toBe(false);
    expect(parseModeInput(mode, '-1', undefined, 4).ok).toBe(false);
    expect(parseModeInput(mode, '2.5', undefined, 4).ok).toBe(false);
    expect(parseModeInput(mode, '5', undefined, 4).ok).toBe(false);
    expect(parseModeInput(mode, '4', undefined, 4).ok).toBe(true);
  });
});