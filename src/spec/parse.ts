import type { PageText } from '../pageText';

/**
 * A project specification read into its sections: MasterFormat numbers as the book prints them
 * (08100, 08 11 13, 22 11 16.01), each section's title, pages, parts and articles (2.7 GLOBE
 * VALVES), and what it points at: other sections (Section 04100), drawing sheets (A6.1),
 * schedules (Door Schedule), the drawings in general (as indicated). Works from the text: the
 * running header (22 11 16 - 3) says which section each page is in, the SECTION heading names it.
 */

export interface SpecArticle {
  number: string;
  title: string;
  /** 1-based page in its file. */
  page: number;
  /** The line's place on that page, for jumping to it. */
  y: number;
}

export interface SpecSection {
  /** The number in one form (spaces removed): 08100, 221116. */
  key: string;
  /** As printed: 08100, 22 11 16. */
  number: string;
  title: string;
  /** Two-digit division: 08, 22. */
  division: string;
  docId: string;
  /** 1-based pages in its file. */
  pages: number[];
  parts: { name: string; page: number }[];
  articles: SpecArticle[];
  /** Other sections it names (keys). */
  sections: string[];
  /** Tokens that look like sheet numbers (checked against the drawings when linking). */
  sheets: string[];
  /** Schedules it names: "door schedule", "room finish schedule". */
  schedules: string[];
  /** Words that say what it is about: its title's and its products' (Part 2 articles). */
  words: string[];
  /** "To follow", or no pages: listed in the table of contents but not in the book. */
  missing?: boolean;
}

export interface SpecBook {
  docId: string;
  name: string;
  pages: number;
  sections: SpecSection[];
  /** Each page's section key (index 0 is page 1), null before the first. */
  pageSection: (string | null)[];
}

/** A text line on a page: its words in reading order. */
export interface Line {
  text: string;
  y: number;
  x: number;
  h: number;
  parts: PageText[];
}

export function linesOf(texts: PageText[]): Line[] {
  const level = texts.filter((t) => !t.angle || Math.abs(Math.sin(t.angle)) < 0.1).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const lines: Line[] = [];
  for (const t of level) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - t.cy) < 0.5 * Math.max(t.h, last.h)) {
      last.parts.push(t);
    } else lines.push({ text: '', y: t.cy, x: 0, h: t.h, parts: [t] });
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.cx - b.cx);
    l.x = l.parts[0].cx - l.parts[0].w / 2;
    l.text = l.parts
      .map((p) => p.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return lines;
}

