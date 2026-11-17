import type { SplitPart } from '../types';
import { partFileName } from '../shared/byte-split';
import { planCuts } from '../shared/cut-plan';

const BAD = 'This MPEG transport stream could not be read. It may be damaged, or it is not a TS or M2TS file.';
const NO_KEYS = 'This transport stream has no video key frames to cut at. Use byte split for it.';

interface Key {
    readonly idx: number;
    readonly pts: number;
}

interface Scan {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly size: number;
    readonly off: number;
    readonly count: number;
    readonly patIdx: number;
    readonly pmtIdx: number;
    readonly pmtPid: number;
    readonly keys: Key[];
    readonly lastPts: number;
}

const pidOf = (b: Uint8Array, o: number) => ((b[o + 1] & 0x1f) << 8) | b[o + 2];
const isStart = (b: Uint8Array, o: number) => (b[o + 1] & 0x40) !== 0;

/** Index of the first payload byte of the packet at o, or -1 when it has no payload. */
function payloadAt(b: Uint8Array, o: number): number {
    const afc = (b[o + 3] >> 4) & 3;
    if (!(afc & 1)) return -1;
    return afc & 2 ? o + 5 + b[o + 4] : o + 4;
}

function hasRandomAccess(b: Uint8Array, o: number): boolean {
    const afc = (b[o + 3] >> 4) & 3;
    return (afc & 2) !== 0 && b[o + 4] > 0 && (b[o + 5] & 0x40) !== 0;
}

/** 33-bit PTS/DTS field, 90 kHz clock. */
function decodeTs(b: Uint8Array, o: number): number {
    return ((b[o] >> 1) & 7) * 2 ** 30 + (b[o + 1] << 22) + (((b[o + 2] >> 1) & 0x7f) << 15) + (b[o + 3] << 7) + ((b[o + 4] >> 1) & 0x7f);
}

function writeTs(b: Uint8Array, o: number, ts: number, prefix: number): void {
    b[o] = (prefix << 4) | ((Math.floor(ts / 2 ** 30) & 7) << 1) | 1;
    b[o + 1] = Math.floor(ts / 2 ** 22) & 0xff;
    b[o + 2] = ((Math.floor(ts / 2 ** 15) & 0x7f) << 1) | 1;
    b[o + 3] = Math.floor(ts / 2 ** 7) & 0xff;
    b[o + 4] = ((ts % 128) << 1) | 1;
}

/** PCR base (33 bits, 90 kHz) at `at`, which is 6 bytes long with the extension. */
function decodePcr(b: Uint8Array, at: number): number {
    return b[at] * 2 ** 25 + (b[at + 1] << 17) + (b[at + 2] << 9) + (b[at + 3] << 1) + (b[at + 4] >> 7);
}

function writePcr(b: Uint8Array, at: number, base: number, ext: number): void {
    b[at] = Math.floor(base / 2 ** 25) & 0xff;
    b[at + 1] = Math.floor(base / 2 ** 17) & 0xff;
    b[at + 2] = Math.floor(base / 2 ** 9) & 0xff;
    b[at + 3] = Math.floor(base / 2) & 0xff;
    b[at + 4] = ((base % 2) << 7) | 0x7e | ((ext >> 8) & 1);
    b[at + 5] = ext & 0xff;
}

function patProgramPid(b: Uint8Array, o: number): number {
    const pay = payloadAt(b, o);
    if (pay < 0) return -1;
    const s = pay + 1 + b[pay];
    const len = ((b[s + 1] & 0x0f) << 8) | b[s + 2];
    for (let k = s + 8; k < s + 3 + len - 4; k += 4) {
        if ((b[k] << 8) | b[k + 1]) return ((b[k + 2] & 0x1f) << 8) | b[k + 3];
    }
    return -1;
}

function pmtVideoPid(b: Uint8Array, o: number): number {
    const pay = payloadAt(b, o);
    if (pay < 0) return -1;
    const s = pay + 1 + b[pay];
    const len = ((b[s + 1] & 0x0f) << 8) | b[s + 2];
    const end = s + 3 + len - 4;
    const infoLen = ((b[s + 10] & 0x0f) << 8) | b[s + 11];
    for (let k = s + 12 + infoLen; k + 5 <= end; ) {
        const type = b[k];
        const pid = ((b[k + 1] & 0x1f) << 8) | b[k + 2];
        const esInfo = ((b[k + 3] & 0x0f) << 8) | b[k + 4];
        if (type === 0x1b || type === 0x24 || type === 0x02) return pid; // H.264, HEVC, MPEG-2
        k += 5 + esInfo;
    }
    return -1;
}

/** PTS of the PES packet that starts in this packet, or null if there is none. */
function pesPts(b: Uint8Array, o: number): number | null {
    const pay = payloadAt(b, o);
    if (pay < 0 || b[pay] !== 0 || b[pay + 1] !== 0 || b[pay + 2] !== 1) return null;
    if (!(b[pay + 7] & 0x80)) return null;
    return decodeTs(b, pay + 9);
}

