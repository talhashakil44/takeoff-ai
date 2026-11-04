import './ScheduleTools.css';
import { useRef, useState, type ReactNode } from 'react';
import { TRADES, tradeByKey } from '../build/extract';
import { parsePredecessors, readScheduleFile } from '../build/scheduleImport';
import { classify, fromGenerated, fromImport, newActivity, scheduleCsv } from '../build/userSchedule';
import type { Activity, ActivityKind, BuildElement, BuildModel, Level, PlanSetup, ScheduleEdits, UserActivity, UserLink, UserSchedule } from '../build/types';

/**
 * The user's own schedules in Build It: importing one (MS Project XML, P6 XER, CSV or Excel),
 * choosing which schedule the model plays, editing activities, and linking them to elements
 * picked on the model. The logic is in src/build/userSchedule.ts; this is only the controls.
 */

const KIND: Record<ActivityKind, string> = { milestone: 'Milestone', mobilize: 'Site', submittal: 'Submittal', review: 'Review', resubmittal: 'Resubmittal', procurement: 'Procurement', work: 'Work', testing: 'Testing', commissioning: 'Commissioning', closeout: 'Closeout' };
const fmt = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : '—');
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const linkText = (l: UserLink, codeOf: Map<string, string>) => `${codeOf.get(l.from) ?? '?'}${l.type !== 'FS' || l.lag ? l.type : ''}${l.lag ? `${l.lag > 0 ? '+' : ''}${l.lag}d` : ''}`;

/** The schedule being shown (null: the generated plan), and a way to change it. */
function useCurrent(schedules: ScheduleEdits | undefined, onChange: (next: ScheduleEdits) => void) {
  const use = schedules?.use ?? 'generated';
  const current = use === 'imported' ? schedules?.imported : use === 'own' ? schedules?.own : undefined;
  const update = (fn: (s: UserSchedule) => UserSchedule) => {
    if (!current || use === 'generated') return;
    onChange({ ...(schedules ?? { use }), [use]: fn(current) });
  };
  const updateActivity = (id: string, fn: (a: UserActivity) => UserActivity | null) =>
    update((s) => ({ ...s, activities: s.activities.flatMap((a) => (a.id === id ? [fn(a)].filter((x): x is UserActivity => !!x) : [a])) }));
  return { use, current, update, updateActivity };
}

