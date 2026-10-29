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
  /** What its text is about: its most used words (stemmed) and how often. */
  about?: [string, number][];
  /** The start of its text, for an AI to read what it is. */
  excerpt?: string;
  /** "To follow", or no pages: listed in the table of contents but not in the book. */
  missing?: boolean;
  /** Addenda that issued it (when merged across files): the last is the one that stands. */
  revisions?: { addendum: number; docId: string; page: number }[];
}

/** The reader's version: books read by an older one are read again (they lack what it learned since). */
export const SPEC_READER = 2;

export interface SpecBook {
  /** The reader that read it (SPEC_READER). */
  reader?: number;
  docId: string;
  name: string;
  pages: number;
  sections: SpecSection[];
  /** Each page's section key (index 0 is page 1), null before the first. */
  pageSection: (string | null)[];
  /** An addendum: its number, and the changes its items make. */
  addendum?: number;
  changes?: AddendumItem[];
}

/** One item of an addendum: what it changes (sections, sheets) and how. */
export interface AddendumItem {
  /** R1, Q2, 3) … as printed. */
  label: string;
  text: string;
  page: number;
  y: number;
  /** Section numbers it names (keys) and sheet-like tokens (checked against the drawings). */
  sections: string[];
  sheets: string[];
  action: 'added' | 'revised' | 'deleted' | 'clarified';
}

