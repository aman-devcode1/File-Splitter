import { registerEngine, type SplitEngine } from './registry';
import { byteEngine } from './split/byte-split';
import { pdfPagesEngine } from './split/pdf-pages';
import { zipEntriesEngine } from './split/zip-entries';
import { textLinesEngine } from './split/text-lines';
import { docxParagraphsEngine } from './split/docx-paragraphs';
import { xlsxRowsEngine } from './split/xlsx-rows';

// Each engine is registered once. A mode shows up only when its engine is registered.
registerEngine({
  id: 'byte',
  split: (file, _detected, partSize) => byteEngine.split(file, partSize),
} satisfies SplitEngine);

registerEngine({
  id: 'pdf-pages',
  split: (file, detected, pagesPerPart) => pdfPagesEngine.split(file, detected, pagesPerPart),
} satisfies SplitEngine);

registerEngine({
  id: 'zip-entries',
  split: (file, detected, entriesPerPart) => zipEntriesEngine.split(file, detected, entriesPerPart),
} satisfies SplitEngine);

registerEngine({
  id: 'text-lines',
  split: (file, detected, linesPerPart) => textLinesEngine.split(file, detected, linesPerPart),
} satisfies SplitEngine);

registerEngine({
  id: 'docx-paragraphs',
  split: (file, detected, perPart) => docxParagraphsEngine.split(file, detected, perPart),
} satisfies SplitEngine);

registerEngine({
  id: 'xlsx-rows',
  split: (file, detected, rowsPerPart) => xlsxRowsEngine.split(file, detected, rowsPerPart),
} satisfies SplitEngine);

export * from './types';
export * from './detect/detect';
export * from './registry';
export * from './split/byte-split';
export * from './split/pdf-pages';
export * from './split/zip-entries';
export * from './split/text-lines';
export * from './split/docx-paragraphs';
export * from './split/xlsx-rows';
export * from './estimate';