function scan(bytes: Uint8Array<ArrayBuffer>): Scan {
    const layout = [
        { size: 188, off: 0 },
        { size: 192, off: 4 },
    ].find(({ size, off }) => bytes.length >= 3 * size + off && [0, 1, 2].every((k) => bytes[k * size + off] === 0x47));
    if (!layout) throw new Error(BAD);

    const { size, off } = layout;
    const count = Math.floor((bytes.length - off) / size);
    let patIdx = -1;
    let pmtIdx = -1;
    let pmtPid = -1;
    let videoPid = -1;
    let lastPts = 0;
    const keys: Key[] = [];

    for (let i = 0; i < count; i++) {
        const o = i * size + off;
        const pid = pidOf(bytes, o);
        if (pid === 0 && pmtPid < 0 && isStart(bytes, o)) {
            patIdx = i;
            pmtPid = patProgramPid(bytes, o);
        } else if (pid === pmtPid && videoPid < 0 && isStart(bytes, o)) {
            pmtIdx = i;
            videoPid = pmtVideoPid(bytes, o);
        } else if (pid === videoPid && isStart(bytes, o)) {
            const pts = pesPts(bytes, o);
            if (pts !== null) {
                lastPts = pts;
                if (hasRandomAccess(bytes, o)) keys.push({ idx: i, pts });
            }
        }
    }
    if (patIdx < 0 || pmtIdx < 0) throw new Error(BAD);
    return { bytes, size, off, count, patIdx, pmtIdx, pmtPid, keys, lastPts };
}

/** Writes the PCR and PES timestamps of one packet so the part starts at 0. */
function rebasePacket(p: Uint8Array<ArrayBuffer>, o: number, base: number): void {
    const afc = (p[o + 3] >> 4) & 3;
    let pay = o + 4;
    if (afc & 2) {
        const afLen = p[o + 4];
        if (afLen >= 7 && (p[o + 5] & 0x10)) {
            const ext = ((p[o + 10] & 1) << 8) | p[o + 11];
            writePcr(p, o + 6, Math.max(0, decodePcr(p, o + 6) - base), ext);
        }
        pay = o + 5 + afLen;
    }
    if (!(afc & 1) || !isStart(p, o)) return;
    if (p[pay] !== 0 || p[pay + 1] !== 0 || p[pay + 2] !== 1) return;

    const flags = p[pay + 7];
    if (flags & 0x80) {
        const v = decodeTs(p, pay + 9);
        writeTs(p, pay + 9, Math.max(0, v - base), p[pay + 9] >> 4);
    }
    if ((flags & 0xc0) === 0xc0) {
        const d = pay + 14;
        const v = decodeTs(p, d);
        writeTs(p, d, Math.max(0, v - base), p[d] >> 4);
    }
}

/** Length of the video in seconds, from the first key frame to the last video timestamp. */
export async function tsDuration(file: File): Promise<number | null> {
    const s = scan(new Uint8Array(await file.arrayBuffer()));
    if (s.keys.length === 0) return null;
    return (s.lastPts - s.keys[0].pts) / 90000;
}

/** Cuts a TS or M2TS into clips of about clipSeconds, at video key frames. No re-encoding. */
export async function splitTs(file: File, clipSeconds: number): Promise<SplitPart[]> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const s = scan(bytes);
    if (s.keys.length === 0) throw new Error(NO_KEYS);

    const first = s.keys[0].pts;
    const secs = Float64Array.from(s.keys, (k) => (k.pts - first) / 90000);
    const sync = s.keys.map((_, i) => i);
    const cuts = planCuts(secs, sync, secs[secs.length - 1], clipSeconds, s.keys.length);
    const count = cuts.length - 1;

    const packetCopy = (i: number) => bytes.slice(i * s.size, (i + 1) * s.size);
    const psi = [packetCopy(s.patIdx), packetCopy(s.pmtIdx)];

    const parts: SplitPart[] = [];
    for (let i = 0; i < count; i++) {
        const from = cuts[i];
        const to = cuts[i + 1];
        const startIdx = s.keys[from].idx;
        const endIdx = to < s.keys.length ? s.keys[to].idx : s.count;
        const base = s.keys[from].pts;

        const pieces: Uint8Array<ArrayBuffer>[] = [...psi];
        for (let p = startIdx; p < endIdx; p++) {
            const o = p * s.size + s.off;
            const pid = pidOf(bytes, o);
            if (pid === 0 || pid === s.pmtPid) continue; // PAT and PMT are written once, at the start
            const pk = packetCopy(p);
            rebasePacket(pk, s.off, base);
            pieces.push(pk);
        }
        parts.push({
            name: partFileName(file.name, i, count),
            blob: new Blob(pieces, { type: 'video/mp2t' }),
        });
    }
    return parts;
}