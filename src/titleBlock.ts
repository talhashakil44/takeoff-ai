import type { PageText } from './pageText';

/** What a sheet's title block says it is. */
export interface TitleBlockName {
  /** The sheet number ("412", "A-101"); null when none was found. */
  number: string | null;
  /** The drawing title ("FIRE SUPPRESSION LAYOUT - LEVEL 1"); null when none was found. */
  title: string | null;
}

/** The caption over the sheet number: "DWG. NO.", "SHEET NO", "DRAWING NUMBER", "NO. DESSIN". */
const NUMBER_CAPTION = /^(?:(?:dwg|drawing|sheet|plan)\s*\.?\s*(?:no|nos|number|num|#)\b\.?|no\.?\s*(?:de\s+)?(?:dessin|feuille)|num[ée]ro\s+de\s+(?:dessin|feuille))\s*[.:#|]*/i;
/** The caption over the drawing title: "SUBJECT", "DRAWING TITLE", "SHEET NAME", "TITRE". */
const TITLE_CAPTION = /^(?:subject|sujet|(?:drawing|sheet|dwg)\s*(?:title|name)|title|titre(?:\s+du\s+dessin)?)\b\s*[.:#|]*/i;
/** A sheet number: 412, A300, A-101, M2.01, FP-1, E101A. */
const SHEET_NUMBER = /^[A-Z]{0,4}[-.]?\d{1,4}(?:[.-]\d{1,3})*[A-Z]?$/i;

const upright = (t: PageText) => Math.abs(Math.sin(t.angle ?? 0)) < 0.2;
const left = (t: PageText) => t.cx - t.w / 2;
const right = (t: PageText) => t.cx + t.w / 2;

/** A caption is short: a note that happens to start with "Subject to…" is not one. */
const isCaption = (t: PageText, re: RegExp) => t.str.length <= 48 && re.test(t.str);

/**
 * Reads the sheet number and title from the title block: the boxes captioned "DWG. NO." and
 * "SUBJECT" (or the like) nearest the sheet's bottom-right corner, where title blocks live.
 */
export function readTitleBlock(texts: PageText[], width: number, height: number): TitleBlockName {
  const runs = texts.filter((t) => t.str.trim() && upright(t));
  // The title block: the right-hand third or the bottom strip.
  const inBlock = (t: PageText) => t.cx > width * 0.6 || t.cy > height * 0.82;
  const corner = (t: PageText) => t.cx / width + t.cy / height;
  const caption = (re: RegExp) =>
    runs
      .filter((t) => inBlock(t) && isCaption(t, re))
      .sort((a, b) => corner(b) - corner(a))[0];

  const numberCap = caption(NUMBER_CAPTION);
  const titleCap = caption(TITLE_CAPTION);
  const number = numberCap ? pickNumber(valueOf(numberCap, runs, width)) : null;
  const titleLines = titleCap ? valueOf(titleCap, runs, width) : [];
  const title = titleLines.length ? tidy(titleLines.map((l) => l.map((t) => t.str).join(' ')).join(' ')) : null;
  return { number: number ?? cornerNumber(runs, width, height), title: title || null };
}

/**
 * The text a caption labels, as lines: what is written after it on its own run or line,
 * otherwise the lines under it in its box, down to the next caption.
 */
function valueOf(cap: PageText, runs: PageText[], width: number): PageText[][] {
  const h = cap.h;
  // Written into the caption's own run: "SHEET NO. A-101".
  const rest = stripCaptions(cap.str);
  // The box's sides: from the caption's left edge to the next caption along its row.
  const x0 = left(cap) - h * 2;
  const beside = runs.filter((t) => t !== cap && Math.abs(t.cy - cap.cy) < h * 0.6 && left(t) > right(cap) && t.h <= h * 1.15);
  const x1 = beside.length ? Math.min(...beside.map(left)) - h * 0.5 : width;
  const within = (t: PageText) => t.cx >= x0 && t.cx <= x1;

  // Down to the next caption-sized text under it in the box.
  const below = runs.filter((t) => t !== cap && within(t) && t.cy > cap.cy + h * 0.6).sort((a, b) => a.cy - b.cy);
  const next = below.find((t) => t.h <= h * 1.15);
  const bottom = next ? next.cy - h * 0.3 : cap.cy + h * 12;
  const values = below.filter((t) => t.cy < bottom && isValueLike(t, h));
  if (values.length) return lines(values);
  // Written beside it on its row: "SHEET NO.:  A-101".
  const after = runs.filter((t) => t !== cap && Math.abs(t.cy - cap.cy) < h * 0.6 && left(t) > right(cap) - 1 && left(t) < right(cap) + h * 20);
  if (after.length) return lines(after);
  return rest ? [[{ ...cap, str: rest }]] : [];
}

/** A caption run with its captions taken off, both languages: "DWG. NO. | NO. DESSIN A-101" is "A-101". */
function stripCaptions(s: string): string {
  let out = s.trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(NUMBER_CAPTION, '').replace(TITLE_CAPTION, '').replace(/^[\s|/:]+/, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Big enough to be a value even at a caption's size (a one-character revision letter is not a caption). */
const isValueLike = (t: PageText, h: number) => t.h > h * 1.15;

/** Runs into reading lines, top to bottom and left to right. */
function lines(runs: PageText[]): PageText[][] {
  const out: PageText[][] = [];
  for (const t of [...runs].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const line = out[out.length - 1];
    if (line && Math.abs(line[0].cy - t.cy) < Math.max(line[0].h, t.h) * 0.6) line.push(t);
    else out.push([t]);
  }
  for (const l of out) l.sort((a, b) => a.cx - b.cx);
  return out;
}

/**
 * The sheet's own number out of the drawing number: "K-B35-6803/28 - 412" is sheet 412 of
 * project K-B35-6803/28. The project part is the long code; the sheet the short number.
 */
function pickNumber(value: PageText[][]): string | null {
  const tokens = value.flat().flatMap((t) =>
    t.str
      .split(/\s+/)
      .map((s) => s.replace(/^[-–.:#]+|[-–.:#]+$/g, ''))
      .filter(Boolean)
      .map((s) => ({ s, h: t.h })),
  );
  const sheetLike = tokens.filter((x) => x.s.length <= 8 && !x.s.includes('/') && SHEET_NUMBER.test(x.s) && /\d/.test(x.s));
  if (sheetLike.length) {
    const biggest = Math.max(...sheetLike.map((x) => x.h));
    // Of the biggest, the last: the sheet part comes after the project code.
    return sheetLike.filter((x) => x.h >= biggest * 0.9).pop()!.s;
  }
  // A project code with the sheet joined on: "K-B35-6803-28-890".
  for (const x of tokens.reverse()) {
    const tail = x.s.match(/[-/](\d{1,4}[A-Z]?)$/i);
    if (tail && x.s.length > 8) return tail[1];
  }
  return null;
}

/** With no caption to go by: the biggest sheet-number-shaped text in the bottom-right corner. */
function cornerNumber(runs: PageText[], width: number, height: number): string | null {
  const cands = runs.filter((t) => t.cx > width * 0.8 && t.cy > height * 0.8 && /[A-Z]/i.test(t.str) && SHEET_NUMBER.test(t.str.replace(/\s+/g, '')));
  return cands.sort((a, b) => b.h - a.h)[0]?.str.replace(/\s+/g, '') ?? null;
}

/** Spacing put right: "LAYOUT- BASEMENT" reads "LAYOUT - BASEMENT". */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s*|\s*-\s+/g, ' - ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*-\s*$/, '')
    .trim();
}

/**
 * Where the title block is, to keep tools off it: the strip from its captions to the sheet's
 * right edge, or to its bottom edge when the block runs along the bottom. Null when no
 * captions were found.
 */
export function titleBlockBox(texts: PageText[], width: number, height: number): [number, number, number, number] | null {
  const caps = texts.filter((t) => upright(t) && (t.cx > width * 0.6 || t.cy > height * 0.82) && (isCaption(t, NUMBER_CAPTION) || isCaption(t, TITLE_CAPTION)));
  if (!caps.length) return null;
  const x = Math.min(...caps.map(left));
  const y = Math.min(...caps.map((t) => t.cy - t.h));
  // Along the bottom: captions spread across the sheet's width, low down.
  if (x < width * 0.6 && y > height * 0.7) return [0, y - 20, width, height];
  return [x - 20, 0, width, height];
}
