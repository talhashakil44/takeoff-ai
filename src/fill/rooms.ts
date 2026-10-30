import type { Pt } from '../model';
import type { PageText } from '../pageText';
import { ringArea } from '../geometry';
import { SegmentIndex } from '../walls/bands';
import { dedupe, symbolLoop } from '../walls/tags';
import { fillRoom, wallFaceShare, type WallModel } from './roomFill';
import type { Segment } from './vectors';

/** A room tag: its number in a box, and the name printed with it. */
export interface RoomLabel {
  number: string;
  name: string;
  /** Centre of the number box, where the room is filled from. */
  at: Pt;
  /** The number box (x0, y0, x1, y1), when the number is boxed. */
  box?: [number, number, number, number];
  /**
   * Where the room is when the tag stands outside it: the dot or arrow at the end of a
   * leader drawn from the box into a room too small to hold the tag (a WC, a closet).
   */
  seed?: Pt;
  /** About where the room's name is written beside the box. */
  nameAt?: Pt;
  /** The pen the tag box is drawn in (as `widthKey` gives it). */
  pen?: string;
}

/** The point a room is filled from: the leader's end when the tag has one, else the tag. */
export const roomPoint = (l: RoomLabel): Pt => l.seed ?? l.at;

export interface FoundRoom {
  labels: RoomLabel[];
  /** The room's outline, or why it could not be filled. */
  points: Pt[] | null;
  reason?: 'on-wall' | 'not-closed' | 'no-walls' | 'not-connected';
  /** Area in square sheet points. */
  area: number;
  /** Outline length across door openings, in sheet points. */
  openings?: number;
  /** Other rooms standing inside this one as islands (a washroom block in an open space), cut out of it. */
  holes?: Pt[][];
}

/**
 * A room number: a short code of digits with an optional letter prefix and suffix, or a
 * dotted level number (101, 101a, B23, M01, B24S, 2.14).
 */
