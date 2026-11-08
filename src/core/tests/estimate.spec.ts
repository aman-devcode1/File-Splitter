import { describe, expect, it } from 'vitest';
import { describeEstimate, estimateSeconds } from '../index';

describe('estimateSeconds', () => {
  it('never returns less than 1 second', () => {
    expect(estimateSeconds('bytes', 0)).toBe(1);
  });

  it('grows with file size', () => {
    expect(estimateSeconds('pdf-pages', 800_000_000)).toBeGreaterThan(
      estimateSeconds('pdf-pages', 8_000_000),
    );
  });
});

describe('describeEstimate', () => {
  it('uses readable wording', () => {
    expect(describeEstimate(5)).toBe('a few seconds');
    expect(describeEstimate(90)).toBe('about 2 min');
    expect(describeEstimate(3720)).toBe('about 1 h 2 min');
  });
});