import type { Segment } from '../fill/vectors';
import type { Sheet } from '../model';
import type { PageText } from '../pageText';
import { pause, perSheet, type SetAccess } from '../automate/set';
import { readAbbreviations, readTypeLegends, type LegendEntry } from './legends';
import { columnName, readSchedules, type Schedule, type ScheduleRow } from './schedules';

/**
 * Smart drawings: the set read once into an index of what its tags mean (its schedules, type
 * legends and abbreviations), so every door, room, window, wall type, finish code, equipment
 * mark and detail callout on a sheet can be clicked for what the drawings say about it. Every
 * answer comes from the drawings' own text: nothing is guessed when you click.
 */

export type TagKind = 'door' | 'window' | 'room' | 'wall' | 'finish' | 'item' | 'sheet';

export const TAG_KINDS: { kind: TagKind; label: string; color: string }[] = [
  { kind: 'door', label: 'Doors', color: '#0a84ff' },
  { kind: 'room', label: 'Rooms', color: '#30d158' },
  { kind: 'window', label: 'Windows', color: '#64d2ff' },
  { kind: 'wall', label: 'Walls', color: '#ff9f0a' },
  { kind: 'finish', label: 'Finishes', color: '#bf5af2' },
  { kind: 'item', label: 'Equipment', color: '#ff375f' },
  { kind: 'sheet', label: 'Details', color: '#8e8e93' },
];

export interface IndexedSchedule extends Schedule {
  sheetId: string;
}
export interface IndexedLegend extends LegendEntry {
  sheetId: string;
  kind: TagKind;
}

export interface DrawingIndex {
  schedules: IndexedSchedule[];
  legends: IndexedLegend[];
  abbreviations: Record<string, string>;
  /** Where each tag is on the set: entry key → sheet id → times. */
  where: Record<string, Record<string, number>>;
  /** Sheets read. */
  sheets: number;
}

/** What a code is in the index: its schedule row and its legend, either or both. */
export interface Entry {
  key: string;
  kind: TagKind;
  code: string;
  schedule?: IndexedSchedule;
  row?: ScheduleRow;
  legend?: IndexedLegend;
}

/** One clickable tag on a sheet. */
export interface SmartTag {
  key: string;
  kind: TagKind;
  code: string;
  /** x0, y0, x1, y1 on the sheet. */
  box: [number, number, number, number];
  /** The sheet a detail callout points to. */
  target?: string;
}

/** A code as tags and schedules may write it: D-101, d101 and D101 are one. */
export const norm = (s: string) => s.toUpperCase().replace(/[\s\-–_]/g, '');

const discipline = (name: string) => (/^[A-Z]+/i.exec(name)?.[0] ?? name.charAt(0)).toUpperCase().charAt(0);

function kindOfSchedule(s: Schedule): TagKind {
  switch (s.kind) {
    case 'door':
      return 'door';
    case 'window':
      return 'window';
    case 'room':
      return 'room';
    case 'wall':
      return 'wall';
    default:
      return 'item';
  }
}

function kindOfLegend(l: LegendEntry): TagKind {
  const t = `${l.legend} ${l.lines[0] ?? ''}`.toUpperCase();
  if (/PARTITION|\bWALL/.test(t)) return 'wall';
  if (/CEILING|FLOOR|FINISH|BASE|MILLWORK|COUNTERTOP|CASEWORK/.test(t)) return 'finish';
  if (/SCREEN|WINDOW|GLAZ|STOREFRONT/.test(t)) return 'window';
  if (/DOOR|FRAME/.test(t)) return 'door';
  return 'item';
}

const SCHEDULE_HINT = /\bSCHEDULE\b|ASSEMBLIES|\bTYPES?\b/i;
const LEGEND_HINT = /\b(TYPES?|ASSEMBL(Y|IES)|LEGEND|ELEVATIONS|CONSTRUCTION)\b/i;

