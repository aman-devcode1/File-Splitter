import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';

interface Parsed {
  readonly header: string[];
  readonly cues: string[][];
  readonly vtt: boolean;
}

const NO_CUES = 'This subtitle file has no cues (lines with a time range) to split.';

async function parse(file: File): Promise<Parsed> {
  const text = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const vtt = file.name.toLowerCase().endsWith('.vtt');
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);

  const header: string[] = [];
  const cues: string[][] = [];
  for (const b of blocks) {
    if (b.includes('-->')) cues.push([b]);
    else if (cues.length === 0) header.push(b);
    else cues[cues.length - 1].push(b);
  }
  if (cues.length === 0) throw new Error(NO_CUES);
  return { header, cues, vtt };
}

/** SRT cue numbers start again at 1 in every part. */
function numbered(cue: string, n: number): string {
  const lines = cue.split('\n');
  if (/^\d+$/.test(lines[0])) lines[0] = String(n);
  return lines.join('\n');
}

export async function countSubtitleCues(file: File): Promise<number> {
  return (await parse(file)).cues.length;
}

export async function splitSubtitleCues(file: File, perPart: number): Promise<SplitPart[]> {
  const p = await parse(file);
  const count = Math.ceil(p.cues.length / perPart);
  const head = p.header.join('\n\n');
  const parts: SplitPart[] = [];

  for (let i = 0; i < count; i++) {
    const chunk = p.cues.slice(i * perPart, (i + 1) * perPart);
    const body = chunk.map((unit, j) => {
      const [first, ...rest] = unit;
      const cue = p.vtt ? first : numbered(first, j + 1);
      return [cue, ...rest].join('\n\n');
    });
    const text = [head, ...body].filter((s) => s.length > 0).join('\n\n') + '\n';
    parts.push({ name: partFileName(file.name, i, count), blob: new Blob([text], { type: 'text/plain' }) });
  }
  return parts;
}