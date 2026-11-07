import { registerCounter, registerEngine, type SplitEngine } from './registry';
import { byteEngine } from './split/byte-split';
import { pdfPagesEngine, countPdfPages } from './split/pdf-pages';
import { zipEntriesEngine, countZipEntries } from './split/zip-entries';
import { textLinesEngine, countLines } from './split/text-lines';
import { docxParagraphsEngine, countParagraphs } from './split/docx-paragraphs';
import { xlsxRowsEngine, countRows } from './split/xlsx-rows';
import { splitDiagonal, splitPercent, splitCount, countImageAxis } from './split/image-split';
import { splitMp4 } from './split/media-time';
import { splitWav } from './split/wav-split';
import { splitMp3 } from './split/mp3-split';

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
  split: (file, _detected, seconds) => splitMp4(file, seconds),
} satisfies SplitEngine);

registerEngine({
  id: 'media-time',
  split: (file, detected, seconds) =>
    detected.kind.id === 'wav' ? splitWav(file, seconds) : splitMp4(file, seconds),
} satisfies SplitEngine);

registerEngine({
  id: 'media-time',
  split: (file, detected, seconds) => {
    switch (detected.kind.id) {
      case 'wav': return splitWav(file, seconds);
      case 'mp3': return splitMp3(file, seconds);
      default: return splitMp4(file, seconds);
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
export * from './split/byte-split';
export * from './split/pdf-pages';
export * from './split/zip-entries';
export * from './split/text-lines';
export * from './split/docx-paragraphs';
export * from './split/xlsx-rows';
export * from './split/image-split';
export * from './estimate';
export * from './split/media-time';
export * from './duration';
export * from './split/wav-split';
export * from './split/mp3-split';
export * from './split/wav-split';