import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { ringArea } from '../geometry';
import { SegmentIndex } from '../walls/bands';
import { dedupe, symbolLoop } from '../walls/tags';
import { findGridHatch } from './hatchRegions';
import { isLegendHeading } from './autoSymbols';
import { readLegendRows } from './legend';
import { marksOf, type Mark } from './marks';
import { drawSegments, makeGrid, simplify, traceBoundary } from './raster';
import { buildWallModel, snapToLines } from './roomFill';
import { detectWallPens, penStats } from './walls';
import { findRoomLabels } from './rooms';
import { scaleNotes } from '../sheetScale';
import type { Segment } from './vectors';
import { findRoot, maxOf, minOf } from '../arrays';

/**
 * Ceilings by ceiling type, read off a reflected ceiling plan the way an estimator reads one:
 * each ceiling is the area the walls (or a ceiling change line) enclose, and its type is
 *  (a) the ceiling type tag drawn in it (c1, cx3, ACT-1, GWB-1: a short code, usually in a
 *      small closed symbol, often with the height beside it),
 *  (b) failing a tag, the legend swatch its pattern matches,
 *  (c) failing both, what is drawn in it: a lay-in grid, a stipple (gypsum), or nothing.
 * Types are described from the ceiling types table when the set has one (code, then its
 * description on the same row).
 */

type Box = [number, number, number, number];

/** What is drawn in a ceiling area. */
export type CeilingKind = 'grid' | 'stipple' | 'hatch' | 'plain';

export interface CeilingTag {
  /** As printed (cx3, ACT-1). */
  code: string;
  /** For grouping: lower case, no dash (cx3, act1). */
  key: string;
  /** Centre of the tag. */
  at: Pt;
  /** The symbol round it (or the text's own box when it has none). */
  box: Box;
  /** The ceiling height printed with it, e.g. 8'-6". */
  height?: string;
  /** Tagged "above": a ceiling above the one seen (it does not type the area). */
  above?: boolean;
}

export interface CeilingDef {
  code: string;
  key: string;
  description: string;
  at: Pt;
}

export interface CeilingArea {
  points: Pt[];
  holes: Pt[][];
  /** In square sheet points, holes taken out. */
  area: number;
  /** The ceiling type code, when tagged (or carried from a tagged part of the same ceiling). */
  code: string | null;
  /** The legend row's label, for an area typed by the legend. */
  legend?: string;
  source: 'tag' | 'legend' | 'fallback';
  kind: CeilingKind;
  /** Heights tagged in it. */
  height?: string;
  /** Room numbers and names inside it. */
  room?: string;
}

export interface CeilingSheetRead {
  /** False when the sheet has no ceiling type tags: the areas are then the ceiling grid's (legacy reading). */
  tagged: boolean;
  areas: CeilingArea[];
  tags: CeilingTag[];
  defs: CeilingDef[];
  legend: { label: string; kind: CeilingKind }[];
}

/** A short type code: c1, cx3, ACT-1, GWB2, C-1A, C-X1 (existing). */
const CODE = /^([A-Za-z]{1,4})-?([Xx]?\d{1,3}[A-Za-z]?)$/;
/** A code as printed, with brackets round it taken off: "(CA1)" is CA1. */
const bare = (s: string) => s.trim().replace(/^\((.+)\)$|^\[(.+)\]$/, '$1$2');
/** A material abbreviation used as a ceiling code where a legend lists it (GYP, EXP, ACT, MS). */
const LETTERS = /^[A-Z]{2,4}$/;
/** Code prefixes ceiling types go by (an x after them for existing: cx, actx). */
const CEILING_PREFIX = /^(?:c|cl|clg|cg|ceil|act|acp|apc|acl|at|ec|gwb|gb|gyp|lap|sat|sc|t)x?$/i;
const HEIGHT = /^(?:\+\/-\s*|±\s*)?\+?\d{1,2}'\s*-?\s*\d{1,2}(?:\s+\d{1,2}\/\d{1,2})?"?(?:\s*a\.?f\.?f\.?)?$|^(?:\+\/-\s*|±\s*)?\+?\d,?\d{3}\s*(?:mm)?(?:\s*a\.?f\.?f\.?)?$/i;
/** A legend row about a ceiling finish (not a diffuser or a light drawn as a box). */
const CEILING_WORDS = /ceiling|\bclg\b|tile|panel|board|gypsum|\bgyp|\bgwb\b|\bact\b|lay-?in|acoustic|plaster|bulkhead|soffit|t-bar|suspended|drywall/i;
const ABOVE = /^(?:above|abv\.?|\(above\))$/i;
/** A note marking a space with no ceiling: open to below or above, a shaft. */
const OPEN_SPACE = /\bopen\s+(?:to|into)\s+(?:below|above|level|floor)|^open\s+(?:above|below)\b|^no\s+ceiling\b|^open\s+shaft\b/i;

export const codeKey = (s: string) => s.replace(/-/g, '').toLowerCase();