/** "Import schedule": reads the file, matches its activities to the model and hands it over. */
export function ImportScheduleButton(props: { model: BuildModel | null; setup: PlanSetup | null; onImported: (s: UserSchedule, note: string) => void; onError: (text: string) => void; className?: string; children?: ReactNode; title?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const read = async (f: File) => {
    if (!props.model || !props.setup) return;
    setReading(true);
    try {
      const result = await readScheduleFile(f.name, await f.arrayBuffer());
      if (!result.tasks.length) throw new Error(`No activities found in ${f.name}. ${result.warnings.join(' ')}`.trim());
      const s = fromImport(result, f.name, props.model, props.setup);
      const work = s.activities.filter((a) => a.kind === 'work');
      const linked = work.filter((a) => a.elements.length).length;
      props.onImported(s, [`${s.activities.length} activities from ${f.name}: ${linked} of ${work.length} work activities linked to the model.`, ...result.warnings].join(' '));
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <button className={props.className} disabled={!props.model || reading} onClick={() => input.current?.click()} title={props.title ?? 'MS Project (.xml), Primavera P6 (.xer), or a CSV or Excel export with ID, Name, Start, Finish, Duration and Predecessors'}>
        {reading ? 'Reading…' : props.children ?? 'Import schedule'}
      </button>
      <input ref={input} type="file" hidden accept=".xml,.xer,.csv,.txt,.xlsx,.xlsm" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
    </>
  );
}

/** Which schedule the timeline and the model follow. */
export function ScheduleSourcePicker({ schedules, onChange }: { schedules: ScheduleEdits | undefined; onChange: (next: ScheduleEdits) => void }) {
  const use = schedules?.use ?? 'generated';
  if (!schedules?.imported && !schedules?.own) return null;
  return (
    <select className="sch-source" value={use} aria-label="Schedule shown" title="Which schedule the timeline and the model follow" onChange={(e) => onChange({ ...schedules, use: e.target.value as ScheduleEdits['use'] })}>
      <option value="generated">Generated plan</option>
      {schedules.imported && <option value="imported">Imported · {schedules.imported.name}</option>}
      {schedules.own && <option value="own">My schedule</option>}
    </select>
  );
}

/** The activities of the user's schedule as a table to edit, with what isn't on the model yet. */
export function ScheduleTable(props: {
  schedules: ScheduleEdits | undefined;
  generated: Activity[];
  times: Record<string, { start: string; finish: string; critical: boolean }>;
  levels: Level[];
  selected: string | null;
  picks: Set<string>;
  picking: boolean;
  note: string | null;
  importButton: ReactNode;
  onPick: (id: string) => void;
  onPicking: (on: boolean) => void;
  onLink: (id: string) => void;
  onChange: (next: ScheduleEdits) => void;
  onSave: (name: string, data: Blob) => void;
  model: BuildModel;
}) {
  const { schedules, levels, times, selected, picks, onChange } = props;
  const { use, current, update, updateActivity } = useCurrent(schedules, onChange);
  const [filter, setFilter] = useState<'all' | 'unlinked'>('all');
  if (use === 'generated' || !current) {
    return (
      <div className="sch-empty">
        <p>
          The timeline follows the <b>generated plan</b>. Bring the schedule you already have, or build your own here and link its activities to the model.
        </p>
        <div className="sch-row">
          {props.importButton}
          <button onClick={() => onChange({ ...(schedules ?? { use: 'own' }), use: 'own', own: schedules?.own ?? { name: 'My schedule', format: 'own', activities: [] } })}>{schedules?.own ? 'Use my schedule' : 'Start my own schedule'}</button>
          {!schedules?.own && <button onClick={() => onChange({ ...(schedules ?? { use: 'own' }), use: 'own', own: fromGenerated(props.generated) })}>Start from the generated plan</button>}
          {schedules?.imported && <button onClick={() => onChange({ ...schedules, use: 'imported' })}>Use {schedules.imported.name}</button>}
        </div>
        <p className="dim small">MS Project: File › Save As › XML or CSV. Primavera P6: Export › XER, or a spreadsheet with ID, Name, Start, Finish, Duration and Predecessors columns.</p>
      </div>
    );
  }
  const codeOf = new Map(current.activities.map((a) => [a.id, a.code]));
  const idOfCode = new Map(current.activities.map((a) => [a.code, a.id]));
  const work = current.activities.filter((a) => a.kind === 'work');
  const unlinked = work.filter((a) => !a.elements.length);
  const rows = filter === 'unlinked' ? unlinked : current.activities;
  const add = () => {
    const a = newActivity(current, { level: null, ...(selected && codeOf.has(selected) ? { preds: [{ from: selected, type: 'FS' as const, lag: 0 }] } : {}) });
    update((s) => ({ ...s, activities: [...s.activities, a] }));
    props.onPick(a.id);
  };
  const exportCsv = () => props.onSave(`${current.name.replace(/\.[a-z0-9]+$/i, '')} - schedule.csv`, new Blob([scheduleCsv(current, times, levels)], { type: 'text/csv' }));
  const matchAll = () => update((s) => ({ ...s, activities: s.activities.map((a) => (a.elements.length ? a : classify({ ...a, trade: a.trade, level: a.level }, props.model))) }));
  return (
    <div className="sch-panel">
      <div className="sch-toolbar">
        <b className="sch-name" title={current.name}>{use === 'own' ? 'My schedule' : current.name}</b>
        <span className="sch-filter" role="group" aria-label="Show">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All · {current.activities.length}</button>
          <button aria-pressed={filter === 'unlinked'} className={unlinked.length ? 'warn' : ''} onClick={() => setFilter('unlinked')} title="Work activities with nothing in the model linked to them">
            Not on the model · {unlinked.length}
          </button>
        </span>
        <button onClick={add} title="A new activity (after the selected one)">+ Activity</button>
        <button className={props.picking ? 'on' : ''} aria-pressed={props.picking} onClick={() => props.onPicking(!props.picking)} title="Click elements in the 3D model to select them, then link them to an activity">
          {props.picking ? `Selecting · ${picks.size}` : 'Select on model'}
        </button>
        {unlinked.some((a) => a.trade) && <button onClick={matchAll} title="Link activities that have no elements to their trade’s elements on their level">Match by trade</button>}
        <span className="sch-spacer" />
        {use === 'imported' && <button onClick={() => onChange({ ...schedules!, use: 'own', own: { ...current, name: 'My schedule', format: 'own', activities: current.activities.map((a) => ({ ...a })) } })} title="Copy it into a schedule of your own (the import stays as it is)">Copy to my schedule</button>}
        <button onClick={exportCsv} title="Save as CSV (opens in MS Project, Excel and P6's spreadsheet import)">Export CSV</button>
        <button
          className="sch-danger"
          onClick={() => {
            if (!confirm(`Remove ${use === 'own' ? 'your schedule' : current.name}? The generated plan stays.`)) return;
            const next: ScheduleEdits = { ...schedules!, use: 'generated' };
            delete next[use];
            onChange(next);
          }}
        >
          Remove
        </button>
      </div>
      {props.note && <p className="sch-note">{props.note}</p>}
      <div className="sch-table-wrap">
        <table className="sch-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Activity</th>
              <th>Trade</th>
              <th>Level</th>
              <th title="Working days">Days</th>
              <th title="Not earlier than">Start on</th>
              <th>Dates</th>
              <th title="ID, type (FS, SS, FF, SF) and lag in days: 3, 5SS+2">Predecessors</th>
              <th>On the model</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const t = times[a.id];
              return (
                <tr key={a.id} className={`${selected === a.id ? 'sel' : ''} ${t?.critical ? 'crit' : ''}`} onClick={() => props.onPick(a.id)}>
                  <td className="sch-code">{a.code}</td>
                  <td>
                    <TextCell value={a.name} onCommit={(name) => name.trim() && updateActivity(a.id, (x) => ({ ...x, name: name.trim() }))} />
                  </td>
                  <td>
                    <select value={a.trade ?? ''} onChange={(e) => updateActivity(a.id, (x) => ({ ...x, trade: e.target.value || null }))} style={a.trade ? { borderLeftColor: tradeByKey.get(a.trade)?.colour } : undefined}>
                      <option value="">—</option>
                      {TRADES.map((tr) => (
                        <option key={tr.key} value={tr.key}>
                          {tr.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={a.level ?? ''} onChange={(e) => updateActivity(a.id, (x) => ({ ...x, level: e.target.value || null }))}>
                      <option value="">Any</option>
                      {levels.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <TextCell className="num" value={String(a.duration)} onCommit={(v) => {
                      const d = Math.round(Number(v));
                      if (Number.isFinite(d) && d >= 0) updateActivity(a.id, (x) => ({ ...x, duration: d, kind: d === 0 ? 'milestone' : x.kind === 'milestone' ? 'work' : x.kind }));
                    }} />
                  </td>
                  <td>
                    <input type="date" value={a.start ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => updateActivity(a.id, (x) => {
                      const { start: _, ...rest } = x;
                      return e.target.value ? { ...rest, start: e.target.value } : rest;
                    })} />
                  </td>
                  <td className="sch-dates" title={t ? `${t.start} → ${t.finish}` : undefined}>{t ? (a.duration ? `${day(t.start)} → ${day(t.finish)}` : day(t.start)) : '—'}</td>
                  <td>
                    <TextCell
                      value={a.preds.map((l) => linkText(l, codeOf)).join(', ')}
                      placeholder="—"
                      onCommit={(v) => {
                        const links = parsePredecessors(v, new Set(idOfCode.keys()))
                          .filter((l) => idOfCode.has(l.key) && idOfCode.get(l.key) !== a.id)
                          .map((l) => ({ from: idOfCode.get(l.key)!, type: l.type, lag: Math.round(l.lag) }));
                        updateActivity(a.id, (x) => ({ ...x, preds: links }));
                      }}
                    />
                  </td>
                  <td className="sch-model">
                    {a.kind !== 'work' ? (
                      <span className="dim">{KIND[a.kind]}</span>
                    ) : a.elements.length ? (
                      <span>{a.elements.length} element{a.elements.length === 1 ? '' : 's'}{a.linked === 'matched' ? <em className="dim"> · matched</em> : null}</span>
                    ) : (
                      <span className="sch-unlinked">Not linked</span>
                    )}
                    {picks.size > 0 && (
                      <button
                        className="sch-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onLink(a.id);
                        }}
                        title="Link the elements selected on the model to this activity"
                      >
                        Link {picks.size}
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      className="bld-x"
                      title="Delete this activity"
                      onClick={(e) => {
                        e.stopPropagation();
                        update((s) => ({ ...s, activities: s.activities.filter((x) => x.id !== a.id).map((x) => ({ ...x, preds: x.preds.filter((p) => p.from !== a.id) })) }));
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="dim sch-none">
                  {filter === 'unlinked' ? 'Every work activity is linked to the model.' : 'No activities yet: add one, then select elements on the model and link them.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A text box that saves when it's left (or on Enter), and follows the value again after. */
function TextCell({ value, onCommit, className, placeholder }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string }) {
  const [text, setText] = useState<string | null>(null);
  const done = () => {
    if (text !== null && text !== value) onCommit(text);
    setText(null);
  };
  return (
    <input
      className={className}
      value={text ?? value}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

/** The inspector for an activity in the user's schedule: its dates, links and the elements it builds. */
export function UserActivityCard(props: {
  a: UserActivity;
  t: { start: string; finish: string; float: number; critical: boolean; driver: string | null } | undefined;
  schedules: ScheduleEdits | undefined;
  levels: Level[];
  elements: BuildElement[];
  picks: Set<string>;
  picking: boolean;
  model: BuildModel;
  onPicking: (on: boolean) => void;
  onLink: () => void;
  onPick: (id: string) => void;
  onElement: (id: string) => void;
  onChange: (next: ScheduleEdits) => void;
}) {
  const { a, t, levels, elements, picks } = props;
  const { current, update, updateActivity } = useCurrent(props.schedules, props.onChange);
  const [adding, setAdding] = useState('');
  const set = (fields: Partial<UserActivity>) => updateActivity(a.id, (x) => ({ ...x, ...fields }));
  const others = current?.activities.filter((x) => x.id !== a.id) ?? [];
  const name = (id: string) => others.find((x) => x.id === id)?.name ?? 'Deleted activity';
  return (
    <div className="bld-card sch-card">
      <span className="bld-kind" style={a.trade ? { borderColor: tradeByKey.get(a.trade)?.colour } : undefined}>
        {KIND[a.kind]} · {a.code}
      </span>
      <h3>{a.name}</h3>
      {t && (
        <p className="bld-big">
          {fmt(t.start)} → {fmt(t.finish)}
          <span> · {a.duration} day{a.duration === 1 ? '' : 's'}</span>
        </p>
      )}
      {t && <p className="bld-flags">{t.critical ? <span className="crit">Critical</span> : <span>{t.float} days float</span>}</p>}
      {a.finish && t && a.finish !== t.finish && <p className="dim small">The file had it finishing {fmt(a.finish)}.</p>}
      <div className="sch-fields">
        <label>
          <span>Name</span>
          <TextCell value={a.name} onCommit={(v) => v.trim() && set({ name: v.trim() })} />
        </label>
        <label>
          <span>Trade</span>
          <select value={a.trade ?? ''} onChange={(e) => set({ trade: e.target.value || null })}>
            <option value="">—</option>
            {TRADES.map((tr) => (
              <option key={tr.key} value={tr.key}>
                {tr.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Level</span>
          <select value={a.level ?? ''} onChange={(e) => set({ level: e.target.value || null })}>
            <option value="">Any level</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Kind</span>
          <select value={a.kind} onChange={(e) => set({ kind: e.target.value as ActivityKind, ...(e.target.value === 'milestone' ? { duration: 0 } : {}) })}>
            {Object.entries(KIND).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Working days</span>
          <TextCell className="num" value={String(a.duration)} onCommit={(v) => {
            const d = Math.round(Number(v));
            if (Number.isFinite(d) && d >= 0) set({ duration: d, ...(d === 0 ? { kind: 'milestone' as const } : a.kind === 'milestone' ? { kind: 'work' as const } : {}) });
          }} />
        </label>
        <label>
          <span>Not earlier than</span>
          <input type="date" value={a.start ?? ''} onChange={(e) => updateActivity(a.id, (x) => {
            const { start: _, ...rest } = x;
            return e.target.value ? { ...rest, start: e.target.value } : rest;
          })} />
        </label>
      </div>
      <h4>Waits for</h4>
      {!a.preds.length && <p className="dim small">Nothing: it starts at the start{a.start ? `, or on ${fmt(a.start)}` : ''}.</p>}
      <ul className="bld-deps">
        {a.preds.map((l) => (
          <li key={l.from} className={t?.driver === l.from ? 'driver' : ''}>
            <button className="link-button" onClick={() => props.onPick(l.from)}>
              {name(l.from)}
            </button>
            <select className="sch-type" value={l.type} onChange={(e) => set({ preds: a.preds.map((p) => (p.from === l.from ? { ...p, type: e.target.value as UserLink['type'] } : p)) })} aria-label="Link type">
              {(['FS', 'SS', 'FF', 'SF'] as const).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <TextCell className="num sch-lag" value={String(l.lag)} onCommit={(v) => Number.isFinite(Number(v)) && set({ preds: a.preds.map((p) => (p.from === l.from ? { ...p, lag: Math.round(Number(v)) } : p)) })} />
            <span className="dim"> days lag</span>
            {t?.driver === l.from && <span className="tag">sets the start</span>}
            <button className="bld-x" title="Remove this link" onClick={() => set({ preds: a.preds.filter((p) => p.from !== l.from) })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="bld-edit">
        <select value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a predecessor…</option>
          {others
            .filter((x) => !a.preds.some((p) => p.from === x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
        </select>
        <button
          disabled={!adding}
          onClick={() => {
            set({ preds: [...a.preds, { from: adding, type: 'FS', lag: 0 }] });
            setAdding('');
          }}
        >
          Add
        </button>
      </div>
      <h4>On the model</h4>
      <p className="small">
        {elements.length ? `${elements.length} element${elements.length === 1 ? '' : 's'} ${a.linked === 'matched' ? 'matched by trade and words' : 'linked'}` : a.trade ? 'Nothing linked: its trade’s elements on its level follow it on the AI model.' : 'Nothing linked.'}
      </p>
      <div className="sch-row">
        <button className={props.picking ? 'on' : ''} aria-pressed={props.picking} onClick={() => props.onPicking(!props.picking)}>
          {props.picking ? 'Done selecting' : 'Select on model'}
        </button>
        <button className="primary" disabled={!picks.size} onClick={props.onLink} title="Add the elements selected on the model to this activity">
          Link {picks.size || ''} selected to activity
        </button>
      </div>
      <div className="sch-row">
        {a.trade && a.kind === 'work' && (
          <button onClick={() => set(classify({ ...a, elements: [] }, props.model))} title="Link its trade’s elements on its level, narrowed by its words">
            Match by trade
          </button>
        )}
        {elements.length > 0 && <button onClick={() => set({ elements: [], linked: undefined })}>Unlink all</button>}
      </div>
      {elements.length > 0 && (
        <ul className="sch-elements">
          {elements.slice(0, 40).map((e) => (
            <li key={e.id}>
              <button className="link-button" onClick={() => props.onElement(e.id)}>
                {e.name}
              </button>
              <button className="bld-x" title="Unlink this element" onClick={() => set({ elements: a.elements.filter((x) => x !== e.id), linked: 'picked' })}>
                ×
              </button>
            </li>
          ))}
          {elements.length > 40 && <li className="dim">and {elements.length - 40} more</li>}
        </ul>
      )}
      <div className="sch-row sch-end">
        <button
          className="sch-danger"
          onClick={() => update((s) => ({ ...s, activities: s.activities.filter((x) => x.id !== a.id).map((x) => ({ ...x, preds: x.preds.filter((p) => p.from !== a.id) })) }))}
        >
          Delete activity
        </button>
      </div>
    </div>
  );
}

/** Over the model while selecting: how many are picked, and linking them to the chosen activity. */
export function PickBar(props: { count: number; target: UserActivity | undefined; aiModel: boolean; onLink: () => void; onClear: () => void; onDone: () => void; onShowElements: () => void }) {
  return (
    <div className="sch-pickbar" role="status">
      {props.aiModel ? (
        <>
          <span>Elements are selected in the Takeoff or Building view.</span>
          <button onClick={props.onShowElements}>Show takeoff elements</button>
        </>
      ) : (
        <>
          <b>{props.count ? `${props.count} selected` : 'Click elements to select them'}</b>
          <span className="dim">{props.target ? `→ ${props.target.name}` : 'then pick an activity'}</span>
          <button className="primary" disabled={!props.count || !props.target} onClick={props.onLink}>
            Link selected to activity
          </button>
          {props.count > 0 && <button onClick={props.onClear}>Clear</button>}
        </>
      )}
      <button onClick={props.onDone}>Done</button>
    </div>
  );
}
