import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const BAD = 'This Flash video (FLV) could not be read. It may be damaged.';

interface Tag {
    readonly type: number;
    readonly ts: number;
    readonly keyframe: boolean;
    readonly config: boolean;
    /** Tag header and data, without the PreviousTagSize that follows it. */
    readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface Flv {
    readonly header: Uint8Array<ArrayBuffer>;
    readonly tags: Tag[];
}

export async function readFlv(file: File): Promise<Flv> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 13 || bytes[0] !== 0x46 || bytes[1] !== 0x4c || bytes[2] !== 0x56) throw new Error(BAD);

    const dataOffset = new DataView(bytes.buffer).getUint32(5);
    const header = bytes.slice(0, dataOffset + 4);
    const tags: Tag[] = [];
    let pos = dataOffset + 4;

    while (pos + 11 <= bytes.length) {
        const size = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
        const end = pos + 11 + size;
        if (end + 4 > bytes.length) break; // a cut-off last tag is ignored

        const type = bytes[pos];
        const ts = bytes[pos + 7] * 0x1000000 + ((bytes[pos + 4] << 16) | (bytes[pos + 5] << 8) | bytes[pos + 6]);
        const d = pos + 11;
        const isVideo = type === 9 && size > 1;
        const isAudio = type === 8 && size > 1;
        const keyframe = isVideo && (bytes[d] >> 4) === 1;
        // Script (metadata), AVC sequence header and AAC sequence header: every part needs these.
        const config =
            type === 18 ||
            (isVideo && (bytes[d] & 0x0f) === 7 && bytes[d + 1] === 0) ||
            (isAudio && (bytes[d] >> 4) === 10 && bytes[d + 1] === 0);

        tags.push({ type, ts, keyframe, config, bytes: bytes.subarray(pos, end) });
        pos = end + 4;
    }
    return { header, tags };
}

export async function flvDuration(file: File): Promise<number | null> {
    const { tags } = await readFlv(file);
    const last = tags[tags.length - 1];
    return last ? last.ts / 1000 : null;
}

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

/** Position just after one AMF0 value that starts at p. */
function amfSkip(b: Uint8Array, p: number): number {
    switch (b[p]) {
        case 0x00: return p + 9;                 // number (double)
        case 0x01: return p + 2;                 // boolean
        case 0x02: return p + 3 + u16(b, p + 1); // string
        case 0x05: case 0x06: return p + 1;     // null, undefined
        case 0x0a: {                             // strict array
            let q = p + 5;
            for (let i = u32(b, p + 1); i > 0; i--) q = amfSkip(b, q);
            return q;
        }
        case 0x03: case 0x08: {                  // object, ECMA array
            let q = b[p] === 0x08 ? p + 5 : p + 1;
            while (!(b[q] === 0 && b[q + 1] === 0 && b[q + 2] === 9)) {
                q = amfSkip(b, q + 2 + u16(b, q));
            }
            return q + 3;
        }
        default: throw new Error('unknown AMF type');
    }
}

/** Sets "duration" (in seconds) in the onMetaData script tag, so players show the part length. */
function patchDuration(body: Uint8Array<ArrayBuffer>, seconds: number): void {
    try {
        const d = 11; // data starts after the 11-byte tag header
        if (body[d] !== 0x02) return;
        const p = d + 3 + u16(body, d + 1);
        if (body[p] !== 0x08 && body[p] !== 0x03) return;
        let q = body[p] === 0x08 ? p + 5 : p + 1;
        while (!(body[q] === 0 && body[q + 1] === 0 && body[q + 2] === 9)) {
            const valPos = q + 2 + u16(body, q);
            const key = new TextDecoder().decode(body.subarray(q + 2, valPos));
            if (key === 'duration' && body[valPos] === 0x00) {
                new DataView(body.buffer).setFloat64(valPos + 1, seconds); // body is a fresh copy, so offset is 0
                return;
            }
            q = amfSkip(body, valPos);
        }
    } catch {
        // Unknown metadata layout: leave the tag as it is.
    }
}

/** Writes one FLV: header, then each tag with its timestamp moved so the part starts at 0. */
function clipBytes(header: Uint8Array<ArrayBuffer>, list: Tag[], startMs: number, durationSec: number): Blob {
    const pieces: Uint8Array<ArrayBuffer>[] = [header];
    for (const t of list) {
        const body = t.bytes.slice();
        if (t.type === 18) patchDuration(body, durationSec);
        const ts = Math.max(0, t.ts - startMs);
        body[4] = (ts >>> 16) & 0xff;
        body[5] = (ts >>> 8) & 0xff;
        body[6] = ts & 0xff;
        body[7] = (ts >>> 24) & 0xff;
        const prev = new Uint8Array(4);
        new DataView(prev.buffer).setUint32(0, body.length);
        pieces.push(body, prev);
    }
    return new Blob(pieces, { type: 'video/x-flv' });
}

/** Cuts an FLV into clips of about clipSeconds, at video key frames. No re-encoding. */
export async function splitFlv(file: File, clipSeconds: number): Promise<SplitPart[]> {
    const { header, tags } = await readFlv(file);
    if (tags.length === 0) throw new Error('This FLV file has no data to split.');

    const secs = Float64Array.from(tags, (t) => t.ts / 1000);
    const keys = tags.flatMap((t, i) => (t.keyframe ? [i] : []));
    const sync = keys.length > 0 ? keys : tags.map((_, i) => i);
    const cuts = planCuts(secs, sync, secs[secs.length - 1], clipSeconds, tags.length);
    const count = cuts.length - 1;

    const head: Tag[] = [];
    const seen = new Set<number>();
    for (const t of tags) {
        if (t.config && !seen.has(t.type)) {
            seen.add(t.type);
            head.push(t);
        }
    }
    const inHead = new Set(head);

    const lastMs = tags[tags.length - 1].ts;
    const parts: SplitPart[] = [];
    for (let i = 0; i < count; i++) {
        const from = cuts[i];
        const to = cuts[i + 1];
        const startMs = tags[from].ts;
        const endMs = to < tags.length ? tags[to].ts : lastMs;
        const body = tags.slice(from, to).filter((t) => !inHead.has(t));
        parts.push({
            name: partFileName(file.name, i, count),
            blob: clipBytes(header, [...head, ...body], startMs, (endMs - startMs) / 1000),
        });
    }
    return parts;
}