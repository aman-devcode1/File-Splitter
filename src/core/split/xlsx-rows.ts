import JSZip from 'jszip';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from './byte-split';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UNREADABLE =
  'This spreadsheet could not be read. It may be damaged or password-protected. Byte split works for any file.';

export interface RowRange {
  readonly index: number;
  readonly start: number; // inclusive
  readonly end: number; // exclusive
}

/** Groups rows into parts. The last part may be shorter. */
export function planRows(totalRows: number, rowsPerPart: number): RowRange[] {
  if (!Number.isSafeInteger(totalRows) || totalRows < 0) throw new RangeError('Invalid row count.');
  if (!Number.isSafeInteger(rowsPerPart) || rowsPerPart < 1) {
    throw new RangeError('Rows per part must be at least 1.');
  }
  const ranges: RowRange[] = [];
  for (let start = 0; start < totalRows; start += rowsPerPart) {
    ranges.push({ index: ranges.length, start, end: Math.min(start + rowsPerPart, totalRows) });
  }
  return ranges;
}

/** Reads one attribute from an XML start tag. attr('<row r="5">', 'r') returns '5'. */
function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/** Worksheet zip paths in workbook order, so the first sheet comes first. */
export function sheetPaths(workbookXml: string, relsXml: string): string[] {
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target);
  }

  const paths: string[] = [];
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const rid = /\sr:id="([^"]*)"/.exec(m[0])?.[1];
    const target = rid ? targets.get(rid) : undefined;
    if (!target) continue;
    paths.push(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  return paths;
}

const ROW = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

export interface SheetXml {
  /** Everything before <sheetData>. */
  readonly head: string;
  /** The opening <sheetData> tag. */
  readonly openTag: string;
  /** Each <row> element as its own string. Rows never nest, so this is safe. */
  readonly rows: string[];
  /** Everything after </sheetData> (merged cells, page setup, etc.). */
  readonly tail: string;
}

export function splitSheetXml(xml: string): SheetXml | null {
  const start = xml.indexOf('<sheetData');
  if (start === -1) return null;
  const openEnd = xml.indexOf('>', start);
  if (openEnd === -1) return null;

  const head = xml.slice(0, start);

  // <sheetData/> with no rows
  if (xml[openEnd - 1] === '/') {
    return { head, openTag: '<sheetData>', rows: [], tail: xml.slice(openEnd + 1) };
  }

  const close = xml.indexOf('</sheetData>', openEnd);
  if (close === -1) return null;

  return {
    head,
    openTag: xml.slice(start, openEnd + 1),
    rows: xml.slice(openEnd + 1, close).match(ROW) ?? [],
    tail: xml.slice(close + '</sheetData>'.length),
  };
}

/** Keeps only the merged cells whose top row is inside the part. */
function keepMerges(tail: string, firstRow: number, lastRow: number): string {
  return tail.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/, (block) => {
    const kept = (block.match(/<mergeCell\b[^>]*\/>/g) ?? []).filter((tag) => {
      const row = Number(/^[A-Z]+(\d+)/.exec(attr(tag, 'ref') ?? '')?.[1]);
      return row >= firstRow && row <= lastRow;
    });
    return kept.length > 0 ? `<mergeCells count="${kept.length}">${kept.join('')}</mergeCells>` : '';
  });
}

function rebuildSheet(sheet: SheetXml, rows: string[]): string {
  const first = rows.length > 0 ? Number(attr(rows[0], 'r')) : 1;
  const last = rows.length > 0 ? Number(attr(rows[rows.length - 1], 'r')) : 0;
  return sheet.head + sheet.openTag + rows.join('') + '</sheetData>' + keepMerges(sheet.tail, first, last);
}

/** Edits to workbook-level files, made once for all parts: the calcChain entries are removed. */
async function workbookEdits(source: JSZip): Promise<Map<string, string>> {
  const edits = new Map<string, string>();

  const contentTypes = source.file('[Content_Types].xml');
  if (contentTypes) {
    const xml = await contentTypes.async('string');
    edits.set('[Content_Types].xml', xml.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, ''));
  }

  const rels = source.file('xl/_rels/workbook.xml.rels');
  if (rels) {
    const xml = await rels.async('string');
    edits.set('xl/_rels/workbook.xml.rels', xml.replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''));
  }

  return edits;
}

/** Builds one workbook: every original file, with the edited ones replaced and calcChain removed. */
async function buildPart(source: JSZip, edits: Map<string, string>): Promise<Blob> {
  const out = new JSZip();
  for (const entry of Object.values(source.files)) {
    if (entry.dir || entry.name === 'xl/calcChain.xml') continue;
    const edited = edits.get(entry.name);
    out.file(entry.name, edited ?? (await entry.async('uint8array')));
  }
  return out.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
}

async function readText(source: JSZip, path: string): Promise<string> {
  const entry = source.file(path);
  if (!entry) throw new Error(`Missing ${path}`);
  return entry.async('string');
}

interface SheetRef {
  readonly path: string;
  readonly parts: SheetXml;
}

export const xlsxRowsEngine = {
  id: 'xlsx-rows' as const,

  async split(file: File, _detected: DetectedFile, rowsPerPart: number): Promise<SplitPart[]> {
    let source: JSZip;
    const sheets: SheetRef[] = [];

    try {
      source = await JSZip.loadAsync(file);
      const paths = sheetPaths(
        await readText(source, 'xl/workbook.xml'),
        await readText(source, 'xl/_rels/workbook.xml.rels'),
      );
      if (paths.length === 0) throw new Error('no sheets');

      for (const path of paths) {
        const parsed = splitSheetXml(await readText(source, path));
        if (!parsed) throw new Error(`no sheetData in ${path}`);
        sheets.push({ path, parts: parsed });
      }
    } catch {
      throw new Error(UNREADABLE);
    }

    const maxRows = Math.max(0, ...sheets.map((s) => s.parts.rows.length));
    if (maxRows === 0) {
      throw new Error('This spreadsheet has no rows to split.');
    }

    const edits = await workbookEdits(source);
    const ranges = planRows(maxRows, rowsPerPart);
    const parts: SplitPart[] = [];

    for (const range of ranges) {
      const partEdits = new Map(edits);
      for (const sheet of sheets) {
        const rows = sheet.parts.rows.slice(range.start, range.end);
        partEdits.set(sheet.path, rebuildSheet(sheet.parts, rows));
      }
      parts.push({
        name: partFileName(file.name, range.index, ranges.length),
        blob: await buildPart(source, partEdits),
      });
    }

    return parts;
  },
};

export async function countRows(file: File): Promise<number> {
  const source = await JSZip.loadAsync(file);
  const paths = sheetPaths(
    await readText(source, 'xl/workbook.xml'),
    await readText(source, 'xl/_rels/workbook.xml.rels'),
  );
  let max = 0;
  for (const path of paths) {
    const parsed = splitSheetXml(await readText(source, path));
    if (parsed) max = Math.max(max, parsed.rows.length);
  }
  return max;
}