const NUM = String.raw`(\d{5}(?:\.\d{2})?|\d{2}\s\d{2}\s\d{2}(?:\.\d{2})?)`;
/** The running header's section and page: 08100 - 3, 22 11 16 - 1, 08341 -1. */
const HEADER = new RegExp(`${NUM}\\s*[-–]\\s*(\\d{1,3})\\s*$`);
/** The heading opening a section: SECTION 22 11 16 – DOMESTIC WATER PIPING - COPPER. */
const HEADING = new RegExp(`^SECTION\\s+${NUM}\\s*(?:[-–—:]\\s*)?(.*)$`, 'i');
/** An article's heading: 2.7 GLOBE VALVES, 3.4 Jointing (a heading, not a sentence). */
const ARTICLE = /^(\d{1,2}\.\d{1,2})\s+([A-Z][A-Za-z0-9 ,&/()'’\-–]{2,70})$/;
const PART = /^PART\s+(\d)\s*[-–]?\s*(GENERAL|PRODUCTS|EXECUTION)\b/i;
const SECTION_REF = new RegExp(`\\bSections?\\s+${NUM}((?:\\s*(?:,|and|&|or)\\s*${NUM})*)`, 'gi');
const SHEET_TOKEN = /\b([A-Z]{1,2}-?\d{1,2}\.\d{1,2}|[A-Z]{1,2}\d{3})\b/g;
const SCHEDULE_REF = /\b((?:[A-Z][A-Za-z]+\s+){1,3})Schedules?\b/g;

const STOP = new Set(
  'the and for with from that this shall all any are not per into onto its their other such than then when where which within without work section sections part general products execution requirements related include including provide provided installation install installed system systems type types material materials equipment accessories product submittals quality assurance references reference delivery storage handling site conditions scope summary description field examination preparation application protection cleaning schedule schedules'.split(
    ' ',
  ),
);
export const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem);
/** A rough stem, so DAMPERS meets DAMPER and PIPING meets PIPE. */
export function stem(w: string): string {
  return w.replace(/(ies)$/, 'y').replace(/(ing|ers|er|es|s)$/, '') || w;
}
export const keyOf = (n: string) => n.replace(/\s+/g, '');
const divisionOf = (n: string) => keyOf(n).slice(0, 2);

/** Reads one specification file. `texts(p)`: page p's text (1-based). */
export async function readSpec(docId: string, name: string, pages: number, texts: (p: number) => Promise<PageText[]>, progress?: (p: number) => void): Promise<SpecBook> {
  const sections = new Map<string, SpecSection>();
  const pageSection: (string | null)[] = [];
  let current: string | null = null;
  const make = (number: string, title = ''): SpecSection => {
    const key = keyOf(number);
    let s = sections.get(key);
    if (!s) {
      s = { key, number: number.replace(/\s+/g, ' '), title, division: divisionOf(number), docId, pages: [], parts: [], articles: [], sections: [], sheets: [], schedules: [], words: [] };
      sections.set(key, s);
    }
    if (title && !s.title) s.title = title;
    return s;
  };
  let toc: { number: string; title: string; missing: boolean }[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p % 10 === 0) progress?.(p);
    const lines = linesOf(await texts(p));
    if (!lines.length) {
      pageSection.push(current);
      continue;
    }
    const top = lines[0].y;
    // The running header: in the first lines of the page.
    let here: string | null = null;
    for (const l of lines.slice(0, 3)) {
      if (l.y - top > 4 * l.h) break;
      const m = HEADER.exec(l.text);
      if (m) {
        here = m[1];
        break;
      }
    }
    // A SECTION heading on the page (a book without running headers, or the section's first page).
    let headingAt = -1;
    for (const [i, l] of lines.slice(0, 12).entries()) {
      const m = HEADING.exec(l.text);
      if (!m) continue;
      let title = m[2].trim();
      // A title written on the next line.
      if (!title && lines[i + 1] && /^[A-Z][A-Z0-9 ,.&/()'’\-–]{3,}$/.test(lines[i + 1].text)) title = lines[i + 1].text;
      make(m[1], cleanTitle(title));
      here = m[1];
      headingAt = i;
      break;
    }
    if (here) current = keyOf(here);
    pageSection.push(current);
    if (!current) continue;
    const s = sections.get(current) ?? make(here ?? current);
    if (!s.pages.includes(p)) s.pages.push(p);
    // The table of contents: its lines name every section, and which are still "to follow".
    if (/table of contents/i.test(s.title)) toc = toc.concat(readToc(lines));
    let part = s.parts.length ? s.parts[s.parts.length - 1].name : '';
    for (const [i, l] of lines.entries()) {
      if (i === headingAt) continue;
      const pm = PART.exec(l.text);
      if (pm) {
        part = pm[2][0].toUpperCase() + pm[2].slice(1).toLowerCase();
        s.parts.push({ name: part, page: p });
        continue;
      }
      const am = ARTICLE.exec(l.text);
      if (am && !/\.\d{3}/.test(am[1]) && am[2].split(/\s+/).length <= 9) {
        const title = cleanTitle(am[2]);
        s.articles.push({ number: am[1], title, page: p, y: l.y });
        if (part === 'Products') s.words.push(...wordsOf(title));
      }
      for (const m of l.text.matchAll(SECTION_REF)) {
        const all = [m[1], ...[...(m[2] ?? '').matchAll(new RegExp(NUM, 'g'))].map((x) => x[1])];
        for (const n of all) if (keyOf(n) !== s.key && !s.sections.includes(keyOf(n))) s.sections.push(keyOf(n));
      }
      for (const m of l.text.matchAll(SHEET_TOKEN)) if (!s.sheets.includes(m[1])) s.sheets.push(m[1]);
      for (const m of l.text.matchAll(SCHEDULE_REF)) {
        const what = m[1].trim().toLowerCase();
        if (/^(the|a|an|per|see|on|in|refer|to)$/.test(what)) continue;
        const name = `${what} schedule`.replace(/^(the|per|see|refer to|on|in)\s+/, '');
        if (!s.schedules.includes(name)) s.schedules.push(name);
      }
    }
  }
  // Sections the table of contents lists that the book does not hold yet.
  for (const t of toc) {
    const s = sections.get(keyOf(t.number));
    if (s) {
      if (!s.title) s.title = t.title;
      continue;
    }
    const n = make(t.number, t.title);
    n.missing = true;
  }
  for (const s of sections.values()) s.words = [...new Set([...wordsOf(s.title), ...wordsOf(s.title), ...s.words])];
  const list = [...sections.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { docId, name, pages, sections: list, pageSection };
}

function cleanTitle(t: string): string {
  return t
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–]\s*$/, '')
    .trim();
}

/** A table of contents' lines: number, title (and "To follow"). */
function readToc(lines: Line[]): { number: string; title: string; missing: boolean }[] {
  const out: { number: string; title: string; missing: boolean }[] = [];
  const re = new RegExp(`^${NUM}\\s+(.+?)\\s*(?:(\\d+\\s+(?:thru|and|to)\\s+\\d+|\\d+\\s+only|to follow|\\d+\\s+pages?))?$`, 'i');
  for (const l of lines) {
    const m = re.exec(l.text);
    if (!m || /^section$/i.test(m[2])) continue;
    out.push({ number: m[1], title: cleanTitle(m[2].replace(/\s+(To follow)$/i, '')), missing: /to follow/i.test(l.text) });
  }
  return out;
}
