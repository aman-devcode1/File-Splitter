import JSZip from 'jszip';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

const UNREADABLE = 'This OpenDocument file could not be read. It may be damaged or password-protected.';
const CONTENT = 'content.xml';

type OdfKind = 'odt' | 'ods' | 'odp';

/** Each ODF kind has one repeating unit: paragraph, table row, or slide. */
const UNITS: Record<OdfKind, { open: RegExp; name: string }> = {
    odt: { open: /<text:(p|h)\b[^>]*?(?:\/>|>[\s\S]*?<\/text:\1>)/g, name: 'paragraphs' },
    ods: { open: /<table:table-row\b[^>]*?(?:\/>|>[\s\S]*?<\/table:table-row>)/g, name: 'rows' },
    odp: { open: /<draw:page\b[^>]*?(?:\/>|>[\s\S]*?<\/draw:page>)/g, name: 'slides' },
};

interface Doc {
    readonly zip: JSZip;
    readonly xml: string;
    readonly kind: OdfKind;
    readonly units: string[];
    /** gaps[i] is the text in the body immediately before units[i] (gaps[0] is always ''). */
    readonly gaps: string[];
    readonly head: string;
    readonly tail: string;
}

function kindOf(detected: DetectedFile): OdfKind {
    const id = detected.kind.id;
    if (id === 'odf' && detected.extension === 'odt') return 'odt';
    if (id === 'odf' && detected.extension === 'ods') return 'ods';
    if (id === 'odf' && detected.extension === 'odp') return 'odp';
    throw new Error(UNREADABLE);
}

async function readDoc(file: File, kind: OdfKind): Promise<Doc> {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch {
        throw new Error(UNREADABLE);
    }
    const xml: string | undefined = await zip.file(CONTENT)?.async('string');
    if (typeof xml !== 'string') throw new Error(UNREADABLE);

    // The body is the part inside <office:body>. Everything else is kept as is.
    const bodyOpen = xml.match(/<office:body>\s*<office:(text|spreadsheet|presentation)\b[^>]*>/);
    const bodyClose = xml.lastIndexOf('</office:');
    if (!bodyOpen || bodyClose < 0) throw new Error(UNREADABLE);
    const start = bodyOpen.index! + bodyOpen[0].length;
    const inner = xml.slice(start, bodyClose);

    const matches = [...inner.matchAll(UNITS[kind].open)];
    if (matches.length === 0) throw new Error(`This file has no ${UNITS[kind].name} to split.`);
    const units = matches.map((m) => m[0]);
    const pos = matches.map((m) => m.index);
    const gaps: string[] = [''];
    for (let i = 1; i < pos.length; i++) {
        gaps.push(inner.slice(pos[i - 1]! + units[i - 1]!.length, pos[i]!));
    }

    return {
        zip,
        xml,
        kind,
        units,
        gaps,
        head: xml.slice(0, start) + inner.slice(0, pos[0]!),
        tail: inner.slice(pos[pos.length - 1]! + units[units.length - 1]!.length) + xml.slice(bodyClose),
    };
}

const CELL = /<table:((?:covered-)?table-cell)\b[^>]*?(?:\/>|>[\s\S]*?<\/table:\1>)/g;
const TABLE_COLUMN = /<table:table-column\b[^>]*?\/>/g;
const COLS = 'table:number-columns-repeated';

function repeatOf(tag: string, attr: string): number {
  const m = tag.match(new RegExp(`${attr}="(\\d+)"`));
  return m ? Number(m[1]) : 1;
}

/** Sets the repeat count on a tag, or removes the attribute when it is 1. */
function setRepeat(tag: string, attr: string, n: number): string {
  const re = new RegExp(`\\s${attr}="\\d+"`);
  if (n <= 1) return tag.replace(re, '');
  return tag.replace(re, ` ${attr}="${n}"`);
}

function cellHasData(cell: string): boolean {
  return /office:value-type="/.test(cell) || cell.replace(/<[^>]+>/g, '').trim() !== '';
}

