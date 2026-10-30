import { get, set } from 'idb-keyval';
import type { Project, Sheet, SpecDoc } from '../model';
import { isRevisionFile, issueOrder } from '../reissue';
import { mainDrawingScale, scaleHintsOf } from '../sheetScale';
import { parseScale } from '../units';
import type { PageText } from '../pageText';
import type { Segment } from '../fill/vectors';
import type { DrawingText, DrawingTexts } from './building';
import type { DrawingLines } from './roof';

/**
 * The drawing evidence Build It reads (sheet text and elevation linework): which sheets it
 * needs, read a few at a time, kept on this computer by drawing and page so a project opens
 * fast the second time, and fingerprinted cheaply for the stale check.
 *
 * A drawing's pages never change under the same document id (a reissue is a new document),
 * so the cache key is the document and page; the version is bumped when what is kept changes.
 */

const CACHE_VERSION = 3;

/**
 * Sheets whose linework the model reads: exterior elevations and building sections (façades,
 * roof), structural sections and framing elevations, and the measured plans in `plans` (see `linePlans`: door swings and wall openings,
 * structural member strokes).
 */
export const needsLines = (s: Pick<Sheet, 'title'> & { id?: string; name?: string }, plans?: Set<string>) =>
  (/ELEVATION|BUILDING SECTION/i.test(s.title ?? '') && !/INTERIOR|DETAIL/i.test(s.title ?? '')) ||
  structuralSection(s) ||
  (!!s.id && !!plans?.has(s.id));

/** Structural sections and framing elevations (S-sheets titled SECTIONS or ELEVATIONS): beam tops and floor build-ups against the level heads. */
const structuralSection = (s: Pick<Sheet, 'title'> & { name?: string }) =>
  /^S[-\d.]/i.test(s.name ?? '') && /\b(?:SECTIONS?|ELEVATIONS?)\b/i.test(s.title ?? '') && !/DETAIL/i.test(s.title ?? '');

/** Sheets with door counts: by the door takeoff (source doors) or on a Doors count type. */
export function doorSheets(project: Pick<Project, 'measurements'> & { types?: Project['types'] }): Set<string> {
  const doorTypes = new Set((project.types ?? []).filter((t) => t.kind === 'count' && /^doors?\b/i.test(t.name)).map((t) => t.id));
  return new Set(project.measurements.filter((m) => m.source === 'doors' || doorTypes.has(m.typeId)).map((m) => m.sheetId));
}

/**
 * Structural plans with takeoffs (foundation, framing, S-sheets): the member strokes under
 * lintel and beam tags. Mechanical, electrical and plumbing sheets are not structural even
 * when titled a foundation plan.
 */
export function structuralSheets(project: Pick<Project, 'sheets' | 'measurements'>): Set<string> {
  const measured = new Set(project.measurements.map((m) => m.sheetId));
  return new Set(
    project.sheets
      .filter((s) => measured.has(s.id) && !/^[MEP]\d/i.test(s.name ?? '') && (/^S[-\d.]/i.test(s.name ?? '') || /FOUNDATION|FRAMING/i.test(s.title ?? '')))
      .map((s) => s.id),
  );
}

/** Measured plans whose linework the model reads: door plans and structural plans. */
export function linePlans(project: Pick<Project, 'sheets' | 'measurements'> & { types?: Project['types'] }): Set<string> {
  return new Set([...doorSheets(project), ...structuralSheets(project)]);
}

/**
 * Sheets whose text the model reads: plans (levels, grids), elevations and sections (datums,
 * roof, façades), window schedules, and every sheet that has a takeoff (its title block names
 * its level), and untitled sheets (their title block may name a level). Cover sheets, notes,
 * assembly types and details are not read: the model and the plan come out the same without them.
 */
export const needsText = (s: Pick<Sheet, 'id' | 'title'>, measured: Set<string>) =>
  measured.has(s.id) || needsLines(s) || !(s.title ?? '').trim() || /PLAN|ELEVATION|SECTION|SCHEDULE/i.test(s.title ?? '');

