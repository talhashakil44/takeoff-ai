import { get, set } from 'idb-keyval';
import type { Project, Sheet } from '../model';
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

const CACHE_VERSION = 1;

/** Sheets whose linework the model reads: building elevations and sections (window elevations included). */
/**
 * Sheets whose linework the model reads: exterior elevations and building sections (façades,
 * roof), and plans with counted doors (the swing arcs and wall openings the doors are hosted in).
 */
export const needsLines = (s: Pick<Sheet, 'title'> & { id?: string }, doors?: Set<string>) =>
  (/ELEVATION|BUILDING SECTION/i.test(s.title ?? '') && !/INTERIOR|DETAIL/i.test(s.title ?? '')) || (!!s.id && !!doors?.has(s.id));

/** Sheets with door counts: by the door takeoff (source doors) or on a Doors count type. */
export function doorSheets(project: Pick<Project, 'measurements'> & { types?: Project['types'] }): Set<string> {
  const doorTypes = new Set((project.types ?? []).filter((t) => t.kind === 'count' && /^doors?\b/i.test(t.name)).map((t) => t.id));
  return new Set(project.measurements.filter((m) => m.source === 'doors' || doorTypes.has(m.typeId)).map((m) => m.sheetId));
}

/**
 * Sheets whose text the model reads: plans (levels, grids), elevations and sections (datums,
 * roof, façades), window schedules, and every sheet that has a takeoff (its title block names
 * its level), and untitled sheets (their title block may name a level). Cover sheets, notes,
 * assembly types and details are not read: the model and the plan come out the same without them.
 */
export const needsText = (s: Pick<Sheet, 'id' | 'title'>, measured: Set<string>) =>
  measured.has(s.id) || needsLines(s) || !(s.title ?? '').trim() || /PLAN|ELEVATION|SECTION|SCHEDULE/i.test(s.title ?? '');

/** Only what Build It uses of a line: its ends and whether it is a curve or dashed. */
export function slimLines(segs: Segment[]): Segment[] {
  return segs.map((l) => {
    const out: Segment = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: l.width, filled: l.filled };
    if (l.curve) out.curve = true;
    if (l.dashed) out.dashed = true;
    return out;
  });
}

export interface PackedLines {
  v: number;
  xy: Float64Array;
  /** Bit 0 filled, 1 curve, 2 dashed. */
  flags: Uint8Array;
  width: Float32Array;
}
export function packLines(segs: Segment[]): PackedLines {
  const xy = new Float64Array(segs.length * 4);
  const flags = new Uint8Array(segs.length);
  const width = new Float32Array(segs.length);
  segs.forEach((l, i) => {
    xy.set([l.x1, l.y1, l.x2, l.y2], i * 4);
    flags[i] = (l.filled ? 1 : 0) | (l.curve ? 2 : 0) | (l.dashed ? 4 : 0);
    width[i] = l.width;
  });
  return { v: CACHE_VERSION, xy, flags, width };
}
export function unpackLines(p: PackedLines): Segment[] {
  const out: Segment[] = new Array(p.flags.length);
  for (let i = 0; i < p.flags.length; i++) {
    const f = p.flags[i];
    const l: Segment = { x1: p.xy[i * 4], y1: p.xy[i * 4 + 1], x2: p.xy[i * 4 + 2], y2: p.xy[i * 4 + 3], width: p.width[i], filled: !!(f & 1) };
    if (f & 2) l.curve = true;
    if (f & 4) l.dashed = true;
    out[i] = l;
  }
  return out;
}

const textKey = (s: Pick<Sheet, 'docId' | 'page'>) => `bldsrc:t:${s.docId}:${s.page}`;
const lineKey = (s: Pick<Sheet, 'docId' | 'page'>) => `bldsrc:l:${s.docId}:${s.page}`;

export interface DrawingSources {
  texts: DrawingTexts;
  lines: DrawingLines;
  /** Title-block words of each sheet read, for sheets whose title doesn't name the level. */
  hints: Record<string, string>;
}

/**
 * Reads the drawing evidence for the sheets Build It needs, four at a time, from this
 * computer's cache where it was read before. A sheet that can't be read is left out.
 */
export async function loadDrawingSources(opts: {
  project: Pick<Project, 'sheets' | 'measurements'> & { types?: Project['types'] };
  sheetText: (sheetId: string) => Promise<DrawingText[]>;
  sheetLines?: (sheetId: string) => Promise<Segment[]>;
  titleWords: (texts: DrawingText[], width: number, height: number) => string;
  progress?: (done: number, of: number) => void;
  cancelled?: () => boolean;
  cache?: boolean;
}): Promise<DrawingSources> {
  const { project, sheetText, sheetLines, titleWords, progress, cancelled } = opts;
  const useCache = opts.cache !== false && typeof indexedDB !== 'undefined';
  const measured = new Set(project.measurements.map((m) => m.sheetId));
  const doors = doorSheets(project);
  const todo = project.sheets.filter((s) => !s.superseded && needsText(s, measured));
  const out: DrawingSources = { texts: {}, lines: {}, hints: {} };
  let done = 0;
  const one = async (s: Sheet) => {
    let texts = useCache ? await get<DrawingText[] | undefined>(textKey(s)).catch(() => undefined) : undefined;
    if (!texts) {
      const read = await sheetText(s.id).catch(() => null);
      if (read) {
        texts = read.map((t) => ({ str: t.str, cx: t.cx, cy: t.cy }));
        if (useCache && read.length) void set(textKey(s), texts).catch(() => undefined);
      }
    }
    out.texts[s.id] = texts ?? [];
    out.hints[s.id] = titleWords(out.texts[s.id], s.width, s.height);
    if (sheetLines && needsLines(s, doors)) {
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
  return out;
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
