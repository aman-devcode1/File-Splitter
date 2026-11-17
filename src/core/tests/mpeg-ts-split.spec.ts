import { describe, expect, it } from 'vitest';
import { splitTs } from '../video/mpeg-ts';
import { concat, toArrayBuffer } from '../video/mp4';

const VIDEO = 0x100;
const PMT_PID = 0x1000;

/** One 188-byte TS packet. */
function packet(pid: number, start: boolean, payload: number[], rai = false): Uint8Array {
    const out = new Uint8Array(188).fill(0xff);
    out[0] = 0x47;
    out[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f);
    out[2] = pid & 0xff;
    let p = 4;
    if (rai) {
        out[3] = 0x30; // adaptation field + payload
        out[4] = 1; // adaptation field length
        out[5] = 0x40; // random access indicator
        p = 6;
    } else {
        out[3] = 0x10; // payload only
    }
    out.set(payload.slice(0, 188 - p), p);
    return out;
}

/** 5-byte PTS field (prefix 0010). */
function pts5(ts: number): number[] {
    return [
        0x21 | ((Math.floor(ts / 2 ** 30) & 7) << 1),
        Math.floor(ts / 2 ** 22) & 0xff,
        ((Math.floor(ts / 2 ** 15) & 0x7f) << 1) | 1,
        Math.floor(ts / 2 ** 7) & 0xff,
        ((ts % 128) << 1) | 1,
    ];
}

const PAT = [0, 0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | ((PMT_PID >> 8) & 0x1f), PMT_PID & 0xff, 0, 0, 0, 0];
const PMT = [
    0, 0x02, 0xb0, 0x12, 0x00, 0x01, 0xc1, 0x00, 0x00,
    0xe0 | ((VIDEO >> 8) & 0x1f), VIDEO & 0xff,
    0xf0, 0x00,
    0x1b, 0xe0 | ((VIDEO >> 8) & 0x1f), VIDEO & 0xff, 0xf0, 0x00,
    0, 0, 0, 0,
];

/** 10 seconds: a key frame every second, and an inter frame half a second later. */
function makeTs(): File {
    const pes = (pts: number) => [0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, ...pts5(pts)];
    const pieces: Uint8Array[] = [packet(0, true, PAT), packet(PMT_PID, true, PMT)];
    for (let s = 0; s < 10; s++) {
        pieces.push(packet(VIDEO, true, pes(s * 90000), true));
        pieces.push(packet(VIDEO, true, pes(s * 90000 + 45000)));
    }
    return new File([toArrayBuffer(concat(pieces))], 'test.ts', { type: 'video/mp2t' });
}

describe('splitTs', () => {
    it('cuts at video key frames and starts each part at time 0', async () => {
        const parts = await splitTs(makeTs(), 5);
        expect(parts.length).toBe(2);

        const b = new Uint8Array(await parts[1].blob.arrayBuffer());
        // Packet 0 = PAT, 1 = PMT, 2 = the first key frame of this part.
        // That packet has a 6-byte header, then the PES header, with the PTS at byte 9 of the PES.
        expect(b[0]).toBe(0x47);
        expect(Array.from(b.slice(376 + 6 + 9, 376 + 6 + 14))).toEqual(pts5(0));
    });
});