/**
 * Arcs some CAD exports write as runs of short straight chords (Kelso's door swings and tag
 * ovals) rather than Bézier curves: within one subpath, five or more chords of similar length,
 * each turning a little the same way, are marked as curve pieces.
 */
export function markPolylineArcs(segs: Segment[]): Segment[] {
  const out = segs.slice();
  const turn = (a: Segment, b: Segment) => {
    const t = Math.atan2(b.y2 - b.y1, b.x2 - b.x1) - Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
    return Math.atan2(Math.sin(t), Math.cos(t));
  };
  const len = (l: Segment) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  let start = -1;
  let sign = 0;
  const close = (end: number) => {
    // `start`..`end` (inclusive) are chords joined by `end - start` small turns.
    if (start >= 0 && end - start >= 4) for (let k = start; k <= end; k++) if (!out[k].curve) out[k] = { ...out[k], curve: true };
    start = -1;
    sign = 0;
  };
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    const la = len(a);
    const lb = len(b);
    const t = turn(a, b);
    const joined =
      a.sub !== undefined && a.sub === b.sub && !a.filled && !b.filled && !a.curve && !b.curve &&
      Math.hypot(b.x1 - a.x2, b.y1 - a.y2) < 0.01 && la > 0 && lb > 0 && Math.max(la, lb) < 3 * Math.min(la, lb);
    if (joined && Math.abs(t) > 0.02 && Math.abs(t) < 0.6 && (!sign || Math.sign(t) === sign)) {
      if (start < 0) start = i - 1;
      sign = Math.sign(t);
    } else {
      close(i - 1);
    }
  }
  close(out.length - 1);
  return out;
}

/** Only what Build It uses of a line: its ends, ink, and whether it is a curve or dashed. */
export function slimLines(segs: Segment[]): Segment[] {
  return markPolylineArcs(segs).map((l) => {
    const out: Segment = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: l.width, filled: l.filled };
    if (l.curve) out.curve = true;
    if (l.dashed) out.dashed = true;
    if (l.color) out.color = l.color;
    return out;
  });
}

export interface PackedLines {
  v: number;
  xy: Float64Array;
  /** Bit 0 filled, 1 curve, 2 dashed. */
  flags: Uint8Array;
  width: Float32Array;
  /** Ink as 0xrrggbb, -1 for none. */
  color: Int32Array;
}
const hex = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : -1);
export function packLines(segs: Segment[]): PackedLines {
  const xy = new Float64Array(segs.length * 4);
  const flags = new Uint8Array(segs.length);
  const width = new Float32Array(segs.length);
  const color = new Int32Array(segs.length);
  segs.forEach((l, i) => {
    xy.set([l.x1, l.y1, l.x2, l.y2], i * 4);
    flags[i] = (l.filled ? 1 : 0) | (l.curve ? 2 : 0) | (l.dashed ? 4 : 0);
    width[i] = l.width;
    color[i] = hex(l.color);
  });
  return { v: CACHE_VERSION, xy, flags, width, color };
}
export function unpackLines(p: PackedLines): Segment[] {
  const out: Segment[] = new Array(p.flags.length);
  for (let i = 0; i < p.flags.length; i++) {
    const f = p.flags[i];
    const l: Segment = { x1: p.xy[i * 4], y1: p.xy[i * 4 + 1], x2: p.xy[i * 4 + 2], y2: p.xy[i * 4 + 3], width: p.width[i], filled: !!(f & 1) };
    if (f & 2) l.curve = true;
    if (f & 4) l.dashed = true;
    const c = p.color?.[i] ?? -1;
    if (c >= 0) l.color = `#${c.toString(16).padStart(6, '0')}`;
    out[i] = l;
  }
  return out;
}

/** Bumped when what is kept of a text changes (v2: its size and angle). */
const TEXT_VERSION = 2;
const textKey = (s: Pick<Sheet, 'docId' | 'page'>) => `bldsrc:t${TEXT_VERSION}:${s.docId}:${s.page}`;

