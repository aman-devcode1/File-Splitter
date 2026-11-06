import type { DetectedFile, FileKind, Result, SplitPart } from './types';
import { toBytes, type ByteUnit } from './split/byte-split';

/** Which splitting engine a mode uses. Add a new id here when you write a new engine. */
export type EngineId =
  | 'byte'
  | 'pdf-pages'
  | 'zip-entries'
  | 'docx-paragraphs'
  | 'xlsx-rows'
  | 'text-lines'
  | 'media-time'
  | 'image-diag-tlbr'
  | 'image-diag-trbl'
  | 'image-h-percent'
  | 'image-h-count'
  | 'image-v-percent'
  | 'image-v-count';

/** What the user has to type for this mode. 'none' means no input at all. */
export type InputKind = 'bytes' | 'count' | 'seconds' | 'percent' | 'none';

export interface ModeDefinition {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly engine: EngineId;
  readonly input: InputKind;
  readonly defaultValue: string;
  readonly min?: number;
  readonly defaultUnit?: ByteUnit;
  readonly appliesTo: (kind: FileKind) => boolean;
}

export interface SplitEngine {
  readonly id: EngineId;
  /** value: bytes for 'bytes' mode, count for 'count' mode, seconds for 'seconds' mode. */
  split(file: File, detected: DetectedFile, value: number): Promise<SplitPart[]>;
}

const ZIP_ENTRY_KINDS = ['zip', 'epub', 'odf', 'pptx'];
const BYTE_UNUSABLE_KINDS = ['pdf', 'zip', 'docx', 'xlsx', 'pptx', 'epub', 'odf', 'png', 'jpeg', 'webp', 'gif', 'bmp'];
const TEXT_LINE_KINDS = ['text', 'csv'];
const IMAGE_KINDS = ['png', 'jpeg', 'webp', 'gif', 'bmp'];

/** Every mode the product knows about. Byte split is always first and applies to every file. */
export const MODES: readonly ModeDefinition[] = [
  {
    id: 'bytes',
    label: 'Byte split (any file)',
    help: 'Cuts the file into exact byte sizes. Join all parts to get the identical original.',
    engine: 'byte',
    input: 'bytes',
    defaultValue: '10',
    defaultUnit: 'MB',
    appliesTo: () => true,
  },
  {
    id: 'pdf-pages',
    label: 'By pages',
    help: 'Each part is a complete PDF with this many pages.',
    engine: 'pdf-pages',
    input: 'count',
    defaultValue: '1',
    appliesTo: (k) => k.id === 'pdf',
  },
  {
    id: 'zip-entries',
    label: 'By files inside',
    help: 'Each part is a complete ZIP-based file with this many entries.',
    engine: 'zip-entries',
    input: 'count',
    defaultValue: '5',
    appliesTo: (k) => k.id === 'zip',
  },
  {
    id: 'docx-paragraphs',
    label: 'By paragraphs',
    help: 'Each part is a complete Word document with this many paragraphs.',
    engine: 'docx-paragraphs',
    input: 'count',
    defaultValue: '50',
    appliesTo: (k) => k.id === 'docx',
  },
  {
    id: 'xlsx-rows',
    label: 'By rows',
    help: 'Each part is a complete spreadsheet with this many rows.',
    engine: 'xlsx-rows',
    input: 'count',
    defaultValue: '1000',
    appliesTo: (k) => k.id === 'xlsx',
  },
  {
    id: 'text-lines',
    label: 'By lines',
    help: 'Each part is a readable text file with this many lines.',
    engine: 'text-lines',
    input: 'count',
    defaultValue: '1000',
    appliesTo: (k) => TEXT_LINE_KINDS.includes(k.id),
  },
  {
    id: 'media-time',
    label: 'By length (playable clips)',
    help: 'Each clip plays on its own. Cuts happen at the nearest keyframe, so lengths can differ slightly.',
    engine: 'media-time',
    input: 'seconds',
    defaultValue: '60',
    appliesTo: (k) => k.category === 'video' || k.category === 'audio',
  },
    {
    id: 'image-diag-tlbr',
    label: 'Diagonal: top-left to bottom-right',
    help: 'Cuts the image along the diagonal into 2 triangles. Each triangle is a PNG, and the empty area is transparent.',
    engine: 'image-diag-tlbr',
    input: 'none',
    defaultValue: '',
    appliesTo: (k) => IMAGE_KINDS.includes(k.id),
  },
  {
    id: 'image-diag-trbl',
    label: 'Diagonal: top-right to bottom-left',
    help: 'Cuts the image along the diagonal into 2 triangles. Each triangle is a PNG, and the empty area is transparent.',
    engine: 'image-diag-trbl',
    input: 'none',
    defaultValue: '',
    appliesTo: (k) => IMAGE_KINDS.includes(k.id),
  },
  {
    id: 'image-h-percent',
    label: 'Horizontal cut: by percent',
    help: 'The top part gets this percent of the height. The bottom part gets the rest. Always 2 parts.',
    engine: 'image-h-percent',
    input: 'percent',
    defaultValue: '50',
    appliesTo: (k) => IMAGE_KINDS.includes(k.id),
  },
  {
    id: 'image-h-count',
    label: 'Horizontal cut: into equal parts',
    help: 'Cuts the image into equal horizontal strips, from top to bottom. Starts at 3.',
    engine: 'image-h-count',
    input: 'count',
    min: 3,
    defaultValue: '3',
    appliesTo: (k) => IMAGE_KINDS.includes(k.id),
  },
  {
    id: 'image-v-percent',
    label: 'Vertical cut: by percent',
    help: 'The left part gets this percent of the width. The right part gets the rest. Always 2 parts.',
    engine: 'image-v-percent',
    input: 'percent',
    defaultValue: '50',
    appliesTo: (k) => IMAGE_KINDS.includes(k.id),
  },
  {
    id: 'image-v-count',
    label: 'Vertical cut: into equal parts',
    help: 'Cuts the image into equal vertical strips, from left to right. Starts at 3.',
    engine: 'image-v-count',
    input: 'count',
    min: 3,
    defaultValue: '3',
    appliesTo: (k) => IMAGE_KINDS.includes(k.id),
  },
];

