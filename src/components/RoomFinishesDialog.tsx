import { useMemo, useRef, useState } from 'react';
import { codesInside, readFinishSchedule, readFinishTags, roomNumbersOf, sameCode, type ScheduleRow } from '../finishSchedule';
import { findRoomLabels } from '../fill/rooms';
import { segmentsOnce } from '../fill/sheetWalls';
import { pointInRing } from '../fill/similar';
import { FINISH_ROLES, finishType, type FinishRole, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import { pageTexts } from '../pageText';
import type { PDFPageProxy } from '../pdf';
import { measurementVars } from '../quantities';
import { areaUnit, formatQty } from '../units';
import { askText, useEscape } from './Dialogs';

type Finishes = Partial<Record<FinishRole, string>>;

interface Props {
  project: Project;
  palette: string[];
  /** The page of a sheet, for reading a finish schedule. */
  getPage: (sheet: Sheet) => Promise<PDFPageProxy | null>;
  onApply: (result: { types: TakeoffType[]; finishes: Map<string, Finishes> }) => void;
  /** Runs Rooms on the open sheet, when it can (a plan with a scale). */
  onFindRooms?: () => void;
  onClose: () => void;
}

const NONE = '';
const NEW = '__new__';
const codeOf = (name: string) => name.split(' – ')[0].trim().toUpperCase();

/**
 * The room finish schedule: the floor, base, walls and ceiling of every room takeoff,
 * typed in here or read from the finish schedule on the drawings. Each finish is a
 * takeoff type; the room's area counts toward floor and ceiling, its perimeter
 * toward base and walls (walls × the type's height).
 */
export function RoomFinishesDialog({ project, palette, getPage, onApply, onFindRooms, onClose }: Props) {
  const areaTypeIds = new Set(project.types.filter((t) => t.kind === 'area').map((t) => t.id));
  const rooms = useMemo(
    () =>
      project.measurements
        // Areas a legend found are a finish already (named by the room they're in), not rooms.
        .filter((m) => areaTypeIds.has(m.typeId) && m.source !== 'legend' && (m.label || m.source === 'rooms'))
        .sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '', undefined, { numeric: true })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.measurements],
  );
  const [draft, setDraft] = useState<Map<string, Finishes>>(() => new Map(rooms.map((m) => [m.id, { ...m.finishes }])));
  const [added, setAdded] = useState<TakeoffType[]>([]);
  /** The types made in this dialog so far, current even inside a long-running read. */
  const addedRef = useRef<TakeoffType[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<FinishRole>('floor');
  const [bulkType, setBulkType] = useState(NONE);
  const [reading, setReading] = useState<string | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);
  const types = [...project.types, ...added];
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));

  /** Types a finish can be: the right kind, and not the type the room itself is (that would count it twice). */
  const optionsFor = (role: FinishRole, room?: Measurement) => {
    const kind = FINISH_ROLES.find((r) => r.role === role)!.kind;
    return types.filter((t) => t.kind === kind && t.id !== room?.typeId);
  };

  const set = (ids: string[], role: FinishRole, typeId: string) =>
    setDraft((d) => {
      const next = new Map(d);
      for (const id of ids) {
        // Never a room's own type (see optionsFor).
        if (typeId && rooms.find((m) => m.id === id)?.typeId === typeId) continue;
        const f = { ...next.get(id) };
        if (typeId) f[role] = typeId;
        else delete f[role];
        next.set(id, f);
      }
      return next;
    });

  /** A type for this finish code: one already named with it, or a new one. */
  /** `docId`: the drawings the room is on, whose own type of that code is preferred (two buildings' FA1). */
  function typeFor(role: FinishRole, code: string, pool: TakeoffType[], fresh: TakeoffType[], docId?: string): string {
    const kind = FINISH_ROLES.find((r) => r.role === role)!.kind;
    const all = [...pool, ...fresh].filter((t) => t.kind === kind && sameCode(codeOf(t.name), code));
    const hit = all.find((t) => docId && t.fromDoc === docId) ?? all.find((t) => !t.fromDoc) ?? all[0];
    if (hit) return hit.id;
    const t = finishType(role, code, project.units, palette[(pool.length + fresh.length) % palette.length]);
    fresh.push(t);
    return t.id;
  }

  async function newType(ids: string[], role: FinishRole) {
    const code = await askText(`New ${FINISH_ROLES.find((r) => r.role === role)!.label.toLowerCase()} type`, {
      hint: 'Its code as on the finish schedule, e.g. CPT-1',
    });
    if (!code?.trim()) return;
    const fresh: TakeoffType[] = [];
    const id = typeFor(role, code.trim(), [...project.types, ...addedRef.current], fresh);
    addedRef.current = [...addedRef.current, ...fresh];
    setAdded(addedRef.current);
    set(ids, role, id);
  }

  async function readSchedule() {
    setReadNote(null);
    let best: { sheet: Sheet; rows: ScheduleRow[]; matched: number } | null = null;
    const numbers = new Map<string, string[]>();
    for (const m of rooms) for (const n of roomNumbersOf(m.label)) numbers.set(n, [...(numbers.get(n) ?? []), m.id]);
    try {
      for (const [i, sheet] of project.sheets.entries()) {
        setReading(`Looking for a finish schedule… sheet ${i + 1} of ${project.sheets.length}`);
        const page = await getPage(sheet);
        if (!page) continue;
        const found = readFinishSchedule(await pageTexts(page));
        if (!found) continue;
        const matched = found.rows.filter((r) => numbers.has(r.number)).length;
        if (!best || matched > best.matched || (matched === best.matched && found.rows.length > best.rows.length)) best = { sheet, rows: found.rows, matched };
      }
    } finally {
      setReading(null);
    }
    if (!best) {
      await readTags();
      return;
    }
    // Applied to the latest picks and types: the dialog stays usable while the sheets are read.
    const fresh: TakeoffType[] = [];
    const pool = [...project.types, ...addedRef.current];
    const roomType = new Map(rooms.map((m) => [m.id, m.typeId]));
    const picks = new Map<string, Finishes>();
    for (const row of best.rows) {
      for (const id of numbers.get(row.number) ?? []) {
        const f: Finishes = { ...picks.get(id) };
        for (const [role, code] of Object.entries(row.finishes) as [FinishRole, string][]) {
          const t = typeFor(role, code, pool, fresh);
          if (t !== roomType.get(id)) f[role] = t;
        }
        picks.set(id, f);
      }
    }
    addedRef.current = [...addedRef.current, ...fresh];
    setAdded(addedRef.current);
    setDraft((d) => {
      const next = new Map(d);
      for (const [id, f] of picks) next.set(id, { ...next.get(id), ...f });
      return next;
    });
    setReadNote(
      `Read the schedule on ${best.sheet.name}: ${best.rows.length} room${best.rows.length === 1 ? '' : 's'}, ${best.matched} matched to your room takeoffs` +
        (fresh.length ? `, ${fresh.length} new finish type${fresh.length === 1 ? '' : 's'}.` : '.'),
    );
  }

  /**
   * No finish schedule: finishes tagged on the drawings instead. Floors from a finish plan
   * (the code boxed under each room's number), ceilings from a ceiling plan drawn over the
   * same outline as the room's plan (the ceiling type tagged inside each room).
   */
  async function readTags() {
    const ceilingCodes = new Set(
      project.sheets.flatMap((x) => x.aiAssemblies?.assemblies ?? []).filter((a) => a.category === 'ceiling').map((a) => a.code.toUpperCase()),
    );
    for (const t of project.types) if (t.kind === 'area' && /CEILING/i.test(`${t.name} ${t.assemblyTitle ?? ''}`)) ceilingCodes.add(codeOf(t.name));
    // Per drawing file: two buildings in one project can both have a room 100.
    const floors = new Map<string, { sheet: Sheet; rows: ScheduleRow[]; matched: number }>();
    const ceilings = new Map<string, { sheet: Sheet; codes: Map<string, string> }>();
    const docRooms = (docId: string) => rooms.filter((m) => sheets.get(m.sheetId)?.docId === docId);
    const numbersIn = (docId: string) => {
      const out = new Map<string, string[]>();
      for (const m of docRooms(docId)) for (const n of roomNumbersOf(m.label)) out.set(n, [...(out.get(n) ?? []), m.id]);
      return out;
    };
    try {
      for (const [i, sheet] of project.sheets.entries()) {
        setReading(`Reading finish tags… sheet ${i + 1} of ${project.sheets.length}`);
        const own = numbersIn(sheet.docId);
        if (!own.size) continue;
        const page = await getPage(sheet);
        if (!page) continue;
        const texts = await pageTexts(page);
        // Floors: room tags with a finish code under them.
        if (texts.filter((t) => own.has(t.str.trim())).length >= Math.min(2, own.size)) {
          const rows = readFinishTags(texts, findRoomLabels(texts, await segmentsOnce(page)));
          const matched = rows.filter((r) => own.has(r.number)).length;
          const best = floors.get(sheet.docId);
          if (matched >= 1 && (!best || matched > best.matched)) floors.set(sheet.docId, { sheet, rows, matched });
        }
        // Ceilings: one ceiling code inside a room, on another sheet of its plan's size.
        if (!ceilingCodes.size) continue;
        const codes = new Map<string, string>();
        for (const m of docRooms(sheet.docId)) {
          const plan = sheets.get(m.sheetId);
          if (!plan || plan.id === sheet.id || Math.abs(plan.width - sheet.width) > 1 || Math.abs(plan.height - sheet.height) > 1) continue;
          const found = codesInside(texts, (x, y) => pointInRing([x, y], m.points), (c) => ceilingCodes.has(c.toUpperCase()));
          if (found.length === 1) codes.set(m.id, found[0]);
        }
        const best = ceilings.get(sheet.docId);
        if (codes.size >= 1 && (!best || codes.size > best.codes.size)) ceilings.set(sheet.docId, { sheet, codes });
      }
    } finally {
      setReading(null);
    }
    if (!floors.size && !ceilings.size) {
      setReadNote('No room finish schedule or finish tags found on these drawings. Pick the finishes by hand, or select rooms and set them together.');
      return;
    }
    const fresh: TakeoffType[] = [];
    const pool = [...project.types, ...addedRef.current];
    const roomType = new Map(rooms.map((m) => [m.id, m.typeId]));
    const picks = new Map<string, Finishes>();
    for (const [docId, f] of floors) {
      const own = numbersIn(docId);
      for (const row of f.rows) {
        for (const id of own.get(row.number) ?? []) {
          const t = typeFor('floor', row.finishes.floor!, pool, fresh, docId);
          if (t !== roomType.get(id)) picks.set(id, { ...picks.get(id), floor: t });
        }
      }
    }
    for (const [docId, c] of ceilings) {
      for (const [id, code] of c.codes) {
        const t = typeFor('ceiling', code, pool, fresh, docId);
        if (t !== roomType.get(id)) picks.set(id, { ...picks.get(id), ceiling: t });
      }
    }
    addedRef.current = [...addedRef.current, ...fresh];
    setAdded(addedRef.current);
    setDraft((d) => {
      const next = new Map(d);
      for (const [id, f] of picks) next.set(id, { ...next.get(id), ...f });
      return next;
    });
    const n = (k: number) => `${k} room${k === 1 ? '' : 's'}`;
    const parts = [
      ...(floors.size ? [`floors tagged on ${[...floors.values()].map((f) => `${f.sheet.name} (${n(f.matched)})`).join(', ')}`] : []),
      ...(ceilings.size ? [`ceilings tagged on ${[...ceilings.values()].map((c) => `${c.sheet.name} (${n(c.codes.size)})`).join(', ')}`] : []),
    ];
    setReadNote(`No finish schedule; read the ${parts.join('; ')}${fresh.length ? `; ${fresh.length} new finish type${fresh.length === 1 ? '' : 's'}` : ''}. Check the rooms left blank.`);
  }

  const changed = rooms.filter((m) => JSON.stringify(m.finishes ?? {}) !== JSON.stringify(draft.get(m.id) ?? {})).length;
  const usedAdded = added.filter((t) => [...draft.values()].some((f) => Object.values(f).includes(t.id)));

  function save() {
    const finishes = new Map<string, Finishes>();
    for (const m of rooms) {
      const f = draft.get(m.id) ?? {};
      if (JSON.stringify(m.finishes ?? {}) !== JSON.stringify(f)) finishes.set(m.id, f);
    }
    onApply({ types: usedAdded, finishes });
    onClose();
  }

  const area = (m: Measurement) => {
    const sheet = sheets.get(m.sheetId);
    const type = types.find((t) => t.id === m.typeId);
    const v = sheet && type ? measurementVars(m, type, sheet, project.units) : null;
    return v ? `${formatQty(v.A)} ${areaUnit(project.units)}` : '—';
  };

  const allPicked = rooms.length > 0 && rooms.every((m) => picked.has(m.id));
  // A stray click outside or Esc closes only while nothing is unsaved; Cancel always does.
  const dismiss = () => {
    if (!changed) onClose();
  };
  useEscape(dismiss);

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal wide finishes" role="dialog" aria-label="Room finishes" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Room finishes</h3>
          <button onClick={onClose}>{changed ? 'Cancel' : 'Close'}</button>
        </div>
        <p className="muted">
          Each room’s floor and ceiling count as its area, its base and walls as its perimeter (walls × the wall type’s height). Pick types per
          room, select several rooms to set them together, or read the finish schedule from the drawings.
        </p>

        {rooms.length === 0 ? (
          <>
            <p className="warn">No rooms yet. Finishes go on rooms: find them on a plan, or fill rooms by hand and name them, then come back here.</p>
            {onFindRooms && (
              <div className="row-actions">
                <button className="primary" onClick={onFindRooms}>
                  Find rooms on this sheet
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row-actions">
              <button onClick={() => void readSchedule()} disabled={!!reading || !project.sheets.length}>
                Read finishes from the drawings
              </button>
              {reading && (
                <span className="muted inline">
                  <span className="spinner small" /> {reading}
                </span>
              )}
              {readNote && <span className="muted">{readNote}</span>}
            </div>

            {picked.size > 0 && (
              <div className="row-actions bulk-bar">
                <span>
                  {picked.size} room{picked.size === 1 ? '' : 's'}:
                </span>
                <select aria-label="Finish to set" value={bulkRole} onChange={(e) => (setBulkRole(e.target.value as FinishRole), setBulkType(NONE))}>
                  {FINISH_ROLES.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Type to set"
                  value={bulkType}
                  onChange={(e) => (e.target.value === NEW ? void newType([...picked], bulkRole) : setBulkType(e.target.value))}
                >
                  <option value={NONE}>None</option>
                  {optionsFor(bulkRole).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value={NEW}>New type…</option>
                </select>
                <button onClick={() => set([...picked], bulkRole, bulkType)}>Set</button>
                <div className="spacer" />
                <button className="plain" onClick={() => setPicked(new Set())}>
                  Clear selection
                </button>
              </div>
            )}

            <div className="table-scroll">
              <table className="wall-table rooms-table finishes-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all rooms"
                        checked={allPicked}
                        onChange={(e) => setPicked(new Set(e.target.checked ? rooms.map((m) => m.id) : []))}
                      />
                    </th>
                    <th>Room</th>
                    <th>Sheet</th>
                    <th className="num">Area</th>
                    {FINISH_ROLES.map((r) => (
                      <th key={r.role}>{r.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((m) => {
                    const f = draft.get(m.id) ?? {};
                    return (
                      <tr key={m.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${m.label ?? 'room'}`}
                            checked={picked.has(m.id)}
                            onChange={(e) =>
                              setPicked((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(m.id);
                                else next.delete(m.id);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="room-label">{m.label || 'Unnamed area'}</td>
                        <td className="muted">{sheets.get(m.sheetId)?.name}</td>
                        <td className="num">{area(m)}</td>
                        {FINISH_ROLES.map((r) => (
                          <td key={r.role}>
                            <select
                              className="cell-select"
                              aria-label={`${r.label} of ${m.label ?? 'room'}`}
                              value={f[r.role] ?? NONE}
                              onChange={(e) => (e.target.value === NEW ? void newType([m.id], r.role) : set([m.id], r.role, e.target.value))}
                            >
                              <option value={NONE}>—</option>
                              {optionsFor(r.role, m).map((t) => (
                                <option key={t.id} value={t.id} title={t.name}>
                                  {t.name.split(' – ')[0]}
                                </option>
                              ))}
                              <option value={NEW}>New type…</option>
                            </select>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="row-actions sticky">
          <div className="spacer" />
          <button className="primary" disabled={!changed} onClick={save}>
            {changed ? `Save finishes for ${changed} room${changed === 1 ? '' : 's'}` : 'Save finishes'}
          </button>
        </div>
      </div>
    </div>
  );
}
