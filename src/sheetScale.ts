import type { Segment } from './fill/vectors';
import type { Units } from './model';
import type { PageText } from './pageText';
import { dimensionVotes, type DimensionVote } from './scaleCheck';
import { findScaleHints, parseScale, SCALE_PRESETS } from './units';

/** An axis-aligned box on the sheet: [x0, y0, x1, y1]. */
type Box = [number, number, number, number];

/** A run of text, or several read together as one line. */
interface Chunk {
  runs: PageText[];
  str: string;
  box: Box;
  /** Capital height. */
  h: number;
}

const boxOf = (runs: PageText[]): Box => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of runs) {
    const vertical = t.angle !== undefined && Math.abs(Math.sin(t.angle)) > 0.7;
    const [hw, hh] = vertical ? [t.h / 2, t.w / 2] : [t.w / 2, t.h / 2];
    x0 = Math.min(x0, t.cx - hw);
    x1 = Math.max(x1, t.cx + hw);
    y0 = Math.min(y0, t.cy - hh);
    y1 = Math.max(y1, t.cy + hh);
  }
  return [x0, y0, x1, y1];
};

/** Gap between two boxes (0 when they touch or overlap). */
const boxGap = (a: Box, b: Box) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));

/**
 * The page's text read as lines: runs on one baseline (same direction, same offset across it)
 * with no more than a couple of letter heights between them are one line, so a note split into
 * pieces ("1/8"" "=" "1'-0"") reads whole.
 */
export function textLinesOf(texts: PageText[]): Chunk[] {
  const groups = new Map<number, PageText[]>();
  for (const t of texts) {
    const k = Math.round((t.angle ?? 0) / 0.05);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const out: Chunk[] = [];
  for (const [k, list] of groups) {
    const a = k * 0.05;
    const [ux, uy] = [Math.cos(a), Math.sin(a)];
    const across = (t: PageText) => t.cx * -uy + t.cy * ux;
    const along = (t: PageText) => t.cx * ux + t.cy * uy;
    const sorted = [...list].sort((p, q) => across(p) - across(q));
    const rows: PageText[][] = [];
    for (const t of sorted) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(across(t) - across(row[0])) <= Math.max(0.5, Math.min(t.h, row[0].h) * 0.5)) row.push(t);
      else rows.push([t]);
    }
    for (const row of rows) {
      row.sort((p, q) => along(p) - along(q));
      let chunk: PageText[] = [];
      let end = -Infinity;
      const flush = () => {
        if (chunk.length) out.push({ runs: chunk, str: chunk.map((t) => t.str).join(' '), box: boxOf(chunk), h: Math.max(...chunk.map((t) => t.h)) });
        chunk = [];
      };
      for (const t of row) {
        const start = along(t) - t.w / 2;
        if (chunk.length && start - end > Math.max(t.h, chunk[chunk.length - 1].h) * 2) flush();
        chunk.push(t);
        end = Math.max(end, along(t) + t.w / 2);
      }
      flush();
    }
  }
  return out;
}

/** A scale noted on the sheet and where. */
export interface ScaleNote {
  label: string;
  box: Box;
  h: number;
}

/** A paper size and a real size written side by side with no "=" between ("3/16"" "1'-0"": the sign drawn as linework). */
const PAPER = /^(?:1\s+)?\d+\/\d+"$|^\d+"$/;
const REAL = /^\d+'(?:\s*-\s*0")?$/;

