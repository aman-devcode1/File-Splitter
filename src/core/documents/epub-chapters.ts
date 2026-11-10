import JSZip from 'jszip';
import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

const UNREADABLE = 'This EPUB file could not be read. It may be damaged or DRM-protected.';
const MIME = 'application/epub+zip';

function dirOf(p: string): string {
  return p.slice(0, p.lastIndexOf('/') + 1);
}

function resolvePath(base: string, target: string): string {
  const out: string[] = [];
  for (const seg of (base + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

interface Item {
  readonly tag: string;
  readonly path: string;
}

interface SpineEntry {
  readonly idref: string;
  readonly tag: string;
}

interface Book {
  readonly zip: JSZip;
  readonly opfPath: string;
  readonly opf: string;
  readonly items: Map<string, Item>;
  readonly spine: SpineEntry[];
}

async function readBook(file: File): Promise<Book> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = /full-path="([^"]+)"/.exec(container ?? '')?.[1];
  const opf = opfPath ? await zip.file(opfPath)?.async('string') : undefined;
  if (!opfPath || !opf) throw new Error(UNREADABLE);

  const items = new Map<string, Item>();
  for (const m of opf.matchAll(/<item\b[^>]*\/>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) items.set(id, { tag: m[0], path: resolvePath(dirOf(opfPath), href) });
  }

  const spine = [...opf.matchAll(/<itemref\b[^>]*\/>/g)].map((m) => ({
    idref: /\bidref="([^"]+)"/.exec(m[0])?.[1] ?? '',
    tag: m[0],
  }));
  if (spine.length === 0) throw new Error('This ebook has no chapters to split.');
  return { zip, opfPath, opf, items, spine };
}

export async function countEpubChapters(file: File): Promise<number> {
  return (await readBook(file)).spine.length;
}

/** One ebook with only the chapters in `keep`. Chapter files that are not used elsewhere are removed. */
async function buildBook(book: Book, keep: Set<string>): Promise<Blob> {
  let opf = book.opf;

  const keptPaths = new Set<string>();
  for (const s of book.spine) {
    if (!keep.has(s.idref)) continue;
    const it = book.items.get(s.idref);
    if (it) keptPaths.add(it.path);
  }

  const removedPaths = new Set<string>();
  for (const s of book.spine) {
    if (keep.has(s.idref)) continue;
    opf = opf.split(s.tag).join('');
    const it = book.items.get(s.idref);
    if (it) {
      opf = opf.split(it.tag).join('');
      if (!keptPaths.has(it.path)) removedPaths.add(it.path);
    }
  }

  const out = new JSZip();
  // Object order is the original file order, so 'mimetype' stays first.
  for (const [name, entry] of Object.entries(book.zip.files)) {
    if (entry.dir || removedPaths.has(name)) continue;
    if (name === book.opfPath) {
      out.file(name, opf);
      continue;
    }
    out.file(name, await entry.async('uint8array'), {
      compression: name === 'mimetype' ? 'STORE' : 'DEFLATE',
    });
  }
  return out.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
}

/** Cuts an EPUB into parts of `perPart` chapters each. */
export async function splitEpubChapters(file: File, perPart: number): Promise<SplitPart[]> {
  const book = await readBook(file);
  const count = Math.ceil(book.spine.length / perPart);
  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const keep = new Set(book.spine.slice(i * perPart, (i + 1) * perPart).map((s) => s.idref));
    parts.push({
      name: partFileName(file.name, i, count),
      blob: await buildBook(book, keep),
    });
  }
  return parts;
}