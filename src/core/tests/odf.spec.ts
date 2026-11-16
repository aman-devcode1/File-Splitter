import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, splitFile } from '../index';

async function makeOdt(): Promise<File> {
  const z = new JSZip();
  z.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  const paras = [1, 2, 3, 4, 5].map((i) => `<text:p>Para ${i}</text:p>`).join('');
  z.file('content.xml',
    '<office:document-content><office:body><office:text>' + paras +
    '</office:text></office:body></office:document-content>');
  return new File([new Uint8Array(await z.generateAsync({ type: 'uint8array' }))], 'doc.odt');
}

describe('odf split', () => {
  it('splits 5 paragraphs into 2, 2 and 1', async () => {
    const f = await makeOdt();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'odf', 2);
    expect(parts.length).toBe(3);
    const counts: number[] = [];
    for (const p of parts) {
      const z = await JSZip.loadAsync(await p.blob.arrayBuffer());
      const xml = await z.file('content.xml')!.async('string');
      counts.push(xml.match(/<text:p>/g)?.length ?? 0);
    }
    expect(counts).toEqual([2, 2, 1]);
  });
});