/** Every scale note on the sheet ("SCALE: 1/8" = 1'-0"", "1:100"), each with the place it is written. */
export function scaleNotes(texts: PageText[], lines = textLinesOf(texts)): ScaleNote[] {
  const out: ScaleNote[] = [];
  for (const c of lines) {
    const labels = findScaleHints(c.str);
    for (const label of labels) {
      // The fewest runs of the line that still read as this scale.
      let best: PageText[] = c.runs;
      for (let i = 0; i < c.runs.length; i++)
        for (let j = i; j < c.runs.length && j - i < best.length - 1; j++) {
          const part = c.runs.slice(i, j + 1);
          if (findScaleHints(part.map((t) => t.str).join(' ')).includes(label)) {
            best = part;
            break;
          }
        }
      out.push({ label, box: boxOf(best), h: Math.max(...best.map((t) => t.h)) });
    }
    for (let i = 0; i + 1 < c.runs.length; i++) {
      const [a, b] = [c.runs[i], c.runs[i + 1]];
      if (!PAPER.test(a.str) || !REAL.test(b.str)) continue;
      for (const label of findScaleHints(`${a.str} = ${b.str}`)) if (!labels.includes(label)) out.push({ label, box: boxOf([a, b]), h: Math.max(a.h, b.h) });
    }
  }
  return out;
}

/** The scales noted on a sheet, in the order `findScaleHints` gives them (metric by ratio, then imperial). */
export function scaleHintsOf(texts: PageText[], notes = scaleNotes(texts)): string[] {
  const all = new Set([...findScaleHints(texts.map((t) => t.str).join(' ')), ...notes.map((n) => n.label)]);
  const metric = [...all].filter((l) => /^1:/.test(l)).sort((x, y) => Number(x.slice(2)) - Number(y.slice(2)));
  return [...metric, ...SCALE_PRESETS.imperial.filter((l) => all.has(l))];
}

const VIEW_WORDS = /\b(PLANS?|RCP|ELEVATIONS?|SECTIONS?|DETAILS?|SCHEDULES?|LEGENDS?|ASSEMBL\w*|TYPES)\b/i;
const NOT_A_TITLE = /^(SEE|REFER|NOTE|NOTES|ALL|PROVIDE|PLAN NORTH|TRUE NORTH|KEY PLAN)\b/i;
/** A callout key in the title block ("A - DETAIL NO.", "DETAIL NO. ORIGIN"), not a drawing's title. */
const CALLOUT_KEY = /\bNO\.(\s|$)|\bORIGIN\b|\bSHEET NO\b/i;

/** A drawing title on the sheet: a line naming a view (a plan, elevation, section, detail, schedule, legend). */
export interface DrawingTitle {
  str: string;
  box: Box;
  h: number;
}

/** The sheet's drawing titles, biggest first. */
export function drawingTitles(texts: PageText[], lines = textLinesOf(texts)): DrawingTitle[] {
  const out: DrawingTitle[] = [];
  for (const c of lines) {
    // The title is its biggest run(s) of words: a scale or a note beside it in smaller print is not, nor
    // the drawing's number in its bubble beside it (often bigger than the title).
    const worded = c.runs.filter((t) => /[A-Z]{2}/i.test(t.str));
    const h = worded.length ? Math.max(...worded.map((t) => t.h)) : c.h;
    const big = (worded.length ? worded : c.runs).filter((t) => t.h >= h * 0.9);
    const str = big.map((t) => t.str).join(' ').trim();
    if (str.length < 4 || str.length > 80 || !VIEW_WORDS.test(str) || NOT_A_TITLE.test(str) || CALLOUT_KEY.test(str) || /[:.]$/.test(str)) continue;
    out.push({ str, box: boxOf(big), h });
  }
  return out.sort((a, b) => b.h - a.h);
}

/**
 * A sheet's title when its title block gave none: its most prominent drawing title (the
 * biggest text naming a plan, elevation, section, schedule or legend), the way an estimator
 * reads a sheet with no title block text.
 */
