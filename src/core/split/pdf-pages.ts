import { PDFDocument } from 'pdf-lib';
import type { DetectedFile, SplitPart } from '../types';
import { partFileName } from './byte-split';
import { registerCounter } from '../registry';

export interface PageRange {
    readonly index: number;
    /** First page of the part (0-based, inclusive). */
    readonly start: number;
    /** End page of the part (0-based, exclusive). */
    readonly end: number;
}

/** Splits page numbers into groups. The last group may be shorter. */
export function planPages(totalPages: number, pagesPerPart: number): PageRange[] {
    if (!Number.isSafeInteger(totalPages) || totalPages < 0) {
        throw new RangeError('Invalid page count.');
    }
    if (!Number.isSafeInteger(pagesPerPart) || pagesPerPart < 1) {
        throw new RangeError('Pages per part must be at least 1.');
    }

    const ranges: PageRange[] = [];
    for (let start = 0; start < totalPages; start += pagesPerPart) {
        ranges.push({
            index: ranges.length,
            start,
            end: Math.min(start + pagesPerPart, totalPages),
        });
    }
    return ranges;
}

export const pdfPagesEngine = {
    id: 'pdf-pages' as const,

    async split(file: File, _detected: DetectedFile, pagesPerPart: number): Promise<SplitPart[]> {
        const message =
            'This PDF could not be read. It may be damaged or password-protected. Byte split works for any file.';

        let source: PDFDocument;
        try {
            source = await PDFDocument.load(await file.arrayBuffer(), {
                ignoreEncryption: false,
                updateMetadata: false,
            });
        } catch {
            throw new Error(message);
        }

        // pdf-lib can sometimes fail later on a broken file, so check the page tree too.
        let totalPages: number;
        try {
            totalPages = source.getPageCount();
        } catch {
            throw new Error(message);
        }

        const ranges = planPages(totalPages, pagesPerPart);
        const parts: SplitPart[] = [];

        for (const range of ranges) {
            const output = await PDFDocument.create();
            const indices = Array.from({ length: range.end - range.start }, (_, k) => range.start + k);
            const pages = await output.copyPages(source, indices);
            for (const page of pages) {
                output.addPage(page);
            }
            const bytes = await output.save({ useObjectStreams: false });

            const check = await PDFDocument.load(bytes);
            if (check.getPageCount() !== range.end - range.start) {
                throw new Error('A generated PDF part has the wrong page count.');
            }

            parts.push({
                name: partFileName(file.name, range.index, ranges.length),
                blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
            });
        }

        return parts;
    },
};

export async function countPdfPages(file: File): Promise<number> {
  const doc = await PDFDocument.load(await file.arrayBuffer());
  return doc.getPageCount();
}

registerCounter('pdf-pages', countPdfPages);