/** Only what Build It uses of a text: its words, centre, and its size and angle where the PDF gave them. */
export function slimText(t: DrawingText): DrawingText {
  const out: DrawingText = { str: t.str, cx: t.cx, cy: t.cy };
  if (Number.isFinite(t.w)) out.w = t.w;
  if (Number.isFinite(t.h)) out.h = t.h;
  if (Number.isFinite(t.angle)) out.angle = t.angle;
  return out;
}
const lineKey = (s: Pick<Sheet, 'docId' | 'page'>) => `bldsrc:l:${s.docId}:${s.page}`;

export interface DrawingSources {
  texts: DrawingTexts;
  lines: DrawingLines;
  /** Title-block words of each sheet read, for sheets whose title doesn't name the level. */
  hints: Record<string, string>;
  /** Drawing sheets re-issued inside addendum files (texts, lines and hints keyed by their id). */
  revisions: RevisionSheet[];
}

/**
 * A drawing sheet re-issued inside an addendum or revision file kept with the specifications
 * (Kelso's Addendum 5 attaches Structural Addendum 1: S0.2 to S6.0 on pages 19 to 34). It
 * supersedes the live sheet it `revises` for Build It's geometry and levels; the takeoffs stay
 * on that sheet (moving them is the user's call).
 */
export interface RevisionSheet {
  /** `spec:<docId>:<page>`, the page one-based. */
  id: string;
  docId: string;
  page: number;
  /** Its number, read from its title block. */
  name: string;
  title?: string;
  width: number;
  height: number;
  /** The live project sheet with that number and size; unset for a sheet the addendum adds. */
  revises?: string;
  /** The file it was issued in. */
  issue: string;
  /** The date in its title block, as written. */
  dated?: string;
  metersPerPoint: number | null;
  scaleLabel: string | null;
  /** Re-issued again by a later addendum. */
  superseded?: boolean;
}

/** Access to the pages of the addendum files kept with the specifications. */
export interface RevisionAccess {
  pages: (docId: string) => Promise<number>;
  size: (docId: string, page: number) => Promise<{ width: number; height: number } | null>;
  text: (docId: string, page: number) => Promise<DrawingText[]>;
  lines?: (docId: string, page: number) => Promise<Segment[]>;
}

