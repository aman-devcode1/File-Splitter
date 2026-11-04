import type { FileKind, MagicRule } from '../types';

const at = (offset: number, text: string): MagicRule => ({
  offset,
  bytes: [...text].map((c) => c.charCodeAt(0)),
});

const hex = (offset: number, ...bytes: number[]): MagicRule => ({ offset, bytes });

const ZIP_MAGIC = [[hex(0, 0x50, 0x4b, 0x03, 0x04)], [hex(0, 0x50, 0x4b, 0x05, 0x06)]] as const;

/**
 * Order matters when several kinds match the same bytes. ZIP-based formats
 * (docx, xlsx, epub...) share the ZIP magic, so the extension decides between them.
 * The first kind in the list is used when the extension matches none of them.
 */
export const FILE_KINDS: readonly FileKind[] = [
  // Documents
  { id: 'pdf', label: 'PDF', category: 'document', extensions: ['pdf'], magic: [[at(0, '%PDF-')]] },
  { id: 'ole', label: 'Old Office (DOC/XLS/PPT)', category: 'document', extensions: ['doc', 'xls', 'ppt'],
    magic: [[hex(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)]] },

  // Archives (ZIP family first)
  { id: 'zip', label: 'ZIP archive', category: 'archive', extensions: ['zip', 'jar', 'apk'], magic: ZIP_MAGIC },
  { id: 'docx', label: 'Word document', category: 'office', extensions: ['docx'], magic: ZIP_MAGIC },
  { id: 'xlsx', label: 'Excel spreadsheet', category: 'office', extensions: ['xlsx', 'xlsm'], magic: ZIP_MAGIC },
  { id: 'pptx', label: 'PowerPoint presentation', category: 'office', extensions: ['pptx'], magic: ZIP_MAGIC },
  { id: 'epub', label: 'EPUB ebook', category: 'document', extensions: ['epub'], magic: ZIP_MAGIC },
  { id: 'odf', label: 'OpenDocument', category: 'office', extensions: ['odt', 'ods', 'odp'], magic: ZIP_MAGIC },
  { id: 'rar', label: 'RAR archive', category: 'archive', extensions: ['rar'],
    magic: [[hex(0, 0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)]] },
  { id: '7z', label: '7-Zip archive', category: 'archive', extensions: ['7z'],
    magic: [[hex(0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)]] },
  { id: 'gzip', label: 'GZIP archive', category: 'archive', extensions: ['gz', 'tgz'], magic: [[hex(0, 0x1f, 0x8b)]] },
  { id: 'tar', label: 'TAR archive', category: 'archive', extensions: ['tar'], magic: [[at(257, 'ustar')]] },

  // Images
  { id: 'png', label: 'PNG image', category: 'image', extensions: ['png'],
    magic: [[hex(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)]] },
  { id: 'jpeg', label: 'JPEG image', category: 'image', extensions: ['jpg', 'jpeg'], magic: [[hex(0, 0xff, 0xd8, 0xff)]] },
  { id: 'webp', label: 'WebP image', category: 'image', extensions: ['webp'], magic: [[at(0, 'RIFF'), at(8, 'WEBP')]] },
  { id: 'gif', label: 'GIF image', category: 'image', extensions: ['gif'],
    magic: [[at(0, 'GIF87a')], [at(0, 'GIF89a')]] },
  { id: 'bmp', label: 'BMP image', category: 'image', extensions: ['bmp'], magic: [[at(0, 'BM')]] },
  { id: 'tiff', label: 'TIFF image', category: 'image', extensions: ['tif', 'tiff'],
    magic: [[hex(0, 0x49, 0x49, 0x2a, 0x00)], [hex(0, 0x4d, 0x4d, 0x00, 0x2a)]] },
  { id: 'heic', label: 'HEIC image', category: 'image', extensions: ['heic', 'heif'],
    magic: [[at(4, 'ftyp'), at(8, 'heic')], [at(4, 'ftyp'), at(8, 'heix')], [at(4, 'ftyp'), at(8, 'mif1')]] },
  { id: 'psd', label: 'Photoshop file', category: 'image', extensions: ['psd'], magic: [[at(0, '8BPS')]] },

  // Audio
  { id: 'mp3', label: 'MP3 audio', category: 'audio', extensions: ['mp3'],
    magic: [[at(0, 'ID3')], [hex(0, 0xff, 0xfb)], [hex(0, 0xff, 0xf3)], [hex(0, 0xff, 0xf2)]] },
  { id: 'wav', label: 'WAV audio', category: 'audio', extensions: ['wav'], magic: [[at(0, 'RIFF'), at(8, 'WAVE')]] },
  { id: 'flac', label: 'FLAC audio', category: 'audio', extensions: ['flac'], magic: [[at(0, 'fLaC')]] },
  { id: 'ogg', label: 'Ogg audio', category: 'audio', extensions: ['ogg', 'oga', 'opus'], magic: [[at(0, 'OggS')]] },
  { id: 'm4a', label: 'M4A audio', category: 'audio', extensions: ['m4a', 'm4b'],
    magic: [[at(4, 'ftyp'), at(8, 'M4A ')], [at(4, 'ftyp'), at(8, 'M4B ')]] },
  { id: 'midi', label: 'MIDI', category: 'audio', extensions: ['mid', 'midi'], magic: [[at(0, 'MThd')]] },

  // Video (more specific brands first)
  { id: 'mov', label: 'QuickTime video', category: 'video', extensions: ['mov', 'qt'],
    magic: [[at(4, 'ftyp'), at(8, 'qt  ')]] },
  { id: '3gp', label: '3GP video', category: 'video', extensions: ['3gp', '3g2'],
    magic: [[at(4, 'ftyp'), at(8, '3gp')], [at(4, 'ftyp'), at(8, '3g2')]] },
  { id: 'mp4', label: 'MP4 video', category: 'video', extensions: ['mp4', 'm4v'], magic: [[at(4, 'ftyp')]] },
  { id: 'avi', label: 'AVI video', category: 'video', extensions: ['avi'], magic: [[at(0, 'RIFF'), at(8, 'AVI ')]] },
  { id: 'mkv', label: 'Matroska video', category: 'video', extensions: ['mkv'], magic: [[hex(0, 0x1a, 0x45, 0xdf, 0xa3)]] },
  { id: 'webm', label: 'WebM video', category: 'video', extensions: ['webm'], magic: [[hex(0, 0x1a, 0x45, 0xdf, 0xa3)]] },
  { id: 'flv', label: 'Flash video', category: 'video', extensions: ['flv'], magic: [[at(0, 'FLV')]] },
  { id: 'mpeg', label: 'MPEG video', category: 'video', extensions: ['mpg', 'mpeg', 'm2ts', 'vob'],
    magic: [[hex(0, 0x00, 0x00, 0x01, 0xba)]] },
  { id: 'ts', label: 'MPEG transport stream', category: 'video', extensions: ['ts'], magic: [] },

  // Binary and misc
  { id: 'exe', label: 'Windows executable', category: 'binary', extensions: ['exe', 'dll'], magic: [[at(0, 'MZ')]] },
  { id: 'elf', label: 'ELF executable', category: 'binary', extensions: [], magic: [[hex(0, 0x7f, 0x45, 0x4c, 0x46)]] },
  { id: 'sqlite', label: 'SQLite database', category: 'data', extensions: ['db', 'sqlite', 'sqlite3'],
    magic: [[at(0, 'SQLite format 3\0')]] },
  { id: 'ttf', label: 'TrueType font', category: 'binary', extensions: ['ttf'],
    magic: [[hex(0, 0x00, 0x01, 0x00, 0x00)]] },
  { id: 'otf', label: 'OpenType font', category: 'binary', extensions: ['otf'], magic: [[at(0, 'OTTO')]] },
  { id: 'woff', label: 'WOFF font', category: 'binary', extensions: ['woff'], magic: [[at(0, 'wOFF')]] },
  { id: 'woff2', label: 'WOFF2 font', category: 'binary', extensions: ['woff2'], magic: [[at(0, 'wOF2')]] },
  { id: 'iso', label: 'Disk image', category: 'binary', extensions: ['iso', 'img', 'vhd', 'bak', 'dmg'], magic: [] },

  // Text, data and code (extension only, no magic bytes)
  { id: 'text', label: 'Text file', category: 'text', extensions: ['txt', 'log', 'md', 'ini', 'cfg', 'conf'], magic: [] },
  { id: 'csv', label: 'CSV / TSV', category: 'data', extensions: ['csv', 'tsv'], magic: [] },
  { id: 'json', label: 'JSON', category: 'data', extensions: ['json'], magic: [] },
  { id: 'yaml', label: 'YAML', category: 'data', extensions: ['yaml', 'yml'], magic: [] },
  { id: 'xml', label: 'XML', category: 'data', extensions: ['xml'], magic: [] },
  { id: 'sql', label: 'SQL script', category: 'data', extensions: ['sql'], magic: [] },
  { id: 'subtitle', label: 'Subtitles', category: 'text', extensions: ['srt', 'vtt'], magic: [] },
  { id: 'html', label: 'HTML', category: 'code', extensions: ['html', 'htm'], magic: [] },
  { id: 'code', label: 'Source code', category: 'code',
    extensions: ['css', 'js', 'ts', 'py', 'cs', 'java', 'c', 'cpp', 'h', 'php', 'sh', 'go', 'rs', 'rb'], magic: [] },
];

/** Used when the bytes look like text but the extension is unknown or missing. */
export const TEXT_KIND: FileKind = {
  id: 'text', label: 'Plain text', category: 'text', extensions: [], magic: [],
};

/** Used when nothing matches. Only byte split is offered for these. */
export const UNKNOWN_KIND: FileKind = {
  id: 'unknown', label: 'Unknown file', category: 'binary', extensions: [], magic: [],
};