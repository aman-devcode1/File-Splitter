import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, modesFor, planParagraphs, splitFile, splitDocumentXml } from '../index';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

async function makeDocx(paragraphCount: number): Promise<File> {
  const body = Array.from({ length: paragraphCount }, (_, i) => paragraph(`Para ${i + 1}`)).join('');
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', xml);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([new Uint8Array(bytes)], 'letter.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

describe('planParagraphs', () => {
  it('keeps the shorter last group', () => {
    expect(planParagraphs(5, 2)).toEqual([
      { index: 0, start: 0, end: 2 },
      { index: 1, start: 2, end: 4 },
      { index: 2, start: 4, end: 5 },
    ]);
  });
});

describe('splitDocumentXml', () => {
  it('finds paragraphs and keeps section properties in the tail', () => {
    const xml = `<w:document><w:body>${paragraph('A')}${paragraph('B')}<w:sectPr/></w:body></w:document>`;
    const { paragraphs, tail } = splitDocumentXml(xml);
    expect(paragraphs.length).toBe(2);
    expect(tail).toContain('<w:sectPr/>');
  });
});

describe('docx-paragraphs engine', () => {
  it('is offered for DOCX files', async () => {
    const d = await detectFile(await makeDocx(2));
    expect(modesFor(d).map((m) => m.id)).toContain('docx-paragraphs');
  });

  it('splits 5 paragraphs into 2, 2 and 1 paragraph documents', async () => {
    const f = await makeDocx(5);
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'docx-paragraphs', 2);

    expect(parts.map((p) => p.name)).toEqual([
      'letter_PART001.docx',
      'letter_PART002.docx',
      'letter_PART003.docx',
    ]);

    const counts: number[] = [];
    for (const part of parts) {
      const z = await JSZip.loadAsync(await part.blob.arrayBuffer());
      const xml = await z.file('word/document.xml')!.async('string');
      counts.push((xml.match(/<w:p>/g) ?? []).length);
      expect(z.file('[Content_Types].xml')).not.toBeNull();
    }
    expect(counts).toEqual([2, 2, 1]);
  });
});