import { describe, expect, it } from 'vitest';
import { ascii, box, concat, findBox, fullBox, parseMoov, toArrayBuffer, topLevelBoxes, u32Flat } from '../split/mp4';
import { detectFile, splitFile } from '../index';

function moov(): Uint8Array {
    return box(
        'moov',
        fullBox('mvhd', 0, 0, u32Flat([0, 0, 1000, 0]), new Uint8Array(80)),
        box(
            'trak',
            fullBox('tkhd', 0, 3, u32Flat([0, 0, 1]), new Uint8Array(68)),
            box(
                'mdia',
                fullBox('mdhd', 0, 0, u32Flat([0, 0, 1000, 0]), new Uint8Array(4)),
                fullBox('hdlr', 0, 0, u32Flat([0]), ascii('vide'), new Uint8Array(13)),
                box(
                    'minf',
                    fullBox('vmhd', 0, 1, new Uint8Array(8)),
                    box(
                        'stbl',
                        fullBox('stsd', 0, 0, u32Flat([1]), box('avc1', new Uint8Array(78))),
                        fullBox('stts', 0, 0, u32Flat([0])),
                        fullBox('stsc', 0, 0, u32Flat([0])),
                        fullBox('stsz', 0, 0, u32Flat([0, 0])),
                        fullBox('stco', 0, 0, u32Flat([0])),
                    ),
                ),
            ),
        ),
        box('mvex', fullBox('trex', 0, 0, u32Flat([1, 1, 0, 0, 0]))),
    );
}

/** One fragment: 1 second (1000 ticks at timescale 1000), key frame, 8 bytes of data. */
function fragment(seq: number, time: number): Uint8Array {
    const build = (dataOffset: number) =>
        box(
            'moof',
            fullBox('mfhd', 0, 0, u32Flat([seq])),
            box(
                'traf',
                fullBox('tfhd', 0, 0x20008, u32Flat([1, 1000])), // track 1, default duration 1000
                fullBox('tfdt', 0, 0, u32Flat([time])),
                fullBox('trun', 0, 0x601, u32Flat([1, dataOffset, 8, 0])),
            ),
        );
    const len = build(0).length;
    return concat([build(len + 8), box('mdat', new Uint8Array(8))]);
}

function makeFragmented(n: number): File {
    const parts: Uint8Array[] = [box('ftyp', ascii('isom'), u32Flat([0x200])), moov()];
    for (let i = 0; i < n; i++) parts.push(fragment(i + 1, i * 1000));
    return new File([toArrayBuffer(concat(parts))], 'frag.mp4', { type: 'video/mp4' });
}

describe('fragmented mp4 split', () => {
    it('splits 3 one-second fragments into 2 second clips (2 and 1 samples)', async () => {
        const f = makeFragmented(3);
        const d = await detectFile(f);
        const parts = await splitFile(f, d, 'media-time', 2);

        expect(parts.length).toBe(2);
        const counts: number[] = [];
        for (const p of parts) {
            const file = new File([p.blob], 'x.mp4');
            const top = await topLevelBoxes(file);

            // The clip is a regular MP4 now, so it must have no moof boxes.
            expect(top.some((b) => b.type === 'moof')).toBe(false);

            const moov = findBox(top, 'moov');
            const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
            const movie = parseMoov(bytes, moov.headerSize);
            counts.push(movie.tracks[0].sizes.length);
        }
        expect(counts).toEqual([2, 1]);
    });
});