/** Addendum and revision files kept with the specifications, in issue order: where re-issued drawing sheets can be. */
export function revisionDocs(project: { specs?: SpecDoc[] }): SpecDoc[] {
  const docs = (project.specs ?? []).filter((d) => isRevisionFile(d.name));
  const order = issueOrder(docs.map((d) => d.name));
  return docs.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

const DATE = /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+\d{1,2},\s*\d{4}$/i;

/**
 * Which live sheet a drawing-size page of an addendum re-issues: the number in its title block
 * (bottom right) that names a live sheet of the same size. Null for a letter page or a sheet the
 * set doesn't have.
 */
export function reissuedSheetOf(
  texts: DrawingText[],
  width: number,
  height: number,
  sheets: Pick<Sheet, 'id' | 'name' | 'width' | 'height' | 'superseded'>[],
): { sheet: Pick<Sheet, 'id' | 'name'>; dated?: string } | { sheet?: undefined; name: string; dated?: string } | null {
  if (Math.max(width, height) < 1000) return null;
  const live = sheets.filter((s) => !s.superseded && Math.abs(s.width - width) < 1 && Math.abs(s.height - height) < 1);
  const corner = texts.filter((t) => t.cx > width * 0.85 && t.cy > height * 0.8);
  const hit = corner
    .map((t) => ({ t, s: live.find((s) => s.name.trim().toUpperCase() === t.str.trim().toUpperCase()) }))
    .filter((x) => x.s)
    .sort((a, b) => b.t.cx + b.t.cy - (a.t.cx + a.t.cy))[0];
  // A sheet the addendum adds (Kelso's S0.3 schedules): a sheet number in the title block, of a
  // discipline the set has at this size.
  const added = hit
    ? null
    : corner
        .filter((t) => SHEET_NO.test(t.str.trim()) && live.some((s) => prefixOf(s.name) === prefixOf(t.str.trim())))
        .sort((a, b) => b.cx + b.cy - (a.cx + a.cy))[0];
  if (!hit && !added) return null;
  const dated = texts.filter((t) => t.cx > width * 0.75 && t.cy > height * 0.6 && DATE.test(t.str.trim()))[0]?.str.trim();
  return hit ? { sheet: hit.s!, dated } : { name: added!.str.trim().toUpperCase(), dated };
}

const SHEET_NO = /^[A-Z]{1,2}-?\d{1,3}(?:[.-]\d{1,3})?[A-Z]?$/i;
const prefixOf = (name: string) => /^[A-Z]+/i.exec(name.trim())?.[0].toUpperCase() ?? '';

/** A re-issued sheet's scale: its own notes, else the sheet it revises where that scale is among its notes. */
function revisionScale(texts: DrawingText[], lines: Segment[] | null, old: Sheet | undefined, units: Project['units']): { metersPerPoint: number | null; scaleLabel: string | null } {
  const full = texts.filter((t): t is PageText => Number.isFinite(t.w) && Number.isFinite(t.h));
  const hints = full.length ? scaleHintsOf(full) : [];
  const pick = hints.length ? mainDrawingScale(hints, full, lines, units, old?.title) : null;
  const label = pick?.label ?? (old?.scaleLabel && hints.includes(old.scaleLabel) ? old.scaleLabel : null);
  const mpp = label ? (label === old?.scaleLabel && old.metersPerPoint ? old.metersPerPoint : parseScale(label)) : null;
  return { metersPerPoint: mpp, scaleLabel: mpp ? label : null };
}

/**
 * Reads the drawing evidence for the sheets Build It needs, four at a time, from this
 * computer's cache where it was read before. A sheet that can't be read is left out.
 */
export async function loadDrawingSources(opts: {
  project: Pick<Project, 'sheets' | 'measurements'> & Partial<Pick<Project, 'types' | 'specs' | 'units'>>;
  sheetText: (sheetId: string) => Promise<DrawingText[]>;
  sheetLines?: (sheetId: string) => Promise<Segment[]>;
  /** The pages of addendum files kept with the specifications, for sheets they re-issue. */
  revisions?: RevisionAccess;
  titleWords: (texts: DrawingText[], width: number, height: number) => string;
  progress?: (done: number, of: number) => void;
  cancelled?: () => boolean;
  cache?: boolean;
}): Promise<DrawingSources> {
  const { project, sheetText, sheetLines, titleWords, progress, cancelled } = opts;
  const useCache = opts.cache !== false && typeof indexedDB !== 'undefined';
  const measured = new Set(project.measurements.map((m) => m.sheetId));
  const plans = linePlans(project);
  const todo = project.sheets.filter((s) => !s.superseded && needsText(s, measured));
  const out: DrawingSources = { texts: {}, lines: {}, hints: {}, revisions: [] };
  let done = 0;
  const one = async (s: Sheet) => {
    let texts = useCache ? await get<DrawingText[] | undefined>(textKey(s)).catch(() => undefined) : undefined;
    if (!texts) {
      const read = await sheetText(s.id).catch(() => null);
      if (read) {
        texts = read.map(slimText);
        if (useCache && read.length) void set(textKey(s), texts).catch(() => undefined);
      }
    }
    out.texts[s.id] = texts ?? [];
    out.hints[s.id] = titleWords(out.texts[s.id], s.width, s.height);
    if (sheetLines && needsLines(s, plans)) {
      const packed = useCache ? await get<PackedLines | undefined>(lineKey(s)).catch(() => undefined) : undefined;
      if (packed?.v === CACHE_VERSION) out.lines[s.id] = unpackLines(packed);
      else {
        const read = await sheetLines(s.id).catch(() => null);
        if (read) {
          out.lines[s.id] = slimLines(read);
          if (useCache && read.length) void set(lineKey(s), packLines(out.lines[s.id])).catch(() => undefined);
        }
      }
    }
    progress?.(++done, todo.length);
  };
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let s = queue.shift(); s && !cancelled?.(); s = queue.shift()) await one(s);
    }),
  );
  if (opts.revisions) await loadRevisions(project, opts.revisions, plans, titleWords, out, useCache, cancelled);
  return out;
}

