import type { Segment } from '../fill/vectors';
import type { PageText } from '../pageText';

/**
 * Any schedule on a sheet, read by its own columns: a door schedule, a window schedule, a room
 * finish schedule, an equipment or lintel schedule. Nothing is set up per firm: the table is
 * found under its title, its rows by the marks down its first column of tags (D101, W1, 105,
 * EF-1), its columns by the table's rules (or the gaps between its cells when it has none), and
 * each column is named by the headings over it, group headings included (FRAME over MATERIAL).
 */

export type ScheduleKind = 'door' | 'window' | 'room' | 'wall' | 'hardware' | 'structure' | 'other';

export interface ScheduleRow {
  mark: string;
  /** One cell per column, '' when empty; a bullet or check is "✓". */
  cells: string[];
  /** The row on its sheet: x0, y0, x1, y1. */
  box?: [number, number, number, number];
}

export interface Schedule {
  title: string;
  kind: ScheduleKind;
  /** Each column's headings, the group's first (["FRAME", "MATERIAL"]). */
  columns: string[][];
  /** The column holding the marks. */
  markColumn: number;
  rows: ScheduleRow[];
  /** Where the table is on its sheet: x0, y0, x1, y1. */
  box: [number, number, number, number];
}

export function scheduleKind(title: string): ScheduleKind {
  const t = title.toUpperCase();
  if (/HARDWARE/.test(t)) return 'hardware';
  if (/\bDOORS?\b|\bFRAMES?\b/.test(t)) return 'door';
  if (/WINDOW|GLAZING|STOREFRONT|CURTAIN ?WALL|SCREEN|LOUVRE/.test(t)) return 'window';
  if (/\bWALLS?\b|PARTITION|ASSEMBL/.test(t)) return 'wall';
  if (/FINISH|\bROOMS?\b/.test(t)) return 'room';
  if (/LINTEL|BEAM|COLUMN|FOOTING|PILE|JOIST|PIER|SLAB|REBAR|CONNECTION/.test(t)) return 'structure';
  return 'other';
}

/** A schedule's title, not a note pointing at one (PER SCHEDULE, SEE DOOR SCHEDULE). */
const TITLE = /\bSCHEDULE\b|^(WALL|PARTITION|FLOOR|ROOF|CEILING)\s+(ASSEMBLIES|TYPES)$/i;
const NOT_TITLE = /\b(PER|SEE|REFER|AS|TO|IN|ON|WITH|FOR|FROM|OF|AND)\s+(THE\s+)?([A-Z/&]+\s+){0,3}SCHEDULES?\b|^(SCHEDULES?|AND SCHEDULES?)$|\bNOTES?\b|^SCHEDULES?\s+(AND|FOR|TO|ON|IN|AT|WITH|IS|ARE)\b|\bSCHEDULES?\s+(INDICATES?|SHOWS?|IS|ARE)\b|[.&,:;]\s*$/i;

/** A row's mark: D101, 101A, D000.1, W1, SC-2, EF-1, 000, B12, a fixture type A or J1, a strip footing S/F-5. */
const MARK = /^(?:[A-Z]{0,4}[-.]?\d{1,4}[A-Z]{0,2}(?:[-.]\d{1,3}[A-Z]?)?|[A-Z]{1,3}[-.]?\d{0,2}[A-Z]?|[A-Z]{1,2}\/[A-Z]{1,2}[-.]?\d{1,3}[A-Z]?)$/;

