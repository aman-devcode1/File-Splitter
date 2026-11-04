import JSZip from 'jszip';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from './byte-split';

const DOCUMENT_PATH = 'word/document.xml';
const UNREADABLE =
  'This Word file could not be read. It may be damaged or password-protected. Byte split works for any file.';

/** Groups paragraphs into parts. The last part may be shorter. */
export function planParagraphs(total: number, perPart: number): { index: number; start: number; end: number }[] {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('Invalid paragraph count.');
  if (!Number.isSafeInteger(perPart) || perPart < 1) throw new RangeError('Paragraphs per part must be at least 1.');
  const ranges: { index: number; start: number; end: number }[] = [];
  for (let start = 0; start < total; start += perPart) {
    ranges.push({ index: ranges.length, start, end: Math.min(start + perPart, total) });
  }
  return ranges;
}

/**
 * Returns the body of document.xml split into: head (everything before the first
 * paragraph), the paragraphs, and tail (everything after the last paragraph, e.g. sectPr).
 * Paragraph XML is kept exactly as it is, so formatting is preserved.
 */
export function splitDocumentXml(xml: string): { head: string; paragraphs: string[]; tail: string } {
  const bodyStart = xml.indexOf('<w:body>');
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyStart === -1 || bodyEnd === -1) throw new Error('Missing w:body');

  const bodyOpen = bodyStart + '<w:body>'.length;
  const body = xml.slice(bodyOpen, bodyEnd);

  // Top-level paragraphs only. The section properties (<w:sectPr>) stay in the tail.
  const sectIndex = body.lastIndexOf('<w:sectPr');
  const content = sectIndex === -1 ? body : body.slice(0, sectIndex);
  const tail = (sectIndex === -1 ? '' : body.slice(sectIndex)) + xml.slice(bodyEnd);

  const paragraphs = content.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  const firstParagraph = paragraphs.length > 0 ? content.indexOf(paragraphs[0]!) : content.length;

  return {
    head: xml.slice(0, bodyOpen) + content.slice(0, firstParagraph),
    paragraphs,
    tail,
  };
}

export const docxParagraphsEngine = {
  id: 'docx-paragraphs' as const,

  async split(file: File, _detected: DetectedFile, perPart: number): Promise<SplitPart[]> {
    let source: JSZip;
    let xml: string;
    try {
      source = await JSZip.loadAsync(file);
      const entry = source.file(DOCUMENT_PATH);
      if (!entry) throw new Error('no document');
      xml = await entry.async('string');
    } catch {
      throw new Error(UNREADABLE);
    }

    const { head, paragraphs, tail } = splitDocumentXml(xml);
    if (paragraphs.length === 0) {
      throw new Error('This Word file has no paragraphs to split.');
    }

    const ranges = planParagraphs(paragraphs.length, perPart);
    const parts: SplitPart[] = [];

    for (const r of ranges) {
      // Copy the whole original archive so styles, images and relationships are kept.
      const copy = await JSZip.loadAsync(await file.arrayBuffer());
      const body = paragraphs.slice(r.start, r.end).join('');
      copy.file(DOCUMENT_PATH, head + body + tail);
      const blob = await copy.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        compression: 'DEFLATE',
      });
      parts.push({ name: partFileName(file.name, r.index, ranges.length), blob });
    }

    return parts;
  },
};