export function viewTitle(texts: { str: string; h: number; cx?: number; cy?: number; w?: number; angle?: number }[]): string | null {
  // Any direction: a title block's title often runs up the sheet's edge.
  // A title, not a note: no sentence ("Revise vent location on the roof plan.") or caption ("DETAIL NO.").
  let c = texts.filter((t) => {
    const str = t.str.trim();
    return str.length >= 4 && str.length <= 80 && VIEW_WORDS.test(str) && !/^(SEE|REFER|NOTE|ALL|PROVIDE)\b/i.test(str) && !CALLOUT_KEY.test(str) && !/[:.]$/.test(str) && str.split(/\s+/).length <= 10;
  });
  if (!c.length) return null;
  // A key plan, legend or notes is never what the sheet is of while a drawing title is there (a
  // key plan's title is often the biggest on a sheet of enlarged plans).
  const drawings = c.filter((t) => !/\b(KEY PLAN|LEGEND|NOTES|ABBREVIATIONS|SYMBOLS)\b/i.test(t.str));
  if (drawings.length) c = drawings;
  const top = Math.max(...c.map((t) => t.h));
  // Titles as big as each other (a plan and the legend drawn beside it): the sheet is the plan's.
  const biggest = c.filter((t) => t.h >= top * 0.98);
  const pick = biggest.find((t) => /\b(PLANS?|RCP)\b/i.test(t.str) && !/\b(LEGEND|SYMBOLS|NOTES|SCHEDULE|KEY PLAN)\b/i.test(t.str)) ?? biggest[0];
  return stackedTitle(pick, texts);
}

/**
 * A title set over two or three lines in a title block ("LEVEL 1 (LOWER) DEMO" over "PLAN"),
 * whole: the lines just above it in the same size and alignment are read with it. A line further
 * up than a line and a half is another block (the project's address).
 */
