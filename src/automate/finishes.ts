import { codesInside, heightMeters, matchSchedules, readFinishLegend, readFinishSchedule, readFinishTags, roomNumbersOf, sameCode, type LegendEntry, type ScheduleRow, type ScheduleSheet } from '../finishSchedule';
import { findRoomLabels } from '../fill/rooms';
import { pointInRing } from '../fill/similar';
import { FINISH_ROLES, finishType, type FinishRole, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import { classifySheet } from '../sheetKind';
import { toLength } from '../units';
import { perSheet, PALETTE, type SetAccess } from './set';

export type Finishes = Partial<Record<FinishRole, string>>;

const codeOf = (name: string) => name.split(' – ')[0].trim().toUpperCase();

/**
 * The rooms finishes go on: named area takeoffs (or ones Rooms made), in room-number order. Areas a legend found are a
 * finish already, not rooms; ceiling areas from the RCPs carry room names but are ceilings, not rooms.
 */
export function finishRooms(project: Project): Measurement[] {
  const areaTypeIds = new Set(project.types.filter((t) => t.kind === 'area').map((t) => t.id));
  return project.measurements
    .filter((m) => areaTypeIds.has(m.typeId) && m.source !== 'legend' && m.source !== 'ceilings' && (m.label || m.source === 'rooms'))
    .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', undefined, { numeric: true }));
}

/** What a legend says a finish is, short: its first words, before the maker and product ("RUBBER BASE MANUFACTURER: …" → "Rubber base"). */
export function shortDescription(description: string): string {
  const head = description.split(/\b(MANUFACTURER|MANUF\.?|MFR\.?|PRODUCT|SUPPLIER|STYLE|COLOU?R|LOCATION|REFER TO|SEE|SIZE|FINISH:|NOTE)\b|[:;]|\.\s/i)[0].replace(/[\s,.\-–]+$/, '').trim();
  const words = head.split(/\s+/).slice(0, 6).join(' ');
  if (!/[A-Za-z]{3}/.test(words)) return '';
  return words === words.toUpperCase() ? words.charAt(0) + words.slice(1).toLowerCase() : words;
}

/**
 * A type for this finish code: one already named with it (the one from `docId`, the drawings
 * the room is on, first: two buildings' FA1), or a new one added to `fresh`, named with what
 * the legend says it is when `description` is given ("RB1 – Base: Rubber base").
 */
export function finishTypeFor(project: Project, role: FinishRole, code: string, pool: TakeoffType[], fresh: TakeoffType[], docId?: string, palette = PALETTE, description?: string): string {
  const kind = FINISH_ROLES.find((r) => r.role === role)!.kind;
  const all = [...pool, ...fresh].filter((t) => t.kind === kind && sameCode(codeOf(t.name), code));
  const hit = all.find((t) => docId && t.fromDoc === docId) ?? all.find((t) => !t.fromDoc) ?? all[0];
  if (hit) return hit.id;
  const t = finishType(role, code, project.units, palette[(pool.length + fresh.length) % palette.length]);
  const what = description ? shortDescription(description) : '';
  if (what) t.name = `${t.name}: ${what}`;
  fresh.push(t);
  return t.id;
}

/** What the set's legends say each finish code is, by drawing file (a code's own file first). */
class Legends {
  private byDoc = new Map<string, Map<string, LegendEntry>>();
  add(docId: string, legend: Map<string, LegendEntry>) {
    const m = this.byDoc.get(docId) ?? new Map<string, LegendEntry>();
    for (const [k, e] of legend) if (!m.has(k) || (!m.get(k)!.role && e.role)) m.set(k, e);
    this.byDoc.set(docId, m);
  }
  /** The legend of a drawing file: its own entries, then other files'. */
  of(docId: string): Map<string, LegendEntry> {
    const out = new Map(this.byDoc.get(docId) ?? []);
    for (const [d, m] of this.byDoc) if (d !== docId) for (const [k, e] of m) if (!out.has(k)) out.set(k, e);
    return out;
  }
  /** What a legend says a code is: an entry for that finish first, then any finish's (not a door hardware list's PT). */
  describe(docId: string | undefined, code: string, role?: FinishRole): string | undefined {
    const all = [...this.of(docId ?? '').values()].filter((e) => e.role && sameCode(e.code, code));
    return (all.find((e) => e.role === role) ?? all[0])?.description;
  }
}

/** Finishes read from the drawings for the room takeoffs. */
export interface FinishesRead {
  /** Finishes per room takeoff (merged into what each has). */
  picks: Map<string, Finishes>;
  /** Ceiling heights per room takeoff, in project length units. */
  heights: Map<string, number>;
  /** Rooms whose walls are finished several ways: each wall finish type's share of the walls (see `Measurement.wallShares`). */
  wallShares?: Map<string, Record<string, number>>;
  /** New finish types the picks use. */
  fresh: TakeoffType[];
  note: string;
  /** Schedule lines no room matched, and rooms no line matched. */
  unmatched: { rows: string[]; rooms: string[] } | null;
  /** Where the finishes came from. */
  from: 'schedule' | 'tags' | 'none';
}

/**
 * Reads every room finish schedule in the set (often one sheet per floor, apart from the
 * plans) and gives each room takeoff the finishes and ceiling height of the line with its
 * number. Lines and rooms that did not match are listed. With no schedule, finishes tagged on
 * the drawings instead (see `readFinishTagsIn`). New finish types are named with what the
 * set's finish legend says they are. `pool`: the types to reuse.
 */
export async function readFinishes(project: Project, rooms: Measurement[], access: SetAccess, pool: TakeoffType[], palette = PALETTE): Promise<FinishesRead> {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const found: (ScheduleSheet & { sheet: Sheet })[] = [];
  const legends = new Legends();
  const targets = project.sheets.filter((x) => !x.superseded);
  for (const [i, sheet] of targets.entries()) {
    access.progress?.(`Looking for finish schedules… sheet ${i + 1} of ${targets.length}`);
    await perSheet(access, sheet, async () => {
      const texts = await access.texts(sheet);
      // A ceiling plan's legend lists ceilings, whatever their descriptions say.
      const legend = readFinishLegend(texts, classifySheet(sheet).kind === 'RCP' ? 'ceiling' : null);
      if (legend.size) legends.add(sheet.docId, legend);
      if (!readFinishSchedule(texts)) return;
      // Read again along the table's rules, so each cell lands in its own column.
      const segs = await access.segments(sheet);
      if (!segs) return;
      const schedule = readFinishSchedule(texts, segs);
      if (schedule?.rows.length) found.push({ sheet, sheetName: sheet.name, docId: sheet.docId, rows: schedule.rows });
    });
  }
  if (!found.length) return readFinishTagsIn(project, rooms, access, pool, palette, legends);
  const match = matchSchedules(
    rooms.map((m) => ({ id: m.id, label: m.label, docId: sheets.get(m.sheetId)?.docId })),
    found,
  );
  const fresh: TakeoffType[] = [];
  const roomType = new Map(rooms.map((m) => [m.id, m.typeId]));
  const picks = new Map<string, Finishes>();
  const heights = new Map<string, number>();
  const wallShares = new Map<string, Record<string, number>>();
  for (const [id, { row }] of match.rows) {
    const docId = sheets.get(rooms.find((m) => m.id === id)!.sheetId)?.docId;
    const f: Finishes = {};
    for (const [role, code] of Object.entries(row.finishes) as [FinishRole, string][]) {
      const t = finishTypeFor(project, role, code, pool, fresh, docId, palette, legends.describe(docId, code, role));
      if (t !== roomType.get(id)) f[role] = t;
    }
    picks.set(id, f);
    if (row.wallShares && f.walls) {
      const shares: Record<string, number> = {};
      for (const [code, share] of Object.entries(row.wallShares)) {
        const t = finishTypeFor(project, 'walls', code, pool, fresh, docId, palette, legends.describe(docId, code, 'walls'));
        shares[t] = (shares[t] ?? 0) + share;
      }
      if (Object.keys(shares).length > 1) wallShares.set(id, shares);
    }
    const h = row.ceilingHeight ? heightMeters(row.ceilingHeight) : null;
    if (h) heights.set(id, +toLength(h, project.units).toFixed(3));
  }
  const rowsRead = found.reduce((n, f) => n + f.rows.length, 0);
  const label = (id: string) => rooms.find((m) => m.id === id)?.label ?? 'Unnamed area';
  return {
    from: 'schedule',
    picks,
    heights,
    wallShares,
    fresh,
    unmatched:
      match.unmatched.length || match.missing.length
        ? { rows: match.unmatched.map((u) => `${u.row.number}${u.row.name ? ` ${u.row.name}` : ''} (${u.sheetName})`), rooms: match.missing.map(label) }
        : null,
    note:
      `Read ${found.length} finish schedule${found.length === 1 ? '' : 's'} (${found.map((f) => f.sheetName).join(', ')}): ${rowsRead} room${rowsRead === 1 ? '' : 's'}, ` +
      `${match.rows.size} of your ${rooms.length} room takeoffs matched` +
      (fresh.length ? `, ${fresh.length} new finish type${fresh.length === 1 ? '' : 's'}.` : '.'),
  };
}

/**
 * No finish schedule: finishes tagged on the drawings instead. Floors, bases and walls from the
 * codes tagged under each room's number on a finish plan (FL-1 over BS-1; EP1 | RB1 | PT1),
 * each the finish the set's legend says it is; on a plan that is not a finish plan only codes
 * a legend lists count (a wall type tag under a room number is not a finish). Every plan of a
 * drawing file is read, finish plans first. Ceilings from a ceiling plan drawn over the same
 * outline as the room's plan (the ceiling type tagged inside each room).
 */
export async function readFinishTagsIn(project: Project, rooms: Measurement[], access: SetAccess, pool: TakeoffType[], palette = PALETTE, legends = new Legends()): Promise<FinishesRead> {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const ceilingCodes = new Set(
    project.sheets.flatMap((x) => x.aiAssemblies?.assemblies ?? []).filter((a) => a.category === 'ceiling').map((a) => a.code.toUpperCase()),
  );
  for (const t of project.types) if (t.kind === 'area' && /CEILING/i.test(`${t.name} ${t.assemblyTitle ?? ''}`)) ceilingCodes.add(codeOf(t.name));
  // Per drawing file: two buildings in one project can both have a room 100.
  const tagged: { sheet: Sheet; rows: ScheduleRow[]; matched: number; finishPlan: boolean }[] = [];
  const ceilings = new Map<string, { sheet: Sheet; codes: Map<string, string> }>();
  // A file with no rooms of its own (a finish plan issued apart, an addendum's plans) is the rooms' building's.
  const docRooms = (docId: string) => {
    const own = rooms.filter((m) => sheets.get(m.sheetId)?.docId === docId);
    return own.length ? own : rooms;
  };
  const numbersIn = (docId: string) => {
    const out = new Map<string, string[]>();
    for (const m of docRooms(docId)) for (const n of roomNumbersOf(m.label)) out.set(n, [...(out.get(n) ?? []), m.id]);
    return out;
  };
  const targets = project.sheets.filter((x) => !x.superseded);
  for (const [i, sheet] of targets.entries()) {
    access.progress?.(`Reading finish tags… sheet ${i + 1} of ${targets.length}`);
    const own = numbersIn(sheet.docId);
    if (!own.size) continue;
    await perSheet(access, sheet, async () => {
      const texts = await access.texts(sheet);
      // Floors, bases and walls: room tags with finish codes under them.
      if (texts.filter((t) => own.has(t.str.trim())).length >= Math.min(2, own.size)) {
        const kind = classifySheet(sheet).kind;
        const finishPlan = kind === 'finish plan';
        const legend = legends.of(sheet.docId);
        const listed = [...legend.values()].some((e) => e.role);
        // With no legend to tell a finish code from a wall type's, only a finish plan's tags.
        if (finishPlan || (listed && (kind === 'floor plan' || kind === 'RCP'))) {
          const segs = await access.segments(sheet);
          if (!segs) return;
          const rows = readFinishTags(texts, findRoomLabels(texts, segs), listed ? legend : undefined, kind === 'RCP' ? 'ceiling' : undefined, finishPlan);
          const matched = rows.filter((r) => own.has(r.number)).length;
          if (matched) tagged.push({ sheet, rows, matched, finishPlan });
        }
      }
      // Ceilings: one ceiling code inside a room, on another sheet of its plan's size.
      if (!ceilingCodes.size) return;
      const codes = new Map<string, string>();
      for (const m of docRooms(sheet.docId)) {
        const plan = sheets.get(m.sheetId);
        if (!plan || plan.id === sheet.id || Math.abs(plan.width - sheet.width) > 1 || Math.abs(plan.height - sheet.height) > 1) continue;
        const found = codesInside(texts, (x, y) => pointInRing([x, y], m.points), (c) => ceilingCodes.has(c.toUpperCase()));
        if (found.length === 1) codes.set(m.id, found[0]);
      }
      const best = ceilings.get(sheet.docId);
      if (codes.size >= 1 && (!best || codes.size > best.codes.size)) ceilings.set(sheet.docId, { sheet, codes });
    });
  }
  const empty = { picks: new Map(), heights: new Map(), fresh: [], unmatched: null };
  if (!tagged.length && !ceilings.size)
    return { ...empty, from: 'none', note: 'No room finish schedule or finish tags found on these drawings. Pick the finishes by hand, or select rooms and set them together.' };
  const fresh: TakeoffType[] = [];
  const roomType = new Map(rooms.map((m) => [m.id, m.typeId]));
  const picks = new Map<string, Finishes>();
  // Finish plans first, then the plans with the most rooms tagged: a room's finish from the first that tags it.
  tagged.sort((a, b) => +b.finishPlan - +a.finishPlan || b.matched - a.matched);
  const used = new Map<Sheet, number>();
  for (const f of tagged) {
    const own = numbersIn(f.sheet.docId);
    for (const row of f.rows) {
      for (const id of own.get(row.number) ?? []) {
        for (const [role, code] of Object.entries(row.finishes) as [FinishRole, string][]) {
          if (picks.get(id)?.[role]) continue;
          const t = finishTypeFor(project, role, code, pool, fresh, f.sheet.docId, palette, legends.describe(f.sheet.docId, code, role));
          if (t === roomType.get(id)) continue;
          picks.set(id, { ...picks.get(id), [role]: t });
          used.set(f.sheet, (used.get(f.sheet) ?? 0) + 1);
        }
      }
    }
  }
  for (const [docId, c] of ceilings) {
    for (const [id, code] of c.codes) {
      if (picks.get(id)?.ceiling) continue;
      const t = finishTypeFor(project, 'ceiling', code, pool, fresh, docId, palette, legends.describe(docId, code, 'ceiling'));
      if (t !== roomType.get(id)) picks.set(id, { ...picks.get(id), ceiling: t });
    }
  }
  const n = (k: number) => `${k} room${k === 1 ? '' : 's'}`;
  const plans = tagged.filter((f) => used.has(f.sheet));
  const parts = [
    ...(plans.length ? [`finishes tagged on ${plans.map((f) => `${f.sheet.name} (${n(f.matched)})`).join(', ')}`] : []),
    ...(ceilings.size ? [`ceilings tagged on ${[...ceilings.values()].map((c) => `${c.sheet.name} (${n(c.codes.size)})`).join(', ')}`] : []),
  ];
  return {
    ...empty,
    from: 'tags',
    picks,
    fresh,
    note: `No finish schedule; read the ${parts.join('; ')}${fresh.length ? `; ${fresh.length} new finish type${fresh.length === 1 ? '' : 's'}` : ''}. Check the rooms left blank.`,
  };
}

/** Saves finishes read from the drawings on the rooms, as the dialog's Save does with nothing changed by hand. */
export const applyFinishes =
  (read: FinishesRead) =>
  (p: Project): Project => {
    const used = new Set([...read.picks.values()].flatMap((f) => Object.values(f)));
    for (const s of read.wallShares?.values() ?? []) for (const id of Object.keys(s)) used.add(id);
    return {
      ...p,
      types: [...p.types, ...read.fresh.filter((t) => used.has(t.id))],
      measurements: p.measurements.map((m) => {
        const f = read.picks.get(m.id);
        const h = read.heights.get(m.id);
        const w = read.wallShares?.get(m.id);
        return f || h !== undefined || w
          ? { ...m, ...(f ? { finishes: { ...m.finishes, ...f } } : {}), ...(h !== undefined ? { ceilingHeight: h } : {}), ...(w ? { wallShares: w } : {}) }
          : m;
      }),
    };
  };

/** The floor a sheet's title names ("LEVEL 2 (MAIN) FLOOR PLAN" → "2", "MAIN FLOOR RCP" → "MAIN"), or null. */
export function levelOfSheet(s: Sheet): string | null {
  const t = `${s.title ?? ''}`.toUpperCase();
  const m = /\bLEVEL\s*([A-Z0-9]+)|\b(BASEMENT|CELLAR|GROUND|MAIN|MEZZANINE|FIRST|SECOND|THIRD|FOURTH|FIFTH|ROOF)\b|\b(\d+)(?:ST|ND|RD|TH)\s+FLOOR/.exec(t);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

const centroid = (pts: Pt[]): Pt => {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    const c = x1 * y2 - x2 * y1;
    a += c;
    x += (x1 + x2) * c;
    y += (y1 + y2) * c;
  }
  return a ? [x / (3 * a), y / (3 * a)] : (pts[0] ?? [0, 0]);
};

export interface RcpCeilings {
  project: Project;
  /** Rooms whose ceiling now comes from the RCPs instead of the finish schedule. */
  moved: number;
  /** Those whose schedule ceiling was existing (an EX… code), "001 CORRIDOR (EX ACT)". */
  existing: string[];
}

/**
 * Ceilings measured on the RCPs are the ceiling quantity: a room on a level with RCP ceilings
 * drops the finish schedule's ceiling, so no ceiling is priced twice. Ceiling areas never
 * carry room finishes themselves. Ceiling types the schedule made that nothing uses any more
 * go. A project without RCP ceilings is returned as it is.
 */
export function ceilingsFromRcps(project: Project): RcpCeilings {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const rcp = project.measurements.filter((m) => m.source === 'ceilings');
  const stray = rcp.some((m) => m.finishes || m.wallShares);
  if (!rcp.length) return { project, moved: 0, existing: [] };
  const levels = new Set(rcp.map((m) => { const s = sheets.get(m.sheetId); return s ? levelOfSheet(s) : null; }));
  const onLevel = (m: Measurement) => {
    const s = sheets.get(m.sheetId);
    return !!s && (levels.has(null) || levels.has(levelOfSheet(s)));
  };
  // Under a measured ceiling: named in its label, or (the RCP drawn in the same place on a sheet
  // like the plan's) the room's middle inside it.
  const under = (m: Measurement) => {
    const s = sheets.get(m.sheetId);
    if (!s) return false;
    const number = m.label?.split(/\s+/)[0];
    if (number && /\d/.test(number) && rcp.some((c) => c.label?.split(/,\s*/).some((l) => l.split(/\s+/)[0] === number))) return true;
    const mid = centroid(m.points);
    return rcp.some((c) => {
      const cs = sheets.get(c.sheetId);
      if (!cs || cs.id === s.id || Math.abs(cs.width - s.width) > 1 || Math.abs(cs.height - s.height) > 1) return false;
      if (!cs.metersPerPoint || !s.metersPerPoint || Math.abs(cs.metersPerPoint / s.metersPerPoint - 1) > 0.01) return false;
      return pointInRing(mid, c.points) && !(c.holes ?? []).some((h) => pointInRing(mid, h));
    });
  };
  const scheduled = finishRooms(project).filter((m) => m.finishes?.ceiling && onLevel(m));
  // Rooms the RCPs leave unmeasured (a gypsum ceiling drawn plain, no pattern to find) keep the
  // schedule's ceiling, when the RCPs clearly line up with the plans (most of the rooms under them).
  const lined = scheduled.filter(under);
  const registered = lined.length >= 2 && lined.length >= scheduled.length * 0.3;
  const rooms = new Set((registered ? lined : scheduled).map((m) => m.id));
  if (!rooms.size && !stray) return { project, moved: 0, existing: [] };
  const typeName = new Map(project.types.map((t) => [t.id, t.name]));
  const dropped = new Set<string>();
  const existing: string[] = [];
  const measurements = project.measurements.map((m) => {
    if (m.source === 'ceilings' && (m.finishes || m.wallShares)) {
      const { finishes: _f, wallShares: _w, ...rest } = m;
      for (const id of Object.values(m.finishes ?? {})) if (id) dropped.add(id);
      for (const id of Object.keys(m.wallShares ?? {})) dropped.add(id);
      return rest as Measurement;
    }
    if (!rooms.has(m.id)) return m;
    const id = m.finishes!.ceiling!;
    dropped.add(id);
    const code = codeOf(typeName.get(id) ?? '');
    if (/^EX\b|^EX[^A-Z]/.test(code)) existing.push(`${m.label ?? 'room'} (${code})`);
    const { ceiling: _c, ...finishes } = m.finishes!;
    return { ...m, finishes };
  });
  const inUse = new Set<string>();
  for (const m of measurements) {
    inUse.add(m.typeId);
    for (const id of Object.values(m.finishes ?? {})) if (id) inUse.add(id);
    for (const id of Object.keys(m.wallShares ?? {})) inUse.add(id);
  }
  const types = project.types.filter((t) => !dropped.has(t.id) || inUse.has(t.id));
  return { project: { ...project, measurements, types }, moved: rooms.size, existing };
}
