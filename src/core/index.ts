import { registerLoader } from './registry';

registerLoader('byte', async () => {
  const m = await import('./shared/byte-split');
  return { split: (file, _d, partSize) => m.byteEngine.split(file, partSize) };
});

registerLoader('pdf-pages', async () => {
  const m = await import('./documents/pdf-pages');
  return { split: (f, d, n) => m.pdfPagesEngine.split(f, d, n), count: m.countPdfPages };
});

registerLoader('zip-entries', async () => {
  const m = await import('./archives/zip-entries');
  return { split: (f, d, n) => m.zipEntriesEngine.split(f, d, n), count: m.countZipEntries };
});

registerLoader('text-lines', async () => {
  const m = await import('./text/text-lines');
  return { split: (f, d, n) => m.textLinesEngine.split(f, d, n), count: m.countLines };
});

registerLoader('docx-paragraphs', async () => {
  const m = await import('./documents/docx-paragraphs');
  return { split: (f, d, n) => m.docxParagraphsEngine.split(f, d, n), count: m.countParagraphs };
});

registerLoader('xlsx-rows', async () => {
  const m = await import('./documents/xlsx-rows');
  return { split: (f, d, n) => m.xlsxRowsEngine.split(f, d, n), count: m.countRows };
});

registerLoader('pptx-slides', async () => {
  const m = await import('./documents/pptx-slides');
  return { split: (f, _d, n) => m.splitPptxSlides(f, n), count: m.countPptxSlides };
});

registerLoader('epub-chapters', async () => {
  const m = await import('./documents/epub-chapters');
  return { split: (f, _d, n) => m.splitEpubChapters(f, n), count: m.countEpubChapters };
});

registerLoader('odf', async () => {
  const m = await import('./documents/odf');
  return { split: (f, d, n) => m.splitOdf(f, d, n), count: (f, d) => m.countOdf(f, d) };
});

registerLoader('subtitle-cues', async () => {
  const m = await import('./text/subtitle-cues');
  return { split: (f, _d, n) => m.splitSubtitleCues(f, n), count: m.countSubtitleCues };
});

registerLoader('image-diag-tlbr', async () => {
  const m = await import('./images/image-split');
  return { split: (f) => m.splitDiagonal(f, 'tl-br') };
});

registerLoader('image-diag-trbl', async () => {
  const m = await import('./images/image-split');
  return { split: (f) => m.splitDiagonal(f, 'tr-bl') };
});

registerLoader('image-h-percent', async () => {
  const m = await import('./images/image-split');
  return { split: (f, d, p) => m.splitPercent(f, d, 'horizontal', p) };
});

registerLoader('image-h-count', async () => {
  const m = await import('./images/image-split');
  return { split: (f, d, n) => m.splitCount(f, d, 'horizontal', n), count: (f) => m.countImageAxis(f, 'horizontal') };
});

registerLoader('image-v-percent', async () => {
  const m = await import('./images/image-split');
  return { split: (f, d, p) => m.splitPercent(f, d, 'vertical', p) };
});

registerLoader('image-v-count', async () => {
  const m = await import('./images/image-split');
  return { split: (f, d, n) => m.splitCount(f, d, 'vertical', n), count: (f) => m.countImageAxis(f, 'vertical') };
});

registerLoader('media-time', async () => ({
  split: async (file, detected, seconds) => {
    switch (detected.kind.id) {
      case 'wav': return (await import('./audio/wav-split')).splitWav(file, seconds);
      case 'mp3': return (await import('./audio/mp3-split')).splitMp3(file, seconds);
      case 'flac': return (await import('./audio/flac-split')).splitFlac(file, seconds);
      case 'ogg': return (await import('./audio/ogg-split')).splitOgg(file, seconds);
      case 'mkv':
      case 'webm': return (await import('./video/matroska')).splitMkv(file, seconds);
      case 'avi': return (await import('./video/avi')).splitAvi(file, seconds);
      case 'flv': return (await import('./video/flv')).splitFlv(file, seconds);
      case 'ts': return (await import('./video/mpeg-ts')).splitTs(file, seconds);
      default: {
        const mp4 = await import('./video/mp4');
        const isFragmented = (await mp4.topLevelBoxes(file)).some((b) => b.type === 'moof');
        return isFragmented
          ? (await import('./video/mp4-regular')).splitFragmentedToRegular(file, seconds)
          : (await import('./video/media-time')).splitMp4(file, seconds);
      }
    }
  },
}));

export * from './types';
export * from './detect/detect';
export * from './registry';
export * from './shared/byte-split';
export * from './shared/cut-plan';
export * from './duration';
export * from './estimate';