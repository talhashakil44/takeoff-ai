import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBuild, runBuild, saveBuild } from '../build/client';
import { Calendar } from '../build/cpm';
import { isPlan, levelWords, sourceHashOf, titleBlockWords, TRADES, tradeByKey } from '../build/extract';
import { readSpecFacts } from '../build/facts';
import { replan, type BuildOutput } from '../build/run';
import type { Activity, Assumption, Basis, BuildEdits, BuildElement, Issue, PlanSetup, SourceRef, SpecFact } from '../build/types';
import type { Project } from '../model';
import type { Place } from '../graph/graph';
import type { SpecSection } from '../spec/parse';
import { BuildScene, type ElementState } from './BuildScene';
import { Icon } from './Icons';

/**
 * Build It: the proposed building and the plan to build it, from this project's drawings,
 * takeoff and specification. Setup asks only for what the documents don't say; the model and
 * the schedule come from the same data and move together; the day shown on the timeline is
 * the day shown in the model.
 */

interface Props {
  project: Project;
  sections: SpecSection[];
  /** A spec page's text (for the time requirements it states). */
  specText: (docId: string, page: number) => Promise<string>;
  /** A sheet's text, for the level its title block names. */
  sheetText: (sheetId: string) => Promise<{ str: string; cx: number; cy: number }[]>;
  onEdits: (edits: BuildEdits) => void;
  onOpenSpec: (docId: string, page: number, key: string) => void;
  onOpenDrawing: (places: Place[], label: string) => void;
  onSave: (name: string, data: Blob) => void;
  onClose: () => void;
}

const BASIS_LABEL: Record<Basis, string> = { documented: 'Documented', inferred: 'Inferred', assumed: 'Assumption', unknown: 'Unknown' };
const KIND_LABEL: Record<Activity['kind'], string> = { milestone: 'Milestone', mobilize: 'Site', submittal: 'Submittal', review: 'Review', resubmittal: 'Resubmittal', procurement: 'Procurement', work: 'Work', testing: 'Testing', commissioning: 'Commissioning', closeout: 'Closeout' };
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function Badge({ basis }: { basis: Basis }) {
  return <span className={`bld-badge ${basis}`}>{BASIS_LABEL[basis]}</span>;
}