/** Text runs drawn twice over (some exports do) count once. */
function uniqueTexts(texts: PageText[]): PageText[] {
  const seen = new Set<string>();
  return texts.filter((t) => {
    const k = `${t.str}|${Math.round(t.cx)}|${Math.round(t.cy)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const upright = (t: PageText) => !t.angle || Math.abs(t.angle) < 0.1;

/**
 * A ceiling types table: a column of type codes, one per row (at least three, lined up one
 * above the other), with each code's description to its right. The description is the
 * nearest column of the row with real text in it (a section drawing's labels are short),
 * its first line or lines up to a colon.
 */
export function readCeilingDefs(input: PageText[], segs: Segment[] = []): { defs: CeilingDef[]; box: Box | null } {
  const texts = uniqueTexts(input).filter(upright);
  const codes = texts.filter((t) => CODE.test(t.str) || LETTERS.test(t.str));
  const used = new Set<PageText>();
  const defs: CeilingDef[] = [];
  const boxes: Box[] = [];
  // Candidate code columns, longest first: a table's own column of codes, then (left out once
  // inside a table found) any codes its section drawings carry.
  const columns: PageText[][] = [];
  for (const c of codes) {
    if (used.has(c)) continue;
    const column = codes.filter((o) => Math.abs(o.cx - c.cx) <= 3).sort((a, b) => a.cy - b.cy);
    column.forEach((o) => used.add(o));
    columns.push(column);
  }
  columns.sort((a, b) => b.length - a.length);
  const tables: Box[] = [];
  for (const column of columns) {
    const c = column[0];
    if (column.some((o) => tables.some(([a, b, x, y]) => o.cx >= a && o.cx <= x && o.cy >= b && o.cy <= y))) continue;
    // Rows: far enough apart to be table rows, not a label's lines.
    const rows = column.filter((o, i) => i === 0 || o.cy - column[i - 1].cy > 2 * o.h);
    if (new Set(rows.map((r) => codeKey(r.str))).size < 3) continue;
    // A column of letters only (GYP, EXP, MS: materials abbreviated) is a ceiling table only
    // under a ceiling heading, and its descriptions can be a couple of words.
    // Codes and words mixed (C-1, C-2, EX, OPEN) likewise.
    const lettered = rows.some((r) => !CODE.test(r.str));
    const pitch = rows.length > 1 ? (rows[rows.length - 1].cy - rows[0].cy) / (rows.length - 1) : 50;
    const headedAbove = texts.some((t) => /ceiling.*(type|schedule|assembl|legend|material)|(type|schedule|assembl|legend|material).*ceiling|\bclg\b/i.test(t.str) && t.cy < rows[0].cy && t.cy > rows[0].cy - 3 * pitch && t.cx + t.w / 2 > rows[0].cx - 40 && t.cx - t.w / 2 < rows[0].cx + 400);
    if (lettered && !headedAbove) continue;
    // The table's rules across the code column, when drawn, bound the rows: lines running on
    // across the descriptions, not the box drawn round each code.
    const rules = segs
      .filter((sg) => Math.abs(sg.y1 - sg.y2) < 0.3 && Math.min(sg.x1, sg.x2) < c.cx - c.w / 2 - 1 && Math.max(sg.x1, sg.x2) > c.cx + c.w / 2 + 1)
      .filter((sg) => Math.max(sg.x1, sg.x2) > c.cx + c.w / 2 + Math.max(20, 4 * c.h) || !column.some((o) => Math.abs(o.cy - sg.y1) < 1.3 * o.h))
      .map((sg) => sg.y1)
      .sort((a, b) => a - b);
    const found = rows.map((r, i) => {
      const gapUp = i > 0 ? r.cy - rows[i - 1].cy : rows[i + 1].cy - r.cy;
      const gapDown = i < rows.length - 1 ? rows[i + 1].cy - r.cy : gapUp;
      const above = rules.filter((y) => y < r.cy - r.h && y > r.cy - gapUp).pop();
      const below = rules.find((y) => y > r.cy + r.h && y < r.cy + gapDown);
      const top = above ?? r.cy - gapUp / 2;
      const bottom = below ?? r.cy + gapDown / 2;
      const right = texts.filter((t) => t !== r && t.cx - t.w / 2 > r.cx + r.w / 2 + 2 && t.cy >= top && t.cy <= bottom);
      // Columns by left edge, nearest first.
      const cols: PageText[][] = [];
      for (const t of [...right].sort((a, b) => a.cx - a.w / 2 - (b.cx - b.w / 2))) {
        const col = cols.find((k) => Math.abs(k[0].cx - k[0].w / 2 - (t.cx - t.w / 2)) <= 6);
        if (col) col.push(t);
        else cols.push([t]);
      }
      const desc = cols.find((k) => k.reduce((n, t) => n + t.str.length, 0) >= (lettered ? 6 : 20))?.sort((a, b) => a.cy - b.cy) ?? null;
      return { r, top, bottom, desc };
    });
    // A table: one row per code, nearly every row described, the descriptions in one column.
    if (new Set(rows.map((r) => codeKey(r.str))).size !== rows.length) continue;
    const described = found.filter((f) => f.desc);
    if (described.length < Math.max(3, rows.length * 0.75)) continue;
    const lefts = described.map((f) => Math.min(...f.desc!.map((t) => t.cx - t.w / 2))).sort((a, b) => a - b);
    const mid = lefts[Math.floor(lefts.length / 2)];
    if (lefts.filter((l) => Math.abs(l - mid) <= 6).length < described.length * 0.75) continue;
    // Ceiling types: headed so, or coded so.
    const first = rows[0];
    const span = rows.length > 1 ? (rows[rows.length - 1].cy - first.cy) / (rows.length - 1) : 50;
    const headed = texts.some((t) => /ceiling.*(type|schedule|assembl|legend)|(type|schedule|assembl|legend).*ceiling|\bclg\b/i.test(t.str) && t.cy < first.cy && t.cy > first.cy - 3 * span && t.cx + t.w / 2 > first.cx - 40 && t.cx - t.w / 2 < mid + 400);
    const prefixed = rows.filter((r) => CEILING_PREFIX.test(CODE.exec(r.str)?.[1] ?? '')).length >= rows.length * 0.75;
    if (!headed && !prefixed) continue;
    const before = boxes.length;
    for (const { r, top, bottom, desc: first } of found) {
      // The description column's text (a short one too, "Reserved"), not a column further on.
      const desc = texts
        .filter((t) => t.cy >= top && t.cy <= bottom && Math.abs(t.cx - t.w / 2 - mid) <= 8)
        .sort((a, b) => a.cy - b.cy);
      void first;
      let description = '';
      if (desc.length) {
        const title: string[] = [];
        for (const l of desc) {
          title.push(l.str);
          if (/:\s*$/.test(l.str) || title.length >= 3) break;
        }
        description = /:\s*$/.test(title[title.length - 1]) || title.length < 3 ? title.join(' ') : desc[0].str;
        description = description.replace(/\s+/g, ' ').replace(/:\s*$/, '').trim();
        const xs = [r.cx - r.w / 2, ...desc.map((l) => l.cx + l.w / 2)];
        boxes.push([Math.min(...xs), top, Math.max(...xs), bottom]);
      } else boxes.push([r.cx - r.w, top, r.cx + r.w, bottom]);
      defs.push({ code: r.str, key: codeKey(r.str), description, at: [r.cx, r.cy] });
    }
    const mine = boxes.slice(before);
    tables.push([Math.min(...mine.map((b) => b[0])), Math.min(...mine.map((b) => b[1])), Math.max(...mine.map((b) => b[2])), Math.max(...mine.map((b) => b[3]))]);
  }
  const box: Box | null = boxes.length
    ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
    : null;
  return { defs, box };
}

/**
 * Ink that does not bound a ceiling: white (the masks drawn behind lettering and symbols) and
 * light grey linework in a fine pen, the screened background an RCP draws over (the structure
 * above, existing joists, the floor plan shown faintly). Walls and bulkheads are drawn dark or
 * heavy; a mid grey (walls filled grey) is kept.
 */
export function backgroundInk(s: Segment): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.color ?? '');
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  if (Math.max(r, g, b) - Math.min(r, g, b) > 24) return false;
  const v = (r + g + b) / 3;
  if (v >= 250) return s.filled;
  // Grey fills are kept: walls are often filled grey (poché) with no outline.
  return v >= 140 && !s.filled && s.width < 1;
}

/**
 * Lines drawn dashed by hand: short pieces of one pen on one line (any direction) with gaps
 * between them (CAD exports often explode a dashed line into its dashes). Four in a row at least.
 */
export function explodedDashes(segs: Segment[]): Set<Segment> {
  const out = new Set<Segment>();
  // Pieces by pen and direction (to 6°), then by the line they lie on, measured along the
  // group's own mean direction.
  const byDir = new Map<string, { s: Segment; ang: number }[]>();
  for (const s of segs) {
    if (s.filled || s.curve) continue;
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (L < 0.3 || L > 14) continue;
    let ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    if (Math.abs(s.y2 - s.y1) <= 0.05) ang = 0;
    else if (Math.abs(s.x2 - s.x1) <= 0.05) ang = Math.PI / 2;
    const bucket = Math.round((ang * 180) / Math.PI / 6) % 30;
    const key = `${bucket}|${s.width}|${s.color ?? ''}`;
    (byDir.get(key) ?? byDir.set(key, []).get(key)!).push({ s, ang: bucket === 0 && ang > Math.PI / 2 ? ang - Math.PI : ang });
  }
  const groups: { s: Segment; off: number; a: number; b: number }[][] = [];
  for (const list of byDir.values()) {
    if (list.length < 4) continue;
    const th = list.reduce((n, p) => n + p.ang, 0) / list.length;
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    groups.push(
      list.map(({ s }) => {
        const t1 = s.x1 * ux + s.y1 * uy;
        const t2 = s.x2 * ux + s.y2 * uy;
        return { s, off: ((s.x1 + s.x2) / 2) * -uy + ((s.y1 + s.y2) / 2) * ux, a: Math.min(t1, t2), b: Math.max(t1, t2) };
      }),
    );
  }
  for (const all of groups) {
    if (all.length < 4) continue;
    all.sort((p, q) => p.off - q.off);
    // Lines: pieces whose offsets lie within a quarter point of the last (a slanted line's
    // pieces drift a little off the bucket's direction, so offsets are chained, not binned).
    const lines: (typeof all)[] = [];
    for (const p of all) {
      let line: typeof all | undefined;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 12; k--) {
        const l = lines[k];
        if (Math.abs(l[l.length - 1].off - p.off) <= 0.25 && Math.abs(l[0].off - p.off) <= 1.5) {
          line = l;
          break;
        }
      }
      if (line) line.push(p);
      else lines.push([p]);
    }
    for (const pieces of lines) {
      if (pieces.length < 4) continue;
      pieces.sort((p, q) => p.a - q.a);
      let run: typeof pieces = [pieces[0]];
      const flush = () => {
        if (run.length >= 4) for (const p of run) out.add(p.s);
      };
      for (let i = 1; i < pieces.length; i++) {
        const gap = pieces[i].a - run[run.length - 1].b;
        if (gap >= 0.5 && gap <= 12) run.push(pieces[i]);
        else {
          flush();
          run = [pieces[i]];
        }
      }
      flush();
    }
  }
  return out;
}

/**
 * Lines closing the door and window openings in the walls (the floor plan's wall model), not
 * the gaps between light fixtures or other small drawn shapes the model can take for walls on
 * a ceiling plan: an opening's sides are walls, not a fixture's outline.
 */
function wallBridges(segs: Segment[], mpp: number): Segment[] {
  // Doorways: up to a pair of doors wide.
  const bridges = buildWallModel(segs, mpp).lines.filter((s) => s.bridge && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) <= 2 / mpp);
  if (!bridges.length) return [];
  const small = 1.6 / mpp;
  const boxes = new Map<number, Box>();
  for (const s of segs) {
    if (s.sub === undefined) continue;
    const b = boxes.get(s.sub);
    if (!b) boxes.set(s.sub, [Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)]);
    else {
      b[0] = Math.min(b[0], s.x1, s.x2);
      b[1] = Math.min(b[1], s.y1, s.y2);
      b[2] = Math.max(b[2], s.x1, s.x2);
      b[3] = Math.max(b[3], s.y1, s.y2);
    }
  }
  const shapes = [...boxes.values()].filter((b) => b[2] - b[0] <= small && b[3] - b[1] <= small && b[2] - b[0] > 0.5 && b[3] - b[1] > 0.5);
  const index = new SegmentIndex(shapes.map(([a, b, c, d]) => ({ x1: a, y1: b, x2: c, y2: d, width: 0, filled: false })), 32);
  const onShape = (x: number, y: number) => index.query(x - 0.6, y - 0.6, x + 0.6, y + 0.6).some((i) => {
    const [a, b, c, d] = shapes[i];
    return x >= a - 0.6 && x <= c + 0.6 && y >= b - 0.6 && y <= d + 0.6;
  });
  return bridges.filter((s) => !onShape(s.x1, s.y1) && !onShape(s.x2, s.y2));
}

/** A ceiling note: one saying to put up (or finish) a ceiling, not a fixture or a reference. */
const CEILING_NOTE = /ceiling|\bclg\b|soffit|bulkhead/i;
const NOT_A_CEILING_NOTE = /\b(light|fixture|diffuser|grille|sprinkler|speaker|detector|access panel|refer to (mech|elec))/i;

export interface CeilingNotes {
  /** Each ceiling note's number as code, the note as description. */
  defs: CeilingDef[];
  /** The height the note numbers are printed at: the same keynotes on the plan match it. */
  h: number;
  /** The notes' block on the sheet (its numbers are not tags). */
  box: Box | null;
}

/**
 * Numbered notes about ceilings (an RCP's keynotes: "1  Install new 4'x2' T-bar acoustic tile
 * ceiling", "3  Install new gypsum board ceiling"): a column of note numbers, each with its
 * note running to its right (wrapped lines joined). A plan that marks each ceiling with the
 * number of its note in a keynote symbol types its ceilings that way.
 */
export function readCeilingNotes(input: PageText[]): CeilingNotes {
  const texts = uniqueTexts(input).filter(upright);
  const numbers = texts.filter((t) => /^\d{1,2}\.?$/.test(t.str.trim()));
  const firstWords = (t: PageText) =>
    texts
      .filter((o) => o !== t && Math.abs(o.cy - t.cy) < 1.2 * Math.max(o.h, t.h) && o.cx - o.w / 2 > t.cx + t.w / 2 && o.cx - o.w / 2 - (t.cx + t.w / 2) < 6 * t.h && /[A-Za-z]{3}/.test(o.str))
      .sort((a, b) => a.cx - b.cx)[0];
  const items = numbers.map((n) => ({ n, first: firstWords(n) })).filter((x) => x.first && x.first.str.length >= 12);
  // The list: numbers in one column, their notes starting at one left edge.
  let best: typeof items = [];
  for (const it of items) {
    const col = items.filter((o) => Math.abs(o.n.cx - it.n.cx) <= 2 && Math.abs(o.first!.cx - o.first!.w / 2 - (it.first!.cx - it.first!.w / 2)) <= 4).sort((a, b) => a.n.cy - b.n.cy);
    if (col.length > best.length) best = col;
  }
  if (best.length < 3) return { defs: [], h: 0, box: null };
  const left = best[0].first!.cx - best[0].first!.w / 2;
  const defs: CeilingDef[] = [];
  let x1 = 0;
  best.forEach((it, i) => {
    const next = best[i + 1]?.n.cy ?? it.n.cy + 3 * it.n.h;
    const lines = texts
      .filter((t) => t.cy >= it.n.cy - 1.3 * it.n.h && t.cy < next - 1.3 * it.n.h && t.cx - t.w / 2 >= left - 3 * it.n.h && t.cx - t.w / 2 <= left + 2 && /[A-Za-z]/.test(t.str))
      .sort((a, b) => a.cy - b.cy);
    const note = lines.map((l) => l.str).join(' ').replace(/\s+/g, ' ').trim();
    x1 = Math.max(x1, ...lines.map((l) => l.cx + l.w / 2));
    // A note saying what ceiling to build or finish, not a general note about all of them.
    if (!CEILING_NOTE.test(note) || NOT_A_CEILING_NOTE.test(note) || !/\b(install|new|provide|construct|replace|paint|finish)/i.test(note) || /^(all|where|refer|the|contractor|verify|coordinate|confirm|finished ceiling heights?)\b/i.test(note) || /unless (noted|otherwise)|\bu\.?n\.?o\b/i.test(note)) return;
    const code = it.n.str.trim().replace(/\.$/, '');
    // A note 0, or a symbol legend's pointers to other sheets ("See A000 series Sheets … See Sheet A501"), is no ceiling note.
    if (/^0+$/.test(code) || (note.match(/\bsee\b/gi)?.length ?? 0) >= 2) return;
    defs.push({ code, key: code, description: note.replace(/\s*(to height shown on r\.?c\.?p\.?|refer to .*)$/i, '').replace(/[.;,]\s*$/, ''), at: [it.n.cx, it.n.cy] });
  });
  const h = best[0].n.h;
  const box: Box = [best[0].n.cx - 3 * h, best[0].n.cy - 2 * h, x1, best[best.length - 1].n.cy + 3 * h];
  return { defs, h, box };
}

/**
 * The linework without its screened background: light grey fine lines that run across the
 * dark linework (joists, ducts and the structure drawn over the rooms). Light grey lines that
 * stop at the walls (windows, a screened partition) still bound a ceiling.
 */
function withoutBackground(lines: Segment[]): Segment[] {
  const grey = lines.filter(backgroundInk);
  if (!grey.length) return lines;
  const dark = lines.filter((s) => !backgroundInk(s) && !s.filled);
  const index = new SegmentIndex(dark, 32);
  const crosses = (g: Segment) => {
    const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    if (L < 2) return false;
    for (const i of index.query(Math.min(g.x1, g.x2), Math.min(g.y1, g.y2), Math.max(g.x1, g.x2), Math.max(g.y1, g.y2))) {
      const d = dark[i];
      const dx = d.x2 - d.x1;
      const dy = d.y2 - d.y1;
      const ex = g.x2 - g.x1;
      const ey = g.y2 - g.y1;
      const den = ex * dy - ey * dx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((d.x1 - g.x1) * dy - (d.y1 - g.y1) * dx) / den;
      const u = ((d.x1 - g.x1) * ey - (d.y1 - g.y1) * ex) / den;
      const Ld = Math.hypot(dx, dy);
      // Through the dark line, not ending on it.
      if (t * L > 1 && (1 - t) * L > 1 && u * Ld > 0.5 && (1 - u) * Ld > 0.5) return true;
    }
    return false;
  };
  const drop = new Set(grey.filter(crosses));
  return lines.filter((s) => !drop.has(s));
}

/**
 * The column grid's bubbles: a grid label (A, 7, Ka, 12a) in a circle with a long straight
 * line, the grid line, running off it. They stand outside the building.
 */
export function gridBubbles(texts: PageText[], segs: Segment[]): { at: Pt; r: number }[] {
  const curves = segs.filter((sg) => sg.curve && !sg.filled);
  if (!curves.length) return [];
  const curveIndex = new SegmentIndex(curves, 16);
  const straight = segs.filter((sg) => !sg.curve && !sg.filled && (Math.abs(sg.x1 - sg.x2) < 0.3 || Math.abs(sg.y1 - sg.y2) < 0.3));
  const lineIndex = new SegmentIndex(straight, 32);
  const out: { at: Pt; r: number }[] = [];
  for (const t of texts) {
    if (!/^(?:[A-Z]{1,2}\d?|\d{1,2}[A-Za-z]?|[A-Z]\.\d)$/.test(t.str.trim()) || !upright(t)) continue;
    const R = 5 * t.h;
    const near = curveIndex.query(t.cx - R, t.cy - R, t.cx + R, t.cy + R).map((i) => curves[i]);
    // The circle: curved pieces all about one distance from a centre near the label.
    const pts = near.flatMap((sg) => [[sg.x1, sg.y1], [sg.x2, sg.y2]] as Pt[]).filter(([x, y]) => Math.hypot(x - t.cx, y - t.cy) <= R);
    if (pts.length < 6) continue;
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < Math.max(t.w, t.h) || h < t.h * 1.2 || w / h > 1.25 || h / w > 1.25) continue;
    const c: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
    const r = (w + h) / 4;
    if (Math.hypot(c[0] - t.cx, c[1] - t.cy) > 0.35 * r) continue;
    if (pts.some(([x, y]) => Math.abs(Math.hypot(x - c[0], y - c[1]) - r) > 0.2 * r + 0.5)) continue;
    // The grid line: drawn on from the circle, straight across or down the sheet (in one
    // piece, or dashed), for some way.
    const reach = 25 * t.h;
    const long = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => {
      const a: Pt = [c[0] + dx * r, c[1] + dy * r];
      const b: Pt = [c[0] + dx * (r + reach), c[1] + dy * (r + reach)];
      let ink = 0;
      for (const i of lineIndex.query(Math.min(a[0], b[0]) - 1, Math.min(a[1], b[1]) - 1, Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1)) {
        const sg = straight[i];
        // Along the axis, on it.
        if (dx ? Math.abs(sg.y1 - c[1]) > 0.8 || Math.abs(sg.y2 - c[1]) > 0.8 : Math.abs(sg.x1 - c[0]) > 0.8 || Math.abs(sg.x2 - c[0]) > 0.8) continue;
        const [p, q] = dx ? [sg.x1, sg.x2] : [sg.y1, sg.y2];
        const [lo, hi] = dx ? [Math.min(a[0], b[0]), Math.max(a[0], b[0])] : [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
        ink += Math.max(0, Math.min(hi, Math.max(p, q)) - Math.max(lo, Math.min(p, q)));
      }
      return ink >= 0.4 * reach;
    });
    if (long) out.push({ at: c, r });
  }
  return out;
}

/** Whether a code belongs to the ceiling types: listed in a ceiling types table, or with a ceiling prefix. */
function isCeilingCode(str: string, defined: Set<string>): boolean {
  const m = CODE.exec(str);
  if (!m) return false;
  return defined.has(codeKey(str)) || CEILING_PREFIX.test(m[1]);
}

/**
 * A ceiling height printed with a text: stacked right above or below it (a height oval under a
 * type box, "2,667" over "(CA1)") or on its line just beside it.
 */
function heightBeside(t: PageText, heights: PageText[], dashes: PageText[] = []): boolean {
  if (dashes.length && heightBeside(t, dashes)) return true;
  return heights.some((a) => {
    if (a === t) return false;
    const h = Math.max(t.h, a.h);
    const dx = Math.abs(a.cx - t.cx);
    const dy = Math.abs(a.cy - t.cy);
    const stacked = dy > 0.5 * h && dy < 3.2 * h && dx < Math.max(t.w, a.w) * 0.5 + h;
    const gap = Math.abs(a.cx - t.cx) - (a.w + t.w) / 2;
    const inline = dy < 0.6 * h && gap > -h && gap < 3 * h;
    return stacked || inline;
  });
}

/**
 * Ceiling type tags on a plan: a ceiling code in a small closed symbol (any shape), or a code
 * the ceiling types table lists printed bare. A height printed beside a tag (8'-6", 2400) and
 * an "above" beside it go with the nearest tag.
 */
export function findCeilingTags(input: PageText[], segs: Segment[], defs: CeilingDef[] = [], table: Pt[] = defs.map((d) => d.at), notes?: CeilingNotes): CeilingTag[] {
  const texts = uniqueTexts(input);
  const defined = new Set(defs.map((d) => d.key));
  const lines = segs.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  const tags: CeilingTag[] = [];
  const heights = texts.filter((o) => HEIGHT.test(o.str.trim()));
  const noHeight = texts.filter((o) => /^[-–—]$/.test(o.str.trim()));
  for (const raw of texts) {
    // An existing ceiling's tag: its material with an EX marker ("EX-ACT", "EX. GWB").
    const ex = /^EX[-.\s]+([A-Z]{2,4})$/.exec(bare(raw.str));
    const str = ex ? `EX-${ex[1]}` : bare(raw.str);
    // A ceiling note's number in a keynote symbol the size of the notes' own.
    const keynote = !!notes?.defs.some((d) => d.code === str) && Math.abs(raw.h - notes.h) <= notes.h * 0.15 && !(notes.box && raw.cx >= notes.box[0] && raw.cx <= notes.box[2] && raw.cy >= notes.box[1] && raw.cy <= notes.box[3]);
    // A material abbreviation the set's ceiling legend lists (or a usual one: GB, ACT), printed
    // with a ceiling height or the dash a height tag shows where there is none.
    const material = ex ? ex[1] : str;
    // An existing material marked EX with a ceiling height is a tag whatever the material (EX-CB).
    const lettered = LETTERS.test(material) && (!!ex || defined.has(codeKey(str)) || CEILING_PREFIX.test(material)) && heightBeside(raw, heights, noHeight);
    if (!CODE.test(str) && !keynote && !lettered) continue;
    const t = str === raw.str ? raw : { ...raw, str };
    // A ceiling code by the set's ceiling types, by its prefix, or by the ceiling height printed with it.
    const paired = !keynote && heightBeside(raw, heights);
    if (!keynote && !lettered && !isCeilingCode(str, defined) && !paired) continue;
    // The table's own codes are definitions, not tags.
    if (table.some((d) => Math.hypot(d[0] - t.cx, d[1] - t.cy) < 2)) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const within = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter((s) => within(s.x1, s.y1) && within(s.x2, s.y2));
    let box: Box | null = null;
    for (const pen of new Set(candidates.map((s) => `${s.filled ? 'F' : 'S'}${s.width}`))) {
      const loop = symbolLoop(
        candidates.filter((s) => `${s.filled ? 'F' : 'S'}${s.width}` === pen),
        t.cx,
        t.cy,
      );
      if (loop.length < 3) continue;
      const xs = loop.flatMap((s) => [s.x1, s.x2]);
      const ys = loop.flatMap((s) => [s.y1, s.y2]);
      const b: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      // Just round the code, not a room it happens to sit in.
      if (b[2] - b[0] > Math.max(6 * t.h, 2 * t.w + 10) || b[3] - b[1] > Math.max(5 * t.h, 1.8 * t.w + 8)) continue;
      if (!box || (b[2] - b[0]) * (b[3] - b[1]) < (box[2] - box[0]) * (box[3] - box[1])) box = b;
    }
    if (!box && ((!defined.has(codeKey(t.str)) && !paired) || keynote)) continue;
    // A room number tagged under its room's name (C3 under MALE WASHROOM) is not a ceiling.
    const named = texts.some(
      (o) =>
        o !== t &&
        /[A-Za-z]{3,}/.test(o.str) &&
        !HEIGHT.test(o.str) &&
        !ABOVE.test(o.str) &&
        !CODE.test(o.str) &&
        /^[A-Za-z][A-Za-z .&/'-]*$/.test(o.str) &&
        o.cy < t.cy &&
        t.cy - o.cy < 3.2 * Math.max(t.h, o.h) &&
        Math.abs(o.cx - t.cx) < Math.max(o.w, t.w) * 0.2,
    );
    if (named && texts.filter((o) => codeKey(o.str) === codeKey(t.str)).length === 1) continue;
    box ??= [t.cx - t.w / 2, t.cy - t.h / 2, t.cx + t.w / 2, t.cy + t.h / 2];
    tags.push({ code: t.str, key: codeKey(t.str), at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], box });
  }
  // Heights and "above" go with the nearest tag (measured to its symbol).
  const gap = (t: CeilingTag, x: number, y: number) => Math.hypot(Math.max(t.box[0] - x, 0, x - t.box[2]), Math.max(t.box[1] - y, 0, y - t.box[3]));
  const near = new Map<CeilingTag, number>();
  for (const a of texts) {
    const height = HEIGHT.test(a.str);
    if (!height && !ABOVE.test(a.str)) continue;
    let best: CeilingTag | null = null;
    let bestD = Infinity;
    for (const t of tags) {
      const size = Math.max(t.box[2] - t.box[0], t.box[3] - t.box[1]);
      // Written after the tag it goes with: measured from its start to a tag before it, or
      // from anywhere on it (and a little further) to one after it.
      const d = t.at[0] < a.cx ? gap(t, a.cx - a.w / 2, a.cy) : Math.min(gap(t, a.cx - a.w / 2, a.cy), gap(t, a.cx + a.w / 2, a.cy), gap(t, a.cx, a.cy)) + size * 0.4;
      if (d <= Math.max(size * 0.9, 6) && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (!best) continue;
    if (!height) best.above = true;
    else if (!best.height || bestD < (near.get(best) ?? Infinity)) {
      best.height = a.str.replace(/\s+/g, ' ');
      near.set(best, bestD);
    }
  }
  return tags;
}

/** A straight line's class: its pen and direction to the nearest 15° (as marks name them). */
const segmentKey = (sg: Segment) => {
  const a = (Math.atan2(sg.y2 - sg.y1, sg.x2 - sg.x1) * 180) / Math.PI;
  return `S${sg.width.toFixed(2)} line${(((Math.round(a / 15) * 15) % 180) + 180) % 180}`;
};

const perpendicularKey = (key: string) => key.replace(/line(\d+)$/, (_, a) => `line${(Number(a) + 90) % 180}`);

/**
 * Hatch lines: lines of one pen and direction lying side by side at a regular spacing, at
 * least three in a row (a wall's two faces are a pair, not a hatch). A ceiling grid is two such
 * families of one pen. Spacings under `minSpacing` (wall thicknesses) are not hatch here, nor
 * over `maxSpacing`.
 */
export function hatchFamilies(segs: Segment[], minSpacing: number, maxSpacing = minSpacing * 8, minGrid = minSpacing, wallPens: string[] = []): { lines: Map<Segment, string>; spacing: Map<string, number>; spacings: Map<string, number[]> } {
  const byKey = new Map<string, Segment[]>();
  for (const sg of segs) {
    if (sg.filled || sg.curve) continue;
    const L = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
    if (L < 2) continue;
    const key = segmentKey(sg);
    const list = byKey.get(key);
    if (list) list.push(sg);
    else byKey.set(key, [sg]);
  }
  // Edges of filled shapes that are not white masks: walls drawn as fills.
  const fills = segs.filter((sg) => (sg.filled || sg.width === 0) && !/^#f{6}$/i.test(sg.color ?? '') && Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1) >= 2);
  let fillIndex: SegmentIndex | null = null;
  const onFill = (m: Segment) => {
    if (!fills.length || m.filled || m.width === 0) return false;
    fillIndex ??= new SegmentIndex(fills, 32);
    const L = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    const ux = (m.x2 - m.x1) / L;
    const uy = (m.y2 - m.y1) / L;
    let along = 0;
    for (const k of fillIndex.query(Math.min(m.x1, m.x2) - 0.5, Math.min(m.y1, m.y2) - 0.5, Math.max(m.x1, m.x2) + 0.5, Math.max(m.y1, m.y2) + 0.5)) {
      const f = fills[k];
      const off = (x: number, y: number) => Math.abs((x - m.x1) * uy - (y - m.y1) * ux);
      if (off(f.x1, f.y1) > 0.4 || off(f.x2, f.y2) > 0.4) continue;
      const t1 = (f.x1 - m.x1) * ux + (f.y1 - m.y1) * uy;
      const t2 = (f.x2 - m.x1) * ux + (f.y2 - m.y1) * uy;
      along += Math.max(0, Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)));
    }
    return along >= 0.5 * L;
  };
  const lines = new Map<Segment, string>();
  const spacing = new Map<string, number>();
  const spacings = new Map<string, number[]>();
  for (const [key, fam] of byKey) {
    if (fam.length < 6) continue;
    const angle = (Number(/line(\d+)/.exec(key)![1]) * Math.PI) / 180;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const items = fam
      .map((m) => {
        const t1 = m.x1 * ux + m.y1 * uy;
        const t2 = m.x2 * ux + m.y2 * uy;
        const cx = (m.x1 + m.x2) / 2;
        const cy = (m.y1 + m.y2) / 2;
        return { m, off: cx * -uy + cy * ux, lo: Math.min(t1, t2), hi: Math.max(t1, t2) };
      })
      .sort((a, b) => a.off - b.off);
    // Every pair side by side within the widest spacing, and each line's nearest such neighbour.
    const links: [number, number, number][] = [];
    const nearest: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        const d = b.off - a.off;
        if (d > maxSpacing) break;
        if (d < minSpacing) continue;
        const ov = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
        if (ov > 0.3 * Math.min(a.hi - a.lo, b.hi - b.lo)) {
          if (!links.length || links[links.length - 1][0] !== i) nearest.push(d);
          links.push([i, j, d]);
        }
      }
    }
    if (links.length < 8) continue;
    // The spacings: the gaps from each line to the next one beside it that most lines share,
    // leaving out multiples of one taken (a light leaves out a line). Rooms gridded 2×4 one
    // way and 4×2 the other give two.
    const gaps = nearest.sort((x, y) => x - y);
    const support: [number, number][] = [];
    for (let i = 0, lo = 0, hi = 0; i < gaps.length; i++) {
      while (gaps[lo] < gaps[i] * 0.93) lo++;
      while (hi + 1 < gaps.length && gaps[hi + 1] <= gaps[i] * 1.07) hi++;
      support.push([gaps[i], hi - lo + 1]);
    }
    const top = maxOf(support.map((x) => x[1]));
    const chosen: number[] = [];
    for (const [g2, c] of [...support].sort((x, y) => y[1] - x[1])) {
      if (chosen.length >= 4 || c < Math.max(4, top * 0.15)) break;
      if (chosen.some((g3) => Math.abs(g2 / g3 - Math.round(g2 / g3)) * g3 <= g3 * 0.1 || Math.abs(g3 / g2 - Math.round(g3 / g2)) * g2 <= g2 * 0.1)) continue;
      chosen.push(g2);
    }
    if (!chosen.length) continue;
    // Lines linked at a spacing taken (or a multiple of it, across a light), in runs of three or more.
    const parent = items.map((_, i) => i);
    const find = (i: number): number => findRoot(parent, i);
    const across = byKey.get(perpendicularKey(key));
    // A grid's lines can be two or three cells apart where a light leaves one out; a hatch's
    // lines are evenly spaced.
    const gridded = !!across && across.length >= 4 && chosen.some((g2) => g2 >= minGrid);
    const steps = gridded ? [1, 2, 3, 4] : [1];
    const onSpacing = (d: number) => chosen.some((g2) => steps.some((k) => Math.abs(d - k * g2) <= g2 * 0.08));
    for (const [i, j, d] of links) if (onSpacing(d)) parent[find(i)] = find(j);
    const size = new Map<number, number>();
    items.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
    const inRun = (i: number) => (size.get(find(i)) ?? 0) >= 3;
    let keep: (i: number) => boolean;
    // A ceiling grid's cells are tiles, never as small as a wall is thick.
    if (gridded) {
      // A grid: its lines are crossed by (or meet) the lines across it on both sides; an
      // outline round the grid is met from one side only.
      const index = new SegmentIndex(across, 32);
      // Whether a line is met from both sides.
      const metBoth = ({ m, lo, hi }: (typeof items)[number]) => {
        const nx = -uy;
        const ny = ux;
        const sides: { a: boolean; b: boolean }[] = [];
        for (const k of index.query(Math.min(m.x1, m.x2) - 1, Math.min(m.y1, m.y2) - 1, Math.max(m.x1, m.x2) + 1, Math.max(m.y1, m.y2) + 1)) {
          const q = across[k];
          const d1 = (q.x1 - m.x1) * nx + (q.y1 - m.y1) * ny;
          const d2 = (q.x2 - m.x1) * nx + (q.y2 - m.y1) * ny;
          if (Math.min(d1, d2) > 0.6 || Math.max(d1, d2) < -0.6) continue;
          const t = ((q.x1 + q.x2) / 2) * ux + ((q.y1 + q.y2) / 2) * uy;
          if (t < lo - 0.6 || t > hi + 0.6) continue;
          sides.push({ a: Math.max(d1, d2) > 0.6, b: Math.min(d1, d2) < -0.6 });
        }
        return sides.some((x) => x.a) && sides.some((x) => x.b);
      };
      // The nodes where a line is crossed straight through.
      const crossedThrough = ({ m, lo, hi }: (typeof items)[number]) => {
        const nx = -uy;
        const ny = ux;
        const sides: { t: number; a: boolean; b: boolean }[] = [];
        for (const k of index.query(Math.min(m.x1, m.x2) - 1, Math.min(m.y1, m.y2) - 1, Math.max(m.x1, m.x2) + 1, Math.max(m.y1, m.y2) + 1)) {
          const q = across[k];
          const d1 = (q.x1 - m.x1) * nx + (q.y1 - m.y1) * ny;
          const d2 = (q.x2 - m.x1) * nx + (q.y2 - m.y1) * ny;
          if (Math.min(d1, d2) > 0.6 || Math.max(d1, d2) < -0.6) continue;
          const t = ((q.x1 + q.x2) / 2) * ux + ((q.y1 + q.y2) / 2) * uy;
          if (t < lo - 0.6 || t > hi + 0.6) continue;
          sides.push({ t, a: Math.max(d1, d2) > 0.6, b: Math.min(d1, d2) < -0.6 });
        }
        sides.sort((p, q) => p.t - q.t);
        let through = 0;
        for (let s = 0; s < sides.length; ) {
          let a = false;
          let b = false;
          let e = s;
          for (; e < sides.length && sides[e].t - sides[s].t <= 0.8; e++) {
            a ||= sides[e].a;
            b ||= sides[e].b;
          }
          if (a && b) through++;
          s = e;
        }
        return through;
      };
      // A wall's face drawn along the edge of its fill (walls filled grey or black, poché) is
      // no grid line, however evenly the walls happen to lie.
      // In the walls' own pen, where walls lying evenly spaced meet each other's faces at tees
      // from either side, a grid line is crossed straight through at two nodes at least (lines
      // drawn cell by cell meet end to end there).
      const wallPen = wallPens.includes(key.slice(1, key.indexOf(' ')));
      keep = (i) => inRun(i) && !onFill(items[i].m) && (wallPen ? crossedThrough(items[i]) >= 2 : metBoth(items[i]));
    } else {
      // A hatch one way: a pen that draws mostly hatch (a pen of walls or outlines, a few of
      // them happening to lie evenly spaced, keeps them).
      const len = (i: number) => items[i].hi - items[i].lo;
      let total = 0;
      let chained = 0;
      items.forEach((_, i) => {
        total += len(i);
        if (inRun(i)) chained += len(i);
      });
      if (chained < total * 0.5) continue;
      keep = inRun;
    }
    let n = 0;
    items.forEach((it, i) => {
      if (keep(i)) {
        lines.set(it.m, key);
        n++;
      }
    });
    const best = Math.min(...chosen);
    if (n) {
      spacing.set(key, best);
      spacings.set(key, chosen);
    }
  }
  return { lines, spacing, spacings };
}

interface Faces {
  w: number;
  h: number;
  res: number;
  label: Int32Array;
  count: number;
  pixels: Int32Array;
  edge: Uint8Array;
  /** Half the widest width across each face, in pixels. */
  inner: Float32Array;
  bbox: Int32Array;
}

/** Every space the barrier lines enclose, labelled (4-connected), with its size and how wide it gets. */
function facesOf(barrier: Uint8Array, w: number, h: number, res: number): Faces {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let count = 0;
  const pixels: number[] = [];
  const edge: number[] = [];
  const bbox: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (barrier[i] || label[i] >= 0) continue;
    let top = 0;
    stack[top++] = i;
    label[i] = count;
    let n = 0;
    let e = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (top) {
      const j = stack[--top];
      n++;
      const x = j % w;
      const y = (j - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) e = 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !barrier[j - 1] && label[j - 1] < 0) (label[j - 1] = count), (stack[top++] = j - 1);
      if (x < w - 1 && !barrier[j + 1] && label[j + 1] < 0) (label[j + 1] = count), (stack[top++] = j + 1);
      if (y > 0 && !barrier[j - w] && label[j - w] < 0) (label[j - w] = count), (stack[top++] = j - w);
      if (y < h - 1 && !barrier[j + w] && label[j + w] < 0) (label[j + w] = count), (stack[top++] = j + w);
    }
    pixels.push(n);
    edge.push(e);
    bbox.push(x0, y0, x1, y1);
    count++;
  }
  // Chamfer (3-4) distance to the nearest barrier pixel.
  const dist = new Float32Array(w * h);
  const BIG = 1e9;
  for (let i = 0; i < dist.length; i++) dist[i] = barrier[i] ? 0 : BIG;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        d = Math.min(d, dist[i - w] + 3);
        if (x > 0) d = Math.min(d, dist[i - w - 1] + 4);
        if (x < w - 1) d = Math.min(d, dist[i - w + 1] + 4);
      }
      dist[i] = d;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < h - 1) {
        d = Math.min(d, dist[i + w] + 3);
        if (x < w - 1) d = Math.min(d, dist[i + w + 1] + 4);
        if (x > 0) d = Math.min(d, dist[i + w - 1] + 4);
      }
      dist[i] = d;
    }
  const inner = new Float32Array(count);
  for (let i = 0; i < label.length; i++) {
    const id = label[i];
    if (id >= 0 && dist[i] < BIG && dist[i] / 3 > inner[id]) inner[id] = dist[i] / 3;
  }
  return { w, h, res, label, count, pixels: Int32Array.from(pixels), edge: Uint8Array.from(edge), inner, bbox: Int32Array.from(bbox) };
}

function pointInRing([x, y]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A legend's frame: the space round the word "legend" (a boxed legend), when it is a box and not the sheet. */
function legendBoxes(texts: PageText[], faces: Faces, sheetArea: number): Box[] {
  const out: Box[] = [];
  for (const t of texts) {
    if (!/\blegend\b/i.test(t.str) || t.str.length > 40) continue;
    const id = faceNear(faces, t.cx, t.cy);
    if (id < 0 || faces.edge[id] || faces.pixels[id] / faces.res ** 2 > sheetArea * 0.15) continue;
    const r = faces.res;
    const b: Box = [faces.bbox[4 * id] / r, faces.bbox[4 * id + 1] / r, (faces.bbox[4 * id + 2] + 1) / r, (faces.bbox[4 * id + 3] + 1) / r];
    if (!out.some((o) => o[0] === b[0] && o[1] === b[1])) out.push(b);
  }
  return out;
}

/** The face under a sheet point, or the nearest one within a couple of pixels. */
function faceNear(f: Faces, x: number, y: number): number {
  const px = Math.floor(x * f.res);
  const py = Math.floor(y * f.res);
  for (let r = 0; r <= 3; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= f.w || qy >= f.h) continue;
        const id = f.label[qy * f.w + qx];
        if (id >= 0) return id;
      }
  return -1;
}

export interface ReadCeilingOptions {
  /** Ceiling types described elsewhere in the set (another RCP, an assembly sheet). */
  defs?: CeilingDef[];
  /** Areas to leave out: the title block. */
  avoid?: Box[];
  /** For diagnostics: the faces read, before they are grouped into ceilings. */
  debug?: (d: { label: Int32Array; w: number; h: number; res: number; kinds: CeilingKind[]; group: Int32Array; groups: string[]; tagFaces: string[] }) => void;
}

/**
 * Reads one reflected ceiling plan: its ceiling areas, each with a type. A sheet without
 * ceiling type tags comes back untagged, with the areas its ceiling grid covers.
 */
export function readCeilingSheet(
  segs: Segment[],
  rawTexts: PageText[],
  sheet: { width: number; height: number; metersPerPoint: number | null },
  options: ReadCeilingOptions = {},
): CeilingSheetRead {
  const texts = uniqueTexts(rawTexts);
  const own = readCeilingDefs(texts, segs);
  const notes = readCeilingNotes(texts);
  const defs = mergeDefs([...(options.defs ?? []), ...own.defs, ...notes.defs]);
  const avoid: Box[] = [...(options.avoid ?? []), ...(own.box ? [own.box] : []), ...(notes.box && notes.defs.length ? [notes.box] : [])];
  const inBox = (x: number, y: number, boxes: Box[]) => boxes.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  // Where the set lists its ceiling types, a code of another family (T8 beside c1, c3, cx3) is
  // a fixture's or a door's mark, not a ceiling type.
  const listed = mergeDefs([...(options.defs ?? []), ...own.defs]);
  const family = (k: string) => /^[a-z]*/.exec(k)![0];
  const families = new Set(listed.map((d) => family(d.key)));
  const keyed = new Set(notes.defs.map((d) => d.key));
  let tags = findCeilingTags(texts, segs, defs, [...own.defs, ...notes.defs].map((d) => d.at), notes).filter(
    (t) => !inBox(t.at[0], t.at[1], avoid) && (listed.length < 3 || keyed.has(t.key) || listed.some((d) => d.key === t.key) || families.has(family(t.key))),
  );
  const mpp = sheet.metersPerPoint;
  const pt = (m: number, fallback: number) => (mpp ? m / mpp : fallback);

  // The barrier: every line but hatching, stipple and lettering.
  const marks = marksOf(segs);
  const skip = new Set<number>();
  const dotCount = new Map<string, number>();
  // Lettering drawn as shapes: the counters of its letters and its full stops are no stipple.
  // Filled pieces too small to be glyphs (a hyphen, a full stop, a small letter's parts) sit
  // close beside other filled pieces; a stipple's dots stand apart.
  const filledMarks = marks.filter((m) => m.key.startsWith('F'));
  const glyphs = [...marks.filter((m) => m.glyph), ...filledMarks.filter((m) => m.size < 1.2)];
  const glyphIndex = new SegmentIndex(glyphs.map((m) => ({ x1: m.cx - m.size / 2, y1: m.cy - m.size / 2, x2: m.cx + m.size / 2, y2: m.cy + m.size / 2, width: 0, filled: false })), 16);
  const inLetter = (m: Mark) =>
    glyphIndex.query(m.cx - 1.5, m.cy - 1.5, m.cx + 1.5, m.cy + 1.5).some((i) => {
      const o = glyphs[i];
      if (o === m) return false;
      const reach = o.glyph ? o.size / 2 + 0.6 : m.key.startsWith('F') ? 1.5 : -1;
      return Math.abs(o.cx - m.cx) <= reach && Math.abs(o.cy - m.cy) <= reach;
    });
  const stippleDot = new Set<Mark>();
  for (const m of marks) {
    if (m.sub === undefined) continue;
    if (m.glyph || m.size < 1.2) skip.add(m.sub);
    if (m.size < 1.2 && !(glyphs.length && inLetter(m))) {
      stippleDot.add(m);
      dotCount.set(m.key, (dotCount.get(m.key) ?? 0) + 1);
    }
  }
  const W = sheet.width;
  const H = sheet.height;
  // The ceiling legend's swatches (framed or not): a ceiling finish and the pattern it is drawn with.
  const legend = ceilingSwatches(texts, segs, marks, W, H, options.avoid ?? []);
  const sameLine = (a: CeilingSwatch, b: CeilingSwatch) => a.label === b.label && a.code === b.code;
  const stippleKeys = new Set([...dotCount].filter(([, c]) => c >= 100).map(([k]) => k));
  const legendOut = legend.map((l) => l.box);
  tags = tags.filter((t) => !inBox(t.at[0], t.at[1], legendOut));

  // No type tags, no legend saying what the patterns are and nothing but a grid drawn: the
  // areas the ceiling grid covers (a demolition or existing plan's ceiling, or new T-bar).
  const dotted = [...stippleDot].some((m) => stippleKeys.has(m.key) && !inBox(m.cx, m.cy, [...avoid, ...legendOut]));
  // Read by what is drawn where the legend tells finishes apart by their patterns, or where
  // the sheet has no text to go by (lettering drawn as linework).
  const finishes = new Set(legend.map((l) => `${l.code ?? ''}|${l.label}`)).size;
  if (!tags.length && finishes < 2 && !(dotted && texts.length < 5)) {
    const grid = findGridHatch(segs, mpp, options.avoid ?? []);
    return {
      tagged: false,
      tags: [],
      defs,
      legend: [],
      areas: (grid?.regions ?? []).map((r) => ({ points: r.points, holes: [], area: r.area, code: null, source: 'fallback', kind: 'grid' })),
    };
  }

  const drawn = segs.filter((s) => s.sub === undefined || !skip.has(s.sub));
  const wallPens = mpp ? detectWallPens(penStats(segs, pt(0.06, 1.5), pt(0.7, 20))) : [];
  const hatch = hatchFamilies(drawn, pt(0.28, 7), pt(2, 56), pt(0.45, 12), wallPens);
  // Dashed lines are things above or hidden (beams, bulkheads over, the structural grid), not ceiling edges.
  const dashes = explodedDashes(drawn);
  const kept = drawn.filter((s) => !hatch.lines.has(s) && !s.dashed && !dashes.has(s) && !(s.filled && backgroundInk(s)));
  // A space open to the floor below (or above), a shaft: an X drawn across it and a note in it.
  // It has no ceiling, and the X's lines are no ceiling edges.
  const openNotes = texts.filter((t) => OPEN_SPACE.test(t.str));
  const crossing = (sg: Segment) => {
    const L = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
    const a = Math.abs(((Math.atan2(sg.y2 - sg.y1, sg.x2 - sg.x1) * 180) / Math.PI) % 90);
    if (L < pt(2, 60) || a < 15 || a > 75) return false;
    return openNotes.some((t) => {
      const d = Math.abs((sg.x2 - sg.x1) * (sg.y1 - t.cy) - (sg.x1 - t.cx) * (sg.y2 - sg.y1)) / L;
      const along = ((t.cx - sg.x1) * (sg.x2 - sg.x1) + (t.cy - sg.y1) * (sg.y2 - sg.y1)) / (L * L);
      return d <= Math.max(3 * t.h, t.w / 2) && along > -0.15 && along < 1.15;
    });
  };
  const barrierLines = withoutBackground(openNotes.length ? kept.filter((sg) => !crossing(sg)) : kept);
  const res = Math.min(2, Math.sqrt(9e6 / (W * H)));
  const g = makeGrid(0, 0, W, H, res);
  drawSegments(g, barrierLines);
  // Door and window openings closed across, as the floor plan's rooms are: a ceiling stops at
  // the wall line, not through a doorway into the next room (or outside).
  if (mpp) drawSegments(g, wallBridges(segs, mpp));
  const faces = facesOf(g.data, g.w, g.h, res);
  const sheetArea = W * H;
  const framed = legendBoxes(texts, faces, sheetArea);
  for (const sw of ceilingSwatches(texts, segs, marks, W, H, options.avoid ?? [], framed)) if (!legend.some((l) => sameLine(l, sw))) legend.push(sw);
  const legendFrames = [...framed, ...legendOut];
  const skipBoxes = [...avoid, ...legendFrames];
  tags = tags.filter((t) => !inBox(t.at[0], t.at[1], legendFrames));

  // What is drawn in each face: hatch line length per family, stipple dots.
  const n = faces.count;
  const faceAt = (x: number, y: number) => {
    const px = Math.floor(x * res);
    const py = Math.floor(y * res);
    return px >= 0 && py >= 0 && px < g.w && py < g.h ? faces.label[py * g.w + px] : -1;
  };
  const hatchCover = new Map<string, Float64Array>();
  for (const [m, key] of hatch.lines) {
    const sp = hatch.spacing.get(key);
    if (!sp) continue;
    let arr = hatchCover.get(key);
    if (!arr) hatchCover.set(key, (arr = new Float64Array(n)));
    const [ax, ay, bx, by] = [m.x1, m.y1, m.x2, m.y2];
    const L = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(L / Math.max(1, sp / 2)));
    for (let i = 0; i < steps; i++) {
      const id = faceAt(ax + ((bx - ax) * (i + 0.5)) / steps, ay + ((by - ay) * (i + 0.5)) / steps);
      if (id >= 0) arr[id] += (L / steps) * sp;
    }
  }
  const dots = new Float64Array(n);
  const dotKeysIn = new Map<number, Set<string>>();
  for (const m of marks) {
    if (!stippleDot.has(m) || !stippleKeys.has(m.key)) continue;
    const id = faceAt(m.cx, m.cy);
    if (id < 0) continue;
    dots[id]++;
    (dotKeysIn.get(id) ?? dotKeysIn.set(id, new Set()).get(id)!).add(m.key);
  }
  const areaPt = (id: number) => faces.pixels[id] / res ** 2;
  // How much of each face its stipple spreads over: of the squares (two dots' spacing a side)
  // whose middle lies in the face, the share holding a dot. A room with stippled bulkheads
  // round an open middle is not a stippled ceiling.
  const cell = 2 / Math.sqrt(0.006);
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const dottedCell = new Uint8Array(cols * rows);
  for (const m of marks) if (stippleDot.has(m) && stippleKeys.has(m.key)) dottedCell[Math.min(rows - 1, Math.floor(m.cy / cell)) * cols + Math.min(cols - 1, Math.floor(m.cx / cell))] = 1;
  const cellsIn = new Float64Array(n);
  const dottedIn = new Float64Array(n);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const id = faceAt((c + 0.5) * cell, (r + 0.5) * cell);
      if (id < 0) continue;
      cellsIn[id]++;
      if (dottedCell[r * cols + c]) dottedIn[id]++;
    }
  const spread = (id: number) => (cellsIn[id] < 6 ? 1 : dottedIn[id] / cellsIn[id]);
  const kindOf = (id: number): { kind: CeilingKind; keys: string[] } => {
    const A = areaPt(id);
    const cover = [...hatchCover].map(([k, arr]) => [k, arr[id] / A] as const).filter(([, c]) => c >= 0.25);
    const dirs = new Set(cover.map(([k]) => k));
    const total = cover.reduce((s, [, c]) => s + c, 0);
    // Stipple laid over a grid is the stipple's finish (a gypsum ceiling in a gridded room).
    if (dots[id] >= 12 && dots[id] / A >= 0.006 && spread(id) >= 0.35) return { kind: 'stipple', keys: [...(dotKeysIn.get(id) ?? [])] };
    // A lay-in grid's cells are tiles (600 to 1200 or so each way); boards or planks laid on
    // purlins draw two families too, one of them much closer.
    const tile = (k: string) => {
      return !mpp || (hatch.spacings.get(k) ?? []).some((sp) => sp * mpp >= 0.45 && sp * mpp <= 1.65);
    };
    if (dirs.size >= 2 && total >= 0.6 && [...dirs].every(tile)) return { kind: 'grid', keys: [...dirs] };
    if (total >= 0.5) return { kind: 'hatch', keys: [...dirs] };
    return { kind: 'plain', keys: [] };
  };
  const kinds = Array.from({ length: n }, (_, id) => kindOf(id));

  // Faces that can be ceilings: closed, not the sheet round the plan, wider than a wall's cavity.
  const minWidth = pt(0.4, 10) * res;
  const cx = (id: number) => (faces.bbox[4 * id] + faces.bbox[4 * id + 2] + 1) / 2 / res;
  const cy = (id: number) => (faces.bbox[4 * id + 1] + faces.bbox[4 * id + 3] + 1) / 2 / res;
  const open = new Set(openNotes.map((t) => faceNear(faces, t.cx, t.cy)));
  // The paper round the drawings, framed in by the sheet border: where the drawings' scale
  // notes are written (beside their titles, outside the building), and round the title block.
  for (const n of scaleNotes(texts)) open.add(faceNear(faces, (n.box[0] + n.box[2]) / 2, (n.box[1] + n.box[3]) / 2));
  for (const b of options.avoid ?? []) for (const [x, y] of [[b[0] - 3, (b[1] + b[3]) / 2], [(b[0] + b[2]) / 2, b[1] - 3]]) if (x > 0 && y > 0) open.add(faceNear(faces, x, y));
  // Likewise round the column grid's bubbles.
  for (const b of gridBubbles(texts, segs)) {
    const votes = new Map<number, number>();
    for (let k = 0; k < 8; k++) {
      const id = faceAt(b.at[0] + (b.r + 4) * Math.cos((k * Math.PI) / 4), b.at[1] + (b.r + 4) * Math.sin((k * Math.PI) / 4));
      if (id >= 0) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    const best = [...votes].sort((a, c) => c[1] - a[1])[0];
    if (best && best[1] >= 4) open.add(best[0]);
  }
  open.delete(-1);
  const usable = (id: number) => !faces.edge[id] && faces.inner[id] * 2 >= minWidth && areaPt(id) < sheetArea * 0.2 && !inBox(cx(id), cy(id), skipBoxes) && !open.has(id);

  // Each tag types the face it sits in: the face most of the points just round its symbol fall in.
  const tagsIn = new Map<number, CeilingTag[]>();
  const labels = findRoomLabels(texts, segs);
  // A ceiling tag stacked under (or over) a room tag whose leader points into its room, the
  // two placed outside a room too small or too busy to hold them, goes with that room.
  // The far end of a leader drawn off a room tag's box (with or without a dot at its end).
  let leaderIndex: SegmentIndex | null = null;
  const leaderLines = segs.filter((sg) => !sg.filled && !sg.curve && Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1) > 1);
  const leaderOf = (b: Box): Pt | null => {
    leaderIndex ??= new SegmentIndex(leaderLines, 16);
    const bh = Math.min(b[2] - b[0], b[3] - b[1]);
    const onEdge = (x: number, y: number) => x >= b[0] - 1 && x <= b[2] + 1 && y >= b[1] - 1 && y <= b[3] + 1 && (Math.abs(x - b[0]) <= 1 || Math.abs(x - b[2]) <= 1 || Math.abs(y - b[1]) <= 1 || Math.abs(y - b[3]) <= 1);
    const away = (x: number, y: number) => Math.max(b[0] - x, x - b[2], b[1] - y, y - b[3]);
    for (const i of leaderIndex.query(b[0] - 1.5, b[1] - 1.5, b[2] + 1.5, b[3] + 1.5)) {
      const first = leaderLines[i];
      for (const [start, far] of [[[first.x1, first.y1], [first.x2, first.y2]], [[first.x2, first.y2], [first.x1, first.y1]]] as [Pt, Pt][]) {
        if (!onEdge(start[0], start[1]) || away(far[0], far[1]) <= 0.5) continue;
        // A line running on behind the box (a grid line, a wall) is no leader.
        const L = Math.hypot(far[0] - start[0], far[1] - start[1]);
        const ux = (far[0] - start[0]) / L;
        const uy = (far[1] - start[1]) / L;
        const across = Math.abs(ux) * (b[2] - b[0]) + Math.abs(uy) * (b[3] - b[1]);
        const bx = start[0] - ux * (across + 2);
        const by = start[1] - uy * (across + 2);
        const behind = leaderIndex.query(bx - 1.5, by - 1.5, bx + 1.5, by + 1.5).some((j) => {
          const o = leaderLines[j];
          const off = (x: number, y: number) => Math.abs((x - start[0]) * uy - (y - start[1]) * ux);
          return o !== first && off(o.x1, o.y1) < 0.5 && off(o.x2, o.y2) < 0.5;
        });
        if (behind) continue;
        let end = far;
        let prev = first;
        for (let k = 0; k < 3; k++) {
          const next = leaderIndex.query(end[0] - 0.5, end[1] - 0.5, end[0] + 0.5, end[1] + 0.5).map((j) => leaderLines[j]).find((o) => o !== prev && o.width === first.width && (Math.hypot(o.x1 - end[0], o.y1 - end[1]) < 0.5 || Math.hypot(o.x2 - end[0], o.y2 - end[1]) < 0.5));
          if (!next) break;
          end = Math.hypot(next.x1 - end[0], next.y1 - end[1]) < 0.5 ? [next.x2, next.y2] : [next.x1, next.y1];
          prev = next;
        }
        if (away(end[0], end[1]) > 2 * bh) return end;
      }
    }
    return null;
  };
  const ledTo = (t: CeilingTag): number => {
    for (const l of labels) {
      if (!l.box) continue;
      const bh = l.box[3] - l.box[1];
      const overlap = Math.min(l.box[2], t.box[2]) - Math.max(l.box[0], t.box[0]);
      const gap = Math.max(t.box[1] - l.box[3], l.box[1] - t.box[3]);
      if (overlap <= 0 || gap > 3 * bh) continue;
      const seed = l.seed ?? leaderOf(l.box);
      if (!seed) continue;
      // Round the dot (drawn in the barrier), the face most points fall in.
      const votes = new Map<number, number>();
      for (let k = 0; k < 12; k++) {
        const id = faceAt(seed[0] + 5 * Math.cos((k * Math.PI) / 6), seed[1] + 5 * Math.sin((k * Math.PI) / 6));
        if (id >= 0 && usable(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
      const best = [...votes].sort((a, b) => b[1] - a[1])[0];
      if (best) return best[0];
    }
    return -1;
  };
  for (const t of tags) {
    if (t.above) continue;
    const led = ledTo(t);
    if (led >= 0) {
      (tagsIn.get(led) ?? tagsIn.set(led, []).get(led)!).push(t);
      continue;
    }
    // Round the symbol, further out when what is just round it (a height oval drawn with it,
    // a light) is no ceiling.
    const votes = new Map<number, number>();
    for (const pad of [2.5, 6, 12]) {
      const [x0, y0, x1, y1] = [t.box[0] - pad, t.box[1] - pad, t.box[2] + pad, t.box[3] + pad];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const probes: Pt[] = [
        [x0, y0], [mx, y0], [x1, y0], [x1, my], [x1, y1], [mx, y1], [x0, y1], [x0, my],
        [mx, y0 - pad], [mx, y1 + pad], [x0 - pad, my], [x1 + pad, my],
      ];
      for (const [px, py] of probes) {
        const id = faceAt(px, py);
        if (id >= 0 && usable(id)) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
      if (votes.size) break;
    }
    // A tag drawn over a light fixture or a diffuser types the room round it, not the fixture.
    // (A fixture is an island in the room: the room all round it, not a stair's treads or a
    // closet the tag sits in.)
    const fixture = pt(1.6, 40) ** 2;
    const islandIn = (small: number, big: number) => {
      const [x0, y0, x1, y1] = [0, 1, 2, 3].map((k) => faces.bbox[4 * small + k] / res);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const d = 3;
      const ring: Pt[] = [[x0 - d, y0 - d], [mx, y0 - d], [x1 + d, y0 - d], [x1 + d, my], [x1 + d, y1 + d], [mx, y1 + d], [x0 - d, y1 + d], [x0 - d, my]];
      return ring.filter(([x, y]) => faceAt(x, y) === big).length >= 5;
    };
    const bigs = [...votes.keys()].filter((id) => areaPt(id) >= fixture);
    if (bigs.length) for (const id of [...votes.keys()]) if (areaPt(id) < fixture && bigs.some((b) => islandIn(id, b))) votes.delete(id);
    let best = -1;
    for (const [id, v] of votes) if (best < 0 || v > votes.get(best)! || (v === votes.get(best)! && faces.pixels[id] > faces.pixels[best])) best = id;
    if (best < 0) continue;
    (tagsIn.get(best) ?? tagsIn.set(best, []).get(best)!).push(t);
  }

  // Groups: one per code, then legend rows and fallback kinds. Pixels are assigned to groups.
  const groupKeys: string[] = [];
  const groupIndex = (k: string) => {
    let i = groupKeys.indexOf(k);
    if (i < 0) i = groupKeys.push(k) - 1;
    return i;
  };
  const faceGroup = new Int32Array(n).fill(-1);
  const split = new Map<number, CeilingTag[]>();
  for (const [id, list] of tagsIn) {
    const keys = [...new Set(list.map((t) => t.key))];
    if (keys.length === 1) faceGroup[id] = groupIndex(`code:${keys[0]}`);
    else {
      split.set(id, list);
      // The code most of its tags carry, for neighbours that join it.
      const counts = keys.map((k) => list.filter((t) => t.key === k).length);
      faceGroup[id] = groupIndex(`code:${keys[counts.indexOf(Math.max(...counts))]}`);
      for (const k of keys) groupIndex(`code:${k}`);
    }
  }

  // Untagged faces beside a tagged one across a single line (a dimension, a light's edge, the
  // grid's border) and drawn the same are part of the same ceiling.
  const contact = new Map<number, Map<number, number>>();
  const k = Math.max(3, Math.round(1.5 * res + 1.5));
  const touch = (a: number, b: number) => {
    if (a === b || a < 0 || b < 0) return;
    const m = contact.get(a) ?? contact.set(a, new Map()).get(a)!;
    m.set(b, (m.get(b) ?? 0) + 1);
    const m2 = contact.get(b) ?? contact.set(b, new Map()).get(b)!;
    m2.set(a, (m2.get(a) ?? 0) + 1);
  };
  for (let y = 0; y < g.h; y++) {
    let last = -1;
    let run = 0;
    for (let x = 0; x < g.w; x++) {
      const id = faces.label[y * g.w + x];
      if (id < 0) run++;
      else {
        if (run > 0 && run <= k) touch(last, id);
        last = id;
        run = 0;
      }
    }
  }
  for (let x = 0; x < g.w; x++) {
    let last = -1;
    let run = 0;
    for (let y = 0; y < g.h; y++) {
      const id = faces.label[y * g.w + x];
      if (id < 0) run++;
      else {
        if (run > 0 && run <= k) touch(last, id);
        last = id;
        run = 0;
      }
    }
  }
  const minPiece = pt(0.25, 3) ** 2;
  const gridCode = (key: string): boolean | null => {
    const desc = defs.find((d) => d.key === key)?.description ?? '';
    if (/lay-?in|\blap\b|acoustic|\bact\b|tile|t-bar|suspended|grid/i.test(desc)) return true;
    if (/gypsum|\bgwb\b|wallboard|drywall|plaster|board|concrete|exposed|deck/i.test(desc)) return false;
    let gridFaces = 0;
    let other = 0;
    for (const [id, list] of tagsIn) {
      if (list.some((t) => t.key !== key) || !list.length || list[0].key !== key) continue;
      if (kinds[id].kind === 'grid') gridFaces++;
      else other++;
    }
    return gridFaces + other ? gridFaces > other : null;
  };
  // The code a neighbour passes on: its own, or for a face two codes share, the one drawn
  // like this face (a lay-in code to a gridded piece).
  const passOn = (o: number, id: number): number => {
    const list = split.get(o);
    if (!list) return kinds[o].kind === kinds[id].kind ? faceGroup[o] : -1;
    const grid = kinds[id].kind === 'grid';
    const fit = [...new Set(list.map((t) => t.key))].filter((k) => gridCode(k) === grid);
    return fit.length === 1 ? groupIndex(`code:${fit[0]}`) : -1;
  };
  // The face a room tag stands in (round its box; inside the box is the box's own face).
  const labeledFace = new Set(labels.flatMap((l) => [faceAt(l.at[0], l.at[1]), ...(l.box ? [faceAt(l.box[0] - 3, l.at[1]), faceAt(l.box[2] + 3, l.at[1])] : [])]).filter((id) => id >= 0));
  for (let changed = true; changed; ) {
    changed = false;
    for (let id = 0; id < n; id++) {
      if (faceGroup[id] >= 0 || !usable(id) || areaPt(id) < minPiece) continue;
      let best = -1;
      let bestC = 0;
      // A bigger space with a room of its own named in it is another room, not a piece of this one.
      const named = labeledFace.has(id);
      for (const [o, c] of contact.get(id) ?? []) {
        if (faceGroup[o] < 0) continue;
        if (named && areaPt(id) > 2 * areaPt(o)) continue;
        const gi = passOn(o, id);
        if (gi >= 0 && c > bestC) {
          best = gi;
          bestC = c;
        }
      }
      // A real shared edge, not a corner: a few pixels' worth.
      if (best >= 0 && bestC >= 4) {
        faceGroup[id] = best;
        changed = true;
      }
    }
  }

  // A pattern only ever tagged with one code is that code where it is drawn untagged too
  // (the tag placed once in a hatched infill, the rest of the hatch left to say it).
  const patternCodes = new Map<string, Set<number>>();
  for (const [id, list] of tagsIn) {
    if (split.has(id) || !['hatch', 'stipple'].includes(kinds[id].kind)) continue;
    for (const k of kinds[id].keys) (patternCodes.get(k) ?? patternCodes.set(k, new Set()).get(k)!).add(groupIndex(`code:${list[0].key}`));
  }
  if (patternCodes.size)
    for (let id = 0; id < n; id++) {
      if (faceGroup[id] >= 0 || !usable(id) || areaPt(id) < minPiece || !['hatch', 'stipple'].includes(kinds[id].kind)) continue;
      const codes = new Set(kinds[id].keys.flatMap((k) => [...(patternCodes.get(k) ?? [])]));
      if (codes.size === 1) faceGroup[id] = [...codes][0];
    }

  const fallbackMin = pt(Math.sqrt(2.3), 15) ** 2;
  // Lettering in each face: a box of notes or a table cell is mostly text, a room is not.
  const lettering = new Float64Array(n);
  for (const t of texts) {
    const id = faceAt(t.cx, t.cy);
    if (id >= 0) lettering[id] += t.w * t.h;
  }
  for (let id = 0; id < n; id++) {
    if (faceGroup[id] >= 0 || !usable(id) || lettering[id] > areaPt(id) * 0.08) continue;
    const { kind: drawnAs, keys } = kinds[id];
    // Lines one way at a tile's spacing that no plank or slat swatch runs with: long tiles laid
    // in a grid whose short way is not drawn.
    const tiled = (k: string) => !!mpp && (hatch.spacings.get(k) ?? []).some((sp) => sp * mpp >= 0.45 && sp * mpp <= 1.65);
    const plank = (k: string) => legend.some((l) => l.kind === 'hatch' && l.keys.some((x) => x.split(' ')[1] === k.split(' ')[1]));
    // (Only where the legend tells a plank or slat hatch from tiles: a set without one draws
    // joists and structure one way at such spacings too.)
    const tellsApart = legend.some((l) => l.kind === 'hatch') && legend.some((l) => l.kind === 'grid' || l.implied === 'grid');
    const kind: CeilingKind = tellsApart && drawnAs === 'hatch' && keys.length && keys.every((k) => tiled(k) && !plank(k)) ? 'grid' : drawnAs;
    if (kind !== 'plain') {
      // A stipple is plainly a finish (gypsum), down to a closet's ceiling; lines are less sure.
      if (areaPt(id) < (kind === 'stipple' ? fallbackMin / 2.3 : fallbackMin)) continue;
      const same = legend.filter((l) => l.kind === kind);
      const said = legend.filter((l) => l.kind !== kind && l.implied === kind && !legend.some((o) => o !== l && o.kind === kind));
      // A hatch is a legend row's only when its lines run the same way as the swatch's (planks
      // one way, a corridor's tiles the other).
      const dir = (k: string) => k.split(' ')[1];
      const runs = (l: CeilingSwatch) => kind !== 'hatch' || l.keys.some((x) => keys.some((y) => dir(x) === dir(y)));
      const row = same.find((l) => l.keys.some((x) => keys.includes(x))) ?? (same.length === 1 && runs(same[0]) ? same[0] : said.length === 1 ? said[0] : undefined);
      if (row) faceGroup[id] = groupIndex(`legend:${legend.indexOf(row)}`);
      // Lines one way only, with no legend saying what they are, are stairs or notes as often as a ceiling.
      else if (kind !== 'hatch') faceGroup[id] = groupIndex(`kind:${kind}`);
    } else if (areaPt(id) >= minPiece * 16 && labels.some((l) => faceAt(l.at[0], l.at[1]) === id || (l.box && faceAt(l.box[0] - 3, l.at[1]) === id))) {
      faceGroup[id] = groupIndex('kind:plain');
    }
  }

  options.debug?.({ label: faces.label, w: g.w, h: g.h, res, kinds: kinds.map((k) => k.kind), group: faceGroup, groups: groupKeys, tagFaces: [...tagsIn].flatMap(([id, l]) => l.map((t) => `${t.code}@${t.at.map(Math.round)}->f${id}(${Math.round(areaPt(id))})`)) });

  // Pixels to groups; a face two codes share is split between their tags, nearest first.
  const owner = new Int16Array(g.w * g.h).fill(-1);
  for (let i = 0; i < owner.length; i++) {
    const id = faces.label[i];
    if (id >= 0 && faceGroup[id] >= 0) owner[i] = faceGroup[id];
  }
  // Where a face holds a lay-in code and a board one, the grid drawn decides between them;
  // otherwise (and within each) the nearest tag does.
  let gridMask: Uint8Array | null = null;
  const gridAt = () => {
    if (gridMask) return gridMask;
    const gridKeys = [...hatch.spacing].filter(([k]) => hatch.spacing.has(perpendicularKey(k)));
    const m = makeGrid(0, 0, W, H, res);
    drawSegments(m, [...hatch.lines].filter(([, k]) => gridKeys.some(([gk]) => gk === k)).map(([sg]) => sg));
    const r = Math.max(1, Math.ceil(0.6 * Math.max(0, ...gridKeys.map(([, sp]) => sp)) * res));
    gridMask = box(box(m.data, m.w, m.h, r, true), m.w, m.h, r, false);
    return gridMask;
  };
  for (const [id, list] of split) {
    const [x0, y0, x1, y1] = faces.bbox.subarray(4 * id, 4 * id + 4);
    const kindsOf = new Map(list.map((t) => [t.key, gridCode(t.key)] as const));
    const mixed = [...kindsOf.values()].includes(true) && [...kindsOf.values()].includes(false);
    if (!mixed) {
      // Two codes in one open space: split it at its narrows (a kitchenette open to a hall, a
      // corridor open to a shop), each part to the code tagged in it.
      const fw = x1 - x0 + 1;
      const fh = y1 - y0 + 1;
      const local = new Uint8Array(fw * fh);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (faces.label[y * g.w + x] === id) local[(y - y0) * fw + x - x0] = 1;
      // Narrows from a doorway up to a wide opening (a stair landing open to a hall).
      const at = list.map((t) => ({ key: t.key, x: t.at[0] * res - x0, y: t.at[1] * res - y0 }));
      let keyOf: (string | null)[] | null = null;
      keyOf = splitAtNarrows(local, fw, fh, at, [0.45, 0.9, 1.5].map((m) => Math.max(2, Math.round(pt(m, 6 * (m / 0.45)) * res))));      if (keyOf) {
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const k = keyOf[(y - y0) * fw + x - x0];
            if (k) owner[y * g.w + x] = groupIndex(`code:${k}`);
          }
        continue;
      }
    }
    const mask = mixed ? gridAt() : null;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * g.w + x;
        if (faces.label[i] !== id) continue;
        const px = (x + 0.5) / res;
        const py = (y + 0.5) / res;
        const onGrid = mask ? mask[i] === 1 : null;
        let best: CeilingTag | null = null;
        let bd = Infinity;
        for (const t of list) {
          if (onGrid !== null && kindsOf.get(t.key) !== onGrid) continue;
          const d = (t.at[0] - px) ** 2 + (t.at[1] - py) ** 2;
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (!best)
          for (const t of list) {
            const d = (t.at[0] - px) ** 2 + (t.at[1] - py) ** 2;
            if (d < bd) {
              bd = d;
              best = t;
            }
          }
        owner[i] = groupIndex(`code:${best!.key}`);
      }
  }

  // Each group's pieces, joined across the single lines between them, outlined on the lines.
  const index = new SegmentIndex(barrierLines, 32);
  const areas: CeilingArea[] = [];
  const close = Math.max(1, Math.round(res * 1.2));
  // No slivers: a ceiling piece under a square metre, or a strip too thin to stand in
  // (under 300 mm across, area over perimeter), is a gap between lines, not a ceiling.
  const minArea = pt(1, 10) ** 2;
  const minThick = pt(0.3, 3);
  const spelled = new Map<string, string>();
  for (const t of tags) if (!spelled.has(t.key)) spelled.set(t.key, t.code);
  for (let gi = 0; gi < groupKeys.length; gi++) {
    const gk = groupKeys[gi];
    let bx0 = g.w;
    let by0 = g.h;
    let bx1 = -1;
    let by1 = -1;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== gi) continue;
      const x = i % g.w;
      const y = (i - x) / g.w;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    if (bx1 < 0) continue;
    const m = close + 2;
    const ox = bx0 - m;
    const oy = by0 - m;
    const w = bx1 - bx0 + 1 + 2 * m;
    const h = by1 - by0 + 1 + 2 * m;
    let mask: Uint8Array = new Uint8Array(w * h);
    const other = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx < 0 || sy < 0 || sx >= g.w || sy >= g.h) continue;
        const o = owner[sy * g.w + sx];
        if (o === gi) mask[y * w + x] = 1;
        else if (o >= 0) other[y * w + x] = 1;
      }
    mask = closeMask(mask, w, h, close);
    for (let i = 0; i < mask.length; i++) if (other[i]) mask[i] = 0;
    for (const piece of components(mask, w, h)) {
      // Worked on in the piece's own box, a pixel of margin round it.
      const lx = piece.x0 - 1;
      const ly = piece.y0 - 1;
      const cw = piece.x1 - piece.x0 + 3;
      const chh = piece.y1 - piece.y0 + 3;
      const comp = new Uint8Array(cw * chh);
      const near = new Uint8Array(cw * chh);
      for (const i of piece.pixels) {
        const x = i % w;
        comp[((i - x) / w - ly) * cw + x - lx] = 1;
      }
      for (let y = 0; y < chh; y++)
        for (let x = 0; x < cw; x++) {
          const sx = x + lx;
          const sy = y + ly;
          if (sx >= 0 && sy >= 0 && sx < w && sy < h) near[y * cw + x] = other[sy * w + sx];
        }
      // Holes: filled, unless another ceiling is in them.
      const { filled, holes } = fillHolesKeeping(comp, cw, chh, near);
      const toPts = (ring: [number, number][]) =>
        snapRing(simplify(ring, 1).map(([x, y]) => [(x + lx + ox) / res, (y + ly + oy) / res] as Pt), index, barrierLines, 2.5 / res);
      const outer = toPts(traceBoundary(filled, cw, chh));
      if (outer.length < 3) continue;
      const holeRings = holes.map((hm) => toPts(traceBoundary(hm, cw, chh))).filter((r) => r.length >= 3);
      const area = Math.abs(ringArea(outer)) - holeRings.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
      const perimeter = outer.reduce((n, p, i) => n + Math.hypot(outer[(i + 1) % outer.length][0] - p[0], outer[(i + 1) % outer.length][1] - p[1]), 0);
      if (area < minArea || area / perimeter < minThick / 2) continue;
      const inside = (p: Pt) => pointInRing(p, outer) && !holeRings.some((r) => pointInRing(p, r));
      const mine = tags.filter((t) => inside(t.at) && (gk === `code:${t.key}` || !gk.startsWith('code:')));
      const heights = [...new Set(mine.filter((t) => t.height && !t.above).map((t) => t.height!))];
      const rooms = labels.filter((l) => inside(l.at)).map((l) => (/^[A-Za-z][A-Za-z0-9 .,&/'()-]{0,40}$/.test(l.name) ? `${l.number} ${l.name}` : l.number));
      const swatch = gk.startsWith('legend:') ? legend[Number(gk.slice(7))] : undefined;
      const code = gk.startsWith('code:') ? spelled.get(gk.slice(5)) ?? gk.slice(5) : (swatch?.code ?? null);
      // How it got its type: tagged in this piece, or carried from a tagged neighbour.
      const kindCount = new Map<CeilingKind, number>();
      for (const i of piece.pixels) {
        const x = i % w;
        const id = faces.label[((i - x) / w + oy) * g.w + x + ox];
        if (id >= 0) kindCount.set(kinds[id].kind, (kindCount.get(kinds[id].kind) ?? 0) + 1);
      }
      const kind = [...kindCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'plain';
      areas.push({
        points: outer,
        holes: holeRings,
        area,
        code,
        legend: swatch?.label,
        source: gk.startsWith('code:') ? 'tag' : gk.startsWith('legend:') ? 'legend' : 'fallback',
        kind: gk.startsWith('kind:') ? (gk.slice(5) as CeilingKind) : kind,
        height: heights.length ? heights.join(', ') : undefined,
        room: rooms.length ? rooms.join(', ') : undefined,
      });
    }
  }
  // A legend row starting with a code describes that code where no types table does.
  const described = mergeDefs([...defs, ...legend.filter((l) => l.code).map((l) => ({ code: l.code!, key: codeKey(l.code!), description: l.label, at: [l.box[0], l.box[1]] as Pt }))]);
  return { tagged: true, areas, tags, defs: described, legend: legend.map((l) => ({ label: l.label, kind: l.kind })) };
}

/** Definitions from several tables, first description of each code kept. */
export function mergeDefs(defs: CeilingDef[]): CeilingDef[] {
  const out = new Map<string, CeilingDef>();
  for (const d of defs) {
    const had = out.get(d.key);
    if (!had || (!had.description && d.description)) out.set(d.key, d);
  }
  return [...out.values()];
}

/** Legend lines that are not a ceiling finish, though they may name a ceiling ("Light fixture in GWB ceiling"). */
const NOT_A_FINISH = /light|fixture|lumin|lamp|diffuser|grille|register|\bfan\b|detector|sensor|speaker|sprinkler|\bexit\b|sign\b|access panel|\btag\b|height|heater|camera|alarm|outlet|switch|hatch(?:es)?\b(?!\s*denotes)|elevation|a\.f\.f|\bwall\b|partition|beam/i;

export interface CeilingSwatch {
  /** The legend line, its code taken off ("609x1219" for "SAT1 609x1219"). */
  label: string;
  /** A type code the line starts with (SAT1, ACT-1). */
  code?: string;
  /** What its swatch shows, and the line classes drawing it. */
  kind: CeilingKind;
  keys: string[];
  /** What its words say it is drawn as: a lay-in grid, gypsum (stipple). */
  implied?: CeilingKind;
  /** The swatch and its words, on the sheet. */
  box: Box;
}

/** A legend line naming a ceiling finish: its words (and a code it starts with). */
function finishLine(label: string): { code?: string; label: string; implied?: CeilingKind } | null {
  const first = label.split(/\s+/)[0].replace(/[:.,]+$/, '');
  const lead = CODE.exec(first);
  if (!(CEILING_WORDS.test(label) || (lead && CEILING_PREFIX.test(lead[1]))) || NOT_A_FINISH.test(label)) return null;
  // A note under a legend row ("Refer to reflected ceiling plans") names no finish.
  if (/^(?:refer|see|as)\b/i.test(label.trim())) return null;
  // A sample tag's callouts ("Ceiling material", "Ceiling type") name no finish.
  if (/^(?:ceiling|clg\.?)\s+(?:material|type|finish|tag|code)s?$/i.test(label.trim())) return null;
  const implied: CeilingKind | undefined = /lay-?in|acoustic|\bact\b|t-?bar|ceiling tile|\bsat\d?\b|grid/i.test(label)
    ? 'grid'
    : /gyp|\bgwb\b|\bgb\b|drywall|wallboard|plaster/i.test(label)
      ? 'stipple'
      : undefined;
  const rest = lead ? label.slice(label.indexOf(first) + first.length).replace(/^[\s:.,–-]+/, '').trim() : label;
  return { ...(lead ? { code: first } : {}), label: rest || label, ...(implied ? { implied } : {}) };
}

/**
 * The ceiling finishes a sheet's legends show, framed or not: under a legend heading ("RCP
 * legend", "Ceiling legend"), each block of words naming a ceiling material (wrapped lines
 * joined) with the swatch drawn just left of it, and what the swatch shows: a grid, a stipple,
 * a hatch. A line naming a ceiling plainly ("610x1220 acoustic ceiling tile") stands for the
 * plan's grid or stipple even when its swatch is an empty box. Framed legends (`frames`) are
 * read by their rows as before.
 */
export function ceilingSwatches(texts: PageText[], segs: Segment[], marks: Mark[], width: number, height: number, avoid: Box[] = [], frames: Box[] = []): CeilingSwatch[] {
  const out: CeilingSwatch[] = [];
  const add = (label: string, graphic: Box, box: Box) => {
    const line = finishLine(label);
    if (!line) return;
    const { kind, keys } = swatchKind(marks, segs, graphic);
    if (kind === 'plain' && !line.implied) return;
    if (out.some((o) => o.box[0] === box[0] && o.box[1] === box[1])) return;
    out.push({ ...line, kind, keys, box });
  };
  for (const f of frames)
    for (const r of readLegendRows(texts, segs, f)) if (r.graphic) add(r.label, r.graphic, [Math.min(r.graphic[0], f[0]), r.graphic[1], f[2], r.graphic[3]]);
  const inBoxes = (x: number, y: number, boxes: Box[]) => boxes.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  const heads = texts.filter((t) => upright(t) && isLegendHeading(t.str) && !inBoxes(t.cx, t.cy, [...avoid, ...frames]));
  const lineSegs = segs.filter((sg) => !(sg.filled && /^#f{6}$/i.test(sg.color ?? '')));
  // Long upright lines: a legend's frame, the drawing's border. Words beyond one from the
  // heading are another drawing's (the plan's tags beside a legend column), not the legend's.
  const uprights = lineSegs.filter((sg) => Math.abs(sg.x2 - sg.x1) < 0.5 && Math.abs(sg.y2 - sg.y1) > 40);
  const walledOff = (head: PageText, t: PageText) => {
    const [xa, xb] = t.cx > head.cx ? [head.cx + head.w / 2, t.cx - t.w / 2] : [t.cx + t.w / 2, head.cx - head.w / 2];
    if (xb <= xa) return false;
    const ya = Math.min(head.cy, t.cy);
    const yb = Math.max(head.cy, t.cy);
    return uprights.some((sg) => sg.x1 > xa && sg.x1 < xb && Math.min(sg.y1, sg.y2) <= ya && Math.max(sg.y1, sg.y2) >= yb);
  };
  for (const head of heads) {
    const h = head.h;
    const hl = head.cx - head.w / 2;
    const region: Box = [hl - 15 * h, head.cy + 0.5 * h, Math.min(width, hl + width * 0.35), Math.min(height, head.cy + height * 0.45)];
    const words = texts
      .filter((t) => upright(t) && t !== head && t.cx >= region[0] && t.cx <= region[2] && t.cy >= region[1] && t.cy <= region[3] && /[A-Za-z0-9]{2}/.test(t.str) && !inBoxes(t.cx, t.cy, avoid) && !walledOff(head, t))
      .sort((a, b) => a.cy - b.cy);
    // Blocks: lines starting at one left edge, each close under the last.
    const blocks: { left: number; top: number; bottom: number; right: number; h: number; parts: PageText[] }[] = [];
    for (const t of words) {
      const l = t.cx - t.w / 2;
      const b = blocks.find((k) => Math.abs(k.left - l) <= 2 && t.cy > k.bottom && t.cy - k.bottom < 1.9 * Math.max(k.h, t.h));
      if (b) {
        b.bottom = t.cy;
        b.right = Math.max(b.right, t.cx + t.w / 2);
        b.parts.push(t);
      } else blocks.push({ left: l, top: t.cy, bottom: t.cy, right: t.cx + t.w / 2, h: t.h, parts: [t] });
    }
    for (const b of blocks) {
      const label = b.parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
      if (!finishLine(label)) continue;
      // The swatch: linework wholly left of the words, level with them (a swatch taller than
      // the words: the shapes reaching their line, whole), nearest first.
      const y0 = b.top - 1.6 * b.h;
      const y1 = b.bottom + 1.6 * b.h;
      const left = lineSegs.filter((sg) => Math.max(sg.x1, sg.x2) < b.left - 1 && Math.min(sg.x1, sg.x2) > b.left - 20 * b.h && Math.min(sg.y1, sg.y2) >= b.top - 6 * b.h && Math.max(sg.y1, sg.y2) <= b.bottom + 6 * b.h);
      const level = left.filter((sg) => Math.max(sg.y1, sg.y2) >= y0 && Math.min(sg.y1, sg.y2) <= y1);
      const shapes = new Set(level.filter((sg) => sg.sub !== undefined && !sg.filled).map((sg) => sg.sub));
      const whole = left.filter((sg) => sg.sub !== undefined && shapes.has(sg.sub));
      const fy0 = Math.min(y0, ...whole.map((sg) => Math.min(sg.y1, sg.y2))) - 0.5;
      const fy1 = Math.max(y1, ...whole.map((sg) => Math.max(sg.y1, sg.y2))) + 0.5;
      const near = left.filter((sg) => Math.min(sg.y1, sg.y2) >= fy0 && Math.max(sg.y1, sg.y2) <= fy1);
      if (!near.length) continue;
      // Only the cluster next to the words, not another column's graphics further left.
      near.sort((p, q) => Math.max(q.x1, q.x2) - Math.max(p.x1, p.x2));
      let gx0 = Math.min(near[0].x1, near[0].x2);
      for (const sg of near) {
        if (Math.max(sg.x1, sg.x2) < gx0 - 3 * b.h) break;
        gx0 = Math.min(gx0, sg.x1, sg.x2);
      }
      const mine = near.filter((sg) => Math.min(sg.x1, sg.x2) >= gx0 - 0.01);
      const graphic: Box = [gx0, Math.min(...mine.map((sg) => Math.min(sg.y1, sg.y2))), Math.max(...mine.map((sg) => Math.max(sg.x1, sg.x2))), Math.max(...mine.map((sg) => Math.max(sg.y1, sg.y2)))];
      add(label, graphic, [graphic[0], Math.min(graphic[1], b.top - b.h), b.right, Math.max(graphic[3], b.bottom + b.h)]);
    }
  }
  return out;
}

/** What a legend swatch shows: its hatch lines, its stipple, or nothing. */
function swatchKind(marks: Mark[], segs: Segment[], [x0, y0, x1, y1]: Box): { kind: CeilingKind; keys: string[] } {
  const inset = 1.2;
  const within = (x: number, y: number) => x > x0 + inset && x < x1 - inset && y > y0 + inset && y < y1 - inset;
  const dots = marks.filter((m) => m.size < 1.2 && within(m.cx, m.cy));
  if (dots.length >= 3) return { kind: 'stipple', keys: [...new Set(dots.map((m) => m.key))] };
  const lines = segs.filter((sg) => !sg.filled && !sg.curve && Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1) > 2 && within((sg.x1 + sg.x2) / 2, (sg.y1 + sg.y2) / 2));
  const keys = [...new Set(lines.map(segmentKey))];
  const dirs = new Set(keys.map((k) => k.split(' ')[1]));
  if (dirs.size >= 2) return { kind: 'grid', keys };
  if (lines.length >= 2) return { kind: 'hatch', keys };
  return { kind: 'plain', keys: [] };
}

/**
 * A space's pixels shared out between the codes tagged in it, at its narrows: the space is
 * eroded by the first radius (half the narrowest neck kept whole), each part left takes the
 * code tagged in it, and every pixel goes to the part it reaches first inside the space; a part
 * still holding two codes is split the same way at the next (wider) radius, and shared by
 * nearest tag when none is left. Null when no neck separates any codes.
 */
export function splitAtNarrows(mask: Uint8Array, w: number, h: number, tags: { key: string; x: number; y: number }[], radii: number | number[]): (string | null)[] | null {
  const rs = Array.isArray(radii) ? radii : [radii];
  for (let ri = 0; ri < rs.length; ri++) {
    const got = splitOnce(mask, w, h, tags, rs[ri]);
    if (!got) continue;
    const { out, parts } = got;
    // Parts still shared by two codes: their own narrows, further out.
    for (const part of parts) {
      if (new Set(part.tags.map((t) => t.key)).size < 2) continue;
      const sub = new Uint8Array(w * h);
      for (const i of part.pixels) sub[i] = 1;
      const inner = ri + 1 < rs.length ? splitAtNarrows(sub, w, h, part.tags, rs.slice(ri + 1)) : null;
      for (const i of part.pixels) {
        if (inner) out[i] = inner[i] ?? out[i];
        else {
          const x = i % w;
          const y = (i - x) / w;
          let best = part.tags[0];
          for (const t of part.tags) if ((t.x - x) ** 2 + (t.y - y) ** 2 < (best.x - x) ** 2 + (best.y - y) ** 2) best = t;
          out[i] = best.key;
        }
      }
    }
    return out;
  }
  return null;
}

function splitOnce(mask: Uint8Array, w: number, h: number, tags: { key: string; x: number; y: number }[], r: number): { out: (string | null)[]; parts: { tags: typeof tags; pixels: number[] }[] } | null {
  const eroded = box(mask, w, h, r, false);
  for (let i = 0; i < eroded.length; i++) if (!mask[i]) eroded[i] = 0;
  const comp = new Int32Array(w * h).fill(-1);
  const pieces = components(eroded, w, h);
  pieces.forEach((p, ci) => {
    for (const i of p.pixels) comp[i] = ci;
  });
  if (pieces.length < 2) return null;
  // Each tag's piece: the first piece pixel reached from it inside the space.
  const reach = (sx: number, sy: number): number => {
    const start = Math.max(0, Math.min(h - 1, Math.round(sy))) * w + Math.max(0, Math.min(w - 1, Math.round(sx)));
    const seen = new Uint8Array(w * h);
    const queue = [start];
    seen[start] = 1;
    for (let q = 0; q < queue.length && q < 40000; q++) {
      const i = queue[q];
      if (comp[i] >= 0) return comp[i];
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return -1;
  };
  const byPiece = new Map<number, typeof tags>();
  for (const t of tags) {
    const ci = reach(t.x, t.y);
    if (ci >= 0) (byPiece.get(ci) ?? byPiece.set(ci, []).get(ci)!).push(t);
  }
  // Worth it only when the narrows put the codes in different pieces.
  if (byPiece.size < 2) return null;
  const owner = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (const ci of byPiece.keys())
    for (const i of pieces[ci].pixels) {
      owner[i] = ci;
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j < 0 || j >= w * h || !mask[j] || owner[j] >= 0) continue;
      owner[j] = owner[i];
      queue.push(j);
    }
  }
  const out: (string | null)[] = new Array(w * h).fill(null);
  const parts = new Map<number, { tags: typeof tags; pixels: number[] }>();
  for (const [ci, list] of byPiece) parts.set(ci, { tags: list, pixels: [] });
  for (let i = 0; i < owner.length; i++) {
    if (owner[i] < 0) continue;
    const part = parts.get(owner[i])!;
    part.pixels.push(i);
    out[i] = part.tags[0].key;
  }
  return { out, parts: [...parts.values()] };
}

/** Closing (dilate then erode) with a square of radius r. */
function closeMask(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return box(box(src, w, h, r, true), w, h, r, false);
}

function box(src: Uint8Array, w: number, h: number, r: number, max: boolean): Uint8Array {
  const pass = (a: Uint8Array, rows: boolean) => {
    const out = new Uint8Array(w * h);
    const [outer, inner] = rows ? [h, w] : [w, h];
    const at = (o: number, k: number) => (rows ? o * w + k : k * w + o);
    for (let o = 0; o < outer; o++) {
      let count = 0;
      const val = (k: number) => (k < 0 || k >= inner ? (max ? 0 : 1) : a[at(o, k)]);
      for (let k = -r; k <= r; k++) count += val(k);
      for (let k = 0; k < inner; k++) {
        out[at(o, k)] = max ? (count > 0 ? 1 : 0) : count === 2 * r + 1 ? 1 : 0;
        count += val(k + r + 1) - val(k - r);
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** The 4-connected pieces of a mask: their pixels and boxes. */
function components(mask: Uint8Array, w: number, h: number): { pixels: number[]; x0: number; y0: number; x1: number; y1: number }[] {
  const seen = new Uint8Array(w * h);
  const out: { pixels: number[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const pixels: number[] = [];
    let [x0, y0, x1, y1] = [w, h, 0, 0];
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    while (top) {
      const i = stack[--top];
      pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= mask.length || seen[j] || !mask[j]) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    out.push({ pixels, x0, y0, x1, y1 });
  }
  return out;
}

/** Fills a piece's holes (lights, tags, columns) except those another ceiling lies in, which stay holes. */
function fillHolesKeeping(comp: Uint8Array, w: number, h: number, other: Uint8Array): { filled: Uint8Array; holes: Uint8Array[] } {
  const filled = Uint8Array.from(comp);
  const holes: Uint8Array[] = [];
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!comp[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x);
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] || outside[s] || seen[s]) continue;
    const hole = new Uint8Array(w * h);
    const list = [s];
    seen[s] = 1;
    let others = 0;
    let n = 0;
    while (list.length) {
      const i = list.pop()!;
      hole[i] = 1;
      n++;
      if (other[i]) others++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= comp.length || seen[j] || comp[j] || outside[j]) continue;
        seen[j] = 1;
        list.push(j);
      }
    }
    if (others > n * 0.3) holes.push(hole);
    else for (let i = 0; i < hole.length; i++) if (hole[i]) filled[i] = 1;
  }
  return { filled, holes };
}

/** Snaps an outline's edges onto the drawn lines near it. */
function snapRing(ring: Pt[], index: SegmentIndex, lines: Segment[], tol: number): Pt[] {
  if (ring.length < 3) return ring;
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const near = index.query(minOf(xs) - 3, minOf(ys) - 3, maxOf(xs) + 3, maxOf(ys) + 3).map((i) => lines[i]);
  const snapped = snapToLines(ring, near, tol);
  // A snap that wrecked the outline (a corner pulled far off) is not used.
  const a0 = Math.abs(ringArea(ring));
  const a1 = Math.abs(ringArea(snapped));
  return snapped.length >= 3 && Math.abs(a1 - a0) <= a0 * 0.08 + 4 ? snapped : ring;
}

/** What a ceiling plan shows: new work, ceilings to demolish, or existing ceilings to take down and put back. */
export type CeilingPlanKind = 'new' | 'demo' | 'reinstate';

/** From the sheet's title: a demolition plan, an existing plan (no new ceiling shown), or any other. */
export const ceilingPlanKind = (title: string): CeilingPlanKind => (/DEMO|REMOVAL/i.test(title) ? 'demo' : /EXISTING/i.test(title) ? 'reinstate' : 'new');

export interface CeilingTypeSpec {
  name: string;
  division: string;
  package: string;
  items: { name: string; unit: string; formula: string }[];
  /** The ceiling types table's description, for a coded type. */
  description?: string;
}

/**
 * The takeoff type an area goes under: one per ceiling type code (named by the code and its
 * description), per legend row, or per kind drawn when neither says. A sheet with no tags keeps
 * the grid reading's three types (new T-bar, demolish, remove & reinstate).
 */
export function ceilingTypeFor(a: CeilingArea, read: { tagged: boolean; defs: CeilingDef[] }, plan: CeilingPlanKind, metric: boolean): CeilingTypeSpec {
  const area = metric ? 'm²' : 'SF';
  const len = metric ? 'm' : 'ft';
  const tile = metric ? 0.72 : 8;
  const tbar = [
    { name: 'Ceiling area', unit: area, formula: 'A' },
    { name: metric ? 'Tiles 600×1200 + 5%' : 'Tiles 2×4 + 5%', unit: 'ea', formula: `ceil(A / ${tile} * 1.05)` },
    { name: metric ? 'Main tees @ 1200, 3.66 m long' : "Main tees @ 4', 12' long", unit: 'ea', formula: metric ? 'ceil(A / 1.2 / 3.66)' : 'ceil(A / 4 / 12)' },
    { name: metric ? '1200 cross tees @ 600' : "4' cross tees @ 2'", unit: 'ea', formula: `ceil(A / ${tile})` },
    { name: 'Wall angle', unit: len, formula: 'P' },
    { name: metric ? 'Hanger wires @ 1200×1200' : "Hanger wires @ 4'×4'", unit: 'ea', formula: metric ? 'ceil(A / 1.44)' : 'ceil(A / 16)' },
  ];
  const finishes = { division: '09 Finishes', package: 'Drywall & ceilings' };
  if (!read.tagged) {
    if (plan === 'demo') return { name: 'Ceiling – demolish existing', division: '02 Existing Conditions', package: 'Demolition & abatement', items: [{ name: 'Existing ceiling to demolish', unit: area, formula: 'A' }] };
    if (plan === 'reinstate') return { name: 'Ceiling – remove & reinstate existing tiles', ...finishes, items: [{ name: 'Existing ceiling to remove and reinstate', unit: area, formula: 'A' }] };
    return { name: metric ? 'Ceiling – new suspended T-bar, 600×1200' : 'Ceiling – new suspended T-bar, 2×4', ...finishes, items: tbar };
  }
  const description = a.code ? read.defs.find((d) => d.key === codeKey(a.code!))?.description || undefined : undefined;
  // Untyped areas named by what is drawn in them, in the words an estimator uses.
  const KIND: Record<CeilingKind, string> = {
    grid: 'ACT, acoustic tile in a lay-in grid (untagged)',
    stipple: 'GWB, gypsum board (stippled, untagged)',
    hatch: 'hatched (untagged)',
    plain: a.legend ? a.legend : 'open / none shown (untagged)',
  };
  const base = a.code ? `${a.code} – ${description ?? a.legend ?? 'ceiling'}` : a.legend && a.source === 'legend' ? `Ceiling – ${a.legend}` : `Ceiling – ${KIND[a.kind]}`;
  if (plan === 'demo') return { name: `${base} – demolish`, division: '02 Existing Conditions', package: 'Demolition & abatement', items: [{ name: 'Existing ceiling to demolish', unit: area, formula: 'A' }], description };
  if (plan === 'reinstate') return { name: `${base} – remove & reinstate`, ...finishes, items: [{ name: 'Existing ceiling to remove and reinstate', unit: area, formula: 'A' }], description };
  const words = `${description ?? ''} ${a.legend ?? ''}`;
  const existing = /^\s*existing|to remain/i.test(words);
  const layIn = /lay-?in|\blap\b|acoustic|\bact\b|t-bar|suspended/i.test(words) || (!words.trim() && a.kind === 'grid');
  const items = !existing && layIn ? tbar : [{ name: 'Ceiling area', unit: area, formula: 'A' }, { name: 'Perimeter', unit: len, formula: 'P' }];
  return { name: base, ...finishes, items, description };
}

/** A name for one ceiling area: the room(s) it covers and its height. */
export const ceilingLabel = (a: CeilingArea): string | undefined => [a.room, a.height && `h ${a.height}`].filter(Boolean).join(' · ') || undefined;
