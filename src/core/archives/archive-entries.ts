import JSZip from 'jszip';
import { Archive } from 'libarchive.js';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planEntries } from './zip-entries';

interface Entry {
  readonly path: string;
  readonly file: File;
}

/** The nested object that libarchive.js returns: folders are objects, files are File values. */
type Tree = { [name: string]: Tree | File };

let ready = false;

function ensureReady(): void {
  if (ready) return;
  Archive.init({ workerUrl: `${import.meta.env.BASE_URL}libarchive/worker-bundle.js` });
  ready = true;
}

/** Turns the nested tree into a flat list of files with their full paths, like docs/a.txt. */
function flatten(tree: Tree, prefix = ''): Entry[] {
  const out: Entry[] = [];
  for (const [name, value] of Object.entries(tree)) {
    const path = prefix + name;
    if (value instanceof File) out.push({ path, file: value });
    else out.push(...flatten(value, `${path}/`));
  }
  return out;
}

async function loadEntries(file: File): Promise<Entry[]> {
  ensureReady();
  let entries: Entry[];
  try {
    const archive = await Archive.open(file);
    entries = flatten((await archive.extractFiles()) as Tree);
  } catch {
    throw new Error(
      'This archive could not be read. It may be damaged or password-protected. Byte split works for any file.',
    );
  }
  if (entries.length === 0) {
    throw new Error('This archive has no files inside to split.');
  }
  return entries;
}

export const archiveEntriesEngine = {
  id: 'archive-entries' as const,

  async split(file: File, _detected: DetectedFile, perPart: number): Promise<SplitPart[]> {
    const entries = await loadEntries(file);
    const ranges = planEntries(entries.length, perPart);
    const stem = file.name.replace(/\.[^.]+$/, '');
    const parts: SplitPart[] = [];

    for (const r of ranges) {
      const zip = new JSZip();
      for (const e of entries.slice(r.start, r.end)) zip.file(e.path, e.file);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      parts.push({ name: partFileName(`${stem}.zip`, r.index, ranges.length), blob });
    }

    return parts;
  },
};

export async function countArchiveEntries(file: File): Promise<number> {
  return (await loadEntries(file)).length;
}