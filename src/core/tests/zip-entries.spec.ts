import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { detectFile, modesFor, planEntries, splitFile } from '../index';

async function makeZip(count: number): Promise<File> {
  const zip = new JSZip();
  for (let i = 1; i <= count; i++) {
    zip.file(`file${i}.txt`, `content ${i}`);
  }
    const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([new Uint8Array(bytes)], 'archive.zip', { type: 'application/zip' });
}

describe('planEntries', () => {
  it('groups entries and keeps the shorter last group', () => {
    expect(planEntries(7, 3)).toEqual([
      { index: 0, start: 0, end: 3 },
      { index: 1, start: 3, end: 6 },
      { index: 2, start: 6, end: 7 },
    ]);
  });
});

describe('zip-entries engine', () => {
  it('is offered for ZIP files', async () => {
    const d = await detectFile(await makeZip(2));
    expect(modesFor(d).map((m) => m.id)).toContain('zip-entries');
  });

  it('splits 7 files into 3, 3 and 1 file archives', async () => {
    const f = await makeZip(7);
    const d = await detectFile(f);

    const parts = await splitFile(f, d, 'zip-entries', 3);

    expect(parts.map((p) => p.name)).toEqual([
      'archive_PART001.zip',
      'archive_PART002.zip',
      'archive_PART003.zip',
    ]);

    const counts: number[] = [];
    for (const part of parts) {
      const z = await JSZip.loadAsync(await part.blob.arrayBuffer());
      counts.push(Object.values(z.files).filter((e) => !e.dir).length);
    }
    expect(counts).toEqual([3, 3, 1]);
  });

  it('keeps the content of every file', async () => {
    const f = await makeZip(4);
    const d = await detectFile(f);
    const parts = await splitFile(f, d, 'zip-entries', 2);

    const first = await JSZip.loadAsync(await parts[1].blob.arrayBuffer());
    expect(await first.file('file3.txt')!.async('string')).toBe('content 3');
  });
});