function stackedTitle(t: { str: string; h: number; cx?: number; cy?: number; w?: number; angle?: number }, all: { str: string; h: number; cx?: number; cy?: number; w?: number; angle?: number }[]): string {
  if (t.cx === undefined || t.cy === undefined || t.w === undefined || Math.abs(Math.sin(t.angle ?? 0)) > 0.2) return t.str.trim();
  // A line: the runs on its baseline joined to it with gaps of a couple of letters at most (not a title beside it).
  const lineOf = (x: typeof t) => {
    const row = all.filter((u) => u.cy !== undefined && u.cx !== undefined && u.w !== undefined && Math.abs(u.cy - x.cy!) < x.h * 0.4 && Math.abs(u.h - x.h) < x.h * 0.12 && Math.abs(Math.sin(u.angle ?? 0)) < 0.2);
    const line = [x];
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of row) {
        if (line.includes(u)) continue;
        const near = line.some((v) => Math.max(u.cx! - u.w! / 2 - (v.cx! + v.w! / 2), v.cx! - v.w! / 2 - (u.cx! + u.w! / 2)) < x.h * 2);
        if (near) {
          line.push(u);
          grew = true;
        }
      }
    }
    return line;
  };
  const leftOf = (line: typeof all) => Math.min(...line.map((u) => u.cx! - u.w! / 2));
  const textOf = (line: typeof all) => [...line].sort((a, b) => a.cx! - b.cx!).map((u) => u.str.trim()).join(' ');
  let line = lineOf(t);
  const parts = [textOf(line)];
  const x0 = leftOf(line);
  for (let i = 0; i < 2; i++) {
    const cy = line[0].cy!;
    const above = all.find(
      (u) =>
        u.cy !== undefined && u.cx !== undefined && u.w !== undefined &&
        Math.abs(u.h - t.h) < t.h * 0.12 &&
        cy - u.cy > t.h * 0.8 && cy - u.cy < t.h * 1.6 &&
        Math.abs(u.cx - u.w / 2 - x0) < t.h * 0.8 &&
        Math.abs(Math.sin(u.angle ?? 0)) < 0.2,
    );
    if (!above) break;
    line = lineOf(above);
    if (Math.abs(leftOf(line) - x0) > t.h * 0.8) break;
    const str = textOf(line);
    // A sentence or a caption is not part of a title.
    if (/[:.]$/.test(str) || str.length > 60) break;
    // A line that is a title of its own (a legend's, over the plan's) is not the start of this one.
    if (VIEW_WORDS.test(str)) break;
    parts.unshift(str);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Why a sheet got the scale it did. */
export interface SheetScalePick {
  label: string;
  why: string;
}

/** Dimension votes agreeing with a scale (within 2%). */
const support = (votes: DimensionVote[], label: string) => {
  const mpp = parseScale(label);
  return mpp ? votes.filter((v) => Math.abs(v.metersPerPoint / mpp - 1) < 0.02).length : 0;
};

const STOP = new Set(['THE', 'OF', 'AND', 'TO', 'AT', 'IN', 'ON', 'FOR']);
const wordsOf = (s: string) => new Set((s.toUpperCase().match(/[A-Z0-9]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w)));
/** A plan of the building, not a detail, section or elevation drawn beside it. */
const MAIN_VIEW = /\b(PLANS?|RCP)\b/i;
const SIDE_VIEW = /DETAIL|SECTION|ELEVATION|ENLARGED|KEY PLAN|PARTIAL|TYPICAL|DIAGRAM/i;

/**
 * The scale of a sheet noting several (a floor plan at 1/8" = 1'-0" with details at 1/2"): the
 * scale of its main drawing, as an estimator reads it. Each drawing's scale is noted beside its
 * title; the main drawing is the one the sheet is named for (its title is the sheet's title),
 * else the plan drawn on it (not a detail, section or elevation), else the drawing with the
 * biggest title. Where the dimension strings, measured against the lines they label, clearly
 * agree with another of the scales and not at all with that one, they decide. Null when nothing
 * tells.
 */
export function mainDrawingScale(candidates: string[], texts: PageText[], segs: Segment[] | null, units: Units, sheetTitle?: string): SheetScalePick | null {
  if (candidates.length < 2) return candidates.length ? { label: candidates[0], why: 'the only scale noted' } : null;
  const lines = textLinesOf(texts);
  const notes = scaleNotes(texts, lines).filter((n) => candidates.includes(n.label));
  // Each drawing title with the scale noted nearest it (under it or beside it).
  const titled = drawingTitles(texts, lines)
    .map((t) => {
      const near = notes.map((n) => ({ n, d: boxGap(n.box, t.box) })).sort((x, y) => x.d - y.d)[0];
      return near && near.d <= Math.max(t.h, near.n.h) * 6 ? { t, label: near.n.label } : null;
    })
    .filter((x): x is { t: DrawingTitle; label: string } => !!x);
  const one = (list: { label: string }[]) => (list.length && list.every((x) => x.label === list[0].label) ? list[0].label : null);
  let pick: SheetScalePick | null = null;
  // The drawing the sheet is named for.
  const named = sheetTitle ? wordsOf(sheetTitle) : new Set<string>();
  if (named.size) {
    const share = (t: DrawingTitle) => {
      const w = wordsOf(t.str);
      return w.size ? [...w].filter((x) => named.has(x)).length / w.size : 0;
    };
    const ranked = titled.map((x) => ({ ...x, share: share(x.t) })).filter((x) => x.share >= 0.5);
    const top = Math.max(0, ...ranked.map((x) => x.share));
    const label = one(ranked.filter((x) => x.share >= top - 1e-9));
    if (label) pick = { label, why: 'noted under the drawing the sheet is titled for' };
  }
  if (!pick) {
    const label = one(titled.filter((x) => MAIN_VIEW.test(x.t.str) && !SIDE_VIEW.test(x.t.str)));
    if (label) pick = { label, why: 'noted under the plan on the sheet' };
  }
  if (!pick && titled.length) {
    const top = titled.reduce((m, x) => Math.max(m, x.t.h), 0);
    const label = one(titled.filter((x) => x.t.h >= top * 0.95));
    if (label) pick = { label, why: 'noted under the biggest drawing title' };
  }
  // The dimensions: they overrule the titles only when they clearly agree on another scale.
  const votes = segs ? [dimensionVotes(texts, segs, units), dimensionVotes(texts, segs, units === 'metric' ? 'imperial' : 'metric')].flatMap((r) => r.votes) : [];
  const byDims = candidates.map((label) => ({ label, n: support(votes, label) })).sort((x, y) => y.n - x.n);
  const dims = byDims[0];
  const clear = dims.n >= 5 && byDims[1].n * 3 <= dims.n;
  if (clear && (!pick || support(votes, pick.label) === 0)) return { label: dims.label, why: `the dimensions agree on it (${dims.n})` };
  return pick;
}
