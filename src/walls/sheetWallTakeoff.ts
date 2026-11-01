import type { Sheet } from '../model';
import type { PDFDocumentProxy, PDFPageProxy } from '../pdf';
import { segmentsOf, wallModelFor } from '../fill/sheetWalls';
import { pageTexts, type PageText } from '../pageText';
import { WALL_TAG, type TagText } from './tags';
import { CODE, classifyCode, codeOfText, emptySetTypes, listedCodes, mergeSetTypes, readTagLegend, readTypeSheet, type SetTypes } from './setTypes';
import type { WallTakeoffResult } from './wallTakeoff';
import { wallTakeoffByTags } from './tagPens';
import { buildWallModel } from '../fill/roomFill';

/**
 * Wall type tags on the page, with each text's centre and size in sheet points. What
 * counts as a wall tag comes from context: the project's wall types, the set's assembly
 * types sheet and symbol legends (`set`), this sheet's own legend, and otherwise the
 * usual wall prefixes. Other codes count only when their leader lands on a wall.
 */
export async function wallTagTexts(page: PDFPageProxy, known: readonly string[] = [], set?: SetTypes): Promise<TagText[]> {
  const vp = page.getViewport({ scale: 1 });
  return tagTextsFrom(await pageTexts(page), known, set, [vp.width, vp.height]);
}

export function tagTextsFrom(texts: PageText[], known: readonly string[] = [], set?: SetTypes, size?: [number, number]): TagText[] {
  // This sheet's own legend adds to the set's; the codes listed in its schedules are no tags.
  const context = mergeSetTypes([set ?? emptySetTypes(), readTagLegend(texts)]);
  // (Only lists right under their heading: a plan's own tags can line up by chance.)
  const listed = size ? listedCodes(texts, size[0], size[1], true) : new Map();
  const out: TagText[] = [];
  // A code OCR misread by a letter (WI-1 or WTI-4 for WT-1, WT-4 where the set lists WT types and
  // no WI or WTI at all) is the listed one.
  const listedWalls = [...new Set([...context.wall, ...known].map((c) => c.toUpperCase().replace(/[-\s]/g, '')))];
  const anyListed = new Set([...listedWalls, ...context.other.map((c) => c.toUpperCase().replace(/[-\s]/g, ''))]);
  const snap = (code: string) => {
    const plain = code.toUpperCase().replace(/[-\s]/g, '');
    if (anyListed.has(plain) || listedWalls.length < 2) return code;
    const m = /^([A-Z]+)(\d.*)$/.exec(plain);
    if (!m) return code;
    const hits = listedWalls.filter((w) => {
      const n = /^([A-Z]+)(\d.*)$/.exec(w);
      return !!n && n[2] === m[2] && n[1] !== m[1] && oneEdit(n[1], m[1]) && !listedWalls.some((o) => o.startsWith(m[1]) && /\d/.test(o.slice(m[1].length, m[1].length + 1)));
    });
    return hits.length === 1 ? hits[0]! : code;
  };
  for (const t of texts) {
    if (!CODE.test(t.str.trim()) || listed.has(t)) continue;
    const c = classifyCode(snap(codeOfText(t.str)), context, known, (code) => WALL_TAG.test(code));
    if (!c) continue;
    // W-1 and W1 are the same type ("EX 1" is EX1).
    const code = snap(codeOfText(t.str)).replace('-', '');
    out.push({ code, cx: t.cx, cy: t.cy, w: t.w, h: t.h, ...(c.wall ? (c.confirmed ? { confirmed: true } : {}) : { generic: true }) });
  }
  return out;
}

const setCache = new WeakMap<object, Promise<SetTypes>>();

/**
 * What the drawing set says its type codes are (assembly types sheets and symbol
 * legends), read once per drawing file from every sheet's text.
 */
export function setTypesOf(doc: PDFDocumentProxy): Promise<SetTypes> {
  let p = setCache.get(doc);
  if (!p) {
    p = (async () => {
      const parts: Partial<SetTypes>[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const texts = await pageTexts(page);
        const vp = page.getViewport({ scale: 1 });
        const sheet = readTypeSheet(texts, vp.width, vp.height);
        if (sheet) parts.push(sheet);
        parts.push(readTagLegend(texts));
      }
      return mergeSetTypes(parts);
    })();
    p.catch(() => setCache.delete(doc));
    setCache.set(doc, p);
  }
  return p;
}

export interface KnownWalls {
  /** Codes of the project's wall types (empty when it has none yet: tags are then read by their prefixes). */
  codes: string[];
  /** Those of them that are exterior walls. */
  exterior: string[];
  /** What the drawing set's own type sheets and legends say (see `setTypesOf`). */
  set?: SetTypes;
}

/** Runs the wall takeoff on a sheet with a known scale. */
export async function sheetWallTakeoff(
  page: PDFPageProxy,
  sheet: Sheet,
  maxOpening: number,
  throughDoors: boolean,
  stopAtDoors: string[] = [],
  known: KnownWalls = { codes: [], exterior: [] },
): Promise<WallTakeoffResult> {
  if (!sheet.metersPerPoint) throw new Error('Set the sheet scale first.');
  const [model, segments, texts] = await Promise.all([wallModelFor(page, sheet, maxOpening), segmentsOf(page), wallTagTexts(page, known.codes, known.set)]);
  // The wall takeoff reads tags and leaders itself: it takes the wall pens' symbols as drawn.
  const mpp = sheet.metersPerPoint;
  return wallTakeoffByTags(model, segments, texts, mpp, { throughDoors, stopAtDoors, exterior: known.exterior, kinds: known.set?.kinds }, (pens) =>
    buildWallModel(segments, mpp, { pens, maxOpening, stats: model.stats }),
  );
}

/** Do two letter groups differ by one letter added, dropped or changed (WT and WI, WT and WTI)? */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
