import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, splitFile } from '../index';

async function makePptx(): Promise<File> {
  const z = new JSZip();
  z.file('[Content_Types].xml',
    '<Types>' +
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="a"/>' +
    '<Override PartName="/ppt/slides/slide2.xml" ContentType="a"/>' +
    '<Override PartName="/ppt/slides/slide3.xml" ContentType="a"/>' +
    '</Types>');
  z.file('ppt/presentation.xml',
    '<p:presentation><p:sldIdLst>' +
    '<p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/>' +
    '</p:sldIdLst></p:presentation>');
  z.file('ppt/_rels/presentation.xml.rels',
    '<Relationships>' +
    '<Relationship Id="rId1" Type="t/slide" Target="slides/slide1.xml"/>' +
    '<Relationship Id="rId2" Type="t/slide" Target="slides/slide2.xml"/>' +
    '<Relationship Id="rId3" Type="t/slide" Target="slides/slide3.xml"/>' +
    '</Relationships>');
  for (let i = 1; i <= 3; i++) z.file(`ppt/slides/slide${i}.xml`, `<p:sld>${i}</p:sld>`);
  return new File([new Uint8Array(await z.generateAsync({ type: 'uint8array' }))], 'deck.pptx');
}

describe('pptx slides', () => {
  it('splits 3 slides into 2 and 1', async () => {
    const f = await makePptx();
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'pptx-slides', 2);
    expect(parts.length).toBe(2);

    const first = await JSZip.loadAsync(await parts[0].blob.arrayBuffer());
    const second = await JSZip.loadAsync(await parts[1].blob.arrayBuffer());
    const firstPres = await first.file('ppt/presentation.xml')!.async('string');
    expect(firstPres.match(/<p:sldId\b/g)?.length).toBe(2);
    expect(first.file('ppt/slides/slide3.xml')).toBeNull();
    expect(second.file('ppt/slides/slide1.xml')).toBeNull();
    expect(second.file('ppt/slides/slide3.xml')).not.toBeNull();
  });
});