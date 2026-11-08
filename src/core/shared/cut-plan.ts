/** First index whose value is >= target. Values must be sorted. */
export function lowerBound(arr: Float64Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The sync point whose time is closest to target. Ties go to the later one. */
function nearestSync(secs: Float64Array, sync: number[], target: number): number {
  let lo = 0;
  let hi = sync.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (secs[sync[mid]] < target) lo = mid + 1;
    else hi = mid;
  }
  const after = lo < sync.length ? sync[lo] : undefined;
  const before = lo > 0 ? sync[lo - 1] : undefined;
  if (after === undefined) return before ?? 0;
  if (before === undefined) return after;
  return target - secs[before] < secs[after] - target ? before : after;
}

/**
 * Sample indexes where each clip starts, plus the end (n).
 * For every multiple of clipSeconds, the nearest sync point is used as a cut.
 */
export function planCuts(
  secs: Float64Array,
  sync: number[],
  total: number,
  clipSeconds: number,
  n: number,
): number[] {
  const cuts = [0];
  for (let target = clipSeconds; target < total; target += clipSeconds) {
    const idx = nearestSync(secs, sync, target);
    if (idx > cuts[cuts.length - 1]) cuts.push(idx);
  }
  cuts.push(n);
  return cuts;
}