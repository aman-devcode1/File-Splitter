import { registerEngine, type SplitEngine } from './registry';
import { byteEngine } from './split/byte-split';

// Byte split is registered here, so it is always available.
// Each new engine (pdf, zip, media...) is registered in the same way.
registerEngine({
  id: 'byte',
  split: (file, _detected, partSize) => byteEngine.split(file, partSize),
} satisfies SplitEngine);

export * from './types';
export * from './detect/detect';
export * from './registry';
export * from './split/byte-split';