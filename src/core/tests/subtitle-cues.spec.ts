import { describe, expect, it } from 'vitest';
import { countSubtitleCues, splitSubtitleCues } from '../text/subtitle-cues';

const cue = (n: number) => `${n}\n00:00:0${n},000 --> 00:00:0${n},900\nLine ${n}`;
const SRT = [1, 2, 3, 4, 5].map(cue).join('\n\n') + '\n';

describe('subtitle cues', () => {
  it('counts cues and splits them, renumbering each part from 1', async () => {
    const f = new File([SRT], 'sub.srt');
    expect(await countSubtitleCues(f)).toBe(5);

    const parts = await splitSubtitleCues(f, 2);
    expect(parts.length).toBe(3);
    const texts = await Promise.all(parts.map((p) => p.blob.text()));
    expect(texts[1].startsWith('1\n')).toBe(true);
    expect(texts[1]).toContain('Line 3');
    expect(texts[1]).not.toContain('Line 2');
  });
});