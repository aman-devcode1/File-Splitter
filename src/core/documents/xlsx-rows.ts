import JSZip from 'jszip';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UNREADABLE =
  'This spreadsheet could not be read. It may be damaged or password-protected. Byte split works for any file.';

export interface RowRange {
  readonly index: number;
  readonly start: number; // inclusive
  readonly end: number; // exclusive
}

/** Groups data rows into parts. The header row is not counted; it is copied into every part. */
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
  /** Everything after </sheetData> (merged cells, autoFilter, page setup, etc.). */
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

/** A row holds data when it has a value, text or a formula. Formatting alone does not count. */
function hasData(row: string): boolean {
  return /<(v|is|f)[\s>/]/.test(row);
}

/** Drops empty rows at the end, so the sheet stops at its last real data row. */
function trimTrailing(rows: string[]): string[] {
  let end = rows.length;
  while (end > 0 && !hasData(rows[end - 1]!)) end--;
  return rows.slice(0, end);
}

/** Gives a row a new number, and its cells too (row 12 cell A12 becomes row 5 cell A5). */
export function renumberRow(rowXml: string, num: number): string {
  return rowXml
    .replace(/^<row\b([^>]*?)\sr="\d+"/, (_m: string, pre: string) => `<row${pre} r="${num}"`)
    .replace(/<c\b([^>]*?)\sr="([A-Z]+)\d+"/g, (_m: string, pre: string, col: string) => `<c${pre} r="${col}${num}"`);
}

/** Sets the end row of a ref attribute on one tag. For example dimension A1:B21 becomes A1:B5 when lastRow is 5. */
function clipRef(xml: string, tag: string, lastRow: number): string {
  const re = new RegExp(`(<${tag}\\b[^>]*?\\sref=")([A-Z]+\\d+):([A-Z]+)\\d+(")`, 'g');
  return xml.replace(re, (_m: string, a: string, start: string, col: string, b: string) => `${a}${start}:${col}${lastRow}${b}`);
}

/**
 * Keeps the merged cells that are inside this part and moves them to the part's row numbers.
 * The header row (row 1) is copied into every part, so a merge in row 1 is kept as it is.
 */
function remapMerges(tail: string, start: number, end: number, hasHeader: boolean): string {
  const firstDataRow = hasHeader ? 2 : 1;
  return tail.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/, (block) => {
    const kept: string[] = [];
    for (const tag of block.match(/<mergeCell\b[^>]*\/>/g) ?? []) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(attr(tag, 'ref') ?? '');
      if (!m) continue;
      const top = Number(m[2]);
      const bottom = Number(m[4]);

      if (hasHeader && top === 1 && bottom === 1) {
        kept.push(tag);
        continue;
      }
      if (top < firstDataRow + start || top >= firstDataRow + end) continue;

      kept.push(tag.replace(/\sref="[^"]*"/, ` ref="${m[1]}${top - start}:${m[3]}${bottom - start}"`));
    }
    return kept.length > 0 ? `<mergeCells count="${kept.length}">${kept.join('')}</mergeCells>` : '';
  });
}

/** Resolves a relationship target (like ../tables/table1.xml) against the folder of the sheet. */
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const p of (base + target).split('/')) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

/** Table files (xl/tables/*.xml) linked to a sheet. */
async function tablePathsOf(source: JSZip, sheetPath: string): Promise<string[]> {
  const slash = sheetPath.lastIndexOf('/');
  const dir = sheetPath.slice(0, slash + 1);
  const name = sheetPath.slice(slash + 1);
  const rels = source.file(`${dir}_rels/${name}.rels`);
  if (!rels) return [];

  const out: string[] = [];
  for (const m of (await rels.async('string')).matchAll(/<Relationship\b[^>]*>/g)) {
    if (/\/table$/.test(attr(m[0], 'Type') ?? '')) {
      const target = attr(m[0], 'Target');
      if (target) out.push(resolvePath(dir, target));
    }
  }
  return out;
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

interface SheetData {
  readonly path: string;
  readonly parsed: SheetXml;
  /** Row 1, if it is the header. Copied into every part. */
  readonly header: string | null;
  /** Data rows after the header, with empty trailing rows removed. */
  readonly data: string[];
  readonly tablePaths: string[];
}

async function loadSheets(file: File): Promise<{ source: JSZip; sheets: SheetData[] }> {
  let source: JSZip;
  const sheets: SheetData[] = [];
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

      const rows = parsed.rows;
      const header = rows.length > 0 && attr(rows[0]!, 'r') === '1' ? rows[0]! : null;
      const data = trimTrailing(header ? rows.slice(1) : rows);
      sheets.push({ path, parsed, header, data, tablePaths: await tablePathsOf(source, path) });
    }
  } catch {
    throw new Error(UNREADABLE);
  }
  return { source, sheets };
}

export const xlsxRowsEngine = {
  id: 'xlsx-rows' as const,

  async split(file: File, _detected: DetectedFile, rowsPerPart: number): Promise<SplitPart[]> {
    const { source, sheets } = await loadSheets(file);

    const total = Math.max(0, ...sheets.map((s) => s.data.length));
    if (total === 0) {
      throw new Error('This spreadsheet has no data rows to split.');
    }

    const edits = await workbookEdits(source);
    const ranges = planRows(total, rowsPerPart);
    const parts: SplitPart[] = [];

    for (const range of ranges) {
      const partEdits = new Map(edits);

      for (const sheet of sheets) {
        const hasHeader = sheet.header !== null;
        const offset = hasHeader ? 1 : 0;
        const slice = sheet.data.slice(range.start, range.end);

        const out: string[] = [];
        if (sheet.header) out.push(renumberRow(sheet.header, 1));
        slice.forEach((row, i) => out.push(renumberRow(row, offset + i + 1)));

        // The last row this sheet really uses in this part. Tables and dimension stop here.
        const lastRow = Math.max(1, offset + slice.length);
        const { parsed } = sheet;

        const sheetXml =
          clipRef(parsed.head, 'dimension', lastRow) +
          parsed.openTag +
          out.join('') +
          '</sheetData>' +
          clipRef(remapMerges(parsed.tail, range.start, range.end, hasHeader), 'autoFilter', lastRow);
        partEdits.set(sheet.path, sheetXml);

        for (const tablePath of sheet.tablePaths) {
          const tableXml = await readText(source, tablePath);
          partEdits.set(tablePath, clipRef(clipRef(tableXml, 'table', lastRow), 'autoFilter', lastRow));
        }
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
  const { sheets } = await loadSheets(file);
  return Math.max(0, ...sheets.map((s) => s.data.length));
}