/** Keeps only rows and columns up to the last one that has data. Empty formatted cells are dropped. */
function trimSheet(doc: Doc): Doc {
  let lastRow = -1;
  doc.units.forEach((row, i) => {
    if ((row.match(CELL) ?? []).some(cellHasData)) lastRow = i;
  });
  const rows = doc.units.slice(0, lastRow + 1);

  let lastCol = -1;
  for (const row of rows) {
    let col = 0;
    for (const cell of row.match(CELL) ?? []) {
      const open = cell.match(/^<[^>]*>/)![0];
      const span = repeatOf(open, COLS);
      if (cellHasData(cell)) lastCol = Math.max(lastCol, col + span - 1);
      col += span;
    }
  }
  const keep = lastCol + 1;
  if (keep === 0) return { ...doc, units: [] };

  const trimmedRows = rows.map((row) => {
    let col = 0;
    return row.replace(CELL, (cell) => {
      const open = cell.match(/^<[^>]*>/)![0];
      const span = repeatOf(open, COLS);
      const start = col;
      col += span;
      if (start >= keep) return '';
      if (col > keep) return setRepeat(open, COLS, keep - start) + cell.slice(open.length);
      return cell;
    });
  });

  let c = 0;
  const head = doc.head.replace(TABLE_COLUMN, (tag) => {
    const span = repeatOf(tag, COLS);
    const start = c;
    c += span;
    if (start >= keep) return '';
    if (c > keep) return setRepeat(tag, COLS, keep - start);
    return tag;
  });

  const endAddr = `${colLetters(keep - 1)}${rows.length}`;
  const fixRange = (s: string) =>
    s.replace(
      /(table:target-range-address="[^"]*:(?:[^"]*\.)?\$?)[A-Z]+\$?\d+"/g,
      (_m, p: string) => `${p}${endAddr}"`,
    );

  return { ...doc, units: trimmedRows, gaps: doc.gaps.slice(0, lastRow + 1), head: fixRange(head), tail: fixRange(doc.tail) };
}

async function loadDoc(file: File, detected: DetectedFile): Promise<Doc> {
  const doc = await readDoc(file, kindOf(detected));
  return doc.kind === 'ods' ? trimSheet(doc) : doc;
}

function colLetters(n: number): string {
    let s = '';
    n += 1; // 0-based to 1-based
    while (n > 0) {
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

const HEADER_ROWS: Partial<Record<OdfKind, number>> = { ods: 1 };

function headerCount(kind: OdfKind): number {
    return HEADER_ROWS[kind] ?? 0;
}

export async function countOdf(file: File, detected: DetectedFile): Promise<number> {
    const doc = await loadDoc(file, detected);
    return doc.units.slice(headerCount(doc.kind)).length;
}

async function buildPart(doc: Doc, keep: string[], file: File, gaps: string[] = []): Promise<Blob> {
    const fixedHead = doc.head.replace(
        /(table:target-range-address="[^"]*:(?:[^"]*\.)?\$?[A-Z]+\$?)\d+"/g,
        (_m, p: string) => `${p}${keep.length}"`,
    );
    const body = keep.map((u, i) => (gaps[i] ?? '') + u).join('');
    const xml = fixedHead + body + doc.tail;
    const out = new JSZip();
    for (const [name, entry] of Object.entries(doc.zip.files)) {
        if (entry.dir) continue;
                if (name === 'settings.xml' && doc.kind === 'ods') {
            const s = await entry.async('string');
            const fixed = s.replace(/(config:name="CursorPosition[XY]"[^>]*>)\d+/g, (_m, p: string) => `${p}0`);
            out.file(name, fixed, { compression: 'DEFLATE' });
            continue;
        }
        if (name === CONTENT) {
            out.file(name, xml);
        } else {
            out.file(name, await entry.async('uint8array'), {
                compression: name === 'mimetype' ? 'STORE' : 'DEFLATE',
            });
        }
    }
    const mime = file.name.toLowerCase().endsWith('.ods')
        ? 'application/vnd.oasis.opendocument.spreadsheet'
        : file.name.toLowerCase().endsWith('.odp')
            ? 'application/vnd.oasis.opendocument.presentation'
            : 'application/vnd.oasis.opendocument.text';
    return out.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE' });
}

export async function splitOdf(file: File, detected: DetectedFile, perPart: number): Promise<SplitPart[]> {
    const doc = await loadDoc(file, detected);
    const h = headerCount(doc.kind);
    const header = doc.units.slice(0, h);
    const body = doc.units.slice(h);
    if (body.length === 0) throw new Error(`This file has only a header and no ${UNITS[doc.kind].name} to split.`);

    const count = Math.ceil(body.length / perPart);
    const parts: SplitPart[] = [];
    for (let i = 0; i < count; i++) {
        const start = i * perPart;
        const end = Math.min(body.length, (i + 1) * perPart);
        const keep = [...header, ...body.slice(start, end)];
        const keepGaps = [doc.gaps[start] ?? '', ...body.slice(start, end).map((_, j) => doc.gaps[start + j + 1] ?? '')];
        parts.push({ name: partFileName(file.name, i, count), blob: await buildPart(doc, keep, file, keepGaps) });
    }
    return parts;
}