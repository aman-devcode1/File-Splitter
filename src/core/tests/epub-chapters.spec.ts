import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, splitFile } from '../index';

async function makeEpub(): Promise<File> {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  z.file('OEBPS/content.opf',
    '<package><manifest>' +
    '<item id="c1" href="c1.xhtml"/><item id="c2" href="c2.xhtml"/><item id="c3" href="c3.xhtml"/>' +
    '</manifest><spine>' +
    '<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>' +
    '</spine></package>');
  for (const n of ['c1', 'c2', 'c3']) z.file(`OEBPS/${n}.xhtml`, `<html>${n}</html>`);
  return new File([new Uint8Array(await z.generateAsync({ type: 'uint8array' }))], 'book.epub');
}

describe('epub chapters', () => {
  it('splits 3 chapters into 2 and 1', async () => {
    const f = await makeEpub();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'epub-chapters', 2);
    expect(parts.length).toBe(2);

    const second = await JSZip.loadAsync(await parts[1].blob.arrayBuffer());
    const opf = await second.file('OEBPS/content.opf')!.async('string');
    expect(opf.match(/<itemref\b/g)?.length).toBe(1);
    expect(second.file('OEBPS/c1.xhtml')).toBeNull();
    expect(second.file('OEBPS/c3.xhtml')).not.toBeNull();
  });
});