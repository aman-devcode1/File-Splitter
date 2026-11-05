import { describe, expect, it } from 'vitest';
import { planTiles } from '../index';

describe('planTiles', () => {
  it('covers the full width with no gap', () => {
    const r = planTiles(10, 3);
    expect(r[0].start).toBe(0);
    expect(r[r.length - 1].end).toBe(10);
    for (let i = 1; i < r.length; i++) expect(r[i].start).toBe(r[i - 1].end);
  });

  it('never makes more tiles than pixels', () => {
    expect(planTiles(3, 10).length).toBe(3);
  });
});