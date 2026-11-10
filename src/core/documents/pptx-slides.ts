import JSZip from 'jszip';
import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

const UNREADABLE = 'This PowerPoint file could not be read. It may be damaged or password-protected.';
const PRES = 'ppt/presentation.xml';
const PRES_RELS = 'ppt/_rels/presentation.xml.rels';
const CONTENT_TYPES = '[Content_Types].xml';
const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function dirOf(p: string): string {
  return p.slice(0, p.lastIndexOf('/') + 1);
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const seg of (base + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

function relsPathOf(part: string): string {
  const d = dirOf(part);
  return `${d}_rels/${part.slice(d.length)}.rels`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Rel {
  readonly tag: string;
  readonly id: string;
  readonly target: string;
  readonly type: string;
}

function parseRels(xml: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => ({
    tag: m[0],
    id: /\bId="([^"]+)"/.exec(m[0])?.[1] ?? '',
    target: /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '',
    type: /\bType="([^"]+)"/.exec(m[0])?.[1] ?? '',
  }));
}

interface Slide {
  readonly rid: string;
  readonly path: string;
}

async function readSlides(file: File): Promise<Slide[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  const pres = await zip.file(PRES)?.async('string');
  const rels = await zip.file(PRES_RELS)?.async('string');
  if (!pres || !rels) throw new Error(UNREADABLE);

  const byId = new Map(parseRels(rels).map((r): [string, Rel] => [r.id, r]));
  const slides = [...pres.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => {
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    const rel = byId.get(rid);
    if (!rel) throw new Error(UNREADABLE);
    return { rid, path: resolvePath('ppt/', rel.target) };
  });
  if (slides.length === 0) throw new Error('This presentation has no slides to split.');
  return slides;
}

export async function countPptxSlides(file: File): Promise<number> {
  return (await readSlides(file)).length;
}

/** Builds one presentation that keeps only the slides in `keep`, and removes their parts. */
async function buildDeck(file: File, keep: Set<string>, all: Slide[]): Promise<Blob> {
  const zip = await JSZip.loadAsync(file);
  let pres = await zip.file(PRES)!.async('string');
  let rels = await zip.file(PRES_RELS)!.async('string');
  let ct = await zip.file(CONTENT_TYPES)!.async('string');

  pres = pres.replace(/<p:sldId\b[^>]*\/>/g, (tag) => {
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1] ?? '';
    return keep.has(rid) ? tag : '';
  });

  const originalRels = parseRels(rels);
  const removed: string[] = [];

  for (const s of all) {
    if (keep.has(s.rid)) continue;

    const relTag = originalRels.find((r) => r.id === s.rid)?.tag;
    if (relTag) rels = rels.split(relTag).join('');

    // Notes pages of a removed slide would point at a missing slide, so they go too.
    const slideRels = zip.file(relsPathOf(s.path));
    if (slideRels) {
      for (const r of parseRels(await slideRels.async('string'))) {
        if (!r.type.endsWith('/notesSlide')) continue;
        const notes = resolvePath(dirOf(s.path), r.target);
        removed.push(notes, relsPathOf(notes));
      }
    }
    removed.push(s.path, relsPathOf(s.path));
  }

  for (const p of removed) {
    zip.remove(p);
    ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${escapeRe(p)}"[^>]*/>`), '');
  }

  zip.file(PRES, pres);
  zip.file(PRES_RELS, rels);
  zip.file(CONTENT_TYPES, ct);
  return zip.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
}

/** Cuts a PowerPoint deck into parts of `perPart` slides each. Every part is a valid deck. */
export async function splitPptxSlides(file: File, perPart: number): Promise<SplitPart[]> {
  const slides = await readSlides(file);
  const count = Math.ceil(slides.length / perPart);
  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    const keep = new Set(slides.slice(i * perPart, (i + 1) * perPart).map((s) => s.rid));
    parts.push({
      name: partFileName(file.name, i, count),
      blob: await buildDeck(file, keep, slides),
    });
  }
  return parts;
}