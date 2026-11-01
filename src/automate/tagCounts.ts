import { codeLists, codesIn, familyOf, isLegendSample, ITEM_CODE, type EnclosedTag, type ListedCode } from '../fill/typeTags';
import type { Pt, Sheet } from '../model';
import type { PageText } from '../pageText';
import { classifySheet, tradeOfNumber } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { emptySetTypes, mergeSetTypes, readTagLegend, readTypeSheet, type SetTypes } from '../walls/setTypes';

/**
 * Counting by type tag, as an estimator does with a set's own conventions:
 *
 * - Items a schedule or legend lists by code (equipment EQ-1…, washroom accessories TA-1…,
 *   fixtures P-1…) are counted wherever the plans write their code, in a symbol or not; the
 *   schedule's own entries are not counted.
 * - Windows (and glazed screens, storefronts, curtain walls) are counted by their type tag on
 *   the floor plans; a window type that no plan tags is counted on the building elevations.
 *
 * Works on what each sheet's text and tags are (read by the caller), so it runs the same in the
 * app and the benchmark.
 */
export type TagSheetInfo = Pick<Sheet, 'id' | 'name' | 'title' | 'width' | 'height'> & { superseded?: boolean };

export interface TagSheet {
  sheet: TagSheetInfo;
  texts: PageText[];
  /** Codes in closed symbols (only needed for windows: `findEnclosedTags`). */
  tags?: EnclosedTag[];
}

/** One type counted across the set. */
export interface TagCount {
  code: string;
  /** What the set's schedule or legend says it is, when it lists it. */
  description: string;
  /** Where each is; `labels`, when given, names each one (a window's number) in step with `at`. */
  places: { sheetId: string; at: Pt[]; labels?: string[] }[];
  total: number;
}

/** Codes written as other kinds the set lists: doors, windows, walls, finishes, rooms. */
const NOT_AN_ITEM =
  /\b(PAINT(ED)?|TILE|CARPET|VINYL|LINOLEUM|RESILIENT|RUBBER|TERRAZZO|EPOXY|SEALER|SEALED|STAIN|VENEER|LAMINATE|WALL\s*COVERING|WALLCOVERING|FINISH(ES)?|FLOOR(ING)?|BASE|CEILINGS?|GYPSUM|GWB|PARTITIONS?|STUDS?|WALLS?|ROOF(ING)?|SLAB|CONCRETE|MASONRY|BLOCK|DOORS?|FRAMES?|HARDWARE|H\.?M\.?|WINDOWS?|GLAZ(ED|ING)|CURTAIN\s*WALL|STOREFRONT|SCREENS?|LOUVRES?|LOUVERS?|ROOM|COLOU?R|WHITE|GRE[YA]|BLACK|MANUFACTURER|SOFFIT|DECK|ASSEMBLY|PLYWOOD)\b/i;

/** Sheets whose lists are of doors, windows, finishes or assemblies (a door schedule's existing-door marks are no items). */
const OTHER_LISTS = /\b(DOORS?|WINDOWS?|OPENINGS?|FRAMES?|HARDWARE|ROOM FINISH|FINISH(ES)? SCHEDULE|ROOM SCHEDULE|PARTITIONS?|WALL TYPES?|ASSEMBL)/i;

/** Words naming rooms: a list mostly of them is the set's room numbers. */
const ROOM_WORDS =
  /\b(ROOM|OFFICE|STORAGE|STOR|CORRIDOR|WASHROOM|WR|W\/?C|MECH(ANICAL)?|ELEC(TRICAL)?|JANITOR|JAN|VESTIBULE|LOBBY|STAIRS?|LOUNGE|CLOSET|SPACE|AREA|HALL|KITCHENETTE|ADMIN|RECEPTION|CLASSROOM|GYM|CHANGE|LOCKERS?|MEETING|BOARDROOM|ELEVATOR|CIRCULATION|ENTRY|FOYER|DINING|LAUNDRY|SERVER|WORKSHOP|STUDIO|BEDROOM|BATH(ROOM)?|SUITE|UNIT)\b/i;

