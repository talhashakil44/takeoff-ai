import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from './pdf';

/**
 * A tender often comes as one PDF: the project manual's letter-size pages and the drawings'
 * large sheets bound together. Pages are told apart by size: a page no bigger than legal
 * (8.5 × 14 in, 1008 pt) on either side is a document page; anything larger is a drawing.
 */

export type PageKind = 'doc' | 'sheet';
const DOC_MAX = 1100;

export async function pageKinds(pdf: PDFDocumentProxy): Promise<PageKind[]> {
  const out: PageKind[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { width, height } = page.getViewport({ scale: 1 });
    out.push(Math.max(width, height) <= DOC_MAX ? 'doc' : 'sheet');
    page.cleanup();
  }
  return out;
}

/** Worth splitting: a real run of document pages alongside the drawings. */
export function isCombined(kinds: PageKind[]): boolean {
  const docs = kinds.filter((k) => k === 'doc').length;
  const sheets = kinds.length - docs;
  return docs >= 8 && sheets >= 3;
}

/** 1-based page numbers of each kind. */
export const pagesOf = (kinds: PageKind[], kind: PageKind) => kinds.flatMap((k, i) => (k === kind ? [i + 1] : []));

/** New PDFs, one per list of 1-based pages, in that order. */
export async function splitPdf(data: ArrayBuffer, parts: number[][]): Promise<ArrayBuffer[]> {
  const src = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  const out: ArrayBuffer[] = [];
  for (const pages of parts) {
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(
      src,
      pages.map((p) => p - 1),
    );
    for (const pg of copied) doc.addPage(pg);
    const bytes = await doc.save({ useObjectStreams: true });
    out.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  }
  return out;
}