const engines = new Map<EngineId, SplitEngine>();

export type ItemCounter = (file: File) => Promise<number>;

const counters = new Map<EngineId, ItemCounter>();

export function registerCounter(engine: EngineId, counter: ItemCounter): void {
  counters.set(engine, counter);
}

/**
 * Total items for a count mode (pages, files, lines, paragraphs, rows).
 * Returns null for byte and seconds modes, or when no counter is registered.
 */
export async function itemTotal(mode: ModeDefinition, file: File): Promise<number | null> {
  if (mode.input !== 'count') return null;
  const counter = counters.get(mode.engine);
  return counter ? counter(file) : null;
}

export function registerEngine(engine: SplitEngine): void {
  engines.set(engine.id, engine);
}

/**
 * Modes to show for a file. A mode appears only when its engine is registered.
 * For formats where byte parts do not open, byte split is hidden once a structure mode exists.
 * Every file still gets at least one mode.
 */
export function modesFor(detected: DetectedFile): ModeDefinition[] {
  const available = MODES.filter((m) => m.appliesTo(detected.kind) && engines.has(m.engine));
  const structured = available.filter((m) => m.id !== 'bytes');

  if (structured.length > 0 && BYTE_UNUSABLE_KINDS.includes(detected.kind.id)) {
    return structured;
  }
  return available;
}

/** validates what the user typed for a mode. */
/** Validates what the user typed for a mode. Rejects negatives, decimals, and values above the limit. */
export function parseModeInput(mode: ModeDefinition, text: string, unit?: ByteUnit, max?: number): Result<number> {
  if (mode.input === 'none') return { ok: true, value: 0 };

  if (mode.input === 'bytes') {
    return toBytes(text, unit ?? mode.defaultUnit ?? 'MB');
  }

  const t = text.trim();
  if (!/^\d+$/.test(t)) {
    return {
      ok: false,
      error: mode.input === 'percent'
        ? 'Enter a whole number from 1 to 99. No minus sign or decimals.'
        : 'Enter a whole number. No minus sign or decimals.',
    };
  }
  const n = Number(t);

  if (mode.input === 'percent') {
    if (n < 1 || n > 99) return { ok: false, error: 'Enter a percent from 1 to 99.' };
    return { ok: true, value: n };
  }

  const min = mode.min ?? 1;
  if (n < min) return { ok: false, error: `Enter at least ${min}.` };

  if (max !== undefined) {
    if (max < min) {
      return { ok: false, error: `This file is too small to split into ${min} parts. It has only ${max}.` };
    }
    if (n > max) return { ok: false, error: `Enter at most ${max}. This file has ${max} in total.` };
  }

  return { ok: true, value: n };
}

/** Runs the split for a chosen mode. The caller passes a value already checked by parseModeInput. */
export async function splitFile(
  file: File,
  detected: DetectedFile,
  modeId: string,
  value: number,
): Promise<SplitPart[]> {
  const mode = MODES.find((m) => m.id === modeId);
  if (!mode || !mode.appliesTo(detected.kind)) {
    throw new Error(`Mode "${modeId}" is not available for this file.`);
  }
  const engine = engines.get(mode.engine);
  if (!engine) {
    throw new Error(`Engine "${mode.engine}" is not registered.`);
  }
  return engine.split(file, detected, value);
}