/** What a list's rows say a code is: a window (or other glazing), a wall type, or neither. */
const WINDOW_WORDS = /\b(WINDOWS?|GLAZ(ED|ING)|GLASS|ALUMINUM FRAME|ALUMINIUM FRAME|CURTAIN\s*WALL|STOREFRONT|SASH|VISION|OPERABLE|FIXED|AWNING|CASEMENT|SKYLIGHT)\b/i;
const WALL_WORDS = /\b(GYPSUM|GWB|STUDS?|PARTITION|WALL(?!\s*-?\s*(HUNG|MOUNT))|DRYWALL|MASONRY|BLOCK|CMU|SHEATHING|INSULATION|CLADDING|FURRING)\b/i;

/** Glazing type tags by their letters: windows, curtain walls, storefronts, glazed screens. */
const GLAZING = /^(W|CW|SF|S|G|GL|SG|WS)$/;

const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What the set's type sheets and legends say its codes are. */
export function setTypesFrom(sheets: TagSheet[]): SetTypes {
  const parts: Partial<SetTypes>[] = [emptySetTypes()];
  for (const s of sheets) {
    // Type lists are read off the set's type, legend and schedule sheets: a plan's own tags under a note heading are not a list.
    const kind = classifySheet(s.sheet).kind;
    const read = kind === 'assembly' || kind === 'legend' || kind === 'schedule' ? readTypeSheet(s.texts, s.sheet.width, s.sheet.height) : null;
    if (read) parts.push(read);
    parts.push(readTagLegend(s.texts));
  }
  return mergeSetTypes(parts);
}

/** A sheet number of the set: a detail or section callout's reference, never a tag. */
const sheetNumbers = (sheets: TagSheet[]) => new Set(sheets.map((s) => norm(s.sheet.name)).filter((n) => /\d/.test(n)));

/** Plans an estimator counts items on: new-work plans of the building, finish and furniture/equipment plans included; not trade, site, demolition or existing plans. */
export function isItemPlan(s: TagSheetInfo): boolean {
  if (s.superseded) return false;
  const k = classifySheet(s);
  // Roof and foundation plans tag roofing and footings, not items.
  if (k.kind === 'floor plan') return k.level === 'level';
  if (k.kind === 'finish plan') return true;
  const t = (s.title ?? '').toUpperCase();
  if (!/\bPLANS?\b/.test(t) || tradeOfNumber(s.name ?? '')) return false;
  return !/DEMO|REMOV|EXISTING|SITE|KEY PLAN|LIFE SAFETY|FIRE SEPARATION|PHASING|REFLECTED|\bR\.?C\.?P\b|CEILING|ROOF|FOUNDATION|FOOTING|SPRINKLER|ELECTRICAL|MECHANICAL|PLUMBING|LIGHTING|POWER|STRUCTURAL|FRAMING/.test(t);
}

/** Building elevations (not interior or window-type elevations, details or schedules). */
export function isBuildingElevation(s: TagSheetInfo): boolean {
  if (s.superseded || tradeOfNumber(s.name ?? '')) return false;
  const t = (s.title ?? '').toUpperCase();
  return /ELEVATION/.test(t) && !/INTERIOR|WINDOW|DOOR|TYPES?\b|DETAIL|SCHEDULE|DEMOLI|EXISTING|WASHROOM|ENLARGED|MILLWORK/.test(t);
}

/** Text runs inside the title block are not counted. */
function outsideTitleBlock(s: TagSheet): (p: Pt) => boolean {
  const b = titleBlockBox(s.texts, s.sheet.width, s.sheet.height);
  return b ? ([x, y]) => !(x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) : () => true;
}

/** What a list is of, by what its rows say. */
export type ListKind = 'item' | 'window' | 'wall' | 'other' | 'schedule';