/** Reads a sheet's schedules, legends and abbreviations into the index. */
export function readSheetInto(index: DrawingIndex, sheet: Sheet, texts: PageText[], segs: Segment[]) {
  const schedules = readSchedules(texts, segs);
  for (const s of schedules) index.schedules.push({ ...s, sheetId: sheet.id });
  for (const l of readTypeLegends(texts, segs, schedules.map((s) => s.box))) index.legends.push({ ...l, sheetId: sheet.id, kind: kindOfLegend(l) });
  for (const [a, m] of readAbbreviations(texts)) if (!index.abbreviations[a]) index.abbreviations[a] = m;
}

export const emptyIndex = (): DrawingIndex => ({ schedules: [], legends: [], abbreviations: {}, where: {}, sheets: 0 });

/** Reads the whole set: its schedules and legends, then where each tag is on every sheet. */
export async function buildIndex(sheets: Sheet[], access: SetAccess): Promise<DrawingIndex> {
  const index = emptyIndex();
  const live = sheets.filter((s) => !s.superseded);
  const texts = new Map<string, PageText[]>();
  for (const [i, s] of live.entries()) {
    access.progress?.(`Reading schedules and legends… ${s.name} (${i + 1} of ${live.length})`);
    if (i % 4 === 0) await pause();
    await perSheet(access, s, async () => {
      const t = await access.texts(s);
      texts.set(s.id, t);
      if (!t.some((x) => SCHEDULE_HINT.test(x.str) || LEGEND_HINT.test(x.str) || /^ABBREVIATIONS?:?$/i.test(x.str.trim()))) return;
      const segs = (await access.segments(s)) ?? [];
      readSheetInto(index, s, t, segs);
    });
  }
  index.sheets = live.length;
  const dict = entries(index);
  for (const [i, s] of live.entries()) {
    if (i % 8 === 0) {
      access.progress?.(`Finding tags on the sheets… ${i + 1} of ${live.length}`);
      await pause();
    }
    const t = texts.get(s.id);
    if (!t) continue;
    for (const tag of tagsOn(s, t, index, sheets, dict)) {
      if (tag.kind === 'sheet') continue;
      const w = (index.where[tag.key] ??= {});
      w[s.id] = (w[s.id] ?? 0) + 1;
    }
  }
  return index;
}

/**
 * Every code the index knows, by its normal form: schedule rows first, legend entries joining
 * them (P3's legend, W1's elevation); finish codes listed in a room finish schedule; a door's
 * number written without its letter on the plans (011.2 for D011.2) as well.
 */
export function entries(index: DrawingIndex): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const s of index.schedules)
    for (const row of s.rows) {
      const kind = kindOfSchedule(s);
      const key = `${kind}:${norm(row.mark)}`;
      if (out.has(norm(row.mark))) continue;
      out.set(norm(row.mark), { key, kind, code: row.mark, schedule: s, row });
    }
  for (const l of index.legends) {
    const had = out.get(norm(l.code));
    if (had) {
      if (!had.legend) had.legend = l;
      continue;
    }
    out.set(norm(l.code), { key: `${l.kind}:${norm(l.code)}`, kind: l.kind, code: l.code, legend: l });
  }
  // Finish codes a room finish schedule uses (VPLK 1, ACT 1, LVT 2).
  for (const s of index.schedules) {
    if (s.kind !== 'room') continue;
    for (const row of s.rows)
      row.cells.forEach((c, i) => {
        if (i === s.markColumn) return;
        for (const m of c.matchAll(/\b([A-Z]{2,5})\s?(\d{1,2}[A-Z]?)\b/g)) {
          const code = `${m[1]} ${m[2]}`;
          if (out.has(norm(code))) continue;
          out.set(norm(code), { key: `finish:${norm(code)}`, kind: 'finish', code });
        }
      });
  }
  // Doors tagged by number alone.
  const bare = new Map<string, Entry[]>();
  for (const e of out.values()) {
    if (e.kind !== 'door') continue;
    const n = norm(e.code).replace(/^[A-Z]+/, '');
    if (n !== norm(e.code) && /\d/.test(n)) bare.set(n, [...(bare.get(n) ?? []), e]);
  }
  for (const [n, es] of bare) if (es.length === 1 && !out.has(n)) out.set(n, es[0]);
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

