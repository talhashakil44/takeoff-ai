import { guessDivision } from '../divisionGuess';
import { codesIn, familyOf } from '../fill/typeTags';
import type { Segment } from '../fill/vectors';
import { findLegends } from '../fill/autoSymbols';
import { isBackground, layerService, layerStatus, type LayerStatus } from '../layers';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { drawingTitles } from '../sheetScale';
import { tradeOfNumber } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { replaceRun, type Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';
import { symbolTallies } from './symbols';

/**
 * Automate › Mechanical & electrical counts: what the trades' plans show, counted the way an
 * estimator checks a sub's price.
 *
 * - Symbols from the trades' legends (receptacles, switches, sensors, fire alarm devices, data,
 *   security, mechanical devices), counted on the trades' new-work plans.
 * - Items the trades' schedules list by tag (plumbing fixtures WC-1, L-1, FD-1; equipment EF-1,
 *   CU-1, FC-1, ERV-1; grilles and diffusers D1, R1, E1), counted where the plans write the tag.
 * - Light fixtures by the type letter the lighting plans write in each fixture (A, J, J1), from
 *   the light fixture schedule.
 *
 * A device on a layer of existing work to stay is left out; one on a demolition layer, or on a
 * demolition plan, is a removal. An item shown on several plans of one floor (an exhaust fan on
 * the ductwork plan and again on the power plan) counts once: each floor's count is the most any
 * one plan of that floor shows.
 */

export interface TradesResult extends Automation {
  checks: string[];
}

const TRADES = /^(M|MD|MH|MP|ME|P|PD|PL|E|ED|EL|EP|FP|FA|F|T|S|SD)$/;
const disciplineOf = (s: Sheet): string | null => {
  const t = tradeOfNumber(s.name ?? '');
  if (!t || !TRADES.test(t)) return null;
  if (t === 'S' || t === 'SD') return 'S';
  return t.startsWith('E') || t === 'T' ? 'E' : t.startsWith('FP') || t === 'F' || t === 'FA' ? (t === 'FA' ? 'E' : 'FP') : t.startsWith('P') ? 'P' : 'M';
};

/** What a sheet's drawing titles say: a demolition plan, or new work. */
export function planStatus(title: string | undefined, texts: PageText[]): 'demo' | 'new' {
  const titles = [title ?? '', ...drawingTitles(texts).slice(0, 4).map((d) => d.str)].join(' ').toUpperCase();
  return /DEMOLITION|\bDEMO\b|REMOVALS?/.test(titles) && !/RENOVATION|NEW WORK|PROPOSED/.test(titles) ? 'demo' : 'new';
}

/** The floor a plan is of, by its titles ("LOWER LEVEL", "MAIN LEVEL", "ROOF", "LEVEL 2"). */
export function floorOf(title: string | undefined, texts: PageText[]): string {
  const all = [title ?? '', ...drawingTitles(texts).slice(0, 4).map((d) => d.str)].join(' | ').toUpperCase();
  const m = /\b(BELOW GRADE|LOWER|MAIN|UPPER|GROUND|BASEMENT|CELLAR|MEZZANINE|PENTHOUSE|ROOF|FIRST|SECOND|THIRD|FOURTH|FIFTH)\b|\bLEVEL\s*([0-9A-Z]{1,2})\b|\b(\d+)(?:ST|ND|RD|TH)\s+FLOOR/.exec(all);
  return m ? (m[1] ?? m[2] ?? m[3]) : 'plan';
}

/** Whether a sheet is one of the trades' plans (drawn to scale, a plan, not a schedule or detail sheet). */
const isPlan = (s: Sheet, texts: PageText[]) => {
  if (!s.metersPerPoint || s.superseded) return false;
  const t = [s.title ?? '', ...drawingTitles(texts).slice(0, 3).map((d) => d.str)].join(' ').toUpperCase();
  return /\bPLANS?\b/.test(t) && !/\b(SCHEDULES?|DETAILS?|DIAGRAMS?|RISER)\b/.test((s.title ?? '').toUpperCase());
};

/**
 * Whether the linework at a point is new work, to remove or existing (by the layers it is on),
 * or null with no layered ink there. The architect's background under the trade's work is not
 * looked at.
 */
export function statusAt(segs: Segment[], names: Map<string, string>, [x, y]: Pt, r: number): LayerStatus | null {
  if (!names.size) return null;
  const votes = new Map<LayerStatus, number>();
  for (const s of segs) {
    if (!s.layer) continue;
    if (Math.max(s.x1, s.x2) < x - r || Math.min(s.x1, s.x2) > x + r || Math.max(s.y1, s.y2) < y - r || Math.min(s.y1, s.y2) > y + r) continue;
    const name = names.get(s.layer);
    if (!name || isBackground(name) || /TEXT|ANNO|NAMES?\b|WIRE/i.test(name)) continue;
    const st = layerStatus(name);
    votes.set(st, (votes.get(st) ?? 0) + Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + 0.5);
  }
  if (!votes.size) return null;
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

/** A tag a schedule lists: letters and a number (WC-1, FD-1, EF-3, VVT-1.2, D1). */
const TAG = (c: string) => /^[A-Za-z]{1,4}[-.]?\d{1,3}(?:\.\d{1,2})?[A-Za-z]?$/.test(c);

type Hit = { sheet: Sheet; at: Pt; floor: string; remove: boolean };

/**
 * Counts per floor, the most any one plan of that floor shows, as the places to mark. A unit of
 * equipment (EF-1, CU-1) is one wherever it is drawn: its tag twice on a plan close together (on
 * the unit and in a note by it) is one, and on two floors (a roof fan on the roof plan and again on
 * the ductwork plan below) it counts on the floor that shows most of them.
 */
function perFloor(hits: Hit[], unit = false): { places: Map<string, Pt[]>; total: number } {
  const byFloor = new Map<string, Map<string, Hit[]>>();
  for (const h of hits) {
    const f = byFloor.get(h.floor) ?? new Map<string, Hit[]>();
    f.set(h.sheet.id, [...(f.get(h.sheet.id) ?? []), h]);
    byFloor.set(h.floor, f);
  }
  const once = (list: Hit[]) => {
    if (!unit) return list;
    // Within 20 ft (6 m) of one already kept: the same unit.
    const r = 6 / (list[0].sheet.metersPerPoint || 0.0035);
    const kept: Hit[] = [];
    for (const h of list) if (!kept.some((k) => Math.hypot(k.at[0] - h.at[0], k.at[1] - h.at[1]) < r)) kept.push(h);
    return kept;
  };
  const floors = [...byFloor.values()].map((sheets) => [...sheets.values()].map(once).sort((a, b) => b.length - a.length)[0]);
  const chosen = unit ? [floors.sort((a, b) => b.length - a.length)[0]] : floors;
  const places = new Map<string, Pt[]>();
  let total = 0;
  for (const best of chosen) {
    total += best.length;
    places.set(best[0].sheet.id, [...(places.get(best[0].sheet.id) ?? []), ...best.map((h) => h.at)]);
  }
  return { places, total };
}

/** Schedule tags that are not units of equipment: grilles and diffusers, plumbing fixtures, drains (counted wherever drawn). */
const MANY = /^(D|R|E|S|DG|T|G|SG|RG|EG|SD|RD|ED|WC|L|LAV|TS|SV|SH|WS|LT|FD|FFD|U|UR|MS|DF|HB|CO|FCO|TP|SK|BFP|P)$/;

/** Lettering a legend gives as a modifier on another symbol (TR on a receptacle), not a device of its own. */
const MODIFIER = /^(TAMPER[- ]?RESISTANT|GROUND[- ]?FAULT|WIRE ?GUARD|WEATHER ?PROOF|ISOLATED GROUND|SURGE PROTECTED|CEILING MOUNTED|WALL MOUNTED|EXISTING|RELOCATED|NEW|REMOVED|DEMOLISHED|EMERGENCY POWER|ABOVE COUNTER|UNSWITCHED|SWITCHED|DEDICATED)\b(?!.*\b(DETECTOR|SENSOR|SWITCH|STATION|RELAY|PANEL|CAMERA|READER|BUTTON|SPEAKER|LIGHT|FIXTURE)\b)/i;

/**
 * The tag column of each schedule on a sheet: under a heading naming a schedule ("PLUMBING FIXTURE
 * SCHEDULE", "LIGHT FIXTURE SCHEDULE (INTERIOR)"), the codes down its left column (WC-1, L-1, FD-1;
 * A, J, J1), each with the next cell of its row as what it is. Codes of any family: a schedule
 * lists one of each.
 */
export function scheduleTags(texts: PageText[]): { code: string; description: string; schedule: string }[] {
  const heads = texts.filter((t) => /\bSCHEDULE\b/i.test(t.str) && !/\b(NOTES?|REFER|SEE|INDICATED|AS PER|ON SCHEDULE)\b/i.test(t.str) && t.str.trim().split(/\s+/).length <= 8);
  const CODE = /^[A-Z]{1,4}[-.]?\d{0,3}(?:\.\d{1,2})?[A-Z]?$/;
  const out: { code: string; description: string; schedule: string }[] = [];
  const seen = new Set<string>();
  for (const head of heads) {
    const x0 = head.cx - head.w / 2;
    // Down to the next schedule heading under this one.
    const next = heads.filter((h) => h !== head && h.cy > head.cy + head.h && Math.abs(h.cx - h.w / 2 - x0) < 80).sort((p, q) => p.cy - q.cy)[0];
    const yEnd = next ? next.cy - next.h : head.cy + 1600;
    const below = texts.filter((t) => CODE.test(t.str.trim()) && t.cy > head.cy + head.h * 0.8 && t.cy < yEnd && t.cx - t.w / 2 > x0 - 40 && t.cx - t.w / 2 < x0 + 60 && Math.abs(Math.sin(t.angle ?? 0)) < 0.1);
    // The tag column: the left edge (or centre) most of them share.
    const keys = new Map<number, PageText[]>();
    for (const t of below) for (const k of [Math.round(t.cx - t.w / 2), 10000 + Math.round(t.cx)]) keys.set(k, [...(keys.get(k) ?? []), t]);
    const col = [...keys.values()].sort((p, q) => q.length - p.length)[0];
    if (!col) continue;
    // One row (a single ERV or make-up air unit): its tag just under the heading, with a number.
    if (col.length < 2 && !(/\d/.test(col[0].str) && col[0].cy - head.cy < head.h * 20)) continue;
    const ref = col[0];
    // Rows lined up on the column's left edge, or centred in it (WC-1 and L-1 in one centred column).
    const left = ref.cx - ref.w / 2;
    const mid = col.reduce((n, t) => n + t.cx, 0) / col.length;
    const rows = below.filter((t) => Math.abs(t.cx - t.w / 2 - left) <= 2 || Math.abs(t.cx - mid) <= 2.5).sort((p, q) => p.cy - q.cy);
    const schedule = head.str.replace(/\s+/g, ' ').trim();
    for (const r of rows) {
      const code = r.str.trim();
      // A row's tag has a digit, or the schedule is of light fixtures (types A, J, K).
      if (!/\d/.test(code) && !/LIGHT|LUMINAIRE|FIXTURE/i.test(schedule)) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      const cells = texts
        .filter((o) => o !== r && Math.abs(o.cy - r.cy) < r.h * 0.8 && o.cx > r.cx && o.cx - r.cx < 400)
        .sort((p, q) => p.cx - q.cx)
        .map((o) => o.str.trim())
        .filter((c) => /[A-Za-z]{3}/.test(c) && !/^\(?(YES|NO|NONE|N\/A|TYP\.?|EXISTING|NEW)\)?$/i.test(c));
      const kind = schedule.replace(/\s*SCHEDULE.*$/i, '').trim();
      out.push({ code, description: (cells[0] ?? kind).replace(/\s+/g, ' ').slice(0, 50), schedule });
    }
  }
  return out;
}

/** Whether linework on a layer named like `re` is drawn near a point. */
export function onLayer(segs: Segment[], names: Map<string, string>, [x, y]: Pt, r: number, re: RegExp): boolean {
  return segs.some((s) => {
    if (!s.layer || Math.max(s.x1, s.x2) < x - r || Math.min(s.x1, s.x2) > x + r || Math.max(s.y1, s.y2) < y - r || Math.min(s.y1, s.y2) > y + r) return false;
    const name = names.get(s.layer);
    return !!name && !isBackground(name) && re.test(name);
  });
}

/** The layer most of the linework at a point is on (the trade's own layers, not the background). */
export function layerAt(segs: Segment[], names: Map<string, string>, [x, y]: Pt, r: number): string | null {
  const votes = new Map<string, number>();
  for (const s of segs) {
    if (!s.layer) continue;
    if (Math.max(s.x1, s.x2) < x - r || Math.min(s.x1, s.x2) > x + r || Math.max(s.y1, s.y2) < y - r || Math.min(s.y1, s.y2) > y + r) continue;
    const name = names.get(s.layer);
    if (!name || isBackground(name)) continue;
    votes.set(name, (votes.get(name) ?? 0) + Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + 0.5);
  }
  return [...votes].sort((p, q) => q[1] - p[1])[0]?.[0] ?? null;
}

/** Whether a code sits in a drawn outline up to `max` across (a fixture's rectangle, a tag's ellipse). */
function outlined(segs: Segment[], t: PageText, max: number): Segment[] | null {
  const subs = new Map<number, Segment[]>();
  for (const s of segs) {
    if (s.sub === undefined) continue;
    if (Math.max(s.x1, s.x2) < t.cx - max || Math.min(s.x1, s.x2) > t.cx + max || Math.max(s.y1, s.y2) < t.cy - max || Math.min(s.y1, s.y2) > t.cy + max) continue;
    subs.set(s.sub, [...(subs.get(s.sub) ?? []), s]);
  }
  let best: Segment[] | null = null;
  let bestArea = Infinity;
  for (const list of subs.values()) {
    if (list.length < 3) continue;
    const xs = list.flatMap((s) => [s.x1, s.x2]);
    const ys = list.flatMap((s) => [s.y1, s.y2]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (t.cx < x0 || t.cx > x1 || t.cy < y0 || t.cy > y1) continue;
    if (x1 - x0 > max || y1 - y0 > max || Math.min(x1 - x0, y1 - y0) < t.h * 1.1) continue;
    const area = (x1 - x0) * (y1 - y0);
    if (area < bestArea) {
      best = list;
      bestArea = area;
    }
  }
  return best;
}

export async function automateTrades(p: Project, access: SetAccess): Promise<TradesResult> {
  const checks: string[] = [];
  const trade = p.sheets.filter((s) => !s.superseded && disciplineOf(s));
  if (!trade.length) return { message: 'No mechanical or electrical sheets in the set.', checks };

  // Each trade sheet's text, layers, and what it is.
  type Info = { sheet: Sheet; disc: string; texts: PageText[]; plan: boolean; status: 'demo' | 'new'; floor: string };
  const info = new Map<string, Info>();
  for (const [i, s] of trade.entries()) {
    access.progress?.(`Mechanical and electrical: reading ${s.name} (${i + 1} of ${trade.length})`);
    if (i % 4 === 0) await pause();
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      info.set(s.id, { sheet: s, disc: disciplineOf(s)!, texts, plan: isPlan(s, texts), status: planStatus(s.title, texts), floor: floorOf(s.title, texts) });
    });
  }
  const layersOf = async (s: Sheet) => (await access.layers?.(s)) ?? new Map<string, string>();
  const segCache = new Map<string, Segment[] | null>();
  const segsOf = async (s: Sheet) => {
    if (!segCache.has(s.id)) {
      // A few sheets at a time: a trade plan's linework is large.
      if (segCache.size > 3) segCache.delete(segCache.keys().next().value!);
      segCache.set(s.id, await access.segments(s));
    }
    return segCache.get(s.id)!;
  };

  type Count = { name: string; division: string; hits: Hit[]; unit: boolean };
  const counts = new Map<string, Count>();
  const add = (name: string, division: string, h: Hit, unit = false) => {
    const c = counts.get(name) ?? { name, division, hits: [], unit };
    c.hits.push(h);
    counts.set(name, c);
  };
  // Where a hit is kept: on a new-work plan, unless its ink is existing work (or a removal shown
  // there again); on a demolition plan, only what its layers say is to go (with no layers, all of it).
  const judge = async (s: Sheet, at: Pt, r: number): Promise<'new' | 'remove' | null> => {
    const i = info.get(s.id)!;
    const names = await layersOf(s);
    const st = names.size ? statusAt((await segsOf(s)) ?? [], names, at, r) : null;
    if (i.status === 'demo') return st === 'demo' || (!names.size && st === null) ? 'remove' : null;
    if (st === 'exist' || st === 'demo') return null;
    return 'new';
  };

  // 1. Legend symbols, on the trades' plans.
  const tradeProject: Project = { ...p, sheets: trade.filter((s) => info.has(s.id) && (info.get(s.id)!.plan || !s.metersPerPoint)) };
  const { tallies } = await symbolTallies(tradeProject, access);
  for (const t of tallies) {
    if (t.symbol.key.startsWith('tag:')) continue;
    const label = t.symbol.label.replace(/\s+/g, ' ').trim();
    const short = label.length > 70 ? `${label.slice(0, 67)}…` : label;
    const r = Math.max(4, t.symbol.sample.span * 0.6);
    for (const pl of t.places) {
      const s = p.sheets.find((x) => x.id === pl.sheetId)!;
      const i = info.get(s.id);
      if (!i?.plan) continue;
      for (const at of pl.at) {
        // A circle round a number is a keynote or a tag bubble, not the device (unless the device has lettering of its own).
        if (!t.symbol.text && i.texts.some((x) => /\d/.test(x.str) && Math.hypot(x.cx - at[0], x.cy - at[1]) < r * 0.6)) continue;
        const v = await judge(s, at, r);
        if (!v) continue;
        const div = i.disc === 'E' ? '26 Electrical' : '20-25 Mechanical';
        add(v === 'remove' ? `Remove: ${short.toLowerCase()}` : short, guessDivision(label) === '26 Electrical' || guessDivision(label) === '20-25 Mechanical' ? guessDivision(label)! : div, { sheet: s, at, floor: i.floor, remove: v === 'remove' });
      }
    }
  }

  // 2. Lettering the legends use as symbols ("OS" an occupancy sensor, "TR" tamper resistant), counted where written.
  const lettered = new Map<string, { label: string; disc: string }>();
  for (const i of info.values()) {
    // A structural legend's lettering marks spans and assemblies ("F1 DENOTES SPAN OF CLT WOOD PANELS"), not items to count.
    if (i.plan || i.disc === 'S') continue;
    const segs = await segsOf(i.sheet);
    if (!segs) continue;
    const box = titleBlockBox(i.texts, i.sheet.width, i.sheet.height);
    for (const l of findLegends(i.texts, segs, i.sheet.width, i.sheet.height, box ? [box] : []))
      for (const r of l.rows) if (r.tag && !r.graphic && !lettered.has(r.tag) && !/^(EXISTING|EX\b|NEW\b)/i.test(r.label) && !MODIFIER.test(r.label.trim())) lettered.set(r.tag, { label: r.label.replace(/\s+/g, ' ').trim().slice(0, 60), disc: i.disc });
  }

  // 3. Items the trades' schedules list by tag, and light fixtures by type, per discipline.
  const listedBy = new Map<string, Map<string, { description: string; light: boolean }>>();
  for (const i of info.values()) {
    if (i.plan) continue;
    const d = i.disc === 'P' ? 'M' : i.disc;
    const m = listedBy.get(d) ?? new Map<string, { description: string; light: boolean }>();
    for (const r of scheduleTags(i.texts)) {
      // Structural wall, floor and roof assemblies are taken as lengths and areas, not counted (Kelso R1, WT-1).
      if (d === 'S' && /ASSEMBL|\b(WALL|FLOOR|ROOF|SLAB|DECK)S?\b/i.test(r.schedule)) continue;
      if (!m.has(r.code)) m.set(r.code, { description: r.description, light: /LIGHT|LUMINAIRE/i.test(r.schedule) });
    }
    listedBy.set(d, m);
  }
  // Mechanical equipment the electrical schedules list for its connections is the mechanical count's.
  for (const code of listedBy.get('M')?.keys() ?? []) if (!listedBy.get('E')?.get(code)?.light) listedBy.get('E')?.delete(code);

  // Codes another takeoff already has on a sheet (the foundation step's F1 pad footings on Kelso
  // S1.0, a code counted by hand): not counted again here under a legend's other meaning for it.
  const codeOf = (name: string) => name.split(/\s+[–-]\s+/)[0].trim().replace(/-/g, '').toUpperCase();
  const typeCode = new Map(p.types.map((t) => [t.id, codeOf(t.name)]));
  const taken = new Map<string, Set<string>>();
  for (const m of p.measurements) {
    if (m.source === 'trades') continue;
    const c = typeCode.get(m.typeId);
    if (c) taken.set(m.sheetId, (taken.get(m.sheetId) ?? new Set()).add(c));
  }
  const takenOn = (s: Sheet, code: string) => taken.get(s.id)?.has(code.replace(/-/g, '').toUpperCase()) ?? false;

  for (const i of info.values()) {
    if (!i.plan || i.status === 'demo') continue;
    const s = i.sheet;
    const d = i.disc === 'P' ? 'M' : i.disc;
    const listed = listedBy.get(d) ?? new Map();
    const box = titleBlockBox(i.texts, s.width, s.height);
    const outside = ([x, y]: Pt) => !box || x < box[0] || x > box[2] || y < box[1] || y > box[3];
    const segs = (await segsOf(s)) ?? [];
    const names = await layersOf(s);
    const mpp = s.metersPerPoint!;
    const division = d === 'E' ? '26 Electrical' : d === 'S' ? '05 Metals' : '20-25 Mechanical';
    for (const t of i.texts) {
      const str = t.str.trim();
      const at: Pt = [t.cx, t.cy];
      if (!outside(at)) continue;
      const item = listed.get(str);
      if (item?.light) {
        // A light fixture: its type letter in the fixture's outline (up to 10 ft / 3 m across), on a lighting layer when the drawing has layers.
        if (!outlined(segs, t, 3 / mpp)) continue;
        if (names.size && !onLayer(segs, names, at, Math.max(6, t.h * 3), /LIGHT|LITE|EMERG/i)) continue;
        if ((await judge(s, at, Math.max(4, t.h * 2))) !== 'new') continue;
        add(`Light fixture type ${str}${item.description ? ` – ${item.description}` : ''}`, '26 Electrical', { sheet: s, at, floor: i.floor, remove: false });
        continue;
      }
      const lt = lettered.get(str);
      if (lt && lt.disc === d) {
        if (takenOn(s, str)) continue;
        if ((await judge(s, at, Math.max(6, t.h * 3))) !== 'new') continue;
        add(`${lt.label} (${str})`, division, { sheet: s, at, floor: i.floor, remove: false });
        continue;
      }
      for (const { code, at: cat } of codesIn(t, TAG)) {
        const it = listed.get(code);
        if (!it || it.light || !outside(cat) || takenOn(s, code)) continue;
        // A code in a sentence ("CONNECT TO CU-1") is a reference, not the item.
        if (str.split(/\s+/).length > 3) continue;
        if ((await judge(s, cat, Math.max(6, t.h * 3))) !== 'new') continue;
        add(`${code}${it.description ? ` – ${it.description}` : ''}`, d === 'S' ? (guessDivision(it.description) ?? division) : division, { sheet: s, at: cat, floor: i.floor, remove: false }, !MANY.test(familyOf(code)));
      }
    }
  }

  // 4. Removals on the demolition layers: each fixture or device drawn there, one to remove.
  for (const i of info.values()) {
    if (!i.plan) continue;
    const s = i.sheet;
    const names = await layersOf(s);
    if (!names.size) continue;
    const segs = (await segsOf(s)) ?? [];
    const mpp = s.metersPerPoint!;
    const byLayer = new Map<string, Segment[]>();
    for (const g of segs) {
      const name = g.layer ? names.get(g.layer) : undefined;
      if (!name || name.includes('|') || layerStatus(name) !== 'demo') continue;
      const svc = layerService(name);
      if (!svc || svc.kind !== 'devices') continue;
      byLayer.set(svc.label, [...(byLayer.get(svc.label) ?? []), g]);
    }
    for (const [label, list] of byLayer) {
      for (const at of blobs(list, 0.3 / mpp, 0.15 / mpp, 3.5 / mpp)) add(`Remove: ${label.toLowerCase()} fixtures and devices`, i.disc === 'E' ? '26 Electrical' : '20-25 Mechanical', { sheet: s, at, floor: i.floor, remove: true });
    }
  }

  // A mechanical device the electrical legend draws too (a thermostat, a humidistat) is counted off
  // the mechanical plans when they show it: once, not once per trade.
  const MECH_DEVICE = /\b(THERMOSTATS?|HUMIDISTATS?|CO2 SENSORS?|TEMPERATURE SENSORS?)\b/i;
  const mechHas = [...counts.values()].some((c) => MECH_DEVICE.test(c.name) && c.hits.some((h) => info.get(h.sheet.id)?.disc !== 'E'));
  if (mechHas) for (const [k, c] of counts) if (MECH_DEVICE.test(c.name) && c.hits.every((h) => info.get(h.sheet.id)?.disc === 'E')) counts.delete(k);
  if (!counts.size) return { message: 'Nothing counted on the mechanical and electrical plans.', checks };
  const fresh: TakeoffType[] = [];
  const added: Measurement[] = [];
  const typeIds: string[] = [];
  const refile = new Map<string, string>();
  const sorted = [...counts.values()].sort((a, b) => a.division.localeCompare(b.division) || familyOf(a.name).localeCompare(familyOf(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const c of sorted) {
    const { places, total } = perFloor(c.hits, c.unit);
    if (!total) continue;
    let t = p.types.find((x) => x.kind === 'count' && x.name === c.name);
    // A type an earlier run made, filed under another division then: filed where it belongs now.
    if (t && t.division !== c.division && p.measurements.every((m) => m.typeId !== t!.id || m.source === 'trades')) refile.set(t.id, c.division);
    if (!t) {
      t = { id: newId(), name: c.name, color: PALETTE[(p.types.length + fresh.length) % PALETTE.length], kind: 'count', height: 0, division: c.division, ...(c.division === '26 Electrical' ? { package: 'Electrical sub' } : c.division === '20-25 Mechanical' ? { package: 'Mechanical sub' } : {}), items: [{ id: newId(), name: c.name, unit: 'ea', formula: 'N' }] };
      fresh.push(t);
    }
    typeIds.push(t.id);
    for (const [sheetId, pts] of places) for (const at of pts) added.push({ id: newId(), sheetId, typeId: t.id, points: [at], holes: [], source: 'trades' });
  }
  checks.push(
    'Mechanical and electrical counts come from the trades\' legends, schedules and fixture type letters. Symbols drawn as text only (a switch "$") and items written as notes ("TYP. OF 4") are not counted: check the counts against the plans before relying on a sub\'s quantities.',
  );
  return {
    message: `Counted ${added.length} mechanical and electrical items as ${typeIds.length} types`,
    checks,
    apply: (q) => {
      const r = replaceRun(q, 'trades', fresh, added);
      return refile.size ? { ...r, types: r.types.map((t) => (refile.has(t.id) ? { ...t, division: refile.get(t.id)! } : t)) } : r;
    },
  };
}

/**
 * Separate drawings on a layer: shapes joined when within `join` of each other, kept when between
 * `min` and `max` across (a fixture or a device, not a run of conduit). Their centres.
 */
export function blobs(segs: Segment[], join: number, min: number, max: number): Pt[] {
  type B = { x0: number; y0: number; x1: number; y1: number };
  const subs = new Map<number | string, B>();
  segs.forEach((s, k) => {
    const id = s.sub ?? `s${k}`;
    const b = subs.get(id);
    const nb = { x0: Math.min(s.x1, s.x2), y0: Math.min(s.y1, s.y2), x1: Math.max(s.x1, s.x2), y1: Math.max(s.y1, s.y2) };
    subs.set(id, b ? { x0: Math.min(b.x0, nb.x0), y0: Math.min(b.y0, nb.y0), x1: Math.max(b.x1, nb.x1), y1: Math.max(b.y1, nb.y1) } : nb);
  });
  let boxes = [...subs.values()].filter((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) <= max);
  // Join boxes that touch or nearly, until none do.
  for (let changed = true; changed; ) {
    changed = false;
    const out: B[] = [];
    for (const b of boxes) {
      const o = out.find((c) => b.x0 <= c.x1 + join && b.x1 >= c.x0 - join && b.y0 <= c.y1 + join && b.y1 >= c.y0 - join);
      if (o) {
        o.x0 = Math.min(o.x0, b.x0);
        o.y0 = Math.min(o.y0, b.y0);
        o.x1 = Math.max(o.x1, b.x1);
        o.y1 = Math.max(o.y1, b.y1);
        changed = true;
      } else out.push({ ...b });
    }
    boxes = out;
  }
  return boxes.filter((b) => Math.max(b.x1 - b.x0, b.y1 - b.y0) >= min && Math.max(b.x1 - b.x0, b.y1 - b.y0) <= max).map((b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] as Pt);
}