export const ROOM_NUMBER = /^(?:[A-Z]{1,2})?\d{1,4}(?:\.\d{1,3})?[A-Za-z]?$/;
/** "RM" or "ROOM" written before a room's number (RM 110). */
const ROOM_PREFIX = /^(?:RM\.?|ROOM)\s*(?=[A-Z]?\d)/i;
/** Type tags and other short codes (W2, CB1, EW3A, S114A, fx2, px7) that sit near room names but are not part of them. */
const TAG_LIKE = /^[A-Za-z]{1,4}-?\d{1,4}[A-Za-z]?$/;
/** Words that are notes or device marks round a tag, not a room's name: x, sim, UP, DN, a dimension. */
const NOT_NAME = /^([A-Za-z]|sim\.?|typ\.?|UP|DN|\d.*['"].*|[\d.,/\s-]+|\d+(\.\d+)?\s*(hr|hour|min)\b.*)$/i;

type Box = { x0: number; y0: number; x1: number; y1: number; pen?: string };

/** A line's pen, to a hundredth of a point: a transformed drawing's widths differ in their last digits (0.2399997, 0.2400003). */
const penOf = (s: Segment) => s.width.toFixed(2);

/** The rectangle closed round a text (drawn once or doubled), if any. */
function boxAround(t: PageText, index: SegmentIndex, lines: Segment[]): Box | null {
  // A box padded round its number; failing that, a wide one round a short number (a room "2").
  return boxWithin(t, index, lines, Math.max(t.w, t.h) * 0.5 + 14) ?? (/^\d$/.test(t.str) ? boxWithin(t, index, lines, Math.max(t.w, t.h) * 0.5 + 4.5 * t.h, true) : null);
}

function boxWithin(t: PageText, index: SegmentIndex, lines: Segment[], r: number, wide = false): Box | null {
  const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
  const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
  const candidates = local.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
  for (const pen of new Set(candidates.map(penOf))) {
    const loop = symbolLoop(
      candidates.filter((s) => penOf(s) === pen),
      t.cx,
      t.cy,
    );
    // A box, or a box drawn double (one inside the other).
    if (loop.length !== 4 && loop.length !== 8) continue;
    const axisAligned = loop.every((s) => Math.abs(s.x1 - s.x2) < 0.2 || Math.abs(s.y1 - s.y2) < 0.2);
    if (!axisAligned) continue;
    const xs = loop.flatMap((s) => [s.x1, s.x2]);
    const ys = loop.flatMap((s) => [s.y1, s.y2]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), pen };
    // A tag's box, not a closet's walls round its number.
    if (wide && (box.y1 - box.y0 > 4 * t.h || box.x1 - box.x0 > Math.max(10 * t.h, 2 * t.w))) continue;
    return box;
  }
  return null;
}

/**
 * The end of a leader drawn from a tag box into the room it names: a straight line (or a
 * few, with elbows) starting on the box's outline and running away from it, ending at a
 * small filled dot or arrowhead. Returns the centre of the dot or arrow. A line that merely
 * touches the box, with nothing at its end, is not a leader.
 */
function leaderEnd(box: Box, index: SegmentIndex, lines: Segment[], marks: Map<number, Box>, markIndex: SegmentIndex): Pt | null {
  const h = Math.min(box.x1 - box.x0, box.y1 - box.y0);
  const tol = 1;
  const onOutline = (x: number, y: number) =>
    x >= box.x0 - tol &&
    x <= box.x1 + tol &&
    y >= box.y0 - tol &&
    y <= box.y1 + tol &&
    (Math.abs(x - box.x0) <= tol || Math.abs(x - box.x1) <= tol || Math.abs(y - box.y0) <= tol || Math.abs(y - box.y1) <= tol);
  const outside = (x: number, y: number, by: number) => x < box.x0 - by || x > box.x1 + by || y < box.y0 - by || y > box.y1 + by;
  const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const near = dedupe(index.query(box.x0 - 2, box.y0 - 2, box.x1 + 2, box.y1 + 2).map((i) => lines[i]));
  for (const first of near) {
    if (first.curve || len(first) < 2) continue;
    const ends: [Pt, Pt][] = [
      [
        [first.x1, first.y1],
        [first.x2, first.y2],
      ],
      [
        [first.x2, first.y2],
        [first.x1, first.y1],
      ],
    ];
    for (const [start, far] of ends) {
      // A leader can leave the box in a short stub before it turns off to the room.
      if (!onOutline(start[0], start[1]) || !outside(far[0], far[1], len(first) < 0.6 * h ? 0 : 0.6 * h)) continue;
      // Follow the leader through its elbows, same pen, end to end.
      let end = far;
      let prev = first;
      for (let link = 0; link < 4; link++) {
        const next = dedupe(index.query(end[0] - 0.5, end[1] - 0.5, end[0] + 0.5, end[1] + 0.5).map((i) => lines[i])).find(
          (o) => o !== prev && !o.curve && penOf(o) === penOf(first) && len(o) >= 2 && (Math.hypot(o.x1 - end[0], o.y1 - end[1]) < 0.5 || Math.hypot(o.x2 - end[0], o.y2 - end[1]) < 0.5),
        );
        if (!next) break;
        end = Math.hypot(next.x1 - end[0], next.y1 - end[1]) < 0.5 ? [next.x2, next.y2] : [next.x1, next.y1];
        prev = next;
      }
      if (!outside(end[0], end[1], 0.6 * h)) continue;
      // The dot or arrowhead: a small filled shape at the end, no bigger than the tag.
      for (const i of markIndex.query(end[0] - 1, end[1] - 1, end[0] + 1, end[1] + 1)) {
        const m = marks.get(markIndex.segs[i].sub!);
        if (!m) continue;
        const size = Math.max(m.x1 - m.x0, m.y1 - m.y0);
        if (size < 1 || size > 1.5 * h) continue;
        if (end[0] < m.x0 - 1 || end[0] > m.x1 + 1 || end[1] < m.y0 - 1 || end[1] > m.y1 + 1) continue;
        const c: Pt = [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2];
        if (!outside(c[0], c[1], 0)) continue;
        return c;
      }
    }
  }
  return null;
}

/**
 * A legend line rather than a tag: the boxed sample code with its explanation written
 * beside it ("07  Room Numbers, see Room Finish Schedule").
 */
function legendLine(texts: PageText[], t: PageText, box: Box): boolean {
  const h = box.y1 - box.y0;
  return texts.some(
    (o) =>
      o !== t &&
      o.cx - o.w / 2 > box.x1 - 1 &&
      o.cx - o.w / 2 < box.x1 + Math.max(4 * h, 20) &&
      Math.abs(o.cy - (box.y0 + box.y1) / 2) < h &&
      /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(o.str),
  );
}

/**
 * Finds room tags: a room number (101, 101a, B23, M01, 2.14) inside a small rectangle,
 * with the room name on the lines just above or just below the box. The sheet's own
 * habit decides which side a name is read from when there is text on both. Door and
 * window numbers sit in ovals or hexagons, so only rectangular boxes count; a boxed code
 * explained beside it is a legend, not a room.
 */
export function findRoomLabels(texts: PageText[], segs: Segment[]): RoomLabel[] {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  // Small filled shapes (leader dots, arrowheads) by subpath, for leaders from tags.
  // A dot can also be a tiny circle stroked with a heavy pen (as wide as the circle): its ink
  // reaches half the pen's width out from the path.
  const filled = segs.filter((s) => s.sub !== undefined && (s.filled || (s.curve && s.width >= 1.5)));
  const marks = new Map<number, Box>();
  for (const s of filled) {
    const r = s.filled ? 0 : s.width / 2;
    const m = marks.get(s.sub!);
    if (m) {
      m.x0 = Math.min(m.x0, s.x1 - r, s.x2 - r);
      m.y0 = Math.min(m.y0, s.y1 - r, s.y2 - r);
      m.x1 = Math.max(m.x1, s.x1 + r, s.x2 + r);
      m.y1 = Math.max(m.y1, s.y1 + r, s.y2 + r);
    } else marks.set(s.sub!, { x0: Math.min(s.x1, s.x2) - r, y0: Math.min(s.y1, s.y2) - r, x1: Math.max(s.x1, s.x2) + r, y1: Math.max(s.y1, s.y2) + r });
  }
  let markIndex: SegmentIndex | null = null;
  const boxed: { t: PageText; number: string; box: Box; above: string; below: string; lettered: boolean; short: boolean }[] = [];
  for (const t of texts) {
    // A corridor can be lettered (A, C) rather than numbered: boxed, with its name by it.
    const lettered = /^[A-Z]$/.test(t.str);
    // The number, written with its prefix or not (RM 110).
    const number = t.str.replace(ROOM_PREFIX, '');
    if (!ROOM_NUMBER.test(number) && !lettered) continue;
    // Without a letter prefix a code needs two digits (07, 101, 2.14): one digit (1, 1.1) is a
    // keynote or equipment mark, unless it is named like a room (a small building's rooms 1 to 9).
    const short = !lettered && !/^[A-Z]/.test(number) && !/\d{2}/.test(number);
    const box = boxAround(t, index, lines);
    if (!box) continue;
    const cx = (box.x0 + box.x1) / 2;
    const above = nameNear(texts, t, cx, box.y0, box.x1 - box.x0, -1);
    const below = nameNear(texts, t, cx, box.y1, box.x1 - box.x0, 1);
    if (!above && !below && legendLine(texts, t, box)) continue;
    if (short && !above && !below) continue;
    boxed.push({ t, number, box, above, below, lettered, short });
  }
  // Which side this sheet writes names on: where most tags have one.
  const nAbove = boxed.filter((b) => b.above).length;
  const nBelow = boxed.filter((b) => b.below).length;
  const first = nBelow > nAbove ? 'below' : 'above';
  const second = first === 'below' ? 'above' : 'below';
  // A room plan has a run of tags. A lone boxed code (a keynote, a sheet number in the title
  // block) or a boxed letter on a sheet without numbered rooms (a symbol) is not one; nor is
  // a box under a title-block caption (Dwg. No.).
  const caption = (name: string) => /^(dwg|drawing|sheet|project|job|plot|file)\.?\s*(no\.?|number|#)?:?$/i.test(name.trim());
  let keep = boxed.filter((b) => !caption(b[first] || b[second]));
  // One-digit rooms only where several are named so.
  if (keep.filter((b) => b.short).length < 3) keep = keep.filter((b) => !b.short);
  // Room numbers come in families (101, 102; B23, B24; M01): a family none of whose tags is
  // named, beside families whose tags are, is another kind of tag in a box (wall types W3,
  // EW1; floor types F1, FA1), not rooms.
  const family = (b: (typeof keep)[number]) => /^[A-Za-z]*/.exec(b.number)![0].toUpperCase();
  const namedIn = new Map<string, number>();
  for (const b of keep) if (!b.lettered) namedIn.set(family(b), (namedIn.get(family(b)) ?? 0) + (b.above || b.below ? 1 : 0));
  if ([...namedIn.values()].some((n) => n >= 1)) keep = keep.filter((b) => b.lettered || namedIn.get(family(b))! > 0);
  const numbered = keep.filter((b) => !b.lettered);
  const named = numbered.filter((b) => b.above || b.below).length;
  const roomTags = named >= 3 || numbered.length >= 5 ? numbered.length : named;
  const out: RoomLabel[] = [];
  for (const b of keep) {
    const name = b[first] || b[second];
    if (b.lettered && (!name || roomTags < 3)) continue;
    if (!name && named < 3 && numbered.length < 5) continue;
    const { box } = b;
    markIndex ??= new SegmentIndex(filled, 16);
    const seed = leaderEnd(box, index, lines, marks, markIndex);
    // The name's first line, about a box height off the side it was read from.
    const h = box.y1 - box.y0;
    const nameAt: Pt | undefined = name ? [(box.x0 + box.x1) / 2, b[first] ? (first === 'below' ? box.y1 + h : box.y0 - h) : second === 'below' ? box.y1 + h : box.y0 - h] : undefined;
    out.push({
      number: b.number,
      name,
      at: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2],
      box: [box.x0, box.y0, box.x1, box.y1],
      ...(seed ? { seed } : {}),
      ...(nameAt ? { nameAt } : {}),
      ...(box.pen ? { pen: box.pen } : {}),
    });
  }
  if (out.length) return out;

  // No boxed tags on the sheet: many sets print the room number bare, under the room
  // name. Take numbers with a name directly above them that are not in any symbol
  // (door and window numbers sit in ovals and hexagons).
  for (const t of texts) {
    // Written with its prefix too: RM 110, ROOM 110.
    const m = /^(?:(?:RM\.?|ROOM)\s*)?([A-Z]?\d{3,4}[A-Za-z]?)$/.exec(t.str);
    if (!m) continue;
    const name = nameNear(texts, t, t.cx, t.cy - t.h / 2, t.w, -1);
    if (!name) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    // Only lines wholly near the number: a small room's own walls are not a symbol round it.
    const near = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i])).filter((s) => near(s.x1, s.y1) && near(s.x2, s.y2));
    const enclosed = [...new Set(local.map(penOf))].some((pen) => symbolLoop(local.filter((s) => penOf(s) === pen), t.cx, t.cy).length > 0);
    if (enclosed || caption(name)) continue;
    out.push({ number: m[1], name, at: [t.cx, t.cy] });
  }
  // A plan has a run of them: one alone is a title block's drawing number or a note.
  return out.length >= 2 ? out : [];
}

