import { registerEngine, type SplitEngine } from './registry';
import { byteEngine } from './split/byte-split';
import { docxParagraphsEngine } from './split/docx-paragraphs';
import { pdfPagesEngine } from './split/pdf-pages';
import { textLinesEngine } from './split/text-lines';
import { zipEntriesEngine } from './split/zip-entries';

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

export * from './types';
export * from './detect/detect';
export * from './registry';
export * from './split/byte-split';
export * from './split/pdf-pages';
export * from './split/zip-entries';
export * from './split/text-lines';
export * from './split/docx-paragraphs';