import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { SetAccess } from '../src/automate/set';
import { layerNames } from '../src/layers';
import { sheetsOf } from '../src/automate/sheets';
import { segmentsOf } from '../src/fill/sheetWalls';
import type { Segment } from '../src/fill/vectors';
import { newId, type Sheet, type Units } from '../src/model';
import { pageTexts, type PageText } from '../src/pageText';
import { inspectPage, type PDFDocumentProxy, type PDFPageProxy } from '../src/pdf';
import { withOcrText } from '../src/ocrText';
import { cliOcr } from './ocrCli';

// pdf.js in Node runs its worker in-process from this file.
GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;

export interface OpenDoc {
  id: string;
  file: string;
  pdf: PDFDocumentProxy;
}

/** Opens a drawing PDF in Node the way the app does in the browser. */
export async function openDoc(path: string): Promise<OpenDoc> {
  const data = new Uint8Array(readFileSync(path));
  const read = (await getDocument({ data, verbosity: 0 }).promise) as unknown as PDFDocumentProxy;
  // Pages drawn with no text layer (lettering as linework) are read by OCR, as the app does.
  const ocr = await cliOcr(path);
  const pdf = ocr ? withOcrText(read, ocr) : read;
  return { id: newId(), file: basename(path), pdf };
}

/**
 * The project's units, as an estimator would set them up: the system most scale notes on the
 * sheets are in (1:100 metric, 1/8" = 1'-0" imperial).
 */
export async function unitsOf(docs: OpenDoc[]): Promise<{ units: Units; metric: number; imperial: number }> {
  let metric = 0;
  let imperial = 0;
  for (const d of docs)
    for (let n = 1; n <= d.pdf.numPages; n++) {
      const pg = await d.pdf.getPage(n);
      const info = await inspectPage(pg);
      for (const h of info.scaleHints) if (/^1\s*:/.test(h)) metric++;
      else imperial++;
    }
  return { units: imperial > metric ? 'imperial' : 'metric', metric, imperial };
}

/** Every page of the drawings as sheets, as the app makes them on upload. */
export async function makeSheets(docs: OpenDoc[], units: Units, log?: (s: string) => void): Promise<{ sheets: Sheet[]; noText: number }> {
  const sheets: Sheet[] = [];
  let noText = 0;
  for (const d of docs) {
    const read = await sheetsOf(d.pdf, d.id, units, (n, of) => log?.(`${d.file}: sheet ${n} of ${of}`));
    sheets.push(...read.sheets);
    noText += read.noText;
  }
  return { sheets, noText };
}

/** How the automations read the set in Node: pages from the open PDFs, text and linework kept per sheet. */
export class NodeSet implements SetAccess {
  private textCache = new Map<string, Promise<PageText[]>>();
  /** The automation running, and per sheet and automation: time spent, errors. */
  tool = '';
  readonly times = new Map<string, Map<string, number>>();
  readonly errors: { sheetId: string; tool: string; error: string }[] = [];

  /** The last progress message naming a sheet, and when it came: the time up to the next one is that sheet's. */
  private naming: { sheetId: string; at: number } | null = null;
  private lastNamed = '';

  constructor(
    private docs: Map<string, OpenDoc>,
    private sheets: Sheet[] = [],
  ) {}

  /**
   * Progress from an automation. Count symbols reports each sheet it moves on to ("Counting
   * symbols… A501 (3 of 40)", "Finding legends… 3 of 40") rather than timing sheets itself, so its
   * time per sheet is the time between those messages.
   */
  // A property, not a method: automations hand it on unbound.
  progress = (text: string) => {
    if (this.tool !== 'symbols') return;
    const now = Date.now();
    this.endNaming(now);
    const byName = /Counting symbols… (.+) \(\d+ of \d+\)/.exec(text);
    const byIndex = /Finding legends… (\d+) of \d+/.exec(text);
    const set = this.sheets.filter((x) => !x.superseded);
    // Sheets go in set order: two files can both have an A311, so the next one of that name.
    const after = set.findIndex((x) => x.id === this.lastNamed);
    const named = (name: string) => set.find((x, i) => i > after && x.name === name) ?? set.find((x) => x.name === name);
    const s = byName ? named(byName[1]) : byIndex ? set[+byIndex[1] - 1] : undefined;
    this.lastNamed = s?.id ?? this.lastNamed;
    this.naming = s ? { sheetId: s.id, at: now } : null;
  };

  /** Ends the time of the sheet last named in progress. */
  endNaming(now = Date.now()) {
    if (this.naming) this.addTime(this.naming.sheetId, this.tool, now - this.naming.at);
    this.naming = null;
  }

  async page(sheet: Sheet): Promise<PDFPageProxy | null> {
    const d = this.docs.get(sheet.docId);
    return d ? d.pdf.getPage(sheet.page) : null;
  }

  doc(sheet: Sheet): PDFDocumentProxy | undefined {
    return this.docs.get(sheet.docId)?.pdf;
  }

  async layers(sheet: Sheet): Promise<Map<string, string>> {
    const d = this.docs.get(sheet.docId);
    return d ? layerNames(d.pdf) : new Map();
  }

  texts(sheet: Sheet): Promise<PageText[]> {
    let p = this.textCache.get(sheet.id);
    if (!p) {
      p = this.page(sheet).then((pg) => (pg ? pageTexts(pg) : []));
      this.textCache.set(sheet.id, p);
    }
    return p;
  }

  async segments(sheet: Sheet): Promise<Segment[] | null> {
    const pg = await this.page(sheet);
    if (!pg) return null;
    const segs = await segmentsOf(pg);
    // pdf.js keeps every page's operator list until the page is cleaned up: across a whole set
    // that is gigabytes. The segments read from it stay cached.
    pg.cleanup();
    return segs;
  }

  sheetError(sheet: Sheet, error: unknown) {
    this.errors.push({ sheetId: sheet.id, tool: this.tool, error: error instanceof Error ? error.message : String(error) });
  }

  sheetTime(sheet: Sheet, ms: number) {
    this.addTime(sheet.id, this.tool, ms);
  }

  addTime(sheetId: string, tool: string, ms: number) {
    let m = this.times.get(sheetId);
    if (!m) this.times.set(sheetId, (m = new Map()));
    m.set(tool, (m.get(tool) ?? 0) + ms);
  }
}