export default function BuildView({ project, sections, specText, sheetText, onEdits, onOpenSpec, onOpenDrawing, onSave, onClose }: Props) {
  const edits = useMemo(() => project.build ?? {}, [project.build]);
  const [out, setOut] = useState<BuildOutput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<SpecFact[] | null>(null);
  const [hints, setHints] = useState<Record<string, string> | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [sel, setSel] = useState<{ kind: 'element' | 'activity'; id: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [levelsOn, setLevelsOn] = useState<Set<string> | null>(null);
  const [tradesOn, setTradesOn] = useState<Set<string> | null>(null);
  const [ghosts, setGhosts] = useState(true);
  const [zoom, setZoom] = useState(9);

  // The last build of this project, from this computer.
  useEffect(() => {
    let gone = false;
    void loadBuild(project.id ?? '').then((b) => {
      if (!gone && b && !out) {
        setOut(b.output);
        setSetupOpen(false);
      }
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // What the documents say about time, and which level each measured sheet is: read once.
  const measured = useMemo(() => [...new Set(project.measurements.map((m) => m.sheetId))], [project.measurements]);
  useEffect(() => {
    let gone = false;
    void (async () => {
      const f = await readSpecFacts(sections, specText).catch(() => []);
      if (!gone) setFacts(f);
    })();
    return () => {
      gone = true;
    };
  }, [sections, specText]);
  useEffect(() => {
    let gone = false;
    void (async () => {
      const h: Record<string, string> = {};
      for (const sid of measured) {
        const s = project.sheets.find((x) => x.id === sid);
        if (!s || s.superseded || !isPlan(s)) continue;
        const lw = levelWords(s.title ?? '');
        if (lw.num !== undefined || lw.word) continue;
        const t = await sheetText(sid).catch(() => []);
        h[sid] = titleBlockWords(t, s.width, s.height);
      }
      if (!gone) setHints(h);
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured.join(',')]);
  const ready = facts !== null && hints !== null;

  const build = async (withEdits: BuildEdits = edits) => {
    if (!facts || !hints) return;
    setBusy('Building the model and the plan…');
    setError(null);
    try {
      const o = await runBuild({ project, sections, facts, levelHints: hints, edits: withEdits, today: today() });
      setOut(o);
      if (project.id) void saveBuild(project.id, o);
      setSetupOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Stale: the drawings, takeoff or spec changed since this was built.
  const currentHash = useMemo(() => {
    if (!out) return null;
    const ftf = out.setup.floorToFloor.value;
    return sourceHashOf({ project, sections, levelHints: hints ?? undefined, edits, floorToFloor: project.units === 'imperial' ? ftf * 0.3048 : ftf });
  }, [project, sections, hints, edits, out]);
  const stale = !!out && !!currentHash && hints !== null && currentHash !== out.model.sourceHash;

  // Edits: setup values and activity changes replan at once (the model unchanged); levels and heights rebuild it.
  const edit = (next: BuildEdits, rebuild = false) => {
    onEdits(next);
    if (!out) return;
    if (rebuild) return void build(next);
    const setup = applyEditsToSetup(out.setup, next);
    const { schedule } = replan(out.model, setup, { sections, facts: facts ?? [], edits: next });
    const o = { ...out, setup, schedule };
    setOut(o);
    if (project.id) void saveBuild(project.id, o);
  };

  const model = out?.model ?? null;
  const schedule = out?.schedule ?? null;
  const setup = out?.setup ?? null;
  const acts = schedule?.activities ?? [];
  const times = schedule?.times ?? {};
  const actById = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts]);
  const elById = useMemo(() => new Map((model?.elements ?? []).map((e) => [e.id, e])), [model]);
  const actOfElement = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of acts) for (const id of a.elements) m.set(id, a.id);
    return m;
  }, [acts]);
  const end = useMemo(() => Math.max(1, ...Object.values(times).map((t) => t.ef)), [times]);
  const cal = useMemo(() => (setup ? new Calendar(setup.start.value, setup.workDays.value, setup.holidays.value) : null), [setup]);
  const targetIdx = useMemo(() => (cal && setup?.target.value ? cal.workingDaysTo(setup.target.value) : null), [cal, setup]);

  // Playback: the day moves; the model follows the schedule.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setDay((d) => {
        const n = d + dt * speed;
        if (n >= end) {
          setPlaying(false);
          return end;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, end]);

  const dayInt = Math.floor(day);
  const stateOf = (e: BuildElement): ElementState => {
    const t = times[actOfElement.get(e.id) ?? ''];
    if (!t) return 'done';
    const demo = e.trade === 'demolition';
    if (dayInt < t.es) return demo ? 'existing' : 'todo';
    if (dayInt < t.ef) return demo ? 'removing' : 'doing';
    return demo ? 'gone' : 'done';
  };
  const stateKey = `${dayInt}|${Object.keys(times).length}|${acts.map((a) => times[a.id]?.es).join(',')}`;

  const levels = model?.levels ?? [];
  const tradesUsed = useMemo(() => TRADES.filter((t) => model?.elements.some((e) => e.trade === t.key)), [model]);
  const levelSet = levelsOn ?? new Set(levels.map((l) => l.id));
  const tradeSet = tradesOn ?? new Set(tradesUsed.map((t) => t.key));
  const highlight = useMemo(() => (sel?.kind === 'activity' ? new Set(actById.get(sel.id)?.elements ?? []) : null), [sel, actById]);

  const allIssues: Issue[] = [...(model?.issues ?? []), ...(schedule?.issues ?? [])];
  const feas = schedule?.feasibility;
  const progress = acts.filter((a) => a.kind === 'work').length ? Math.round((100 * acts.filter((a) => a.kind === 'work' && (times[a.id]?.ef ?? 0) <= dayInt).length) / acts.filter((a) => a.kind === 'work').length) : 0;

  const openSource = (s: SourceRef) => {
    if (s.kind === 'spec') onOpenSpec(s.id, s.page, s.section ?? '');
    else onOpenDrawing([{ sheetId: s.id, box: s.box ?? [0, 0, 100, 100], label: s.label }], s.label);
  };
  const openSection = (key: string) => {
    const s = sections.find((x) => x.key === key);
    if (s) onOpenSpec(s.docId, s.pages[0] ?? 1, s.key);
  };
  const secLabel = (key: string) => {
    const s = sections.find((x) => x.key === key);
    return s ? `${s.number} ${s.title}` : key;
  };

  const exportPlan = () => {
    if (!out) return;
    const data = { format: 'takeoff-ai-build', version: 1, project: project.name, builtAt: new Date().toISOString(), edits, setup: out.setup, model: out.model, schedule: out.schedule };
    onSave(`${project.name || 'Project'} - build plan.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  };
  const exportCsv = () => {
    if (!out) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['ID', 'Activity', 'Type', 'Trade', 'Level', 'Duration (working days)', 'Start', 'Finish', 'Float', 'Critical', 'Late for target', 'Predecessors', 'Duration basis', 'Why', 'Spec sections'].map(esc).join(',')];
    for (const a of acts) {
      const t = times[a.id];
      rows.push([a.id, a.name, KIND_LABEL[a.kind], a.trade ? tradeByKey.get(a.trade)?.name : '', a.level ?? '', a.duration, t?.start, t?.finish, t?.float, t?.critical ? 'yes' : '', t?.late ? 'yes' : '', a.deps.map((d) => d.from).join(' '), a.durationBasis, a.durationWhy, a.specs.join(' ')].map(esc).join(','));
    }
    onSave(`${project.name || 'Project'} - schedule.csv`, new Blob([rows.join('\n')], { type: 'text/csv' }));
  };

  // Gantt rows: preconstruction, each level, then testing, commissioning and closeout.
  const groups = useMemo(() => {
    const g: { title: string; items: Activity[] }[] = [];
    const pre = acts.filter((a) => ['milestone', 'mobilize', 'submittal', 'review', 'resubmittal', 'procurement'].includes(a.kind) && a.id !== 'ms:substantial' && a.id !== 'ms:finish');
    g.push({ title: 'Start, submittals and procurement', items: pre });
    for (const l of [...levels.map((l) => l.id), null]) {
      const items = acts.filter((a) => a.kind === 'work' && a.level === l);
      if (items.length) g.push({ title: l ? levels.find((x) => x.id === l)?.name ?? l : 'Level not known', items });
    }
    g.push({ title: 'Testing, commissioning and closeout', items: acts.filter((a) => ['testing', 'commissioning', 'closeout'].includes(a.kind) || a.id === 'ms:substantial' || a.id === 'ms:finish') });
    return g.filter((x) => x.items.length);
  }, [acts, levels]);

  const selAct = sel?.kind === 'activity' ? actById.get(sel.id) : undefined;
  const selEl = sel?.kind === 'element' ? elById.get(sel.id) : undefined;
  const hoverEl = hover ? elById.get(hover) : undefined;

  return (
    <div className="bld" role="region" aria-label="Build It">
      <header className="bld-bar">
        <div className="bld-title">
          <Icon name="walls" size={16} />
          <strong>Build it</strong>
          <span className="bld-sub">{project.name}</span>
        </div>
        {out && feas && (
          <div className={`bld-feas ${feas.target ? (feas.overBy ? 'late' : 'ok') : 'none'}`} title={feas.target ? `Target ${fmt(feas.target)}` : 'No target set'}>
            {feas.target ? (feas.overBy ? `${feas.overBy} working days late · earliest ${fmt(feas.earliestFinish)}` : `Fits the target · ${fmt(feas.earliestFinish)}`) : `Earliest finish ${fmt(feas.earliestFinish)} · no target set`}
          </div>
        )}
        {stale && (
          <button className="bld-stale" onClick={() => void build()} title="The drawings, takeoff or specification changed since this was built">
            Documents changed · Rebuild
          </button>
        )}
        <div className="bld-actions">
          <button className={setupOpen ? 'on' : ''} onClick={() => setSetupOpen((o) => !o)}>
            Setup
          </button>
          <button className={issuesOpen ? 'on' : ''} onClick={() => setIssuesOpen((o) => !o)} disabled={!out}>
            Issues {allIssues.length ? <i className={allIssues.some((i) => i.severity === 'conflict') ? 'bad' : ''}>{allIssues.length}</i> : null}
          </button>
          <button onClick={exportPlan} disabled={!out} title="The model, the assumptions and the schedule, as data">
            Export plan
          </button>
          <button onClick={exportCsv} disabled={!out} title="The schedule as a spreadsheet">
            Schedule CSV
          </button>
          <button className="bld-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="bld-main">
        {setupOpen && (
          <SetupPanel
            project={project}
            setup={setup}
            facts={facts}
            levels={levels}
            edits={edits}
            ready={ready}
            busy={busy}
            built={!!out}
            onBuild={() => void build()}
            onEdit={edit}
            onSource={openSource}
            tradeKeys={tradesUsed.map((t) => t.key)}
            unplacedSheets={model ? [...new Set(model.elements.filter((e) => !e.level && e.issues.some((x) => /level/.test(x))).map((e) => e.sheetId))] : []}
          />
        )}

        <section className="bld-stage">
          {model ? (
            <>
              <BuildScene
                model={model}
                stateOf={stateOf}
                stateKey={stateKey}
                selected={selEl?.id ?? null}
                highlight={highlight}
                levels={levelSet}
                trades={tradeSet}
                showGhosts={ghosts}
                onSelect={(id) => setSel(id ? { kind: 'element', id } : null)}
                onHover={setHover}
              />
              <div className="bld-filters">
                <div className="bld-chips" role="group" aria-label="Levels">
                  {levels.map((l) => (
                    <button
                      key={l.id}
                      className={levelSet.has(l.id) ? 'on' : ''}
                      onClick={() => {
                        const n = new Set(levelSet);
                        if (n.has(l.id)) n.delete(l.id);
                        else n.add(l.id);
                        setLevelsOn(n);
                      }}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
                <div className="bld-chips trades" role="group" aria-label="Trades">
                  {tradesUsed.map((t) => (
                    <button
                      key={t.key}
                      className={tradeSet.has(t.key) ? 'on' : ''}
                      onClick={() => {
                        const n = new Set(tradeSet);
                        if (n.has(t.key)) n.delete(t.key);
                        else n.add(t.key);
                        setTradesOn(n);
                      }}
                      title={t.name}
                    >
                      <i style={{ background: t.colour }} />
                      {t.name}
                    </button>
                  ))}
                </div>
                <label className="bld-ghost">
                  <input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} /> Show what isn’t built yet
                </label>
              </div>
              <div className="bld-day">
                <b>{cal ? fmt(cal.date(dayInt)) : ''}</b>
                <span>
                  Day {dayInt + 1} of {end} · {progress}% of the work done
                </span>
              </div>
              {hoverEl && (
                <div className="bld-hover">
                  {hoverEl.name} · {Math.round(hoverEl.quantity).toLocaleString()} {hoverEl.unit}
                </div>
              )}
              <div className="bld-legend">
                <span>
                  <i className="todo" /> Not started
                </span>
                <span>
                  <i className="doing" /> Being built
                </span>
                <span>
                  <i className="done" /> Done
                </span>
                <span>
                  <i className="demo" /> To demolish
                </span>
              </div>
            </>
          ) : (
            <div className="bld-empty">
              <h2>Build it</h2>
              <p>
                The building and the plan to build it, from this project’s takeoff and specification. Check the setup on the left: dates, review and lead times, crews. Only what the documents
                don’t say needs an answer.
              </p>
              <p className="dim">
                {project.measurements.length.toLocaleString()} takeoffs on {measured.length} sheets · {sections.length} spec sections
              </p>
              <button className="primary big" disabled={!ready || !!busy || !project.measurements.length} onClick={() => void build()}>
                {busy ?? (!ready ? 'Reading the documents…' : 'Build it')}
              </button>
              {!project.measurements.length && <p className="dim">There is no takeoff yet: take off the drawings first.</p>}
              {error && <p className="bld-error">{error}</p>}
            </div>
          )}
        </section>

        {out && (
          <aside className="bld-inspect">
            {selAct ? (
              <ActivityCard
                a={selAct}
                t={times[selAct.id]}
                acts={acts}
                edits={edits}
                onEdit={edit}
                onPick={(id) => setSel({ kind: 'activity', id })}
                onSection={openSection}
                secLabel={secLabel}
                onSource={openSource}
                elements={selAct.elements.map((id) => elById.get(id)!).filter(Boolean)}
              />
            ) : selEl ? (
              <ElementCard e={selEl} act={actById.get(actOfElement.get(selEl.id) ?? '')} state={stateOf(selEl)} onPickAct={(id) => setSel({ kind: 'activity', id })} onSection={openSection} secLabel={secLabel} onSource={openSource} missing={(k) => !!sections.find((s) => s.key === k)?.missing} />
            ) : feas ? (
              <div className="bld-card">
                <h3>{feas.target ? (feas.overBy ? 'The target can’t be met' : 'The plan meets the target') : 'Earliest finish'}</h3>
                <p className="bld-big">
                  {fmt(feas.earliestFinish)}
                  {feas.target && <span> · target {fmt(feas.target)}</span>}
                </p>
                {feas.target && feas.overBy > 0 && (
                  <p>
                    {feas.overBy} working days late under the current assumptions. Nothing has been squeezed to fit: the chain below sets the date.
                  </p>
                )}
                <h4>What sets the date</h4>
                <ol className="bld-chain">
                  {feas.chain
                    .filter((c) => c.duration > 0)
                    .map((c) => (
                      <li key={c.id}>
                        <button onClick={() => setSel({ kind: 'activity', id: c.id })}>
                          <span>{c.name}</span>
                          <b>{c.duration}d</b>
                          <Badge basis={c.basis} />
                        </button>
                      </li>
                    ))}
                </ol>
                <p className="dim">
                  {feas.documentedDays} days of it are documented requirements; {feas.assumedDays} rest on quantities, rates and assumptions you can change.
                </p>
                {feas.levers.length > 0 && (
                  <>
                    <h4>What would change it</h4>
                    <ul className="bld-levers">
                      {feas.levers.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </aside>
        )}

        {issuesOpen && out && (
          <div className="bld-issues">
            <div className="bld-issues-head">
              <b>Unresolved and assumed</b>
              <button className="bld-close" onClick={() => setIssuesOpen(false)} aria-label="Close">
                <Icon name="close" size={12} />
              </button>
            </div>
            <ul>
              {allIssues.map((i) => (
                <li key={i.id} className={i.severity}>
                  {i.text}
                  {i.refs?.length && actById.has(i.refs[0]) ? (
                    <button className="link-button" onClick={() => setSel({ kind: 'activity', id: i.refs![i.refs!.length - 1] })}>
                      Show
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {out && cal && (
        <footer className="bld-time">
          <div className="bld-controls">
            <button className="primary" onClick={() => (day >= end ? (setDay(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
              <option value={5}>5 days/s</option>
              <option value={10}>10 days/s</option>
              <option value={25}>25 days/s</option>
            </select>
            <input type="range" min={0} max={end} step={1} value={dayInt} onChange={(e) => (setPlaying(false), setDay(Number(e.target.value)))} aria-label="Day" />
            <span className="bld-date">{fmt(cal.date(dayInt))}</span>
            <span className="bld-zoom">
              <button onClick={() => setZoom((z) => Math.max(2, z / 1.5))} aria-label="Zoom out">
                −
              </button>
              <button onClick={() => setZoom((z) => Math.min(40, z * 1.5))} aria-label="Zoom in">
                +
              </button>
            </span>
          </div>
          <Gantt groups={groups} times={times} end={end} zoom={zoom} day={day} target={targetIdx} cal={cal} selected={sel?.kind === 'activity' ? sel.id : null} onPick={(id) => setSel({ kind: 'activity', id })} onDay={(d) => (setPlaying(false), setDay(d))} />
        </footer>
      )}
    </div>
  );
}

/** Setup edits applied over the built setup (same rules as a rebuild, without one). */
function applyEditsToSetup(setup: PlanSetup, edits: BuildEdits): PlanSetup {
  const out: PlanSetup = { ...setup, trades: { ...setup.trades } };
  for (const [k, v] of Object.entries(edits.setup ?? {})) {
    if (k === 'trades' || v === undefined) continue;
    const cur = (out as unknown as Record<string, Assumption<unknown>>)[k];
    if (cur && JSON.stringify(cur.value) !== JSON.stringify(v)) (out as unknown as Record<string, Assumption<unknown>>)[k] = { value: v, basis: 'assumed', why: cur.basis === 'documented' ? `Set by you (the documents say ${JSON.stringify(cur.value)})` : 'Set by you' };
  }
  for (const [t, v] of Object.entries(edits.setup?.trades ?? {})) {
    const cur = out.trades[t];
    if (cur) out.trades[t] = { value: { ...cur.value, ...v, rates: { ...cur.value.rates, ...(v.rates ?? {}) } }, basis: 'assumed', why: 'Set by you' };
  }
  return out;
}

function SetupPanel(props: {
  project: Project;
  setup: PlanSetup | null;
  facts: SpecFact[] | null;
  levels: { id: string; name: string; elevation: number }[];
  edits: BuildEdits;
  ready: boolean;
  busy: string | null;
  built: boolean;
  unplacedSheets: string[];
  tradeKeys: string[];
  onBuild: () => void;
  onEdit: (e: BuildEdits, rebuild?: boolean) => void;
  onSource: (s: SourceRef) => void;
}) {
  const { project, setup, facts, edits, ready, busy, built, onBuild, onEdit, onSource } = props;
  const ed = edits.setup ?? {};
  const metric = project.units === 'metric';
  const val = <T,>(k: keyof PlanSetup, fallback: T): T => ((ed as Record<string, unknown>)[k] as T) ?? ((setup as unknown as Record<string, Assumption<T>> | null)?.[k]?.value ?? fallback);
  const basisOf = (k: keyof PlanSetup): Assumption<unknown> | undefined => (setup ? (setup as unknown as Record<string, Assumption<unknown>>)[k] : undefined);
  const set = (k: string, v: unknown, rebuild = false) => onEdit({ ...edits, setup: { ...ed, [k]: v } }, rebuild);
  const fact = (k: SpecFact['key']) => facts?.find((f) => f.key === k);
  const Row = ({ k, label, unit, rebuild }: { k: keyof PlanSetup; label: string; unit: string; rebuild?: boolean }) => {
    const b = basisOf(k);
    return (
      <label className="bld-field">
        <span>{label}</span>
        <input type="number" min={0} step={k === 'floorToFloor' ? 0.1 : 1} value={val<number>(k, 0)} onChange={(e) => set(k, Number(e.target.value), rebuild)} />
        <em>{unit}</em>
        {b && <Badge basis={(ed as Record<string, unknown>)[k] !== undefined ? 'assumed' : b.basis} />}
        {b?.source && (
          <button className="link-button" onClick={() => onSource(b.source!)} title={b.source.quote}>
            {b.source.label} p.{b.source.page}
          </button>
        )}
      </label>
    );
  };
  const [tab, setTab] = useState<'project' | 'trades' | 'levels'>('project');
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const wd = val<number[]>('workDays', [1, 2, 3, 4, 5]);
  return (
    <aside className="bld-setup">
      <div className="bld-tabs" role="tablist">
        {(['project', 'trades', 'levels'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'project' ? 'Dates & reviews' : t === 'trades' ? 'Crews & rates' : 'Levels'}
          </button>
        ))}
      </div>
      {tab === 'project' && (
        <div className="bld-form">
          <p className="dim">Found in the documents: {facts === null ? 'reading…' : facts.length ? facts.map((f) => `${f.key === 'reviewDays' ? 'review period' : f.key === 'substantialDate' ? 'completion date' : f.key === 'durationWeeks' ? 'contract time' : 'commissioning'} (${f.source.label})`).join(', ') : 'no time requirements'}.</p>
          <label className="bld-field">
            <span>Start</span>
            <input type="date" value={val<string>('start', today())} onChange={(e) => set('start', e.target.value)} />
            {basisOf('start') && <Badge basis={ed.start !== undefined ? 'assumed' : basisOf('start')!.basis} />}
          </label>
          <label className="bld-field">
            <span>Target completion</span>
            <input type="date" value={val<string | null>('target', null) ?? ''} onChange={(e) => set('target', e.target.value || null)} />
            {basisOf('target') && <Badge basis={ed.target !== undefined ? 'assumed' : basisOf('target')!.basis} />}
            {basisOf('target')?.source && (
              <button className="link-button" onClick={() => onSource(basisOf('target')!.source!)}>
                {basisOf('target')!.source!.label}
              </button>
            )}
          </label>
          <p className="dim small">A target, not a reason to squeeze the work: if it can’t be met, Build It shows why.</p>
          <div className="bld-field">
            <span>Working days</span>
            <span className="bld-days">
              {days.map((d, i) => (
                <button key={i} className={wd.includes(i) ? 'on' : ''} onClick={() => set('workDays', wd.includes(i) ? wd.filter((x) => x !== i) : [...wd, i].sort())}>
                  {d}
                </button>
              ))}
            </span>
          </div>
          <label className="bld-field">
            <span>Holidays</span>
            <input type="text" placeholder="2026-12-25, 2027-01-01" defaultValue={val<string[]>('holidays', []).join(', ')} onBlur={(e) => set('holidays', e.target.value.split(/[,\s]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))} />
          </label>
          <h4>Submittals and reviews</h4>
          <Row k="submittalPrepDays" label="Preparing submittals" unit="days" />
          <Row k="reviewDays" label="Consultant review" unit="days" />
          {!fact('reviewDays') && facts !== null && <p className="dim small">The specification doesn’t give a review period: this is an assumption.</p>}
          <Row k="resubmitRounds" label="Resubmissions" unit="rounds" />
          <Row k="resubmitReviewDays" label="Re-review" unit="days" />
          <h4>Site and finish</h4>
          <Row k="mobilizeDays" label="Mobilization" unit="days" />
          <Row k="testingDays" label="Testing per trade" unit="days" />
          <Row k="commissioningDays" label="Commissioning" unit="days" />
          <Row k="closeoutDays" label="Closeout" unit="days" />
          <Row k="floorToFloor" label="Floor to floor" unit={metric ? 'm' : 'ft'} rebuild />
          <label className="bld-field check">
            <input type="checkbox" checked={val<boolean>('levelsInParallel', false)} onChange={(e) => set('levelsInParallel', e.target.checked)} />
            <span>A trade may work on more than one level at a time</span>
          </label>
        </div>
      )}
      {tab === 'trades' && (
        <div className="bld-form">
          <p className="dim small">Production per crew per day, crews on site and lead time after approval. Typical values until you set them.</p>
          {!setup && <p className="dim">Build once to see the trades this project has.</p>}
          {setup &&
            TRADES.filter((t) => setup.trades[t.key])
              .filter((t) => props.tradeKeys.includes(t.key))
              .map((t) => {
                const cur = setup.trades[t.key].value;
                const mine = ed.trades?.[t.key] ?? {};
                const setT = (v: Partial<typeof cur>) => onEdit({ ...edits, setup: { ...ed, trades: { ...(ed.trades ?? {}), [t.key]: { ...mine, ...v } } } });
                return (
                  <div key={t.key} className="bld-trade">
                    <b>
                      <i style={{ background: t.colour }} /> {t.name} <Badge basis={setup.trades[t.key].basis} />
                    </b>
                    <div>
                      {Object.entries(cur.rates).map(([u, r]) => (
                        <label key={u}>
                          <input type="number" min={0} value={mine.rates?.[u] ?? r} onChange={(e) => setT({ rates: { ...(mine.rates ?? {}), [u]: Number(e.target.value) } })} /> {u}/day
                        </label>
                      ))}
                      <label>
                        <input type="number" min={1} value={mine.crews ?? cur.crews} onChange={(e) => setT({ crews: Math.max(1, Number(e.target.value)) })} /> crews
                      </label>
                      <label>
                        <input type="number" min={0} value={mine.leadDays ?? cur.leadDays} onChange={(e) => setT({ leadDays: Number(e.target.value) })} /> days lead
                      </label>
                    </div>
                  </div>
                );
              })}
        </div>
      )}
      {tab === 'levels' && (
        <div className="bld-form">
          <p className="dim small">Each measured plan sheet’s level, from its title or title block. Set the ones that aren’t known, or fix any that are wrong.</p>
          {props.levels.map((l) => (
            <label key={l.id} className="bld-field">
              <span>{l.name}</span>
              <input type="number" step={0.1} value={edits.elevations?.[l.id] ?? Math.round(l.elevation * 100) / 100} onChange={(e) => onEdit({ ...edits, elevations: { ...(edits.elevations ?? {}), [l.id]: Number(e.target.value) } }, true)} />
              <em>m elevation</em>
            </label>
          ))}
          <h4>Sheets</h4>
          {project.sheets
            .filter((s) => !s.superseded && project.measurements.some((m) => m.sheetId === s.id) && isPlan(s))
            .map((s) => (
              <label key={s.id} className={`bld-field ${props.unplacedSheets.includes(s.id) ? 'warn' : ''}`}>
                <span title={s.title}>
                  {s.name} {s.title ? `· ${s.title}` : ''}
                </span>
                <select
                  value={edits.levels?.[s.id] ?? ''}
                  onChange={(e) => {
                    const lv = { ...(edits.levels ?? {}) };
                    if (e.target.value) lv[s.id] = e.target.value;
                    else delete lv[s.id];
                    onEdit({ ...edits, levels: lv }, true);
                  }}
                >
                  <option value="">Auto</option>
                  {['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'roof'].map((id) => (
                    <option key={id} value={id}>
                      {id === 'roof' ? 'Roof' : `Level ${id.slice(1)}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}
      <div className="bld-go">
        <button className="primary big" disabled={!ready || !!busy || !project.measurements.length} onClick={onBuild}>
          {busy ?? (!ready ? 'Reading the documents…' : built ? 'Rebuild' : 'Build it')}
        </button>
      </div>
    </aside>
  );
}

function ActivityCard(props: {
  a: Activity;
  t: { start: string; finish: string; float: number; critical: boolean; late: boolean; driver: string | null } | undefined;
  acts: Activity[];
  edits: BuildEdits;
  elements: BuildElement[];
  onEdit: (e: BuildEdits) => void;
  onPick: (id: string) => void;
  onSection: (key: string) => void;
  secLabel: (key: string) => string;
  onSource: (s: SourceRef) => void;
}) {
  const { a, t, acts, edits, onEdit, onPick, onSection, secLabel, onSource, elements } = props;
  const mine = edits.activities?.[a.id] ?? {};
  const setA = (v: Partial<typeof mine> | null) => {
    const all = { ...(edits.activities ?? {}) };
    if (v === null) delete all[a.id];
    else all[a.id] = { ...mine, ...v };
    onEdit({ ...edits, activities: all });
  };
  const name = (id: string) => acts.find((x) => x.id === id)?.name ?? id;
  const [adding, setAdding] = useState('');
  const issues = [...new Set(elements.flatMap((e) => e.issues))];
  return (
    <div className="bld-card">
      <span className={`bld-kind ${a.kind}`} style={a.trade ? { borderColor: tradeByKey.get(a.trade)?.colour } : undefined}>
        {KIND_LABEL[a.kind]}
      </span>
      <h3>{a.name}</h3>
      {t && (
        <p className="bld-big">
          {fmt(t.start)} → {fmt(t.finish)}
          <span>
            {' '}
            · {a.duration} day{a.duration === 1 ? '' : 's'}
          </span>
        </p>
      )}
      {t && (
        <p className="bld-flags">
          {t.critical && <span className="crit">Critical</span>}
          {t.late && <span className="late">Can’t make the target</span>}
          {!t.critical && <span>{t.float} days float</span>}
        </p>
      )}
      <h4>
        Duration <Badge basis={a.durationBasis} />
      </h4>
      <p>{a.durationWhy}</p>
      <div className="bld-edit">
        <label>
          Days <input type="number" min={0} value={mine.duration ?? a.duration} onChange={(e) => setA({ duration: Number(e.target.value) })} />
        </label>
        {a.kind === 'work' && (
          <label>
            Crews <input type="number" min={1} value={mine.crews ?? a.crews ?? 1} onChange={(e) => setA({ crews: Math.max(1, Number(e.target.value)) })} />
          </label>
        )}
        {a.edited && (
          <button className="link-button" onClick={() => setA(null)}>
            Undo my changes
          </button>
        )}
      </div>
      <h4>Waits for</h4>
      <ul className="bld-deps">
        {a.deps.map((d) => (
          <li key={d.from} className={t?.driver === d.from ? 'driver' : ''}>
            <button className="link-button" onClick={() => onPick(d.from)}>
              {name(d.from)}
            </button>
            {d.lag ? <em> +{d.lag}d</em> : null}
            <span className="dim"> · {d.why}</span>
            {t?.driver === d.from && <span className="tag">sets the start</span>}
            <button className="bld-x" title="Remove this link" onClick={() => setA({ dropDeps: [...(mine.dropDeps ?? []), d.from], addDeps: (mine.addDeps ?? []).filter((x) => x.from !== d.from) })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="bld-edit">
        <select value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add a predecessor…</option>
          {acts
            .filter((x) => x.id !== a.id && !a.deps.some((d) => d.from === x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
        <button
          disabled={!adding}
          onClick={() => {
            setA({ addDeps: [...(mine.addDeps ?? []), { from: adding }], dropDeps: (mine.dropDeps ?? []).filter((x) => x !== adding) });
            setAdding('');
          }}
        >
          Add
        </button>
      </div>
      {a.quantities && (
        <>
          <h4>Builds</h4>
          <p>
            {elements.length} element{elements.length === 1 ? '' : 's'} · {Object.entries(a.quantities).map(([u, q]) => `${Math.round(q).toLocaleString()} ${u}`).join(' + ')}
          </p>
        </>
      )}
      {a.specs.length > 0 && (
        <>
          <h4>Specification</h4>
          <div className="bld-chips2">
            {a.specs.slice(0, 12).map((k) => (
              <button key={k} onClick={() => onSection(k)}>
                {secLabel(k)}
              </button>
            ))}
          </div>
        </>
      )}
      {a.sources.length > 0 && (
        <>
          <h4>Read from</h4>
          {a.sources.map((s, i) => (
            <button key={i} className="link-button block" onClick={() => onSource(s)} title={s.quote}>
              {s.label} · page {s.page}
              {s.quote ? `: “${s.quote.slice(0, 90)}…”` : ''}
            </button>
          ))}
        </>
      )}
      {issues.length > 0 && (
        <>
          <h4>Unresolved</h4>
          <ul className="bld-warn">
            {issues.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ElementCard(props: { e: BuildElement; act?: Activity; state: ElementState; onPickAct: (id: string) => void; onSection: (k: string) => void; secLabel: (k: string) => string; onSource: (s: SourceRef) => void; missing: (k: string) => boolean }) {
  const { e, act, state, onPickAct, onSection, secLabel, onSource, missing } = props;
  const STATE: Record<ElementState, string> = { todo: 'Not started', doing: 'Being built', done: 'Built', existing: 'Existing, to be demolished', removing: 'Being demolished', gone: 'Demolished' };
  return (
    <div className="bld-card">
      <span className="bld-kind" style={{ borderColor: tradeByKey.get(e.trade)?.colour }}>
        {tradeByKey.get(e.trade)?.name}
      </span>
      <h3>{e.name}</h3>
      <p className="bld-big">
        {Math.round(e.quantity * 10) / 10} {e.unit}
        <span> · {STATE[state]}</span>
      </p>
      <h4>Takeoff</h4>
      <p>
        {e.typeName}
        {e.division ? ` · ${e.division}` : ''}
      </p>
      <h4>Measured on</h4>
      {e.sources.map((s, i) => (
        <button key={i} className="link-button block" onClick={() => onSource(s)}>
          {s.label} (page {s.page}) →
        </button>
      ))}
      <h4>
        Place <Badge basis={e.placement} />
      </h4>
      <p className="dim">{e.placement === 'inferred' ? 'From its place on the plan; its level from the sheet.' : 'Not placed in the model.'}</p>
      {e.specs.length > 0 && (
        <>
          <h4>Specification</h4>
          <div className="bld-chips2">
            {e.specs.map((s) => (
              <button key={s.key} onClick={() => onSection(s.key)} className={missing(s.key) ? 'missing' : ''}>
                {secLabel(s.key)}
                {missing(s.key) ? ' · not issued' : ''}
              </button>
            ))}
          </div>
        </>
      )}
      {act && (
        <>
          <h4>Built by</h4>
          <button className="link-button block" onClick={() => onPickAct(act.id)}>
            {act.name} →
          </button>
        </>
      )}
      {e.issues.length > 0 && (
        <>
          <h4>Unresolved</h4>
          <ul className="bld-warn">
            {e.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Gantt(props: {
  groups: { title: string; items: Activity[] }[];
  times: Record<string, { es: number; ef: number; critical: boolean; late: boolean; start: string; finish: string }>;
  end: number;
  zoom: number;
  day: number;
  target: number | null;
  cal: Calendar;
  selected: string | null;
  onPick: (id: string) => void;
  onDay: (d: number) => void;
}) {
  const { groups, times, end, zoom, day, target, cal, selected, onPick, onDay } = props;
  const width = Math.max(600, (Math.max(end, target ?? 0) + 10) * zoom);
  const scroller = useRef<HTMLDivElement>(null);
  // Month ticks along the top.
  const ticks: { x: number; label: string }[] = [];
  let lastMonth = '';
  for (let i = 0; i <= Math.max(end, target ?? 0) + 10; i++) {
    const d = cal.date(i);
    const m = d.slice(0, 7);
    if (m !== lastMonth) {
      if (!ticks.length || i * zoom - ticks[ticks.length - 1].x > 46) ticks.push({ x: i * zoom, label: new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }) });
      lastMonth = m;
    }
  }
  const scrub = (ev: React.PointerEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const go = (x: number) => onDay(Math.max(0, Math.min(end, Math.round((x - r.left) / zoom))));
    go(ev.clientX);
    const move = (e: PointerEvent) => go(e.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    if (!selected || !scroller.current) return;
    // Into view vertically only (scrollIntoView would also move the panes around it).
    const box = scroller.current;
    const row = box.querySelector(`[data-act="${CSS.escape(selected)}"]`) as HTMLElement | null;
    if (!row) return;
    const top = row.offsetTop;
    if (top < box.scrollTop + 24 || top > box.scrollTop + box.clientHeight - 24) box.scrollTop = top - box.clientHeight / 2;
  }, [selected]);
  return (
    <div className="bld-gantt" ref={scroller}>
      <div className="bld-g-inner">
      <div className="bld-g-head">
        <div className="bld-g-name">Activity</div>
        <div className="bld-g-scale" style={{ width }} onPointerDown={scrub}>
          {ticks.map((t) => (
            <span key={t.x} style={{ left: t.x }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.title} className="bld-g-group">
          <div className="bld-g-title">{g.title}</div>
          {g.items.map((a) => {
            const t = times[a.id];
            if (!t) return null;
            const colour = a.trade ? tradeByKey.get(a.trade)?.colour : '#aab4d8';
            return (
              <div key={a.id} data-act={a.id} className={`bld-g-row ${selected === a.id ? 'sel' : ''}`} onClick={() => onPick(a.id)}>
                <div className="bld-g-name" title={a.name}>
                  {a.name}
                </div>
                <div className="bld-g-track" style={{ width }}>
                  {a.duration === 0 ? (
                    <i className={`bld-g-ms ${t.late ? 'late' : ''}`} style={{ left: t.es * zoom - 6 }} title={`${a.name} · ${t.start}`} />
                  ) : (
                    <i
                      className={`bld-g-bar ${a.kind} ${t.critical ? 'crit' : ''} ${t.late ? 'late' : ''}`}
                      style={{ left: t.es * zoom, width: Math.max(2, (t.ef - t.es) * zoom), background: colour }}
                      title={`${a.name} · ${t.start} → ${t.finish} · ${a.duration} days`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="bld-g-cursor" style={{ left: `calc(var(--g-name) + ${day * zoom}px)` }} />
      {target !== null && <div className="bld-g-target" style={{ left: `calc(var(--g-name) + ${target * zoom}px)` }} title="Target" />}
      </div>
    </div>
  );
}