/** A column's heading word, not a row's mark (NO., TAG, ITEM, MARK). */
const HEAD_WORD = /^(NO\.?|NOS?\.?|NUMBER|#|TAG|TAGS|ITEM|MARK|TYPE|ID|REF\.?|SYM\.?|SYMBOL|KEY|CODE|ROOM|ZONE|UNIT|QTY\.?|SIZE|HP|KW|SP|ESP|RPM|TONS?|CFM|GPM|MBH|DB|WB|EAT|LAT)$/i;
/** A mark that names one thing on its own (ERV-1, MUA-1, HOOD-1): a one-row schedule's. */
const STRONG = /^[A-Z]{1,5}-\d{1,3}[A-Z]?$/;

const level = (t: PageText) => !t.angle || Math.abs(Math.sin(t.angle)) < 0.1;
const turned = (t: PageText) => t.angle !== undefined && Math.abs(Math.abs(Math.sin(t.angle)) - 1) < 0.1;
/** A text's extent across the page (a turned heading is as wide as its letters are tall). */
const xSpan = (t: PageText): [number, number] => (turned(t) ? [t.cx - t.h / 2, t.cx + t.h / 2] : [t.cx - t.w / 2, t.cx + t.w / 2]);
const ySpan = (t: PageText): [number, number] => (turned(t) ? [t.cy - t.w / 2, t.cy + t.w / 2] : [t.cy - t.h / 2, t.cy + t.h / 2]);

/** A tick in a yes/no column. */
const TICK = /^[●•✓✔xX■◼◆*]$/;
const clean = (s: string) => (TICK.test(s.trim()) ? '✓' : s.replace(/\s+/g, ' ').trim());
/** A cell's pieces as one value: a tick alone is a tick; bullets among words start lines (a description's list). */
const joinCell = (pieces: string[]) => (pieces.length === 1 ? pieces[0] : pieces.join(' ').replace(/\s*✓\s*/g, '\n').trim());

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Vertical rules (x) crossing height `y` between x0 and x1. */
function rulesAt(vert: Segment[], y: number, x0: number, x1: number): number[] {
  return vert.filter((s) => Math.min(s.y1, s.y2) < y - 0.5 && Math.max(s.y1, s.y2) > y + 0.5 && s.x1 > x0 - 2 && s.x1 < x1 + 2).map((s) => s.x1);
}

/** Clusters close values (within `tol`) to their mean. */
function cluster(xs: number[], tol: number): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x - last[last.length - 1] <= tol) last.push(x);
    else out.push([x]);
  }
  return out.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

/** Reads every schedule on a sheet. */
export function readSchedules(texts: PageText[], segs: Segment[] = []): Schedule[] {
  const lines = segs.filter((s) => !s.filled);
  const vert = lines.filter((s) => Math.abs(s.x1 - s.x2) < 0.6 && Math.abs(s.y2 - s.y1) > 2).map((s) => ({ ...s, x1: (s.x1 + s.x2) / 2, x2: (s.x1 + s.x2) / 2 }));
  const horiz = lines.filter((s) => Math.abs(s.y1 - s.y2) < 0.6 && Math.abs(s.x2 - s.x1) > 20);
  const titles = texts.filter((t) => level(t) && TITLE.test(t.str) && !NOT_TITLE.test(t.str) && t.str.trim().split(/\s+/).length <= 7);
  const out: Schedule[] = [];
  const used = new Set<PageText>();
  for (const title of titles.sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const s = readOne(title, texts, titles, vert, horiz, used);
    if (s) out.push(s);
  }
  return out;
}

