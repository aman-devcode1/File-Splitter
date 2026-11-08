import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { detectFile, modesFor, planPages, splitFile } from '../index';

async function makePdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    doc.addPage();
  }
  const bytes = await doc.save();
  return new File([new Uint8Array(bytes)], 'report.pdf', { type: 'application/pdf' });
}

describe('planPages', () => {
  it('groups pages and keeps the shorter last group', () => {
    expect(planPages(25, 10)).toEqual([
      { index: 0, start: 0, end: 10 },
      { index: 1, start: 10, end: 20 },
      { index: 2, start: 20, end: 25 },
    ]);
  });

  it('returns no parts for a zero-page document', () => {
    expect(planPages(0, 10)).toEqual([]);
  });

  it('rejects a group size below 1', () => {
    expect(() => planPages(10, 0)).toThrow();
  });
});

describe('pdf-pages engine', () => {
    it('is offered for PDF files, and byte split is hidden', async () => {
    const f = await makePdf(3);
    const d = await detectFile(f);
    expect(modesFor(d).map((m) => m.id)).toEqual(['pdf-pages']);
  });

  it('splits 25 pages into 10, 10 and 5 page PDFs with _PART names', async () => {
    const f = await makePdf(25);
    const d = await detectFile(f);

    const parts = await splitFile(f, d, 'pdf-pages', 10);

    expect(parts.map((p) => p.name)).toEqual([
      'report_PART001.pdf',
      'report_PART002.pdf',
      'report_PART003.pdf',
    ]);

    const counts: number[] = [];
    for (const part of parts) {
      const doc = await PDFDocument.load(await part.blob.arrayBuffer());
      counts.push(doc.getPageCount());
    }
    expect(counts).toEqual([10, 10, 5]);
  });

    it('gives a clear error for a file that is not a readable PDF', async () => {
    const broken = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02])], 'broken.pdf');
    const d = await detectFile(broken);

    await expect(splitFile(broken, d, 'pdf-pages', 10)).rejects.toThrow(/could not be read/);
  });
});