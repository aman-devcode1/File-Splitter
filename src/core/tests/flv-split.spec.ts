import { describe, expect, it } from 'vitest';
import { readFlv, splitFlv } from '../video/flv';
import { concat, toArrayBuffer } from '../video/mp4';

/** One FLV tag, with its PreviousTagSize after it. */
function tag(type: number, ts: number, data: number[]): Uint8Array {
    const out = new Uint8Array(11 + data.length + 4);
    out[0] = type;
    out[1] = (data.length >> 16) & 0xff;
    out[2] = (data.length >> 8) & 0xff;
    out[3] = data.length & 0xff;
    out[4] = (ts >>> 16) & 0xff;
    out[5] = (ts >>> 8) & 0xff;
    out[6] = ts & 0xff;
    out[7] = (ts >>> 24) & 0xff;
    out.set(data, 11);
    new DataView(out.buffer).setUint32(out.length - 4, 11 + data.length);
    return out;
}

/** onMetaData script tag with a "duration" property. */
function scriptTag(duration: number): Uint8Array {
    const name = [...'onMetaData'].map((c) => c.charCodeAt(0));
    const key = [...'duration'].map((c) => c.charCodeAt(0));
    const num = new Uint8Array(8);
    new DataView(num.buffer).setFloat64(0, duration);
    return tag(18, 0, [0x02, 0, name.length, ...name, 0x08, 0, 0, 0, 1, 0, key.length, ...key, 0x00, ...num, 0, 0, 9]);
}

/** 10 seconds: script, video and audio config, then a key frame and an inter frame every second. */
function makeFlv(): File {
    const header = new Uint8Array([0x46, 0x4c, 0x56, 1, 5, 0, 0, 0, 9, 0, 0, 0, 0]);
    const pieces: Uint8Array[] = [header, scriptTag(10), tag(9, 0, [0x17, 0]), tag(8, 0, [0xaf, 0])];
    for (let s = 0; s < 10; s++) {
        pieces.push(tag(9, s * 1000, [0x17, 1]));
        pieces.push(tag(9, s * 1000 + 500, [0x27, 1]));
    }
    return new File([toArrayBuffer(concat(pieces))], 'test.flv', { type: 'video/x-flv' });
}

/** Reads the "duration" value (seconds) from the script tag of an FLV blob. */
async function durationOf(blob: Blob): Promise<number> {
    const flv = await readFlv(new File([blob], 'part.flv'));
    const script = flv.tags.find((t) => t.type === 18)!;
    // Script data layout: string "onMetaData" (13 bytes), ECMA array header (5 bytes), key "duration" (10 bytes), type byte, then the double.
    return new DataView(script.bytes.buffer, script.bytes.byteOffset).getFloat64(11 + 29);
}

describe('splitFlv', () => {
    it('cuts at key frames, keeps the config tags, and starts each part at 0', async () => {
        const parts = await splitFlv(makeFlv(), 5);
        expect(parts.length).toBe(2);

        const second = await readFlv(new File([parts[1].blob], 'p2.flv'));
        const configs = second.tags.filter((t) => t.config);
        const media = second.tags.filter((t) => !t.config);
        expect(configs.length).toBe(3);
        expect(media[0].ts).toBe(0);
        expect(media[media.length - 1].ts).toBe(4500);
    });

    it('sets the metadata duration to each part length', async () => {
        const parts = await splitFlv(makeFlv(), 5);
        expect(await durationOf(parts[0].blob)).toBeCloseTo(5, 5);
        expect(await durationOf(parts[1].blob)).toBeCloseTo(4.5, 5);
    });
});