function readOne(title: PageText, texts: PageText[], titles: PageText[], vert: Segment[], horiz: Segment[], used: Set<PageText>): Schedule | null {
  const th = title.h;
  const top = title.cy + th * 0.6;
  // The table's width: the longest rule drawn across under the title (its frame), else a wide band round it.
  const under = horiz
    .filter((s) => Math.min(s.y1, s.y2) > title.cy - th && Math.min(s.y1, s.y2) < title.cy + 4 * th && Math.min(s.x1, s.x2) < title.cx && Math.max(s.x1, s.x2) > title.cx)
    .sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1))[0];
  let L = under ? Math.min(under.x1, under.x2) : title.cx - 60 * th;
  let R = under ? Math.max(under.x1, under.x2) : title.cx + 60 * th;
  // Not into another schedule beside this one.
  for (const o of titles) {
    if (o === title || Math.abs(o.cy - title.cy) > 3 * th) continue;
    if (o.cx < title.cx) L = Math.max(L, (o.cx + o.w / 2 + title.cx - title.w / 2) / 2);
    else R = Math.min(R, (o.cx - o.w / 2 + title.cx + title.w / 2) / 2);
  }
  // Down to the next schedule's title below in this band.
  const next = titles.filter((o) => o !== title && o.cy > title.cy + 2 * th && o.cx > L && o.cx < R).sort((a, b) => a.cy - b.cy)[0];
  const bottom = next ? next.cy - next.h : title.cy + 2400;

  // The mark column: the leftmost column of marks lined up on their left edge (or centred).
  // A metric bar size (15M, 20M) in a reinforcing column is not a row's mark.
  const marks = texts.filter((t) => level(t) && !used.has(t) && t.cy > top && t.cy < bottom && t.cx > L - 2 && t.cx < R + 2 && MARK.test(t.str.trim()) && !HEAD_WORD.test(t.str.trim()) && !/^\d{2}M$/.test(t.str.trim()));
  if (marks.length < 1) return null;
  const groups = new Map<string, PageText[]>();
  for (const t of marks) {
    for (const k of [`l${Math.round((t.cx - t.w / 2) / 2)}`, `c${Math.round(t.cx / 2)}`]) groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  // Neighbouring keys (a mark a point off) count together.
  const merged = [...groups.entries()].map(([k, v]) => {
    const n = +k.slice(1);
    const near = [n - 1, n + 1].flatMap((m) => groups.get(`${k[0]}${m}`) ?? []);
    return [...new Set([...v, ...near])];
  });
  const best = Math.max(...merged.map((g) => g.length));
  const leftOf = (g: PageText[]) => Math.min(...g.map((t) => t.cx - t.w / 2));
  // A one-row schedule (a single ERV): its one mark names the thing (ERV-1), at the table's left.
  const qualifies = (g: PageText[]) => g.length >= Math.max(2, best * 0.4) || (g.length === 1 && STRONG.test(g[0].str.trim()) && g[0].cy - top < 300);
  const candidates = merged.filter(qualifies);
  if (!candidates.length) return null;
  const x0 = Math.min(...candidates.map(leftOf));
  const mh = median(marks.map((t) => t.h));
  // Groups starting about there are one column read two ways (left-aligned, centred): the fuller one.
  const col = candidates.filter((g) => leftOf(g) - x0 < 4 * mh).sort((a, b) => b.length - a.length)[0];
  let rowsAt = [...col].sort((a, b) => a.cy - b.cy);
  // The rows: down from the header, to the first big gap (the schedule has ended).
  const pitch = Math.max(3, median(rowsAt.slice(1).map((r, i) => r.cy - rowsAt[i].cy)));
  if (rowsAt[0].cy - top > 400) return null;
  const kept = [rowsAt[0]];
  for (const r of rowsAt.slice(1)) {
    if (r.cy - kept[kept.length - 1].cy > 4 * pitch + 2) break;
    kept.push(r);
  }
  rowsAt = kept;
  const rh = median(rowsAt.map((r) => r.h));
  // Each row between the rules round its mark (a tall row's mark sits mid-row, its cells from its top),
  // else from just over its mark to just over the next one.
  const across = (y0: number, y1: number, x: number) =>
    horiz.filter((s) => s.y1 > y0 && s.y1 < y1 && Math.min(s.x1, s.x2) < x - 0.5 && Math.max(s.x1, s.x2) > x + 0.5).map((s) => s.y1);
  const bands = rowsAt.map((r, i) => {
    const prev = i > 0 ? rowsAt[i - 1].cy : r.cy - 6 * Math.max(pitch, 2 * r.h);
    const nxt = i + 1 < rowsAt.length ? rowsAt[i + 1].cy : r.cy + 6 * Math.max(pitch, 2 * r.h);
    const above = across(prev + r.h * 0.4, r.cy - r.h * 0.4, r.cx);
    const below = across(r.cy + r.h * 0.4, nxt - r.h * 0.4, r.cx);
    return [above.length ? Math.max(...above) : null, below.length ? Math.min(...below) : null] as [number | null, number | null];
  });
  const ruled = bands.filter(([a, b]) => a !== null && b !== null).length >= rowsAt.length * 0.6;
  const bandOf = (i: number): [number, number] => {
    const r = rowsAt[i];
    if (ruled) {
      const [a, b] = bands[i];
      const top = a ?? (i > 0 ? bandOf(i - 1)[1] : r.cy - rh * 0.8);
      const bot = b ?? (i + 1 < rowsAt.length ? (bands[i + 1][0] ?? rowsAt[i + 1].cy - rh * 0.75) : r.cy + Math.max(pitch, 2 * rh) - rh * 0.75);
      return [top, bot];
    }
    return [r.cy - rh * 0.75, i + 1 < rowsAt.length ? rowsAt[i + 1].cy - rh * 0.75 : r.cy + Math.max(pitch, 2 * rh) - rh * 0.75];
  };
  const first = bandOf(0)[0];
  const bandEnd = (i: number) => bandOf(i)[1];

  // The texts of the table body.
  const body = texts.filter((t) => level(t) && t.cy > first - 0.5 && t.cy < bandEnd(rowsAt.length - 1) && t.cx > L - 2 && t.cx < R + 2);
  // Tighten the width to what the rows hold, when no frame was found.
  if (!under && body.length) {
    const span = body.filter((t) => rowsAt.some((r) => Math.abs(r.cy - t.cy) < pitch * 0.45));
    L = Math.max(L, Math.min(...span.map((t) => t.cx - t.w / 2)) - 4);
    R = Math.min(R, Math.max(...span.map((t) => t.cx + t.w / 2)) + 4);
  }

  // Column edges: the table's rules crossing most rows, else the gaps between its cells.
  const counts = new Map<number, number>();
  for (const r of rowsAt) for (const x of new Set(cluster(rulesAt(vert, r.cy, L, R), 1.2).map((x) => Math.round(x)))) counts.set(x, (counts.get(x) ?? 0) + 1);
  let edges = cluster(
    [...counts].filter(([, n]) => n >= rowsAt.length * 0.5).map(([x]) => x),
    2,
  );
  if (edges.length < 3) edges = gapEdges(body, L, R, rh);
  else {
    if (edges[0] > L + 4 && edges[0] > Math.min(...rowsAt.map((r) => r.cx - r.w / 2)) - 1) edges.unshift(L);
    if (edges[edges.length - 1] < R - 4) edges.push(R);
  }
  const cols = edges.slice(1).map((x, i) => [edges[i], x] as [number, number]).filter(([a, b]) => b - a > 1.5);
  if (cols.length < 2) return null;
  const colAt = (x: number) => cols.findIndex(([a, b]) => x >= a - 0.5 && x <= b + 0.5);
  const markColumn = colAt(rowsAt[0].cx);
  if (markColumn < 0) return null;

  // Headings: the texts between the title and the first row, each over the columns its cell spans.
  const heads = texts.filter((t) => (level(t) || turned(t)) && t !== title && ySpan(t)[0] > title.cy + th * 0.4 && t.cy < first && t.cx > L - 2 && t.cx < R + 2 && first - ySpan(t)[1] < 260);
  const columns: string[][] = cols.map(() => []);
  const order: { col: number; t: PageText }[] = [];
  for (const t of heads) {
    const [x0, x1] = xSpan(t);
    // Its cell: the rules round it at its height (a group heading's cell spans its columns).
    const at = cluster(rulesAt(vert, t.cy, L, R), 1.2);
    const lo = at.filter((x) => x <= x0 + 1).pop() ?? x0;
    const hi = at.find((x) => x >= x1 - 1) ?? x1;
    cols.forEach(([a, b], i) => {
      const mid = (a + b) / 2;
      if ((mid >= lo && mid <= hi) || (x0 + x1) / 2 >= a && (x0 + x1) / 2 <= b) order.push({ col: i, t });
    });
  }
  // A note written over the whole table (REFER TO SPECIFICATION…) heads no column.
  const spread = new Map<PageText, number>();
  for (const o of order) spread.set(o.t, (spread.get(o.t) ?? 0) + 1);
  order.sort((p, q) => ySpan(p.t)[0] - ySpan(q.t)[0] || p.t.cx - q.t.cx);
  for (const { col: i, t } of order) if (cols.length < 4 || spread.get(t)! <= cols.length * 0.6) columns[i].push(clean(t.str));

  // Cells, row by row.
  const taken = new Set<PageText>();
  const rows: ScheduleRow[] = rowsAt.map((r, i) => {
    const [y0, y1] = bandOf(i);
    const cells: string[][] = cols.map(() => []);
    for (const t of body) {
      if (t.cy < y0 || t.cy >= y1 || taken.has(t)) continue;
      const c = colAt(t.cx);
      if (c < 0) continue;
      taken.add(t);
      // One run of text across several cells (3' - 0" 6' - 0" ALUM): each word to the cell it sits in.
      const x0 = t.cx - t.w / 2;
      const x1 = t.cx + t.w / 2;
      const crossed = edges.filter((x) => x > x0 + 2 && x < x1 - 2).length;
      if (!crossed || !/\s/.test(t.str) || t.w > (R - L) * 0.35) {
        cells[c].push(clean(t.str));
        continue;
      }
      const words: { c: number; s: string }[] = [];
      // Its words, a dimension (3' - 0", 2' - 10 1/2") kept whole: one for each cell it spans, in turn.
      const tokens = [...t.str.matchAll(/\d+'\s*-\s*\d+(?:\s+\d+\/\d+)?"|\S+/g)];
      const first = colAt(x0 + 1);
      if (tokens.length === crossed + 1 && first >= 0) tokens.forEach((m, j) => words.push({ c: Math.min(first + j, cols.length - 1), s: m[0] }));
      else
        for (const m of tokens) {
          const mid = x0 + ((m.index! + m[0].length / 2) / t.str.length) * t.w;
          const k = colAt(mid);
          const last = words[words.length - 1];
          if (last && last.c === k) last.s += ` ${m[0]}`;
          else words.push({ c: k < 0 ? c : k, s: m[0] });
        }
      for (const w of words) cells[w.c].push(clean(w.s));
    }
    return { mark: r.str.trim(), cells: cells.map(joinCell), box: [L, y0, R, y1] as [number, number, number, number] };
  });
  // A column with no heading and nothing in it is a gap.
  const keep = cols.map((_, i) => columns[i].length > 0 || rows.some((r) => r.cells[i]));
  const columnsKept = columns.filter((_, i) => keep[i]);
  const rowsKept = rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) }));
  const markKept = keep.slice(0, markColumn).filter(Boolean).length;
  // A schedule has things in its rows beyond the marks.
  const filled = rowsKept.filter((r) => r.cells.some((c, i) => i !== markKept && c)).length;
  if (filled < Math.max(1, rowsKept.length * 0.5)) return null;
  for (const t of taken) used.add(t);
  const name = title.str.replace(/\s+/g, ' ').trim();
  return {
    title: name,
    kind: scheduleKind(name),
    columns: columnsKept,
    markColumn: markKept,
    rows: dedupe(rowsKept),
    box: [L, title.cy - th, R, bandEnd(rowsAt.length - 1)],
  };
}