/** A door tag: the door's number in an oval, circle or hexagon on a plan. */
export interface DoorTag {
  number: string;
  at: Pt;
}

/**
 * Finds door tags: a number (101, 102A, D12) inside a closed symbol that is not a
 * rectangle (room numbers sit in rectangles). A number tagged twice on one sheet (a
 * second plan of the same floor) counts once.
 */
export function findDoorTags(texts: PageText[], segs: Segment[]): DoorTag[] {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.2);
  const index = new SegmentIndex(lines, 16);
  const out: DoorTag[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    // Basement doors take their room's lettered number (B23, B31d): two digits after a letter.
    if (!/^(?:[A-Z]?\d{3,4}|[A-Z]\d{2})(?:\.\d{1,2})?[A-Za-z]?$/.test(t.str) || seen.has(t.str)) continue;
    const r = Math.max(t.w, t.h) * 0.5 + 14;
    const local = dedupe(index.query(t.cx - r, t.cy - r, t.cx + r, t.cy + r).map((i) => lines[i]));
    const inside = (x: number, y: number) => Math.hypot(x - t.cx, y - t.cy) <= r;
    const candidates = local.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2));
    for (const pen of new Set(candidates.map(penOf))) {
      const loop = symbolLoop(
        candidates.filter((s) => penOf(s) === pen),
        t.cx,
        t.cy,
      );
      // Ovals and circles come as many chords, hexagons as six sides; rectangles (drawn
      // single or double) are rooms.
      if (loop.length < 5 || loop.every((s) => Math.abs(s.x1 - s.x2) < 0.2 || Math.abs(s.y1 - s.y2) < 0.2)) continue;
      // A detail or section callout holds a second number (1 over A601): a door tag holds its number alone.
      const xs = loop.flatMap((s) => [s.x1, s.x2]);
      const ys = loop.flatMap((s) => [s.y1, s.y2]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      if (texts.some((o) => o !== t && o.str.trim() && o.cx > x0 && o.cx < x1 && o.cy > y0 && o.cy < y1)) break;
      seen.add(t.str);
      out.push({ number: t.str, at: [t.cx, t.cy] });
      break;
    }
  }
  return out;
}