/** Notes and keynotes ("ELECTRICAL CONTRACTOR SHALL…", "REFER TO…") and drawing lists ("LIGHTING PLAN") are no item lists. */
const NOTE_WORDS = /\b(SHALL|CONTRACTOR|REFER|PROVIDE|REMOVE|RELOCATE|EXISTING|NOTES?|SEE|PLANS?|ELEVATIONS?|SECTIONS?|DETAILS?|SCHEDULES?|LEGEND|SPECIFICATIONS?|DRAWINGS?|LIST|LAYOUT|INDEX|COVER)\b/i;

/** A row's cells (two spaces apart), less the ones with no words: a quantity, a bullet, another code. */
const wordCells = (d: string) => d.split(/\s{2,}/).filter((c) => /[A-Za-z]{3}/.test(c.replace(/\b[A-Za-z]{1,4}[-.]?\d+[A-Za-z]?\b/g, '')));

/** A row's name: its first cell with words, to its first clause ("WASTE RECEPTACLE" of "7  WASTE RECEPTACLE: ITEM TO BE SUPPLIED…"). */
const firstClause = (d: string) => (wordCells(d)[0] ?? '').split(/:|;|\s[-–]\s/)[0].trim();

/** The kind of one row of a list. */
function rowKind(r: ListedCode): ListKind {
  // Its first cells: the name and what it is, not the remarks further along.
  const d = wordCells(r.description).slice(0, 2).join(' ');
  if (WINDOW_WORDS.test(d)) return 'window';
  if (WALL_WORDS.test(d)) return 'wall';
  const name = firstClause(r.description);
  // Nothing said, or only other codes and numbers.
  if (!/[A-Za-z]{4}/.test(name)) return 'other';
  if (NOT_AN_ITEM.test(name) || NOTE_WORDS.test(name)) return 'other';
  return 'item';
}

export interface SetList {
  sheetId: string;
  rows: ListedCode[];
  kind: ListKind;
}

/** Every list of codes in the set's schedules and legends, each with what its rows say it is. */
export function setLists(sheets: TagSheet[]): SetList[] {
  const out: SetList[] = [];
  for (const s of sheets) {
    // A structural or mechanical sheet's lists (footings SF-1, unit heaters) are its own trade's.
    if (s.sheet.superseded || tradeOfNumber(s.sheet.name ?? '')) continue;
    const byList = new Map<number, ListedCode[]>();
    for (const l of codeLists(s.texts)) byList.set(l.list, [...(byList.get(l.list) ?? []), l]);
    for (const rows of byList.values()) {
      const votes = new Map<ListKind, number>();
      for (const r of rows) votes.set(rowKind(r), (votes.get(rowKind(r)) ?? 0) + 1);
      let kind = [...votes].sort((x, y) => y[1] - x[1])[0][0];
      if ((votes.get(kind) ?? 0) * 2 <= rows.length) kind = 'other';
      // A list of rooms (their numbers and names) is no list of items.
      if (rows.filter((r) => ROOM_WORDS.test(firstClause(r.description))).length >= 0.4 * rows.length) kind = 'schedule';
      // A door, opening or room finish schedule's codes (door marks, room numbers) are not items.
      if ((kind === 'item' || kind === 'other') && OTHER_LISTS.test(s.sheet.title ?? '')) kind = 'schedule';
      out.push({ sheetId: s.sheet.id, rows, kind });
    }
  }
  return out;
}

/** Whether a code on a plan is a listed code: the same, or with a letter more or less (EQ-17 for EQ-17A and EQ-17B, EQ-9A for EQ-9). */
const sameItem = (plan: string, listed: string) => {
  const [a, b] = [norm(plan), norm(listed)];
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.startsWith(short) && /^[a-z]+$/.test(long.slice(short.length)) && /\d$/.test(short);
};

const describe = (rows: ListedCode[], code: string) => {
  const row = rows.find((r) => r.code === code) ?? rows.find((r) => r.code.toLowerCase() === code.toLowerCase()) ?? rows.find((r) => sameItem(code, r.code));
  if (!row) return '';
  // The first cell or clause: a name, not the whole row.
  return firstClause(row.description).replace(/\s+/g, ' ').slice(0, 60);
};

