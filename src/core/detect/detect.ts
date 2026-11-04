import { FILE_KINDS, TEXT_KIND, UNKNOWN_KIND } from './signatures';
import type { DetectedFile, FileKind, MagicRule } from '../types';

const SAMPLE_BYTES = 512;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

function ruleMatches(head: Uint8Array, rule: MagicRule): boolean {
  if (rule.offset + rule.bytes.length > head.length) return false;
  return rule.bytes.every((b, i) => head[rule.offset + i] === b);
}

function signatureMatches(kind: FileKind, head: Uint8Array): boolean {
  return kind.magic.some((group) => group.every((rule) => ruleMatches(head, rule)));
}

/** Text if there is no NUL byte and very few control characters. */
function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let control = 0;
  for (const b of head) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  return control / head.length < 0.02;
}

/**
 * Finds the file type from its first bytes, then from its extension.
 * Signature wins over extension, so a file renamed to the wrong extension
 * is still recognised correctly.
 */
export async function detectFile(file: File): Promise<DetectedFile> {
  const extension = extensionOf(file.name);
  const head = new Uint8Array(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  const base = { name: file.name, size: file.size, extension };

  const matches = FILE_KINDS.filter((k) => k.magic.length > 0 && signatureMatches(k, head));
  if (matches.length > 0) {
    const kind = matches.find((k) => k.extensions.includes(extension)) ?? matches[0];
    return { ...base, kind, method: 'signature' };
  }

  const byExtension = FILE_KINDS.find((k) => k.extensions.includes(extension));
  if (byExtension) return { ...base, kind: byExtension, method: 'extension' };

  if (looksLikeText(head)) return { ...base, kind: TEXT_KIND, method: 'text-heuristic' };

  return { ...base, kind: UNKNOWN_KIND, method: 'unknown' };
}