/**
 * The room name: text lines stacked just above `edge` (side -1) or just below it (side 1),
 * centred on the box (or flush with its left side), each line close under the one before.
 * Notes and device marks round a tag (CR, SD) sit off to one side and are left out.
 */
function nameNear(texts: PageText[], t: PageText, cx: number, edge: number, width: number, side: -1 | 1, left = cx - width / 2): string {
  const words = texts.filter(
    (o) =>
      o !== t &&
      Math.abs((o.angle ?? 0) - (t.angle ?? 0)) < 0.1 &&
      // Lettering of the tag's own size: a big symbol letter (CJ) is not a name.
      o.h < 2 * t.h &&
      o.h > 0.5 * t.h &&
      side * (o.cy - edge) > 0 &&
      side * (o.cy - edge) < 6 * Math.max(o.h, 5) &&
      Math.abs(o.cx - cx) < o.w / 2 + width + 20 &&
      /[A-Za-z]{2}/.test(o.str) &&
      !ROOM_NUMBER.test(o.str) &&
      !TAG_LIKE.test(o.str) &&
      !NOT_NAME.test(o.str),
  );
  // Text lines: runs level with each other and close together, read left to right.
  const rows: { cy: number; h: number; x0: number; x1: number; str: string }[] = [];
  for (const o of [...words].sort((a, b) => a.cx - b.cx)) {
    const row = rows.find((r) => Math.abs(r.cy - o.cy) < 0.5 * Math.max(o.h, 3) && o.cx - o.w / 2 - r.x1 < 1.5 * Math.max(o.h, 3));
    if (row) {
      row.x1 = o.cx + o.w / 2;
      row.str += ` ${o.str}`;
    } else rows.push({ cy: o.cy, h: Math.max(o.h, 5), x0: o.cx - o.w / 2, x1: o.cx + o.w / 2, str: o.str });
  }
  const tol = Math.max(4, 0.25 * width);
  // A name is a few words; a sentence of notes is not one.
  const aligned = (r: (typeof rows)[number]) =>
    r.str.length <= 32 && (Math.abs((r.x0 + r.x1) / 2 - cx) <= tol || Math.abs(r.x0 - left) <= 3);
  const block: string[] = [];
  let last = edge;
  for (const r of rows.filter(aligned).sort((a, b) => side * (a.cy - b.cy))) {
    // The first line close to the box, each next close under the one before.
    if (side * (r.cy - last) > (block.length ? 1.9 : 2.6) * r.h) break;
    block.push(r.str);
    last = r.cy;
  }
  return (side < 0 ? block.reverse() : block).join(' ');
}