/**
 * Items listed by code in the set's schedules and legends (equipment, washroom accessories,
 * fixtures), counted where the plans write their code. Lists whose rows describe finishes,
 * doors, windows, walls or rooms, notes and drawing lists are left out, and so is a code another
 * list gives as something else (W-1 a wall type on one sheet and a grab bar on another).
 */
export function countListedItems(sheets: TagSheet[], setTypes: SetTypes = setTypesFrom(sheets), lists: SetList[] = setLists(sheets)): TagCount[] {
  const live = sheets.filter((s) => !s.sheet.superseded);
  const refs = sheetNumbers(sheets);
  const itemRows = lists.filter((l) => l.kind === 'item').flatMap((l) => l.rows);
  if (!itemRows.length) return [];
  const blocked = new Set([...setTypes.wall.map(norm), ...lists.filter((l) => l.kind === 'wall' || l.kind === 'window' || l.kind === 'schedule').flatMap((l) => l.rows.map((r) => norm(r.code)))]);
  const byFamily = new Map<string, ListedCode[]>();
  // D is a door's letter (D1 a door type, D101 a door number): doors have their own count.
  for (const r of itemRows) if (!blocked.has(norm(r.code)) && familyOf(r.code) !== 'D') byFamily.set(familyOf(r.code), [...(byFamily.get(familyOf(r.code)) ?? []), r]);
  const listedTexts = new Map<string, Set<PageText>>();
  for (const l of lists) for (const r of l.rows) listedTexts.set(l.sheetId, (listedTexts.get(l.sheetId) ?? new Set()).add(r.text));
  const counts = new Map<string, TagCount>();
  const named_ = new Map<string, { named: number; all: number }>();
  for (const s of live) {
    if (!isItemPlan(s.sheet)) continue;
    const own = listedTexts.get(s.sheet.id) ?? new Set();
    const keep = outsideTitleBlock(s);
    for (const t of s.texts) {
      if (own.has(t)) continue;
      for (const { code, at } of codesIn(t)) {
        const rows = byFamily.get(familyOf(code));
        if (!rows || blocked.has(norm(code)) || refs.has(norm(code)) || !keep(at) || !rows.some((r) => sameItem(code, r.code))) continue;
        const key = norm(code);
        let c = counts.get(key);
        if (!c) counts.set(key, (c = { code, description: describe(rows, code), places: [], total: 0 }));
        let place = c.places.find((p) => p.sheetId === s.sheet.id);
        if (!place) c.places.push((place = { sheetId: s.sheet.id, at: [] }));
        place.at.push(at);
        c.total++;
        // A room tag carries its room's name beside the number; an item's tag only its code.
        const word = /[A-Za-z]{4,}/.exec(c.description)?.[0]?.toUpperCase();
        const named = !!word && s.texts.some((o) => o !== t && Math.hypot(o.cx - at[0], o.cy - at[1]) < 6 * Math.max(t.h, 3) && o.str.toUpperCase().includes(word));
        const f = familyOf(code);
        const n = named_.get(f) ?? { named: 0, all: 0 };
        named_.set(f, { named: n.named + (named ? 1 : 0), all: n.all + 1 });
      }
    }
  }
  // Codes written with their listed names beside them are room numbers, not items.
  const rooms = new Set([...named_].filter(([, n]) => n.named * 2 >= n.all).map(([f]) => f));
  return sortCounts([...counts.values()].filter((c) => !rooms.has(familyOf(c.code))));
}

/** Natural order: EQ-2 before EQ-10. */
function sortCounts(list: TagCount[]): TagCount[] {
  return list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }));
}

/** A symbol's outline as a class: round, box, diamond, triangle or polygon (5 to 8 sides). */
const shapeClass = (t: EnclosedTag) => (t.sides >= 5 ? 'polygon' : t.shape.split('+')[0]);