/** An addendum's number from its file name or first page: Addendum 7, ADDENDUM # 4, Addenda 2. */
export function addendumNumber(text: string): number | null {
  const m = /\baddend(?:um|a)\s*(?:no\.?|number|#)?\s*0*(\d{1,2})\b/i.exec(text);
  return m ? Number(m[1]) : null;
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

/** A section number: 22 11 16, 013010, 08100 (each maybe .01). */
const NUM = String.raw`(\d{2}\s\d{2}\s\d{2}(?:\.\d{2})?|\d{6}(?:\.\d{2})?|\d{5}(?:\.\d{2})?)(?![\d.]\d)`;
/** The running header's section and page: 08100 - 3, 22 11 16 - 1, 08341 -1. */
const HEADER = new RegExp(`${NUM}\\s*[-–]\\s*(\\d{1,3})\\s*$`);
/** A running header naming the section: GENERAL REQUIREMENTS Section 01 01 00, … Section 013010 Page 2. */
const HEADER_SECTION = new RegExp(`^(.*?)\\bSection\\s+${NUM}(?=\\s*$|\\s+Page\\b)`, 'i');
/** The heading opening a section: SECTION 22 11 16 – DOMESTIC WATER PIPING - COPPER. */
const HEADING = new RegExp(`^(?:SECTION|Section)\\s+${NUM}\\s*(?:[-–—:]\\s*)?(.*)$`);
/** An article's heading: 2.7 GLOBE VALVES, 3.4 Jointing (a heading, not a sentence). */
const ARTICLE = /^(\d{1,2}\.\d{1,2})\.?\s+([A-Z][A-Za-z0-9 ,&/()'’\-–]{2,70}?):?$/;
const PART = /^(?:PART\s+)?(\d)\.?\s*[-–]?\s*(GENERAL|PRODUCTS|EXECUTION)\s*$|^PART\s+(\d)\s*[-–]?\s*(GENERAL|PRODUCTS|EXECUTION)\b/i;
const SECTION_REF = new RegExp(`\\bSections?\\s+${NUM}((?:\\s*(?:,|and|&|or)\\s*${NUM})*)`, 'gi');
const SHEET_TOKEN = /\b([A-Z]{1,3}-?\d{1,2}[.-]\d{1,2}|[A-Z]{1,3}-\d{2,3}|[A-Z]{1,2}\d{3})\b/g;
const SCHEDULE_REF = /\b((?:[A-Z][A-Za-z]+\s+){1,3})Schedules?\b/g;

const STOP = new Set(
  'the and for with from that this shall all any are not per into onto its their other such than then when where which within without work section sections part general products execution requirements related include including provide provided installation install installed system systems type types material materials equipment accessories product submittals quality assurance references reference delivery storage site conditions scope summary description field examination preparation application protection cleaning schedule schedules'.split(
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
export async function readSpec(
  docId: string,
  name: string,
  pages: number,
  texts: (p: number) => Promise<PageText[]>,
  progress?: (p: number) => void,
  opts: { addendum?: number } = {},
): Promise<SpecBook> {
  const changes: AddendumItem[] = [];
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
  /** Each section's first page's header lines, for a title the header gives only in passing. */
  const heads = new Map<string, string[]>();
  const headCount = new Map<string, number>();
  const bodies = new Map<string, { counts: Map<string, number>; excerpt: string }>();
  let headPages = 0;
  /** The last page ended its section: the pages after it belong to none until the next names one. */
  let ended = false;
  for (let p = 1; p <= pages; p++) {
    if (p % 10 === 0) progress?.(p);
    const lines = linesOf(await texts(p));
    if (!lines.length) {
      pageSection.push(current);
      continue;
    }
    const top = lines[0].y;
    const bottom = lines[lines.length - 1].y;
    // The running header (or footer): in the first or last lines of the page.
    let here: string | null = null;
    let headTitle = '';
    const edge = [...lines.slice(0, 3).filter((l) => l.y - top <= 4 * l.h), ...lines.slice(-3).filter((l) => bottom - l.y <= 4 * l.h)];
    for (const l of edge) {
      const m = HEADER.exec(l.text);
      if (m) {
        here = m[1];
        break;
      }
      const h = HEADER_SECTION.exec(l.text);
      if (h) {
        here = h[2];
        // The title in capitals just before it: … GENERAL REQUIREMENTS Section 01 01 00.
        headTitle = /([A-Z0-9][A-Z0-9 ,.&/()'’\-–]{2,})\s*$/.exec(h[1].trim())?.[1]?.trim() ?? '';
        if (headTitle.split(/\s+/).length > 8 || !/[A-Z]{3}/.test(headTitle)) headTitle = '';
        break;
      }
    }
    // A SECTION heading on the page (a book without running headers, or the section's first page).
    let headingAt = -1;
    for (const [i, l] of lines.slice(0, 12).entries()) {
      const m = HEADING.exec(l.text);
      if (!m) continue;
      let title = m[2].trim();
      // "Section 013020 of the specification." is a sentence, not a heading.
      if (title && (!/^[A-Z0-9]/.test(title) || /[.;,]$/.test(title) || title.split(/\s+/).length > 10 || /\b(?!(?:and|with|for|from|into|the|of|to|in|on|or)\b)[a-z]{3,}\b/.test(title.replace(/\b[A-Z][a-z]+/g, '')))) continue;
      // A title written on the next line.
      if (!title && lines[i + 1] && /^[A-Z][A-Z0-9 ,.&/()'’\-–]{3,}$/.test(lines[i + 1].text)) title = lines[i + 1].text;
      make(m[1], cleanTitle(title));
      here = m[1];
      headingAt = i;
      break;
    }
    // Header words, counted: the ones on every page are the project's, not the section's.
    const headLines = lines.slice(0, 3).filter((l) => l.y - top <= 4 * l.h).map((l) => l.text);
    if (headLines.length) {
      headPages++;
      for (const w of new Set(headLines.join(' ').split(/\s+/))) headCount.set(w, (headCount.get(w) ?? 0) + 1);
    }
    if (here && !heads.has(keyOf(here))) heads.set(keyOf(here), headLines);
    if (here) current = keyOf(here);
    else if (ended) current = null;
    ended = false;
    pageSection.push(current);
    if (!current) {
      if (tocLike(lines, p)) toc = toc.concat(readToc(lines));
      // Its items: on its first pages, or a page that answers or revises (not a report bound in with it).
      if (opts.addendum !== undefined && (p <= 25 || lines.some((l) => /\b(addend|response|revis|re-?issu|clarif)/i.test(l.text)))) changes.push(...itemsOf(lines, p));
      continue;
    }
    const s = sections.get(current) ?? make(here ?? current, cleanTitle(headTitle));
    if (!s.title && headTitle) s.title = cleanTitle(headTitle);
    if (!s.pages.includes(p)) s.pages.push(p);
    // The table of contents: its lines name every section, and which are still "to follow".
    if (/(table|list) of contents|^contents$/i.test(s.title) || tocLike(lines, p)) toc = toc.concat(readToc(lines));
    let part = s.parts.length ? s.parts[s.parts.length - 1].name : '';
    if (lines.slice(-4).some((l) => /^END OF SECTION\b/i.test(l.text))) ended = true;
    let body = bodies.get(s.key);
    if (!body) bodies.set(s.key, (body = { counts: new Map(), excerpt: '' }));
    for (const [i, l] of lines.entries()) {
      if (i === headingAt) continue;
      // What the section says: its words counted (not the page header's), and its opening lines.
      for (const w of wordsOf(l.text)) body.counts.set(w, (body.counts.get(w) ?? 0) + 1);
      if (body.excerpt.length < 900 && !/^END OF SECTION/i.test(l.text)) body.excerpt += (body.excerpt ? ' ' : '') + l.text;
      const pm = PART.exec(l.text);
      if (pm) {
        const word = pm[2] ?? pm[4];
        part = word[0].toUpperCase() + word.slice(1).toLowerCase();
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
  // A file of one section with no heading the reader knows (08 11 13 - Hollow Metal.pdf): the file's name says.
  if (!sections.size && pages) {
    const m = new RegExp(`^${NUM}\\s*[-–_ ]*\\s*(.*?)(?:\\.pdf)?$`, 'i').exec(name.trim());
    if (m) {
      const one = make(m[1], cleanTitle(m[2].replace(/[_]+/g, ' ')));
      one.pages = Array.from({ length: pages }, (_, i) => i + 1);
      pageSection.splice(0, pageSection.length, ...one.pages.map(() => one.key));
    }
  }
  // Titles from the table of contents first: they are written out whole.
  for (const t of toc) {
    const s = sections.get(keyOf(t.number));
    if (s && !s.title) s.title = t.title;
  }
  // Titles the header gives between the project's words: T2025-116 Project Meetings Fall 2024.
  for (const [key, hl] of heads) {
    const s = sections.get(key);
    if (!s || s.title || headPages < 6) continue;
    for (const l of hl) {
      if (new RegExp(`Section\\s+${NUM}`, 'i').test(l) || /\bPage\s+\d/i.test(l)) continue;
      const words = l.split(/\s+/).filter((w) => (headCount.get(w) ?? 0) < headPages * 0.5);
      if (words.length >= 1 && words.length <= 10 && /[A-Za-z]{3}/.test(words.join(' '))) {
        s.title = cleanTitle(words.join(' '));
        break;
      }
    }
  }
  // Sections the table of contents lists that the book does not hold yet.
  const titled = new Set([...sections.values()].map((s) => s.title.toLowerCase().replace(/[^a-z]+/g, '')));
  for (const t of toc) {
    const s = sections.get(keyOf(t.number));
    if (s) {
      if (!s.title) s.title = t.title;
      continue;
    }
    // Listed under one number, printed under another (a typo in the book): the same section.
    if (!t.missing && titled.has(t.title.toLowerCase().replace(/[^a-z]+/g, ''))) continue;
    const n = make(t.number, t.title);
    n.missing = true;
  }
  for (const s of sections.values()) {
    s.words = [...new Set([...wordsOf(s.title), ...wordsOf(s.title), ...s.words])];
    const body = bodies.get(s.key);
    if (body?.counts.size) {
      s.about = [...body.counts].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 100);
      s.excerpt = body.excerpt.slice(0, 900);
    }
  }
  const list = [...sections.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { reader: SPEC_READER, docId, name, pages, sections: list, pageSection, ...(opts.addendum !== undefined ? { addendum: opts.addendum, changes } : {}) };
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
  const re = new RegExp(`^${NUM}\\s+(.+)$`);
  for (const l of lines) {
    const m = re.exec(l.text);
    if (!m) continue;
    const missing = /to follow|to be issued/i.test(l.text);
    const title = cleanTitle(
      m[2]
        .replace(/\s*\.{2,}.*$/, '') // dot leaders and what follows them
        .replace(/\s+(?:to follow|to be issued.*)$/i, '')
        .replace(/\s+(?:(?:fall|spring|summer|winter)\s+)?\d{4}$/i, '') // an issue date
        .replace(/\s+\d+(?:\s+(?:thru|and|to)\s+\d+|\s+only|\s+pages?)?$/i, ''), // a page count
    );
    if (!title || /^section$/i.test(title) || /^\d+$/.test(title)) continue;
    out.push({ number: m[1], title, missing });
  }
  return out;
}

/** A page that reads as a table of contents: many lines that start with a section number. */
function tocLike(lines: Line[], page: number): boolean {
  if (page > 15 && !lines.some((l) => /\b(table|list) of contents\b|^contents$/i.test(l.text))) return false;
  const re = new RegExp(`^${NUM}\\s+[A-Za-z]`);
  const n = lines.filter((l) => re.test(l.text)).length;
  return n >= 6 && n >= lines.length * 0.3;
}

/**
 * Every section across the project's spec files, as one book: a manual split into a file per
 * section reads the same as one PDF. A section listed "To follow" in one file's table of
 * contents but present in another file is the one present.
 */
export function mergeSections(books: SpecBook[]): SpecSection[] {
  const by = new Map<string, SpecSection>();
  // The original first, then the addenda in order: a section an addendum re-issues is the one that stands.
  const order = [...books].sort((a, b) => (a.addendum ?? 0) - (b.addendum ?? 0));
  for (const b of order)
    for (const s of b.sections) {
      const had = by.get(s.key);
      const issue = b.addendum !== undefined && s.pages.length ? [{ addendum: b.addendum, docId: s.docId, page: s.pages[0] }] : [];
      if (!had) by.set(s.key, issue.length ? { ...s, revisions: issue } : s);
      else if (s.missing) {
        if (!had.title && s.title) by.set(s.key, { ...had, title: s.title });
      } else if (had.missing || issue.length) {
        const revisions = [...(had.revisions ?? []), ...issue];
        by.set(s.key, { ...s, title: s.title || had.title, ...(revisions.length ? { revisions } : {}) });
      }
      else if (!had.title && s.title) by.set(s.key, { ...had, title: s.title });
    }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** An addendum's items: R1: …, Q2/A2, 3) …, bullets; each with the sections and sheets it names. */
const ITEM_START = /^(?:([RQACS]\d{1,3})\s*[:.)-]|\(?(\d{1,3})[.)]\s|(\d{1,2}\.\d{1,2})\s|[•◦▪–-]\s)/;
function itemsOf(lines: Line[], page: number): AddendumItem[] {
  const groups: { label: string; text: string[]; y: number; x: number }[] = [];
  for (const l of lines) {
    const t = l.text.trim();
    if (/^(page \d|document number)/i.test(t)) continue;
    const m = ITEM_START.exec(t);
    if (m) {
      const label = m[1] ?? (m[2] ? `${m[2]})` : (m[3] ?? '•'));
      // An answer belongs with its question: Q2 … A2 ….
      const last = groups[groups.length - 1];
      if (/^A\d/.test(label) && last && last.label === `Q${label.slice(1)}`) {
        last.text.push(t);
        continue;
      }
      groups.push({ label, text: [t.replace(ITEM_START, '').trim()], y: l.y, x: l.x });
    } else if (groups.length) groups[groups.length - 1].text.push(t);
  }
  const out: AddendumItem[] = [];
  // Items under an item (1. To Section 081113 … 1. To 2.1.1, we clarify …) take what it names.
  const stack: { x: number; label: string; sections: string[]; sheets: string[] }[] = [];
  for (const g of groups) {
    const text = g.text.join(' ').replace(/\s+/g, ' ');
    while (stack.length && stack[stack.length - 1].x >= g.x - 4) stack.pop();
    const parent = stack[stack.length - 1];
    // A section number in an item: after Section/Spec/Div, or written in its spaced form (07 46 12).
    const named = [...text.matchAll(new RegExp(SECTION_REF.source.replace('\\bSections?', '\\b(?:Sections?|Spec(?:ification)?s?(?:\\s+Sections?)?|Div\\.?|Division)'), 'gi'))].flatMap((m) => [m[1], ...[...(m[2] ?? '').matchAll(new RegExp(NUM, 'g'))].map((x) => x[1])]);
    const spaced = [...text.matchAll(/(?<![\d.])(\d{2} \d{2} \d{2})(?![\d.])/g)].map((m) => m[1]);
    let sections = [...new Set([...named, ...spaced].map(keyOf))];
    let sheets = [...new Set([...text.matchAll(SHEET_TOKEN)].map((m) => m[1]))];
    stack.push({ x: g.x, label: g.label, sections, sheets });
    if (parent && !sections.length) sections = parent.sections;
    if (parent && !sheets.length) sheets = parent.sheets;
    const label = parent ? `${parent.label.replace(/[).]$/, '')}.${g.label.replace(/[).]$/, '')}` : g.label;
    if (!sections.length && !sheets.length) continue;
    const action = /\b(delete[ds]?|removed?)\b/i.test(text)
      ? 'deleted'
      : /\b(add(?:ed|s)?|new|issued with)\b/i.test(text) && !/\brevis/i.test(text)
        ? 'added'
        : /\b(revis\w*|replace\w*|re-?issu\w*|amend\w*|chang\w*|substitut\w*)\b/i.test(text)
          ? 'revised'
          : 'clarified';
    out.push({ label, text: text.slice(0, 400), page, y: g.y, sections, sheets, action });
  }
  return out;
}