/** Fills one tag's room, within a window around the tag. */
/** Whether an outline's extent covers a box: the room around a tag, not the one beyond a wall. */
const spans = (pts: Pt[], [x0, y0, x1, y1]: [number, number, number, number]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return Math.min(...xs) <= x0 && Math.max(...xs) >= x1 && Math.min(...ys) <= y0 && Math.max(...ys) >= y1;
};

/** Whether an outline lies within a box (give or take a point): the tag box itself. */
const withinBox = (pts: Pt[], [x0, y0, x1, y1]: [number, number, number, number]) => pts.every(([x, y]) => x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1);

function fillOne(model: WallModel, label: RoomLabel, sheetW: number, sheetH: number): FoundRoom {
  // A space that leaks past the window is an open area or a gap in the walls, left for
  // drawing by hand (or named by another tag inside it, below).
  let res = fillRoom(model, [roomPoint(label)], sheetW, sheetH, 2);
  const boxArea = label.box ? (label.box[2] - label.box[0]) * (label.box[3] - label.box[1]) : 0;
  // A leader ending in something smaller than its tag (a fixture, a symbol) points at no room:
  // the room is the one round the tag.
  if (label.seed && res.ok && Math.abs(ringArea(res.points)) < 2 * boxArea) {
    const here = fillRoom(model, [label.at], sheetW, sheetH, 2);
    if (here.ok && !(label.box && withinBox(here.points, label.box))) res = here;
  }
  // Drawn without lineweights, the number's own box is in the wall pen and fills first:
  // start again just outside it, below, above the name, then to either side.
  // (Or a space hardly bigger than the box: the box sitting on a dashed line or a symbol.)
  if (res.ok && label.box && !label.seed && (withinBox(res.points, label.box) || Math.abs(ringArea(res.points)) < 6 * boxArea)) {
    const [x0, y0, x1, y1] = label.box;
    const [cx, cy] = label.at;
    const w = x1 - x0;
    const h = y1 - y0;
    for (const seed of [
      [cx, y1 + h * 0.8],
      [cx, y0 - h * 2.6],
      [x0 - w * 0.4, cy],
      [x1 + w * 0.4, cy],
    ] as Pt[]) {
      const next = fillRoom(model, [seed], sheetW, sheetH, 2);
      // The tag's own room spans its box; a seed that crossed a wall finds another room.
      if (next.ok && !withinBox(next.points, label.box) && spans(next.points, label.box)) {
        res = next;
        break;
      }
    }
  }
  return res.ok
    ? { labels: [label], points: res.points, area: Math.abs(ringArea(res.points)), openings: res.openings }
    : { labels: [label], points: null, reason: res.reason, area: 0 };
}

