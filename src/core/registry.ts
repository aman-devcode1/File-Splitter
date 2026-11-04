import type { DetectedFile, FileKind, Result, SplitPart } from './types';
import { toBytes, type ByteUnit } from './split/byte-split';

/** Which splitting engine a mode uses. Add a new id here when you write a new engine. */
export type EngineId =
  | 'byte'
  | 'pdf-pages'
  | 'zip-entries'
  | 'docx-paragraphs'
  | 'xlsx-rows'
  | 'image-tiles'
  | 'text-lines'
  | 'media-time';

/** What the user has to type for this mode. */
export type InputKind = 'bytes' | 'count' | 'seconds';

export interface ModeDefinition {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly engine: EngineId;
  readonly input: InputKind;
  readonly defaultValue: string;
  readonly defaultUnit?: ByteUnit;
  readonly appliesTo: (kind: FileKind) => boolean;
}

export interface SplitEngine {
  readonly id: EngineId;
  /** value: bytes for 'bytes' mode, count for 'count' mode, seconds for 'seconds' mode. */
  split(file: File, detected: DetectedFile, value: number): Promise<SplitPart[]>;
}

const ZIP_ENTRY_KINDS = ['zip', 'epub', 'odf', 'pptx'];
const TEXT_LINE_KINDS = ['text', 'csv'];
const IMAGE_TILE_KINDS = ['png', 'jpeg', 'webp', 'gif', 'bmp'];

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
    defaultValue: '10',
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
    id: 'image-tiles',
    label: 'Into tiles',
    help: 'Splits the image into this many vertical slices. Each slice is a separate image.',
    engine: 'image-tiles',
    input: 'count',
    defaultValue: '4',
    appliesTo: (k) => IMAGE_TILE_KINDS.includes(k.id),
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
];

const engines = new Map<EngineId, SplitEngine>();

export function registerEngine(engine: SplitEngine): void {
  engines.set(engine.id, engine);
}

/**
 * Modes to show for a file. A mode appears only when its engine is registered.
 * Byte split is always registered, so there is always at least one mode.
 */
export function modesFor(detected: DetectedFile): ModeDefinition[] {
  return MODES.filter((m) => m.appliesTo(detected.kind) && engines.has(m.engine));
}

/** Validates what the user typed for a mode. */
export function parseModeInput(mode: ModeDefinition, text: string, unit?: ByteUnit): Result<number> {
  if (mode.input === 'bytes') {
    return toBytes(text, unit ?? mode.defaultUnit ?? 'MB');
  }
  if (!/^\d+$/.test(text.trim())) {
    return { ok: false, error: 'Enter a whole number.' };
  }
  const n = Number(text.trim());
  if (n < 1) return { ok: false, error: 'Enter a number of at least 1.' };
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