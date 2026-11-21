import JSZip from 'jszip';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

const DOCUMENT_PATH = 'word/document.xml';
const NUMBERING_PATH = 'word/numbering.xml';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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
 * paragraph), the paragraphs, and tail (section properties and everything after).
 * Paragraph XML is kept exactly as it is, so formatting is preserved.
 */
export function splitDocumentXml(xml: string): { head: string; paragraphs: string[]; tail: string } {
  const bodyStart = xml.indexOf('<w:body>');
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyStart === -1 || bodyEnd === -1) throw new Error('Missing w:body');

  const bodyOpen = bodyStart + '<w:body>'.length;
  const body = xml.slice(bodyOpen, bodyEnd);

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

/** The list (numId) a paragraph belongs to, at any level. null for plain paragraphs. */
function numIdOf(p: string): string | null {
  const pr = /<w:numPr>[\s\S]*?<\/w:numPr>/.exec(p)?.[0];
  if (!pr) return null;
  const id = /<w:numId w:val="(\d+)"/.exec(pr)?.[1];
  return id && id !== '0' ? id : null;
}

/** True for top-level list items (level 0), which are the ones that number the list. */
function isTopLevel(p: string): boolean {
  const pr = /<w:numPr>[\s\S]*?<\/w:numPr>/.exec(p)?.[0] ?? '';
  const lvl = /<w:ilvl w:val="(\d+)"/.exec(pr)?.[1];
  return lvl === undefined || lvl === '0';
}

/**
 * Makes a part's list numbering continue from the earlier parts. For each list used in the part
 * that already had items before it, a new w:num is added with startOverride = count + 1.
 * `before` holds the top-level item count of each list before this part.
 */
function restartNumbers(
  numbering: string,
  part: string[],
  before: Map<string, number>,
): { numbering: string; part: string[] } {
  const abstractOf = new Map<string, string>();
  for (const m of numbering.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>\s*<w:abstractNumId w:val="(\d+)"/g)) {
    abstractOf.set(m[1]!, m[2]!);
  }

  let next = Math.max(0, ...[...abstractOf.keys()].map(Number)) + 1;
  const remap = new Map<string, string>();
  const added: string[] = [];

  for (const p of part) {
    const id = numIdOf(p);
    if (!id || remap.has(id)) continue;
    const seen = before.get(id) ?? 0;
    const abs = abstractOf.get(id);
    if (seen === 0 || !abs) continue;

    const newId = String(next++);
    remap.set(id, newId);
    added.push(
      `<w:num w:numId="${newId}"><w:abstractNumId w:val="${abs}"/>` +
        `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${seen + 1}"/></w:lvlOverride></w:num>`,
    );
  }

  if (remap.size === 0) return { numbering, part };

  const paragraphs = part.map((p) =>
    p.replace(/(<w:numPr>[\s\S]*?<w:numId w:val=")(\d+)(")/, (m: string, a: string, id: string, b: string) =>
      remap.has(id) ? a + remap.get(id) + b : m,
    ),
  );
  return {
    numbering: numbering.replace('</w:numbering>', added.join('') + '</w:numbering>'),
    part: paragraphs,
  };
}

export const docxParagraphsEngine = {
  id: 'docx-paragraphs' as const,

  async split(file: File, _detected: DetectedFile, perPart: number): Promise<SplitPart[]> {
    let source: JSZip;
    let xml: string;
    let numbering: string | null;
    try {
      source = await JSZip.loadAsync(file);
      const entry = source.file(DOCUMENT_PATH);
      if (!entry) throw new Error('no document');
      xml = await entry.async('string');
      const numEntry = source.file(NUMBERING_PATH);
      numbering = numEntry ? await numEntry.async('string') : null;
    } catch {
      throw new Error(UNREADABLE);
    }

    const { head, paragraphs, tail } = splitDocumentXml(xml);
    if (paragraphs.length === 0) {
      throw new Error('This Word file has no paragraphs to split.');
    }

    const ranges = planParagraphs(paragraphs.length, perPart);
    const before = new Map<string, number>();
    const parts: SplitPart[] = [];

    for (const r of ranges) {
      // Copy the whole original archive so styles, images and relationships are kept.
      const copy = await JSZip.loadAsync(await file.arrayBuffer());
      let partParas = paragraphs.slice(r.start, r.end);

      if (numbering !== null) {
        const fixed = restartNumbers(numbering, partParas, before);
        partParas = fixed.part;
        if (fixed.numbering !== numbering) copy.file(NUMBERING_PATH, fixed.numbering);
      }

      // Count this part's top-level list items only after this part has been numbered.
      for (const p of paragraphs.slice(r.start, r.end)) {
        const id = numIdOf(p);
        if (id && isTopLevel(p)) before.set(id, (before.get(id) ?? 0) + 1);
      }

      copy.file(DOCUMENT_PATH, head + partParas.join('') + tail);
      const blob = await copy.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
      parts.push({ name: partFileName(file.name, r.index, ranges.length), blob });
    }

    return parts;
  },
};

export async function countParagraphs(file: File): Promise<number> {
  const source = await JSZip.loadAsync(file);
  const entry = source.file(DOCUMENT_PATH);
  if (!entry) return 0;
  return splitDocumentXml(await entry.async('string')).paragraphs.length;
}