/** Adds one tag to the rooms found so far, filling its room unless another tag already did. */
function place(rooms: FoundRoom[], label: RoomLabel, fill: () => FoundRoom) {
  // Sheets often repeat their room tags on a second plan (dimension or demolition
  // plan): the same room again. Keep the copy that fills.
  const twin = rooms.find((r) => r.labels.some((l) => l.number === label.number));
  if (twin?.points) return;
  // Several tags in one open space share its outline.
  const shared = rooms.find((r) => r.points && pointInRing(roomPoint(label), r.points));
  if (shared) {
    shared.labels.push(label);
    return;
  }
  const found = fill();
  if (twin) {
    if (found.points) rooms[rooms.indexOf(twin)] = found;
  } else rooms.push(found);
}

/** A tag that found no closed room but sits inside a room another tag found names that room too. */
function adoptStrays(rooms: FoundRoom[]) {
  for (const r of [...rooms]) {
    if (r.points) continue;
    const home = rooms.find((o) => o.points && r.labels.every((l) => pointInRing(roomPoint(l), o.points!)));
    if (home) {
      home.labels.push(...r.labels);
      rooms.splice(rooms.indexOf(r), 1);
    }
  }
}

/**
 * An outline holding many rooms' tags has leaked through walls the model missed (walls
 * drawn in another pen, an opening too wide): it is not any one of those rooms. Its tags
 * are left unclosed, to fill again with other settings or draw by hand. One open space
 * named by two or three tags (a corridor and the lobby it opens into) is kept.
 */
const MAX_SHARED = 3;
function splitLeaks(rooms: FoundRoom[]): FoundRoom[] {
  return rooms.flatMap((r) =>
    r.points && new Set(r.labels.map((l) => l.number)).size > MAX_SHARED
      ? r.labels.map((l): FoundRoom => ({ labels: [l], points: null, reason: 'not-closed', area: 0 }))
      : [r],
  );
}

