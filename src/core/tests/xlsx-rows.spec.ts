import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, modesFor, splitFile } from '../index';
import { planRows } from '../documents/xlsx-rows';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function rowXml(r: number, sheet: number): string {
  return `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>S${sheet}R${r}</t></is></c></row>`;
}

/** Sheet 1 has two merged ranges, so the merge filtering can be tested. */
function sheetXml(sheet: number, rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, i) => rowXml(i + 1, sheet)).join('');
  const merges =
    sheet === 1 ? '<mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="A3:B3"/></mergeCells>' : '';
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS}"><dimension ref="A1"/><sheetData>${rows}</sheetData>${merges}</worksheet>`
  );
}

async function makeXlsx(rowCounts: number[]): Promise<File> {
  const zip = new JSZip();
  const sheetTags = rowCounts
    .map((_, i) => `<sheet name="Sheet${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  const rels =
    rowCounts
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('') + `<Relationship Id="rId99" Type="${REL}/calcChain" Target="calcChain.xml"/>`;

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>' +
      '</Types>',
  );
  zip.file('xl/workbook.xml', `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${sheetTags}</sheets></workbook>`);
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  zip.file('xl/calcChain.xml', '<calcChain/>');
  rowCounts.forEach((n, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(i + 1, n)));

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([new Uint8Array(bytes)], 'book.xlsx', { type: MIME });
}

async function splitBook(rowCounts: number[], perPart: number) {
  const f = await makeXlsx(rowCounts);
  const d = await detectFile(f);
  return splitFile(f, d, 'xlsx-rows', perPart);
}

async function xmlOf(blob: Blob, path: string): Promise<string> {
  const z = await JSZip.loadAsync(await blob.arrayBuffer());
  return z.file(path)!.async('string');
}

describe('planRows', () => {
  it('keeps the shorter last group', () => {
    expect(planRows(5, 2)).toEqual([
      { index: 0, start: 0, end: 2 },
      { index: 1, start: 2, end: 4 },
      { index: 2, start: 4, end: 5 },
    ]);
  });
});

describe('xlsx-rows engine', () => {
  it('is offered for XLSX files', async () => {
    const d = await detectFile(await makeXlsx([2]));
    expect(modesFor(d).map((m) => m.id)).toContain('xlsx-rows');
  });

  it('splits every sheet by the same data row range, with the header in every part', async () => {
    // Sheet 1 has 4 data rows and sheet 2 has 2. The total is 4, so 2 parts of 2 rows.
    const parts = await splitBook([5, 3], 2);

    expect(parts.map((p) => p.name)).toEqual(['book_PART001.xlsx', 'book_PART002.xlsx']);

    const counts: [number, number][] = [];
    for (const p of parts) {
      const s1 = (await xmlOf(p.blob, 'xl/worksheets/sheet1.xml')).match(/<row\b/g)?.length ?? 0;
      const s2 = (await xmlOf(p.blob, 'xl/worksheets/sheet2.xml')).match(/<row\b/g)?.length ?? 0;
      counts.push([s1, s2]);
    }
    // Each row count includes the header row.
    expect(counts).toEqual([
      [3, 3],
      [3, 1],
    ]);
  });

  it('renumbers rows and cells from row 1 in each part, and repeats the header', async () => {
    const parts = await splitBook([5], 2);
    const xml = await xmlOf(parts[1].blob, 'xl/worksheets/sheet1.xml');

    expect(xml).toContain('<row r="1"><c r="A1" t="inlineStr"><is><t>S1R1</t></is></c></row>');
    expect(xml).toContain('<row r="3"><c r="A3" t="inlineStr"><is><t>S1R5</t></is></c></row>');
  });

  it('keeps only the merged cells that are inside each part', async () => {
    const parts = await splitBook([5], 2);

    // Part 1 has data rows 2 and 3 of the original, so A3:B3 is inside it.
    const first = await xmlOf(parts[0].blob, 'xl/worksheets/sheet1.xml');
    expect(first).toContain('ref="A1:B1"');
    expect(first).toContain('ref="A3:B3"');

    // Part 2 has data rows 4 and 5, so A3:B3 is dropped. The header merge stays.
    const second = await xmlOf(parts[1].blob, 'xl/worksheets/sheet1.xml');
    expect(second).toContain('ref="A1:B1"');
    expect(second).not.toContain('ref="A3:B3"');
  });

  it('removes calcChain so Excel does not ask to repair the file', async () => {
    const parts = await splitBook([3], 2);
    const z = await JSZip.loadAsync(await parts[0].blob.arrayBuffer());
    expect(z.file('xl/calcChain.xml')).toBeNull();
    expect(await z.file('[Content_Types].xml')!.async('string')).not.toContain('calcChain');
    expect(await z.file('xl/_rels/workbook.xml.rels')!.async('string')).not.toContain('calcChain');
  });
});