/** Column edges from the gaps between a table's cells, for a table drawn without rules. */
function gapEdges(body: PageText[], L: number, R: number, rh: number): number[] {
  const width = R - L;
  const spans = body
    .map((t) => [t.cx - t.w / 2, t.cx + t.w / 2] as [number, number])
    // A note written across the table spans columns.
    .filter(([a, b]) => b - a < width * 0.35)
    .sort((a, b) => a[0] - b[0]);
  const groups: [number, number][] = [];
  for (const [a, b] of spans) {
    const g = groups[groups.length - 1];
    if (g && a <= g[1] + rh * 0.9) g[1] = Math.max(g[1], b);
    else groups.push([a, b]);
  }
  if (groups.length < 2) return [];
  return [L, ...groups.slice(1).map((g, i) => (groups[i][1] + g[0]) / 2), R];
}

/** A mark listed twice (a schedule drawn on two sheets, or its continuation) once, its fuller row kept. */
function dedupe(rows: ScheduleRow[]): ScheduleRow[] {
  const by = new Map<string, ScheduleRow>();
  for (const r of rows) {
    const had = by.get(r.mark);
    if (!had || r.cells.filter(Boolean).length > had.cells.filter(Boolean).length) by.set(r.mark, r);
  }
  return [...by.values()];
}

/** A column's name as shown: its headings, the group's first (Frame · Material). */
export const columnName = (c: string[]) => c.join(' · ');