/** The distinct room numbers whose tags (or leader ends) lie inside a room's outline. */
const numbersIn = (room: FoundRoom, labels: RoomLabel[]) => new Set(labels.filter((l) => pointInRing(roomPoint(l), room.points!)).map((l) => l.number));

/**
 * Whether a room needs another look with lighter pens as walls: it did not close, or its
 * outline holds more than one room's tag (a partition the sheet's wall pens missed).
 */
const unsettled = (room: FoundRoom, labels: RoomLabel[]) => !room.points || numbersIn(room, labels).size > 1;

/** The model with outlines added as walls: a space left over once rooms inside it are taken out. */
function withOutlines(model: WallModel, rooms: FoundRoom[]): WallModel {
  const edges: Segment[] = rooms.flatMap((r) =>
    r.points!.map(([x1, y1], k) => {
      const [x2, y2] = r.points![(k + 1) % r.points!.length];
      return { x1, y1, x2, y2, width: 0, filled: false };
    }),
  );
  return { ...model, lines: [...model.lines, ...edges], lighter: undefined };
}

/**
 * Fills a group of tags again with a lighter pen as wall too, and gives the rooms that
 * replace the group's, or null. A room found this way must hold its own tags and no other
 * room's, span its tag box, and be bounded mostly by wall faces (a door swing or a table
 * drawn in the lighter pen does not make a room). When the group had closed as one space
 * with the sheet's pens, the tags that did not get a room of their own share what is left
 * of it, and the parts must still cover most of it: an open space is not carved up round
 * its furniture.
 */
/** Whether a room found holds its own tags and no other room's, each with its name. */
function ownsTags(r: FoundRoom, labels: RoomLabel[]): boolean {
  if (!r.points) return false;
  const inside = numbersIn(r, labels);
  const mine = new Set(r.labels.map((l) => l.number));
  if (inside.size !== mine.size || [...inside].some((n) => !mine.has(n))) return false;
  // A tag and its name stand in their room: an outline that cuts between them is no room.
  return r.labels.every(
    (l) => l.seed || !l.box || (spans(r.points!, l.box) && !withinBox(r.points!, l.box) && (!l.nameAt || pointInRing(l.nameAt, r.points!))),
  );
}

/**
 * Rooms that leaked out through a doorway wider than the openings closed (an overhead door, a
 * wide cased opening) filled again with wider openings closed (`wide`). A room found so must
 * hold its own tag and no other room's and be bounded mostly by wall faces; else it stays open.
 */
export function closeWide(rooms: FoundRoom[], wide: WallModel, labels: RoomLabel[], sheetW: number, sheetH: number): FoundRoom[] {
  return rooms.map((r) => {
    if (r.points || r.reason !== 'not-closed' || r.labels.length !== 1) return r;
    const found = fillOne(wide, r.labels[0], sheetW, sheetH);
    return found.points && ownsTags(found, labels) && wallFaceShare(found.points, wide) >= 0.6 ? found : r;
  });
}

function retryLighter(room: FoundRoom, from: WallModel, model: WallModel, labels: RoomLabel[], sheetW: number, sheetH: number): FoundRoom[] | null {
  const own = (r: FoundRoom) => ownsTags(r, labels);
  const trial: FoundRoom[] = [];
  for (const label of room.labels) place(trial, label, () => fillOne(model, label, sheetW, sheetH));
  adoptStrays(trial);
  const good = trial.filter((r) => own(r) && wallFaceShare(r.points!, model) >= 0.6);
  if (!good.length) return null;
  const rest = room.labels.filter((l) => !good.some((r) => r.labels.includes(l)));
  if (!room.points) return [...good, ...rest.map((l): FoundRoom => ({ labels: [l], points: null, reason: room.reason, area: 0 }))];
  const left: FoundRoom[] = [];
  if (rest.length) {
    const remainder = withOutlines(from, good);
    for (const label of rest) place(left, label, () => fillOne(remainder, label, sheetW, sheetH));
    adoptStrays(left);
    if (!left.every(own)) return null;
  }
  const parts = [...good, ...left];
  // Only the group's own tags inside: one space or several, judged by how much is kept.
  const others = [...numbersIn(room, labels)].some((n) => !room.labels.some((l) => l.number === n));
  if (!others && parts.reduce((a, r) => a + r.area, 0) < 0.8 * room.area) return null;
  return parts;
}