const boxOf = (t: PageText, pad: number): [number, number, number, number] => {
  const c = Math.abs(Math.cos(t.angle ?? 0));
  const s = Math.abs(Math.sin(t.angle ?? 0));
  const w = t.w * c + t.h * 1.25 * s;
  const h = t.w * s + t.h * 1.25 * c;
  return [t.cx - w / 2 - pad, t.cy - h / 2 - pad, t.cx + w / 2 + pad, t.cy + h / 2 + pad];
};

/** A detail callout's sheet: A5.0, or 3/A5.0 written as one. */
const CALLOUT = /^(?:[A-Z0-9]{1,2}\s*\/\s*)?([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?[A-Z]?)$/i;

/** The tags on one sheet that the index can explain. */
export function tagsOn(sheet: Sheet, texts: PageText[], index: DrawingIndex, sheets: Sheet[], dict = entries(index)): SmartTag[] {
  const mh = median(texts.map((t) => t.h)) || 5;
  const own = [
    ...index.schedules.filter((s) => s.sheetId === sheet.id).map((s) => s.box),
    ...index.legends.filter((l) => l.sheetId === sheet.id).map((l) => [l.at[0] - 20, l.at[1] - 20, l.at[0] + 20, l.at[1] + 20] as [number, number, number, number]),
  ];
  const inOwn = (t: PageText) => own.some(([x0, y0, x1, y1]) => t.cx > x0 && t.cx < x1 && t.cy > y0 && t.cy < y1);
  const byName = new Map<string, Sheet>();
  for (const s of sheets) if (!s.superseded && /\d/.test(s.name)) byName.set(norm(s.name), s);
  const disc = discipline(sheet.name);
  const words = texts.filter((t) => /[A-Z]{3,}/i.test(t.str));
  const out: SmartTag[] = [];
  for (const t of texts) {
    const str = t.str.trim();
    if (!str || str.length > 16 || inOwn(t)) continue;
    const k = norm(str);
    const e = dict.get(k);
    if (e) {
      // Equipment and structural marks (C, J1, BM1) on their own trade's sheets only: an A on a plan is a grid line.
      if (e.kind === 'item' && e.schedule) {
        const from = sheets.find((x) => x.id === e.schedule!.sheetId);
        if (from && discipline(from.name) !== disc) continue;
        if (!/\d/.test(e.code) && t.h > mh * 2.5) continue;
      }
      // A room number has its name beside it.
      if (e.kind === 'room' && !words.some((o) => o !== t && Math.abs(o.cy - t.cy) < 5 * t.h && Math.abs(o.cx - t.cx) < Math.max(25 * t.h, o.w))) continue;
      // A single letter is only a light fixture's type on a lighting plan; elsewhere it is too common.
      if (!/\d/.test(k) && k.length < 2 && !(e.kind === 'item' && /LIGHT|LUMINAIRE|FIXTURE/i.test(e.schedule?.title ?? ''))) continue;
      out.push({ key: e.key, kind: e.kind, code: e.code, box: boxOf(t, t.h * 0.35) });
      continue;
    }
    // A detail callout: another sheet's number, written small (not this sheet's title block).
    const m = CALLOUT.exec(str);
    if (m && t.h <= mh * 2.5) {
      const to = byName.get(norm(m[1]));
      if (to && to.id !== sheet.id) out.push({ key: `sheet:${to.id}`, kind: 'sheet', code: to.name, box: boxOf(t, t.h * 0.35), target: to.id });
    }
  }
  return out;
}

export interface InfoRow {
  label: string;
  value: string;
  /** A code in the value the index explains too (a door's type, a room's ceiling). */
  link?: string;
}
export interface InfoSection {
  title?: string;
  rows: InfoRow[];
}
export interface Info {
  kind: TagKind;
  code: string;
  title: string;
  /** Where it was read from: "Door schedule, A6.1". */
  source: string;
  sections: InfoSection[];
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s(/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** A value with its abbreviations spelled out: HM → HM (hollow metal); EX GB → EX GB (existing gypsum board). */
export function expand(value: string, abbr: Record<string, string>): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return value;
  const known = words.map((w) => (/^(YES|NO|N\/A|NONE|-|A|AT|OR|AND)$/i.test(w) ? undefined : abbr[w.toUpperCase().replace(/[.,]$/, '')]));
  if (!known.some(Boolean)) return value;
  const spelled = words.map((w, i) => (known[i] ? known[i].toLowerCase() : w.toLowerCase())).join(' ');
  return `${value} (${spelled})`;
}

const isTick = (v: string) => v === '✓';

/** What the drawings say about a code. */
export function describe(e: Entry, index: DrawingIndex, sheets: Sheet[], dict = entries(index)): Info {
  const sheetName = (id: string) => sheets.find((s) => s.id === id)?.name ?? '';
  const abbr = index.abbreviations;
  const sections: InfoSection[] = [];
  const linkOf = (v: string) => {
    if (!/[A-Z]/i.test(v)) return undefined;
    const hit = dict.get(norm(v));
    return hit && hit.key !== e.key ? hit.code : undefined;
  };
  const sources: string[] = [];
  let heading = e.code;
  if (e.schedule && e.row) {
    const s = e.schedule;
    sources.push(`${title(s.title)}, ${sheetName(s.sheetId)}`);
    // Columns by their group (DOOR, HARDWARE, FRAME); a wall's sides (WALLS · NORTH · MATERIAL) one line each.
    const groups = new Map<string, { label: string; value: string }[]>();
    const boolCol = (i: number) => s.rows.every((r) => !r.cells[i] || isTick(r.cells[i]));
    s.columns.forEach((c, i) => {
      if (i === s.markColumn) return;
      const v = e.row!.cells[i];
      if (!v) return;
      const group = c.length >= 2 ? c[0] : '';
      // CEILING · CEILING · HEIGHT is the ceiling's height.
      const label = c.length >= 3 ? (c[1] === c[0] ? c.slice(2).join(' ') : c[1]) : c.length === 2 ? c[1] : c[0] ?? `Column ${i + 1}`;
      const list = groups.get(group) ?? [];
      const had = c.length >= 3 && c[1] !== c[0] ? list.find((x) => x.label === label) : undefined;
      const shown = isTick(v) && boolCol(i) ? '✓' : v;
      if (had) had.value += `, ${shown}`;
      else list.push({ label, value: shown });
      groups.set(group, list);
    });
    // Its name, when the schedule gives one (ROOM NAME, DESCRIPTION, a TYPE column of its own).
    const nameCol = nameColumn(s);
    const name = nameCol >= 0 ? e.row.cells[nameCol] : '';
    if (name) heading = `${e.code} · ${title(name.length > 60 ? `${name.slice(0, 57)}…` : name)}`;
    // A group of one column (ESP over (in wc)) reads as one line in the main section.
    const main: InfoRow[] = [];
    const rest: InfoSection[] = [];
    for (const [group, list] of groups) {
      if (group && list.length === 1 && list[0].value !== '✓') {
        main.push({ label: sentence(`${group} ${list[0].label}`), value: expand(list[0].value, abbr), link: linkOf(list[0].value) });
        continue;
      }
      const ticks = list.filter((x) => x.value === '✓');
      const rows: InfoRow[] = list
        .filter((x) => x.value !== '✓' && !(name && x.value === name && !group))
        .map((x) => ({ label: sentence(x.label || group || 'Value'), value: expand(x.value, abbr), link: linkOf(x.value) }));
      if (ticks.length) rows.push({ label: ticks.length > 2 ? 'Includes' : 'Checked', value: ticks.map((x) => sentence(x.label)).join(', ') });
      if (!group) main.unshift(...rows);
      else rest.push({ title: title(group), rows });
    }
    // Remarks and notes last.
    main.sort((a, b) => Number(/remark|note/i.test(a.label)) - Number(/remark|note/i.test(b.label)));
    if (main.length) sections.push({ rows: main });
    sections.push(...rest);
  }
  if (e.legend) {
    const l = e.legend;
    sources.push(`${l.legend ? title(l.legend) : 'Legend'}, ${sheetName(l.sheetId)}`);
    const rows: InfoRow[] = [];
    const [head, ...rest] = l.lines;
    if (!e.schedule) heading = `${e.code} · ${title(head)}`;
    if (l.size) rows.push({ label: 'Overall width', value: l.size });
    if (e.kind === 'wall') rows.push(...wallFacts(l.lines));
    rows.push({ label: e.schedule ? title(head) : 'Construction', value: rest.map((x) => sentence(x)).join('\n') || sentence(head) });
    sections.push({ title: 'Legend', rows });
  }
  if (e.kind === 'wall' && e.schedule && e.row && !e.legend) sections.push({ title: 'Key facts', rows: wallFacts(e.row.cells) });
  // A finish code: what it is, and the rooms it is in.
  if (e.kind === 'finish') {
    const word = norm(e.code).replace(/\d.*$/, '');
    if (abbr[word]) sections.unshift({ rows: [{ label: 'Means', value: sentence(abbr[word]) }] });
    if (!e.schedule && !e.legend && abbr[word]) heading = `${e.code} · ${title(abbr[word])}`;
    const rooms = index.schedules
      .filter((s) => s.kind === 'room')
      .flatMap((s) => s.rows.filter((r) => r.cells.some((c, i) => i !== s.markColumn && norm(c).includes(norm(e.code)))).map((r) => r.mark));
    if (rooms.length) {
      sections.push({ title: 'Used in', rows: [{ label: `${rooms.length} room${rooms.length === 1 ? '' : 's'}`, value: rooms.join(', ') }] });
      sources.push('Room finish schedule');
    }
  }
  // Doors and their rooms: door 013.1 opens off room 013.
  if (e.kind === 'room') {
    const n = norm(e.code);
    const doors = [...new Set([...dict.values()].filter((d) => d.kind === 'door' && d.schedule && norm(d.code).replace(/^[A-Z]+/, '').split('.')[0] === n).map((d) => d.code))];
    if (doors.length) sections.push({ title: 'Doors', rows: [{ label: `${doors.length} door${doors.length === 1 ? '' : 's'}`, value: doors.join(', ') }] });
  }
  if (e.kind === 'door') {
    const n = norm(e.code).replace(/^[A-Z]+/, '').split('.')[0];
    const room = dict.get(n);
    if (room && room.kind === 'room') sections.unshift({ rows: [{ label: 'Room', value: describeName(room), link: room.code }] });
  }
  // Where it is on the set.
  const where = index.where[e.key];
  if (where) {
    const list = Object.entries(where)
      .map(([id, n]) => `${sheetName(id)}${n > 1 ? ` ×${n}` : ''}`)
      .filter((x) => x);
    sections.push({ title: 'On the drawings', rows: [{ label: `${list.length} sheet${list.length === 1 ? '' : 's'}`, value: list.join(', ') }] });
  }
  return { kind: e.kind, code: e.code, title: heading, source: sources.join(' · ') || 'Drawings', sections };
}

/** A schedule's column naming each row (ROOM NAME, DESCRIPTION, a TYPE column of its own). */
const nameColumn = (s: Schedule) => s.columns.findIndex((c, i) => i !== s.markColumn && (/NAME|DESCRIPTION|ITEM/i.test(c[c.length - 1] ?? '') || (c.length === 1 && /^TYPE$/i.test(c[0]))));

/** What a code is called on the drawings: its row's name, or its legend's heading. */
export function entryName(e: Entry): string {
  if (e.schedule && e.row) {
    const i = nameColumn(e.schedule);
    if (i >= 0 && e.row.cells[i]) return title(e.row.cells[i]);
  }
  if (e.legend) return title(e.legend.lines[0] ?? '');
  return '';
}

function describeName(room: Entry): string {
  const s = room.schedule;
  if (!s || !room.row) return room.code;
  const i = s.columns.findIndex((c, j) => j !== s.markColumn && /NAME/i.test(c[c.length - 1] ?? ''));
  return i >= 0 && room.row.cells[i] ? `${room.code} ${title(room.row.cells[i])}` : room.code;
}

/** A wall's studs, boards, insulation, fire rating and sound rating, from its legend or schedule text. */
export function wallFacts(lines: string[]): InfoRow[] {
  const all = lines.join(' \n ');
  const rows: InfoRow[] = [];
  const studs = lines.find((l) => /\bSTUDS?\b|\bCHANNELS?\b|\bFURRING\b|\bGIRTS?\b/i.test(l));
  if (studs) rows.push({ label: 'Framing', value: sentence(studs.replace(/^[•✓\-\s]+/, '')) });
  const boards = lines.filter((l) => /GYPSUM|\bGWB\b|\bGB\b|BOARD|SHEATHING|PLYWOOD|\bFRP\b|FIBREGLASS REINFORCED|SHAFTLINER/i.test(l) && l !== studs && !/CONSTRUCTION$/i.test(l));
  if (boards.length) rows.push({ label: 'Boards', value: boards.map((b) => sentence(b.replace(/^[•✓\-\s]+/, ''))).join('; ') });
  const insul = lines.find((l) => /INSUL|SAFB|BATT|MINERAL WOOL/i.test(l));
  if (insul) rows.push({ label: 'Insulation', value: sentence(insul.replace(/^[•✓\-\s]+/, '')) });
  const fire = /(\d(?:\.\d+)?\s*(?:HR|HOUR)S?\b[^\n]{0,12}?(?:F\.?R\.?R\.?|FIRE)?)|((?:F\.?R\.?R\.?|FIRE RATING)[:\s]+\d[^\n]{0,10})/i.exec(all);
  rows.push({ label: 'Fire rating', value: fire ? fire[0].trim() : 'Not stated on the legend' });
  const stc = /S\.?T\.?C\.?\s*:?\s*(\d{2})/i.exec(all);
  rows.push({ label: 'Sound (STC)', value: stc ? stc[1] : 'Not stated on the legend' });
  return rows;
}

/** The index's counts by kind: listed in schedules and legends, and how many of those are tagged on the sheets. */
export function indexStats(index: DrawingIndex, dict = entries(index)) {
  const seen = new Set<string>();
  const out = new Map<TagKind, { listed: number; onPlans: number; missing: string[] }>();
  for (const e of dict.values()) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    if (!e.schedule && !e.legend) continue;
    const st = out.get(e.kind) ?? { listed: 0, onPlans: 0, missing: [] };
    st.listed++;
    const own = new Set([e.schedule?.sheetId, e.legend?.sheetId]);
    if (Object.keys(index.where[e.key] ?? {}).some((id) => !own.has(id))) st.onPlans++;
    else st.missing.push(e.code);
    out.set(e.kind, st);
  }
  return out;
}

/** What a search finds: codes starting with it first (A3, A3A), then names containing it (LOUNGE). */
export function searchEntries(byKey: Map<string, Entry>, q: string, limit = 8): Entry[] {
  const n = norm(q);
  if (!n) return [];
  const words = q.trim().toLowerCase();
  const scored: [number, Entry][] = [];
  for (const e of byKey.values()) {
    const c = norm(e.code);
    const score = c === n ? 0 : c.startsWith(n) ? 1 : c.replace(/^[A-Z]+/, '') === n ? 1.5 : words.length >= 3 && entryName(e).toLowerCase().includes(words) ? 2 : -1;
    if (score >= 0) scored.push([score, e]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].code.localeCompare(b[1].code, undefined, { numeric: true }))
    .slice(0, limit)
    .map((x) => x[1]);
}

export { columnName };
