import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { detectFile, itemTotal, MODES, parseModeInput, splitFile } from '../index';

async function makePdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return new File([new Uint8Array(await doc.save())], 'four.pdf', { type: 'application/pdf' });
}

describe('count limit', () => {
  it('rejects a value above the total', () => {
    const mode = MODES.find((m) => m.id === 'pdf-pages')!;
    expect(parseModeInput(mode, '5', undefined, 4).ok).toBe(false);
    expect(parseModeInput(mode, '4', undefined, 4).ok).toBe(true);
    expect(parseModeInput(mode, '0', undefined, 4).ok).toBe(false);
  });

  it('reports the page total of a PDF', async () => {
    const f = await makePdf(4);
    const mode = MODES.find((m) => m.id === 'pdf-pages')!;
    expect(await itemTotal(mode, f)).toBe(4);
  });

  it('4 pages in 3 per part gives 2 parts (3 and 1)', async () => {
    const f = await makePdf(4);
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'pdf-pages', 3);
    expect(parts.length).toBe(2);
  });

  it('4 pages in 1 per part gives 4 parts', async () => {
    const f = await makePdf(4);
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'pdf-pages', 1);
    expect(parts.length).toBe(4);
  });
});