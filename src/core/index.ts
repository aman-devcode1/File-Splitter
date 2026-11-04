import { registerEngine, type SplitEngine } from './registry';
import { byteEngine } from './split/byte-split';
import { pdfPagesEngine } from './split/pdf-pages';

// Each engine is registered once. A mode shows up only when its engine is registered.
registerEngine({
  id: 'byte',
  split: (file, _detected, partSize) => byteEngine.split(file, partSize),
} satisfies SplitEngine);

registerEngine({
  id: 'pdf-pages',
  split: (file, detected, pagesPerPart) => pdfPagesEngine.split(file, detected, pagesPerPart),
} satisfies SplitEngine);

export * from './types';
export * from './detect/detect';
export * from './registry';
export * from './split/byte-split';
export * from './split/pdf-pages';