/**
 * Window, curtain wall, storefront and glazed screen tags (W1A, CW2, SF1, S114A in their
 * symbol), counted on the floor plans; a type no floor plan tags is counted on the building
 * elevations. Tags of a glazing letter drawn the way the set draws its wall types (the set's
 * listed wall types W1, W2 in boxes) are walls, not windows; with no wall types listed, W tags in
 * boxes and diamonds are taken as walls.
 */
export function countWindowTags(sheets: TagSheet[], setTypes: SetTypes = setTypesFrom(sheets), lists: SetList[] = setLists(sheets)): TagCount[] {
  const live = sheets.filter((s) => !s.sheet.superseded && s.tags);
  const refs = sheetNumbers(sheets);
  type Hit = { s: TagSheet; t: EnclosedTag };
  const hits: Hit[] = [];
  // What the set's lists say each code is: window types, wall types, or items (W-1 a grab bar).
  // Compared as written but for case: W-3 the wall type is not W3 the window.
  const as = (c: string) => c.toLowerCase();
  const window = lists.filter((l) => l.kind === 'window').flatMap((l) => l.rows);
  const windowCodes = new Set(window.map((r) => as(r.code)));
  const wallCodes = new Set([...setTypes.wall.map(as), ...lists.filter((l) => l.kind === 'wall').flatMap((l) => l.rows.map((r) => as(r.code)))]);
  const itemCodes = new Set(lists.filter((l) => l.kind === 'item').flatMap((l) => l.rows.map((r) => as(r.code))));
  for (const s of live) {
    const plan = classifySheet(s.sheet);
    const onPlan = plan.kind === 'floor plan' && plan.level === 'level';
    if (!onPlan && !isBuildingElevation(s.sheet)) continue;
    const lists = codeLists(s.texts);
    const listed = new Set(lists.map((l) => `${l.text.cx.toFixed(1)},${l.text.cy.toFixed(1)}`));
    const keep = outsideTitleBlock(s);
    for (const t of s.tags!) {
      const f = familyOf(t.code);
      // Upper-case letters: lower-case w1 is a wall on sets that write both.
      if (!GLAZING.test(f) || !/^[A-Z]/.test(t.code) || !ITEM_CODE.test(t.code) || t.others.length) continue;
      if (refs.has(norm(t.code)) || listed.has(`${t.at[0].toFixed(1)},${t.at[1].toFixed(1)}`) || !keep(t.at)) continue;
      if (isLegendSample(t.at, t.h, s.texts)) continue;
      hits.push({ s, t });
    }
  }
  // Each family's tags by how they are drawn: a way of drawing that holds the set's wall types is the wall tags.
  const groups = new Map<string, Hit[]>();
  for (const h of hits) {
    const k = `${familyOf(h.t.code)}|${shapeClass(h.t)}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  }
  const kept: Hit[] = [];
  for (const [k, list] of groups) {
    const codes = [...new Set(list.map((h) => as(h.t.code)))];
    const win = codes.filter((c) => windowCodes.has(c)).length;
    const other = codes.filter((c) => !windowCodes.has(c) && (wallCodes.has(c) || itemCodes.has(c))).length;
    // Nothing said either way: W tags in boxes and diamonds are taken as the wall types.
    if (!win && !other && /^W\|(box|diamond)$/.test(k)) continue;
    // The set's wall types (or items) drawn this way: walls. A few of many codes sharing a wall
    // type's code (windows W1 to W22 on a set with walls W1, W2, W3) do not make them walls.
    if (other > win && other * 2 >= codes.length) continue;
    kept.push(...list);
  }
  const counts = new Map<string, TagCount>();
  const onPlans = new Set(kept.filter((h) => classifySheet(h.s.sheet).kind === 'floor plan').map((h) => norm(h.t.code)));
  for (const h of kept) {
    const plan = classifySheet(h.s.sheet).kind === 'floor plan';
    if (!plan && onPlans.has(norm(h.t.code))) continue;
    const key = norm(h.t.code);
    let c = counts.get(key);
    if (!c) counts.set(key, (c = { code: h.t.code, description: describe(window, h.t.code), places: [], total: 0 }));
    let place = c.places.find((p) => p.sheetId === h.s.sheet.id);
    if (!place) c.places.push((place = { sheetId: h.s.sheet.id, at: [] }));
    place.at.push(h.t.at);
    c.total++;
  }
  return sortCounts([...counts.values()]);
}

/** What a plumbing fixture schedule's rows name. */
const FIXTURE_WORDS =
  /\b(WATER\s*CLOSET|W\.?C\.?|TOILET|LAVATOR(Y|IES)|BASIN|URINAL|SINKS?|SHOWERS?|FLOOR\s*DRAINS?|FUNNEL|DRAINS?|FAUCETS?|HOSE\s*(BIBB?|STATION)|HYDRANT|FOUNTAIN|BOTTLE\s*FILL|EYE\s*WASH|EMERGENCY|MOP|SERVICE\s*SINK|LAUNDRY|TUB|WATER\s*HEATER|HEATER|BACKFLOW|PREVENTER|INTERCEPTOR|THERMOSTATIC|MIXING\s*VALVE|TRAP\s*PRIMER|PUMP|TANK|DISHWASHER)\b/i;
const PLUMBING_TRADES = /^(M|MD|MH|MP|ME|P|PD|PL)$/;

/**
 * Plumbing fixtures counted as a plumber does: the codes the mechanical or plumbing drawings'
 * fixture schedule lists (WC-1, L-2, FD-1), wherever the new-work plumbing plans write them. The
 * architectural lists and plans are `countListedItems`'s; this reads the trade's own.
 */
export function countPlumbingFixtures(sheets: TagSheet[]): TagCount[] {
  const live = sheets.filter((s) => !s.sheet.superseded);
  const trade = (s: TagSheet) => tradeOfNumber(s.sheet.name ?? '');
  const plumbing = live.filter((s) => PLUMBING_TRADES.test(trade(s) ?? ''));
  // The schedule: rows on the trade's sheets whose names are fixtures.
  const rows: ListedCode[] = [];
  const listed = new Set<PageText>();
  for (const s of plumbing)
    for (const r of codeLists(s.texts, undefined, { mixed: true })) {
      listed.add(r.text);
      // (Anywhere in the row: a schedule may give the maker and model before the fixture's name.)
      if (FIXTURE_WORDS.test(r.description)) rows.push(r);
    }
  if (!rows.length) return [];
  const codes = new Map<string, ListedCode>();
  for (const r of rows) if (!codes.has(norm(r.code))) codes.set(norm(r.code), r);
  const counts = new Map<string, TagCount>();
  for (const s of plumbing) {
    const t = (s.sheet.title ?? '').toUpperCase();
    // New-work plumbing plans: not demolition, existing, schedules, details, sections, risers.
    if (!/\bPLANS?\b/.test(t) || !/PLUMB|DRAIN|PIPING|SANITARY|DOMESTIC|WATER/.test(t) || /DEMO|REMOV|EXISTING|SCHEDULE|DETAIL|SECTION|RISER|SCHEMATIC|ROOF|SITE/.test(t)) continue;
    const keep = outsideTitleBlock(s);
    for (const tx of s.texts) {
      if (listed.has(tx)) continue;
      for (const { code, at } of codesIn(tx)) {
        const r = codes.get(norm(code));
        if (!r || !keep(at)) continue;
        let c = counts.get(norm(code));
        if (!c) counts.set(norm(code), (c = { code: r.code, description: firstClause(r.description).replace(/\s+/g, ' ').slice(0, 60), places: [], total: 0 }));
        let place = c.places.find((p) => p.sheetId === s.sheet.id);
        if (!place) c.places.push((place = { sheetId: s.sheet.id, at: [] }));
        place.at.push(at);
        c.total++;
      }
    }
  }
  return sortCounts([...counts.values()]);
}
