import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExtractedAssembly } from '../ai/schema';
import { buildTakeoffType } from '../assemblyBuilder';
import { polylineLength } from '../geometry';
import type { Measurement, Pt, Sheet, TakeoffType, Units } from '../model';
import { newId } from '../model';
import type { PDFPageProxy } from '../pdf';
import { readWallKey, scoreWalls, type WallKeyEntry } from '../eval/wallKey';
import { formatQty, lengthUnit, toLength } from '../units';
import { runsToLines, type TypeLines } from '../walls/runsToLines';
import { sheetWallTakeoff } from '../walls/sheetWallTakeoff';
import { scoringOn } from '../scoring';
import { useEscape } from './Dialogs';
import { tagKind, type WallTakeoffResult } from '../walls/wallTakeoff';

interface Props {
  page: PDFPageProxy;
  sheet: Sheet;
  units: Units;
  types: TakeoffType[];
  /** Measurements this sheet already has from an earlier wall takeoff. */
  earlier: number;
  palette: string[];
  /** Wall types read from the project's assembly legends, used to build new types with their layers. */
  legend: ExtractedAssembly[];
  /** Wall openings up to this width (metres) are measured through. */
  maxOpening: number;
  /** `stopsAtDoors` maps every type the walls went to (new or existing) to whether it stops at doors. */
  onApply: (result: { types: TakeoffType[]; measurements: Measurement[]; replaceEarlier: boolean; stopsAtDoors: Map<string, boolean> }) => void;
  onClose: () => void;
}

const codeOf = (typeName: string) => typeName.split(' – ')[0].trim();
const NEW = '__new__';
const SKIP = '__skip__';

/** The last wall answer key loaded, kept for this visit so each sheet can be scored without re-picking it. */
let wallKey: { name: string; entries: WallKeyEntry[] } | null = null;

type State = { phase: 'running' } | { phase: 'done'; result: WallTakeoffResult; lines: TypeLines[]; ms: number } | { phase: 'error'; message: string };