/** Reads the drawing sheets addendum files re-issue (see `RevisionSheet`) into `out`, keyed `spec:<docId>:<page>`. */
async function loadRevisions(
  project: Pick<Project, 'sheets' | 'measurements'> & Partial<Pick<Project, 'specs' | 'units'>>,
  access: RevisionAccess,
  plans: Set<string>,
  titleWords: (texts: DrawingText[], width: number, height: number) => string,
  out: DrawingSources,
  useCache: boolean,
  cancelled?: () => boolean,
): Promise<void> {
  for (const doc of revisionDocs(project)) {
    const pages = await access.pages(doc.id).catch(() => 0);
    for (let page = 1; page <= pages && !cancelled?.(); page++) {
      const size = await access.size(doc.id, page).catch(() => null);
      if (!size || Math.max(size.width, size.height) < 1000) continue;
      const at = { docId: doc.id, page };
      let texts = useCache ? await get<DrawingText[] | undefined>(textKey(at)).catch(() => undefined) : undefined;
      if (!texts) {
        const read = await access.text(doc.id, page).catch(() => null);
        if (!read) continue;
        texts = read.map(slimText);
        if (useCache && read.length) void set(textKey(at), texts).catch(() => undefined);
      }
      const found = reissuedSheetOf(texts, size.width, size.height, project.sheets);
      if (!found) continue;
      const old = found.sheet ? project.sheets.find((s) => s.id === found.sheet.id) : undefined;
      const name = old?.name ?? ('name' in found ? found.name : '');
      const id = `spec:${doc.id}:${page}`;
      out.texts[id] = texts;
      out.hints[id] = titleWords(texts, size.width, size.height);
      let lines: Segment[] | null = null;
      if (access.lines && ((old && needsLines(old, plans)) || /^S[-\d.]/i.test(name))) {
        const packed = useCache ? await get<PackedLines | undefined>(lineKey(at)).catch(() => undefined) : undefined;
        if (packed?.v === CACHE_VERSION) lines = unpackLines(packed);
        else {
          const read = await access.lines(doc.id, page).catch(() => null);
          if (read) {
            lines = slimLines(read);
            if (useCache && read.length) void set(lineKey(at), packLines(lines)).catch(() => undefined);
          }
        }
        if (lines) out.lines[id] = lines;
      }
      // A later addendum re-issuing the same sheet supersedes this one's predecessors.
      for (const r of out.revisions) if (r.name === name) r.superseded = true;
      out.revisions.push({
        id,
        docId: doc.id,
        page,
        name,
        title: old?.title,
        width: size.width,
        height: size.height,
        revises: old?.id,
        issue: doc.name.replace(/\.pdf$/i, ''),
        dated: found.dated,
        ...revisionScale(texts, lines, old, project.units ?? 'metric'),
      });
    }
  }
}

/**
 * A cheap fingerprint of the drawing evidence for the stale check: per sheet, how many text
 * runs and lines it has and a sample of their positions. Pages don't change under one document,
 * so this tells a different read apart without stringifying megabytes of linework.
 */
export function drawingFingerprint(texts?: DrawingTexts, lines?: DrawingLines): string {
  const part = (n: number, at: (i: number) => number) => {
    let sum = 0;
    const step = Math.max(1, Math.floor(n / 64));
    for (let i = 0; i < n; i += step) sum += at(i);
    return `${n}:${Math.round(sum * 100)}`;
  };
  const t = Object.keys(texts ?? {})
    .sort()
    .map((id) => `${id}:${part(texts![id].length, (i) => texts![id][i].cx + texts![id][i].cy + texts![id][i].str.length)}`);
  const l = Object.keys(lines ?? {})
    .sort()
    .map((id) => `${id}:${part(lines![id].length, (i) => lines![id][i].x1 + lines![id][i].y2)}`);
  return `t[${t.join(',')}]l[${l.join(',')}]`;
}
