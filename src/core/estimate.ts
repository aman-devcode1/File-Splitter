/** Rough speed in MB per second on a normal laptop. Only used to show an estimate before splitting. */
const MB_PER_SECOND: Record<string, number> = {
  bytes: 300,
  'pdf-pages': 8,
  'zip-entries': 25,
  'docx-paragraphs': 12,
  'xlsx-rows': 10,
  'text-lines': 40,
  'image-tiles': 12,
  'media-time': 10,
};

/** Estimated seconds for an engine to split a file of this size. Never less than 1. */
export function estimateSeconds(engineId: string, sizeBytes: number): number {
  const rate = MB_PER_SECOND[engineId] ?? 10;
  return Math.max(1, Math.ceil(sizeBytes / 1_000_000 / rate));
}

/** Readable wording for the UI, for example "about 2 min" or "about 1 h 5 min". */
export function describeEstimate(seconds: number): string {
  if (seconds < 10) return 'a few seconds';
  if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}