export function WallTakeoffDialog({ page, sheet, units, types, earlier, palette, legend, maxOpening, onApply, onClose }: Props) {
  const [state, setState] = useState<State>({ phase: 'running' });
  const [choice, setChoice] = useState<Map<string, string>>(new Map());
  const [replaceEarlier, setReplaceEarlier] = useState(true);
  const [key, setKey] = useState(wallKey);
  const [keyError, setKeyError] = useState<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const mpp = sheet.metersPerPoint ?? 0;
  const fromLegend = useMemo(() => {
    const out = new Map<string, ExtractedAssembly>();
    for (const a of legend) if ((a.category === 'interior_wall' || a.category === 'exterior_wall') && !out.has(a.code)) out.set(a.code, a);
    return out;
  }, [legend]);

  // The project's wall types, once read from an assembly schedule: other codes on the plan
  // (W1 for a window on some sets) are tags only where a leader puts them on a wall.
  const known = useMemo(() => {
    const codes = new Set(fromLegend.keys());
    for (const t of types) if (t.kind === 'linear' && t.assemblyTitle) codes.add(codeOf(t.name).replace('-', ''));
    const exterior = [...fromLegend.values()].filter((a) => a.category === 'exterior_wall').map((a) => a.code);
    return { codes: [...codes], exterior };
  }, [fromLegend, types]);

  const [throughDoors, setThroughDoors] = useState(true);
  // Finish-only partition types (finishes don't run across a door) stop at doors from the start.
  const [stopAt, setStopAt] = useState<Set<string>>(() => {
    const finishOnly = (text: string) => /finish(es)?\s+only/i.test(text);
    const out = new Set<string>();
    for (const a of legend) if (finishOnly([a.title, ...a.notes].join(' '))) out.add(a.code.replace('-', ''));
    for (const t of types) {
      if (t.kind !== 'linear') continue;
      // A type remembers the choice from an earlier wall takeoff.
      if (t.stopsAtDoors ?? finishOnly(`${t.name} ${t.assemblyTitle ?? ''} ${t.description ?? ''}`)) out.add(codeOf(t.name).replace('-', ''));
      else if (t.stopsAtDoors === false) out.delete(codeOf(t.name).replace('-', ''));
    }
    return out;
  });
  const stopKey = [...stopAt].sort().join(',');

  useEffect(() => {
    let live = true;
    setState({ phase: 'running' });
    const started = performance.now();
    sheetWallTakeoff(page, sheet, maxOpening, throughDoors, [...stopAt], known)
      .then((result) => {
        if (!live) return;
        const lines = runsToLines(result.runs);
        const linear = types.filter((t) => t.kind === 'linear');
        // A code read from this drawing file's schedule first (two buildings can share a code).
        const typeFor = (code: string) =>
          linear.find((t) => codeOf(t.name) === code && t.fromDoc === sheet.docId) ?? linear.find((t) => codeOf(t.name) === code && !t.fromDoc) ?? linear.find((t) => codeOf(t.name) === code);
        // A code that is none of the project's wall types (a door tag whose leader touches a
        // wall) is left out unless picked.
        const unknown = (code: string) => known.codes.length > 0 && !known.codes.includes(code);
        setChoice((prev) => new Map(lines.map((l) => [l.code, prev.get(l.code) ?? typeFor(l.code)?.id ?? (unknown(l.code) ? SKIP : NEW)])));
        setState({ phase: 'done', result, lines, ms: Math.round(performance.now() - started) });
      })
      .catch((e) => live && setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throughDoors, stopKey]);

  const lengths = useMemo(() => {
    const out = new Map<string, number>();
    if (state.phase === 'done') for (const l of state.lines) out.set(l.code, l.lines.reduce((n, pts) => n + polylineLength(pts), 0) * mpp);
    return out;
  }, [state, mpp]);

  const untagged = useMemo(
    () =>
      state.phase === 'done'
        ? state.result.runs.filter((r) => !r.tags.length).reduce((n, r) => n + Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), 0) * mpp
        : 0,
    [state, mpp],
  );

  async function loadKey(file: File) {
    setKeyError(null);
    try {
      const entries = await readWallKey(await file.arrayBuffer());
      if (!entries.length) {
        setKeyError('No wall rows found in that workbook (columns Mark, Dwg, Measured qty and Unit).');
        return;
      }
      wallKey = { name: file.name, entries };
      setKey(wallKey);
    } catch {
      setKeyError('That file could not be read as an Excel workbook.');
    }
  }

  const score = key && state.phase === 'done' ? scoreWalls(key.entries, sheet.name, lengths) : null;
  const len = (m: number) => `${formatQty(toLength(m, units))} ${lengthUnit(units)}`;

  function add() {
    if (state.phase !== 'done') return;
    const newTypes: TakeoffType[] = [];
    const measurements: Measurement[] = [];
    const stopsAtDoors = new Map<string, boolean>();
    for (const l of state.lines) {
      const c = choice.get(l.code) ?? SKIP;
      if (c === SKIP) continue;
      let typeId = c;
      if (c === NEW) {
        const a = fromLegend.get(l.code);
        const index = types.length + newTypes.length;
        const height = units === 'metric' ? 3 : 10;
        const t: TakeoffType = a
          ? buildTakeoffType(a, units, index, height)
          : { id: newId(), name: l.code, color: palette[index % palette.length], kind: 'linear', height, items: [] };
        newTypes.push(t);
        typeId = t.id;
      }
      if (tagKind(l.code, known.exterior) === 'partition') stopsAtDoors.set(typeId, stopAt.has(l.code));
      for (const points of l.lines) {
        measurements.push({ id: newId(), sheetId: sheet.id, typeId, points: points.map((p) => [...p] as Pt), holes: [], source: 'walls' });
      }
    }
    onApply({ types: newTypes, measurements, replaceEarlier: earlier > 0 && replaceEarlier, stopsAtDoors });
    onClose();
  }

  const picked = state.phase === 'done' ? state.lines.filter((l) => (choice.get(l.code) ?? SKIP) !== SKIP) : [];

  useEscape(onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Wall takeoff" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Wall takeoff · {sheet.name}</h3>
          <button onClick={onClose}>Close</button>
        </div>

        {state.phase === 'running' && (
          <div className="running">
            <div className="spinner" />
            <div>Reading walls and wall tags…</div>
          </div>
        )}

        {state.phase === 'error' && <p className="err-box">{state.message}</p>}

        {state.phase === 'done' && (
          <>
            <p className="muted">
              Centreline lengths of every wall a type tag points at, carried along the same wall, round corners and into
              untagged walls of the same thickness that run into it. Exterior walls are measured through openings.
            </p>
            <label className="inline">
              <input type="checkbox" checked={throughDoors} onChange={(e) => setThroughDoors(e.target.checked)} /> Measure partitions
              through door openings
            </label>
            {state.lines.length === 0 ? (
              <p className="warn">No tagged walls found. This works on vector PDFs whose plans have wall type tags (W1, EW3A…).</p>
            ) : (
              <table className="wall-table">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th className="num">Length</th>
                    <th className="num">Lines</th>
                    <th>From</th>
                    <th title="Partitions only: stop the length at door openings (finish-only types)">Stops at doors</th>
                    <th>Add to</th>
                  </tr>
                </thead>
                <tbody>
                  {state.lines.map((l) => (
                    <tr key={l.code}>
                      <td>
                        <strong>{l.code}</strong>
                      </td>
                      <td className="num">{len(lengths.get(l.code) ?? 0)}</td>
                      <td className="num">{l.lines.length}</td>
                      <td className="muted">
                        {l.tagged} tagged{l.carried ? ` · ${l.carried} carried` : ''}
                        {l.light ? ` · ${l.light} in light lines, check` : ''}
                      </td>
                      <td>
                        {tagKind(l.code, known.exterior) === 'partition' && (
                          <input
                            type="checkbox"
                            aria-label={`${l.code} stops at doors`}
                            checked={!throughDoors || stopAt.has(l.code)}
                            disabled={!throughDoors}
                            onChange={(e) =>
                              setStopAt((cur) => {
                                const next = new Set(cur);
                                if (e.target.checked) next.add(l.code);
                                else next.delete(l.code);
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                      <td>
                        <select value={choice.get(l.code) ?? SKIP} onChange={(e) => setChoice((m) => new Map(m).set(l.code, e.target.value))}>
                          <option value={NEW}>
                            {fromLegend.has(l.code) ? `New type from legend: ${l.code} – ${fromLegend.get(l.code)!.title}` : `New type “${l.code}”`}
                          </option>
                          {types
                            .filter((t) => t.kind === 'linear')
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          <option value={SKIP}>Don’t add</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {state.result.unmatched.length > 0 && (
              <p className="warn">
                Tags pointing at no wall found (often walls shown above or below in light lines), measure by hand:{' '}
                {summarise(state.result.unmatched.map((t) => t.code))}
              </p>
            )}
            <p className="muted">
              Untagged walls not added: {len(untagged)} (includes walls on any other plans on this sheet).
            </p>

            <div className="row-actions">
              {scoringOn() && <button onClick={() => keyInput.current?.click()}>{key ? 'Score against another workbook…' : 'Score against bid workbook…'}</button>}
              <input
                ref={keyInput}
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadKey(f);
                  e.target.value = '';
                }}
              />
            </div>
            {keyError && <p className="err-box">{keyError}</p>}
            {score && key && (
              <div className="score">
                <div className="score-head">
                  Scored against <strong>{key.name}</strong> · sheet {sheet.name}
                  {score.error !== null && <> · total difference {Math.round(score.error * 100)}% of the workbook’s length</>}
                </div>
                {score.rows.length === 0 ? (
                  <p className="warn">That workbook has no wall rows for this sheet.</p>
                ) : (
                  <table className="wall-table">
                    <thead>
                      <tr>
                        <th>Tag</th>
                        <th className="num">Workbook</th>
                        <th className="num">Takeoff</th>
                        <th className="num">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.rows.map((r) => {
                        const d = (r.got ?? 0) - (r.expected ?? 0);
                        const rel = r.expected ? Math.abs(d) / r.expected : 1;
                        return (
                          <tr key={r.code} className={rel <= 0.05 ? 'good' : rel <= 0.15 ? 'fair' : 'poor'}>
                            <td>{r.code}</td>
                            <td className="num">{r.expected === null ? '–' : len(r.expected)}</td>
                            <td className="num">{r.got === null ? '–' : len(r.got)}</td>
                            <td className="num">
                              {d >= 0 ? '+' : '−'}
                              {len(Math.abs(d))}
                              {r.expected ? ` (${Math.round((100 * d) / r.expected)}%)` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div className="row-actions sticky">
              {earlier > 0 && (
                <label className="inline">
                  <input type="checkbox" checked={replaceEarlier} onChange={(e) => setReplaceEarlier(e.target.checked)} /> Replace this sheet’s
                  earlier wall takeoff ({earlier} lines)
                </label>
              )}
              <div className="spacer" />
              <button className="primary" disabled={!picked.length} onClick={add}>
                Add {picked.length} wall type{picked.length === 1 ? '' : 's'} · {len(picked.reduce((n, l) => n + (lengths.get(l.code) ?? 0), 0))}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "EW3A ×2, FR1" */
function summarise(codes: string[]): string {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([c, n]) => (n > 1 ? `${c} ×${n}` : c)).join(', ');
}
