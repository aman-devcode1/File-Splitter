import { registerCounter, registerEngine, type SplitEngine } from './registry';
import { byteEngine } from './shared/byte-split';
import { pdfPagesEngine, countPdfPages } from './documents/pdf-pages';
import { docxParagraphsEngine, countParagraphs } from './documents/docx-paragraphs';
import { xlsxRowsEngine, countRows } from './documents/xlsx-rows';
import { zipEntriesEngine, countZipEntries } from './archives/zip-entries';
import { textLinesEngine, countLines } from './text/text-lines';
import { splitDiagonal, splitPercent, splitCount, countImageAxis } from './images/image-split';
import { splitWav } from './audio/wav-split';
import { splitMp3 } from './audio/mp3-split';
import { splitMp4 } from './video/media-time';
import { splitFragmentedToRegular } from './video/mp4-regular';
import { topLevelBoxes } from './video/mp4';
import { splitFlac } from './audio/flac-split';
import { splitOgg } from './audio/ogg-split';

registerEngine({
  id: 'byte',
  split: (file, _detected, partSize) => byteEngine.split(file, partSize),
} satisfies SplitEngine);

registerEngine({
  id: 'pdf-pages',
  split: (file, detected, n) => pdfPagesEngine.split(file, detected, n),
} satisfies SplitEngine);

registerEngine({
  id: 'zip-entries',
  split: (file, detected, n) => zipEntriesEngine.split(file, detected, n),
} satisfies SplitEngine);

registerEngine({
  id: 'text-lines',
  split: (file, detected, n) => textLinesEngine.split(file, detected, n),
} satisfies SplitEngine);

registerEngine({
  id: 'docx-paragraphs',
  split: (file, detected, n) => docxParagraphsEngine.split(file, detected, n),
} satisfies SplitEngine);

registerEngine({
  id: 'xlsx-rows',
  split: (file, detected, n) => xlsxRowsEngine.split(file, detected, n),
} satisfies SplitEngine);

registerEngine({
  id: 'image-diag-tlbr',
  split: (file) => splitDiagonal(file, 'tl-br'),
} satisfies SplitEngine);

registerEngine({
  id: 'image-diag-trbl',
  split: (file) => splitDiagonal(file, 'tr-bl'),
} satisfies SplitEngine);

registerEngine({
  id: 'image-h-percent',
  split: (file, detected, p) => splitPercent(file, detected, 'horizontal', p),
} satisfies SplitEngine);

registerEngine({
  id: 'image-h-count',
  split: (file, detected, n) => splitCount(file, detected, 'horizontal', n),
} satisfies SplitEngine);

registerEngine({
  id: 'image-v-percent',
  split: (file, detected, p) => splitPercent(file, detected, 'vertical', p),
} satisfies SplitEngine);

registerEngine({
  id: 'image-v-count',
  split: (file, detected, n) => splitCount(file, detected, 'vertical', n),
} satisfies SplitEngine);

registerEngine({
  id: 'media-time',
  split: async (file, detected, seconds) => {
    switch (detected.kind.id) {
      case 'wav':
        return splitWav(file, seconds);
      case 'mp3':
        return splitMp3(file, seconds);
      case 'flac':
        return splitFlac(file, seconds);
      case 'ogg':
        return splitOgg(file, seconds);
      default: {
        const isFragmented = (await topLevelBoxes(file)).some((b) => b.type === 'moof');
        return isFragmented ? splitFragmentedToRegular(file, seconds) : splitMp4(file, seconds);
      }
    }
  },
} satisfies SplitEngine);

registerCounter('pdf-pages', countPdfPages);
registerCounter('zip-entries', countZipEntries);
registerCounter('text-lines', countLines);
registerCounter('docx-paragraphs', countParagraphs);
registerCounter('xlsx-rows', countRows);
registerCounter('image-h-count', (file) => countImageAxis(file, 'horizontal'));
registerCounter('image-v-count', (file) => countImageAxis(file, 'vertical'));

export * from './types';
export * from './detect/detect';
export * from './registry';
export * from './shared/byte-split';
export * from './shared/cut-plan';
export * from './documents/pdf-pages';
export * from './documents/docx-paragraphs';
export * from './documents/xlsx-rows';
export * from './archives/zip-entries';
export * from './text/text-lines';
export * from './images/image-split';
export * from './audio/wav-split';
export * from './audio/mp3-split';
export * from './audio/flac-split';
export * from './audio/ogg-split';
export * from './video/media-time';
export * from './video/mp4-regular';
export * from './video/mp4-fragmented';
export * from './duration';
export * from './estimate';