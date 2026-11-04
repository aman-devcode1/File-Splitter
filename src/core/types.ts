export type Category =
    | 'document'
    | 'image'
    | 'audio'
    | 'video'
    | 'archive'
    | 'office'
    | 'text'
    | 'data'
    | 'code'
    | 'binary';

export interface MagicRule {
    readonly offset: number;
    readonly bytes: readonly number[];
}

export interface FileKind {
    readonly id: string;
    readonly label: string;
    readonly category: Category;
    readonly extensions: readonly string[];
    /**
     * Outer array = alternatives (any one matches).
     * Inner array = rules that must all match.
     * Empty array = no signature, matched by extension only.
     */
    readonly magic: readonly (readonly MagicRule[])[];
}

export type DetectionMethod = 'signature' | 'extension' | 'text-heuristic' | 'unknown';

export interface DetectedFile {
    readonly name: string;
    readonly size: number;
    readonly extension: string;
    readonly kind: FileKind;
    readonly method: DetectionMethod;
}

export interface SplitPart {
    readonly name: string;
    readonly blob: Blob;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };