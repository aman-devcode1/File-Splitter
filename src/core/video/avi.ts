import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const UNREADABLE = 'This AVI file could not be read. Byte split works for any file.';
const KEYFRAME = 0x10;

interface Chunk {
    readonly id: string;
    readonly start: number; // offset of the chunk header in the file
    readonly size: number; // payload size
    readonly flags: number;
}

interface AviInfo {
    readonly b: Uint8Array<ArrayBuffer>;
    readonly hdrl: { start: number; end: number };
    readonly movi: { start: number; end: number };
    readonly chunks: Chunk[];
    readonly videoStream: string;
    readonly fps: number;
}

function str(b: Uint8Array, p: number): string {
    return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
}

function u32(b: Uint8Array<ArrayBuffer>, p: number): number {
    return new DataView(b.buffer, b.byteOffset + p, 4).getUint32(0, true);
}

/** Reads the RIFF structure. Only the top-level and the movi list are scanned. */
export async function readAvi(file: File): Promise<AviInfo> {
    const b = new Uint8Array(await file.arrayBuffer());
    if (str(b, 0) !== 'RIFF' || str(b, 8) !== 'AVI ') throw new Error(UNREADABLE);

    let hdrl: { start: number; end: number } | null = null;
    let movi: { start: number; end: number } | null = null;
    let idx1: { start: number; end: number } | null = null;
    let videoStream = '';
    let fps = 0;

    let p = 12;
    while (p + 8 <= b.length) {
        const id = str(b, p);
        const size = u32(b, p + 4);
        const body = p + 8;
        const end = body + size + (size % 2);
        if (end > b.length + 1) throw new Error(UNREADABLE);

        if (id === 'LIST') {
            const type = str(b, body);
            if (type === 'hdrl') {
                hdrl = { start: p, end };
                // Scan the headers for the first video stream (strh type "vids") and its rate/scale.
                let q = body + 4;
                while (q + 8 <= end) {
                    if (str(b, q) === 'LIST' && str(b, q + 8) === 'strl') {
                        let r = q + 12;
                        const strlEnd = q + 8 + u32(b, q + 4);
                        while (r + 8 <= strlEnd) {
                            if (str(b, r) === 'strh' && str(b, r + 8) === 'vids' && !videoStream) {
                                const scale = u32(b, r + 8 + 20);
                                const rate = u32(b, r + 8 + 24);
                                fps = scale > 0 ? rate / scale : 0;
                                videoStream = '';
                            }
                            r += 8 + u32(b, r + 4) + (u32(b, r + 4) % 2);
                        }
                    }
                    q += 8 + u32(b, q + 4) + (u32(b, q + 4) % 2);
                }
            } else if (type === 'movi') {
                movi = { start: p, end };
            }
        } else if (id === 'idx1') {
            idx1 = { start: body, end: body + size };
        }
        p = end;
    }

    if (!hdrl || !movi || !idx1) throw new Error(UNREADABLE);
    if (fps <= 0) throw new Error(UNREADABLE);

    // The idx1 entries name the streams. Video streams are "00dc" or "00db" (stream 0).
    const chunks: Chunk[] = [];
    // idx1 offsets are relative to the 'movi' fourcc, which sits 8 bytes into the movi LIST.
    const moviBase = movi.start + 8;
    for (let q = idx1.start; q + 16 <= idx1.end; q += 16) {
        chunks.push({
            id: str(b, q),
            start: moviBase + u32(b, q + 8),
            size: u32(b, q + 12),
            flags: u32(b, q + 4),
        });
    }
    // The first video stream number is the one whose chunks carry the video. Use "00" as default.
    videoStream = chunks.find((c) => c.id.endsWith('dc') || c.id.endsWith('db'))?.id.slice(0, 2) ?? '00';

    return { b, hdrl, movi, chunks, videoStream, fps };
}

/** Cuts an AVI into clips of about clipSeconds, at keyframes. */
export async function splitAvi(file: File, clipSeconds: number): Promise<SplitPart[]> {
    const info = await readAvi(file);
    const video = info.chunks.filter((c) => c.id.startsWith(info.videoStream));
    if (video.length === 0) throw new Error(UNREADABLE);

    const n = video.length;
    const secs = Float64Array.from({ length: n }, (_, i) => i / info.fps);
    const sync = video.flatMap((c, i) => ((c.flags & KEYFRAME) !== 0 ? [i] : []));
    if (sync.length === 0) throw new Error('This file has no key frames, so it cannot be cut.');

    const total = n / info.fps;
    const cuts = planCuts(secs, sync, total, clipSeconds, n);
    const count = cuts.length - 1;

    const parts: SplitPart[] = [];
    for (let i = 0; i < count; i++) {
        const from = cuts[i];
        const to = cuts[i + 1];
        const first = video[from];
        const last = video[to - 1];
        // Every chunk in idx1 whose offset falls between the first and last video chunk of this clip.
        const clipChunks = info.chunks.filter(
            (c) => c.start >= first.start && c.start <= last.start,
        );
        parts.push({
            name: partFileName(file.name, i, count),
            blob: buildAviClip(info, clipChunks, to - from),
        });
    }
    return parts;
}

function pad(n: number): number {
    return n % 2;
}

/** Writes a new RIFF AVI with the same headers, only the chunks of this clip and a new idx1. */
function buildAviClip(info: AviInfo, clip: Chunk[], frames: number): Blob {
    const { b, hdrl } = info;
    const enc = new TextEncoder();
    const pieces: BlobPart[] = [];

    // hdrl is copied as is. Frame counts inside it are not patched (players use idx1 and movi).
    const hdrlBytes = b.slice(hdrl.start, hdrl.end);
    const movieChunks: Uint8Array[] = [];
    const newIndex: Uint8Array[] = [];
    let moviOffset = 4; // offset after the "movi" type id, relative to the movi list data

    for (const c of clip) {
        const header = b.slice(c.start, c.start + 8);
        const payload = b.slice(c.start + 8, c.start + 8 + c.size);
        const padding = pad(c.size) ? new Uint8Array(1) : new Uint8Array(0);
        movieChunks.push(header, payload, padding);

        const entry = new Uint8Array(16);
        const v = new DataView(entry.buffer);
        entry.set(header.subarray(0, 4), 0);
        v.setUint32(4, c.flags, true);
        v.setUint32(8, moviOffset, true);
        v.setUint32(12, c.size, true);
        newIndex.push(entry);

        moviOffset += 8 + c.size + pad(c.size);
    }

    const moviPayload = concatU8([enc.encode('movi'), ...movieChunks]);
    const moviList = concatU8([enc.encode('LIST'), u32le(moviPayload.length), moviPayload]);
    const idxPayload = concatU8(newIndex);
    const idx1 = concatU8([enc.encode('idx1'), u32le(idxPayload.length), idxPayload]);

    const riffPayload = concatU8([enc.encode('AVI '), hdrlBytes, moviList, idx1]);
    pieces.push(concatU8([enc.encode('RIFF'), u32le(riffPayload.length), riffPayload]) as BlobPart);
    void frames;
    return new Blob(pieces, { type: 'video/x-msvideo' });
}

function u32le(n: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(new ArrayBuffer(4));
    new DataView(out.buffer).setUint32(0, n, true);
    return out;
}

function concatU8(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(new ArrayBuffer(parts.reduce((a, p) => a + p.length, 0)));
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.length;
    }
    return out;
}