/** Retries unsettled rooms with each lighter wall pen in turn. */
function* settle(rooms: FoundRoom[], model: WallModel, labels: RoomLabel[], sheetW: number, sheetH: number): Generator<void, FoundRoom[]> {
  let out = rooms;
  const source = new Map<FoundRoom, WallModel>(rooms.map((r) => [r, model]));
  // The pens the tag boxes are drawn in are tags, not walls.
  const tagPens = new Set(labels.flatMap((l) => (l.pen ? [l.pen] : [])));
  for (let m: WallModel | null = model; out.some((r) => unsettled(r, labels)); ) {
    m = m.lighter?.((pen) => tagPens.has(pen)) ?? null;
    if (!m) break;
    // Tags left without a room are filled again together, so tags in one open space share it.
    const open = out.filter((r) => !r.points);
    const pool: FoundRoom[] = open.length ? [{ labels: open.flatMap((r) => r.labels), points: null, reason: open[0].reason, area: 0 }] : [];
    const next: FoundRoom[] = [];
    for (const r of [...out.filter((o) => o.points), ...pool]) {
      if (!unsettled(r, labels)) {
        next.push(r);
        continue;
      }
      yield;
      const parts = retryLighter(r, source.get(r) ?? model, m, labels, sheetW, sheetH);
      if (!parts) {
        next.push(r);
        continue;
      }
      for (const p of parts) source.set(p, p.points ? m : (source.get(r) ?? model));
      next.push(...parts);
    }
    out = next;
  }
  adoptStrays(out);
  // Tags still without a room, one entry per room number.
  const settled = out.flatMap((r) =>
    r.points ? [r] : [...new Set(r.labels.map((l) => l.number))].map((n): FoundRoom => ({ ...r, labels: r.labels.filter((l) => l.number === n) })),
  );
  return splitLeaks(settled);
}

/** Fills each labelled room. Tags that land in one space share its outline. */
export function fillRooms(model: WallModel, labels: RoomLabel[], sheetW: number, sheetH: number): FoundRoom[] {
  const rooms: FoundRoom[] = [];
  for (const label of labels) place(rooms, label, () => fillOne(model, label, sheetW, sheetH));
  adoptStrays(rooms);
  const steps = settle(splitLeaks(rooms), model, labels, sheetW, sheetH);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Like fillRooms, but yields between rooms so the page stays responsive, reporting progress. */
export async function fillRoomsAsync(
  model: WallModel,
  labels: RoomLabel[],
  sheetW: number,
  sheetH: number,
  onProgress: (done: number, total: number) => void,
): Promise<FoundRoom[]> {
  const rooms: FoundRoom[] = [];
  for (let i = 0; i < labels.length; i++) {
    onProgress(i, labels.length);
    await new Promise((r) => setTimeout(r, 0));
    place(rooms, labels[i], () => fillOne(model, labels[i], sheetW, sheetH));
  }
  adoptStrays(rooms);
  onProgress(labels.length, labels.length);
  const steps = settle(splitLeaks(rooms), model, labels, sheetW, sheetH);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    await new Promise((res) => setTimeout(res, 0));
  }
}

/**
 * Cuts each room found standing wholly inside another (a washroom block in an open office, a
 * closet in a hall) out of the room round it: the room round it does not take its floor.
 */
export function cutIslands(rooms: FoundRoom[]): FoundRoom[] {
  const closed = rooms.filter((r) => r.points);
  const within = (q: FoundRoom, r: FoundRoom) => q !== r && q.area < r.area && q.points!.every((p) => pointInRing(p, r.points!));
  return rooms.map((r) => {
    if (!r.points) return r;
    const inside = closed.filter((q) => within(q, r));
    // Only the outermost islands: one inside another island is that island's.
    const islands = inside.filter((q) => !inside.some((o) => within(q, o)));
    if (!islands.length) return r;
    return { ...r, holes: [...(r.holes ?? []), ...islands.map((q) => q.points!)], area: r.area - islands.reduce((a, q) => a + q.area, 0) };
  });
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
