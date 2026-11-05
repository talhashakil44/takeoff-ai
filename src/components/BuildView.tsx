import type { DrawingLines } from '../build/roof';
import './BuildView.css';
import type { DrawingTexts } from '../build/building';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBuild, runBuild, runReplan, saveBuild } from '../build/client';
import { Calendar } from '../build/cpm';
import { isPlan, sourceHashOf, titleBlockWords, TRADES, tradeByKey } from '../build/extract';
import { readSpecFacts } from '../build/facts';
import { loadDrawingSources, type RevisionAccess, type RevisionSheet } from '../build/sources';
import { type BuildOutput } from '../build/run';
import type { Activity, Assumption, Basis, BuildEdits, BuildElement, Feasibility, Issue, PlanSetup, ScopeAllowance, ScopeSuggestion, SourceRef, SpecFact } from '../build/types';
import type { Project } from '../model';
import type { Place } from '../graph/graph';
import type { SpecSection } from '../spec/parse';
import { BuildScene, GLASS, type ElementState, type ViewCommand } from './BuildScene';
import { ElementProperties, GroupProperties, ModelTree, QuantitySchedule, type TreeSel } from './BuildPanels';
import { Icon } from './Icons';
import { ModelScene } from './ModelScene';
import { Explorer, phaseOfTrade, type ExplorerSchedule } from './Explorer';
import { dayOf } from '../scene3d/sequence';
import { AiModelPanel, type AgentRun } from './AiModelPanel';
import { desktopApi, type AgentKey } from '../desktop';
import { tradeOf, type Element3D } from '../scene3d/scene';
import type { ElementState as ModelState } from '../scene3d/render';
import { activeUserSchedule, elementTimes, isUserActivity, scheduleGroups, scheduleUser } from '../build/userSchedule';
import type { ScheduleEdits } from '../build/types';
import { ImportScheduleButton, PickBar, ScheduleSourcePicker, ScheduleTable, UserActivityCard } from './ScheduleTools';

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
  sheetText: (sheetId: string) => Promise<{ str: string; cx: number; cy: number; w?: number; h?: number; angle?: number }[]>;
  sheetLines?: (sheetId: string) => Promise<DrawingLines[string]>;
  /** Pages of the addendum files kept with the specifications, for drawing sheets they re-issue. */
  revisions?: RevisionAccess;
  onEdits: (edits: BuildEdits) => void;
  onOpenSpec: (docId: string, page: number, key: string) => void;
  onOpenDrawing: (places: Place[], label: string) => void;
  onSave: (name: string, data: Blob) => void;
  /** A region of a sheet as an image (with its takeoffs drawn): the drawing blow-ups. */
  renderSheet: (sheetId: string, box: [number, number, number, number], scale: number) => Promise<string>;
  onClose: () => void;
  /** Opens the sample project (a finished AI model, with a tour). */
  onOpenSample?: () => void;
}

const BASIS_LABEL: Record<Basis, string> = { documented: 'Documented', inferred: 'Inferred', assumed: 'Assumption', unknown: 'Unknown' };
const KIND_LABEL: Record<Activity['kind'], string> = { milestone: 'Milestone', mobilize: 'Site', submittal: 'Submittal', review: 'Review', resubmittal: 'Resubmittal', procurement: 'Procurement', work: 'Work', testing: 'Testing', commissioning: 'Commissioning', closeout: 'Closeout' };
/** Today on this computer's calendar (not UTC's: in the evening in Toronto UTC is already tomorrow). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/**
 * A number box for setup: typing is free (an empty box, a half-typed decimal), and the value is
 * applied when it reads as a number; it follows the plan's value again once the box is left.
 */
function NumberField({ value, min, step, onCommit }: { value: number; min?: number; step?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={min}
      step={step ?? 1}
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min)) onCommit(v);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** Where the playback is, in weeks (a job under four months) or months: "Week 6 of 14", "Month 3 of 10". */
const spanLabel = (day: number, total: number) =>
  total <= 85 ? `Week ${Math.max(1, Math.ceil(day / 5))} of ${Math.ceil(total / 5)}` : `Month ${Math.max(1, Math.ceil(day / 21.7))} of ${Math.ceil(total / 21.7)}`;
const fmt = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function Badge({ basis }: { basis: Basis }) {
  return <span className={`bld-badge ${basis}`}>{BASIS_LABEL[basis]}</span>;
}

export default function BuildView({ project, sections, specText, sheetText, sheetLines, revisions, onEdits, onOpenSpec, onOpenDrawing, onSave, renderSheet, onClose, onOpenSample }: Props) {
  const edits = useMemo(() => project.build ?? {}, [project.build]);
  const [out, setOut] = useState<BuildOutput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<SpecFact[] | null>(null);
  const [drawingTexts, setDrawingTexts] = useState<DrawingTexts>({});
  const [drawingLines, setDrawingLines] = useState<DrawingLines>({});
  const [revisionSheets, setRevisionSheets] = useState<RevisionSheet[]>([]);
  const [hints, setHints] = useState<Record<string, string> | null>(null);
  // With an AI model, the 4D explorer fills the view; the browser opens from the header.
  const [setupOpen, setSetupOpen] = useState(() => !project.scene3d?.elements.length);
  const [sideW, setSideW] = useState(() => {
    try {
      return Math.min(720, Math.max(240, Number(localStorage.getItem('takeoff.buildSideW')) || 320));
    } catch {
      return 320;
    }
  });
  /** Drags the side panel's edge to make it wider or narrower. */
  const dragSide = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = sideW;
    let w = w0;
    const move = (ev: PointerEvent) => {
      w = Math.min(Math.max(240, w0 + ev.clientX - x0), Math.min(720, window.innerWidth * 0.6));
      setSideW(w);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem('takeoff.buildSideW', String(Math.round(w)));
      } catch {
        /* not kept: fine */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issueFilter,setIssueFilter] = useState<'all'|'conflict'|'warning'>('all');
  const [sel, setSel] = useState<{ kind: 'element' | 'activity'; id: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  // Working days a second: a month (21 working days) by default.
  const [speed, setSpeed] = useState(21);
  const [ghosts, setGhosts] = useState(true);
  const [left, setLeft] = useState<'model' | 'setup'>('setup');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isolate, setIsolate] = useState<Set<string> | null>(null);
  const [explode, setExplode] = useState(0);
  const [explodeSystems, setExplodeSystems] = useState(false);
  const [cut, setCut] = useState<number | null>(null);
  const [colourMode, setColourMode] = useState<'material' | 'system' | 'status' | 'level' | 'spec' | 'quality'>('material');
  const [view, setView] = useState<ViewCommand | null>(null);
  const [treeSel, setTreeSel] = useState<TreeSel | null>(null);
  // A new pick starts at the top of the inspector, not where the last one was scrolled to.
  const inspectRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (inspectRef.current) inspectRef.current.scrollTop = 0;
  }, [sel?.kind, sel?.id, treeSel?.key]);
  const [workspace, setWorkspace] = useState<'model' | 'sequence'>('model');
  // The 3D: the building as drawn (walls read from the plans, slabs, roof, glazing), or the takeoff's measured elements.
  const [view3d, setView3d] = useState<'model' | 'building' | 'takeoff'>(project.scene3d?.elements.length ? 'model' : 'building');
  // Build 3D with AI: a coding agent on the user's own plan builds project.scene3d through the app's tools.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRun, setAiRun] = useState<AgentRun>({ agent: null, running: false, log: [] });
  useEffect(() => {
    const api = desktopApi?.agent;
    if (!api) return;
    void api.running().then((a) => a && setAiRun((r) => ({ ...r, agent: a, running: true })));
    return api.onEvent((ev) => setAiRun((r) => ({ ...r, running: ev.kind === 'done' ? false : r.running || ev.kind === 'start', log: [...r.log.slice(-400), ev] })));
  }, []);
  const startAi = (agent: AgentKey) => {
    setAiRun({ agent, running: true, log: [] });
    setView3d('model');
    void desktopApi?.agent?.start({ agent, projectName: project.name }).catch((e: unknown) => {
      const text = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
      setAiRun((r) => ({ ...r, running: false, log: [...r.log, { kind: 'error', text }, { kind: 'done', text: 'Not started.', ok: false }] }));
    });
  };
  const scene3d = project.scene3d?.elements.length || aiRun.running ? project.scene3d ?? { version: 1 as const, title: project.name, origin: '', builtBy: 'AI', updated: '', elements: [] } : null;
  const showAiModel = view3d === 'model' && !!scene3d;
  // The AI model in the 4D explorer (the default), or the classic model view with Build It's Gantt.
  const [explorer, setExplorerOn] = useState(() => {
    try {
      return localStorage.getItem('takeoff.explorer') !== 'off';
    } catch {
      return true;
    }
  });
  const setExplorer = (on: boolean) => {
    setExplorerOn(on);
    try {
      localStorage.setItem('takeoff.explorer', on ? 'on' : 'off');
    } catch {
      /* not kept: fine */
    }
  };
  const showExplorer = showAiModel && explorer;
  // The sample project opens on the guided help tour, once; the Help button brings it back.
  const [tourOn, setTourOn] = useState(() => {
    if (!project.sample) return false;
    try {
      return localStorage.getItem('takeoff.tour3d') !== 'done';
    } catch {
      return true;
    }
  });
  const endTour = () => {
    setTourOn(false);
    try {
      localStorage.setItem('takeoff.tour3d', 'done');
    } catch {
      // the tour shows again next time
    }
  };
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [bottom, setBottom] = useState<'schedule' | 'activities' | 'quantities'>('schedule');
  const go = (kind: ViewCommand['kind']) => setView({ kind, n: Date.now() });
  const [zoom, setZoom] = useState(9);

  // The last build of this project, from this computer.
  const [cached, setCached] = useState<'looking' | 'found' | 'none'>('looking');
  useEffect(() => {
    let gone = false;
    setCached('looking');
    void loadBuild(project.id ?? '').then((b) => {
      if (gone) return;
      setCached(b ? 'found' : 'none');
      if (b && !out) {
        setOut(b.output);
        setLeft('model');
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
  // The drawing evidence the model reads (sheet text, elevation linework): only the sheets it
  // uses, a few at a time, kept on this computer so the next opening is quick.
  const [reading, setReading] = useState<{ done: number; of: number } | null>(null);
  useEffect(() => {
    let gone = false;
    void (async () => {
      const src = await loadDrawingSources({
        project,
        sheetText,
        sheetLines,
        revisions,
        titleWords: titleBlockWords,
        progress: (done, of) => !gone && setReading(done < of ? { done, of } : null),
        cancelled: () => gone,
      });
      if (!gone) {
        setHints(src.hints);
        setDrawingTexts(src.texts);
        setDrawingLines(src.lines);
        setRevisionSheets(src.revisions);
        setReading(null);
      }
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.sheets, measured.join(','), sheetText, sheetLines]);
  const ready = facts !== null && hints !== null;

  const requestVersion = useRef(0);
  useEffect(() => () => { requestVersion.current++; }, []);
  const build = async (withEdits: BuildEdits = edits) => {
    if (!facts || !hints) return;
    const request = ++requestVersion.current;
    setBusy('Building the model and the plan…');
    setError(null);
    try {
      const o = await runBuild({ project, sections, facts, drawingTexts, drawingLines, levelHints: hints, edits: withEdits, today: today() });
      if (request !== requestVersion.current) return;
      setOut(o);
      if (project.id) void saveBuild(project.id, o);
      setLeft('model');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestVersion.current) setBusy(null);
    }
  };

  // A project built before (its setup saved with it) but not on this computer, opened from a
  // file or another computer: built again here straight away, from the same setup.
  const autoBuilt = useRef(false);
  const openedBuilt = useRef<{ id: string | undefined; had: boolean }>({ id: project.id, had: !!project.build });
  if (openedBuilt.current.id !== project.id) openedBuilt.current = { id: project.id, had: !!project.build };
  useEffect(() => {
    if (autoBuilt.current || out || busy || !ready || cached !== 'none' || !openedBuilt.current.had || !project.measurements.length) return;
    autoBuilt.current = true;
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cached, out, project.build]);

  // Stale: the drawings, takeoff or spec changed since this was built.
  const currentHash = useMemo(() => {
    if (!out) return null;
    const ftf = out.setup.floorToFloor.value;
    return sourceHashOf({ project, sections, drawingTexts, drawingLines, levelHints: hints ?? undefined, edits, floorToFloor: project.units === 'imperial' ? ftf * 0.3048 : ftf });
  }, [project, sections, hints, drawingTexts, drawingLines, edits, out]);
  const stale = !!out && !!currentHash && hints !== null && currentHash !== out.model.sourceHash;

  // Edits: setup values and activity changes replan at once (the model unchanged); levels and heights rebuild it.
  const edit = (next: BuildEdits, rebuild = false) => {
    onEdits(next);
    if (!out) return;
    if (rebuild) return void build(next);
    const setup = applyEditsToSetup(out.setup, next);
    const request=++requestVersion.current;
    setBusy('Updating construction plan…');
    setError(null);
    void runReplan(out,setup,{sections,facts:facts??[],edits:next}).then(o=>{
      if(request!==requestVersion.current)return;
      setOut(o);
      if(project.id)void saveBuild(project.id,o);
    }).catch(e=>{if(request===requestVersion.current)setError(e instanceof Error?e.message:String(e));})
      .finally(()=>{if(request===requestVersion.current)setBusy(null);});
  };

  // The schedule the timeline plays: the generated plan, or one the user imported or built.
  const userSched = activeUserSchedule(edits.schedules);
  const userView = useMemo(() => (userSched && out ? scheduleUser(userSched, out.setup) : null), [userSched, out]);
  const setSchedules = (next: ScheduleEdits) => onEdits({ ...edits, schedules: next });
  const [scheduleNote, setScheduleNote] = useState<string | null>(null);
  // Selecting elements on the model to link to an activity of the user's schedule.
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useState<Set<string>>(new Set());

  const model = out?.model ?? null;
  const schedule = userView?.schedule ?? out?.schedule ?? null;
  const setup = userView?.setup ?? out?.setup ?? null;
  const acts = schedule?.activities ?? [];
  const times = schedule?.times ?? {};
  const actById = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts]);
  const elById = useMemo(() => new Map([...(model?.elements ?? []), ...(model?.drawingGeometry ?? []), ...(model?.planWalls ?? [])].map((e) => [e.id, e])), [model]);
  const actOfElement = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of acts) for (const id of a.elements) m.set(id, a.id);
    return m;
  }, [acts]);
  const end = useMemo(() => Math.max(1, ...Object.values(times).map((t) => t.ef)), [times]);
  const cal = useMemo(() => (setup ? new Calendar(setup.start.value, setup.workDays.value, setup.holidays.value) : null), [setup]);
  const targetIdx = useMemo(() => (cal && setup?.target.value ? cal.workingDaysTo(setup.target.value) : null), [cal, setup]);
  const userTimeOf = useMemo(() => (userView ? elementTimes(acts, times) : null), [userView, acts, times]);
  const userActOf = (id: string | undefined) => (id && isUserActivity(id) ? userSched?.activities.find((a) => a.id === id) : undefined);
  const linkPicks = (id: string) => {
    if (!userSched || !picks.size) return;
    const key = edits.schedules!.use as 'imported' | 'own';
    setSchedules({ ...edits.schedules!, [key]: { ...userSched, activities: userSched.activities.map((a) => (a.id === id ? { ...a, elements: [...new Set([...a.elements, ...picks])], linked: 'picked' as const } : a)) } });
    setPicks(new Set());
  };
  const startPicking = (on: boolean) => {
    setPicking(on);
    if (!on) setPicks(new Set());
    // The AI's model can't be picked from: the takeoff's elements can.
    else if (view3d === 'model' && model) setView3d('takeoff');
  };

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
  // Walls read from the plans and the building's slabs and roof have no takeoff of their own:
  // they go up with their trade's work on their level.
  const contextTime = (e: BuildElement) => {
    const roof = /roof/i.test(e.name) && e.shape?.type === 'surface';
    const ids = roof
      ? ['work:envelope:roof-covering', 'work:envelope:roof', `work:envelope:${e.level}`]
      : e.shape?.type === 'surface'
        ? [`work:structure:${e.level}`]
        : [`work:${e.trade}:${e.level}`, `work:partitions:${e.level}`, `work:envelope:${e.level}`, `work:structure:${e.level}`];
    for (const id of ids) if (times[id]) return times[id];
    return undefined;
  };
  const stateOf = (e: BuildElement): ElementState => {
    if (workspace === 'model') return e.status === 'demolished' ? 'gone' : 'done';
    if (e.status === 'existing') return 'existing';
    const t = userTimeOf ? userTimeOf(e) : times[actOfElement.get(e.id) ?? ''] ?? (e.origin === 'drawing' || e.origin === 'building' ? contextTime(e) : undefined);
    // In the user's schedule, measured work it doesn't cover stays a ghost: nothing builds it yet.
    if (!t) return userTimeOf && e.origin !== 'drawing' && e.origin !== 'building' ? 'todo' : 'done';
    const demo = e.trade === 'demolition';
    if (dayInt < t.es) return demo ? 'existing' : 'todo';
    if (dayInt < t.ef) return demo ? 'removing' : 'doing';
    return demo ? 'gone' : 'done';
  };
  const stateKey = `${workspace}|${view3d}|${colourMode}|${dayInt}|${Object.keys(times).length}|${acts.map((a) => times[a.id]?.es).join(',')}`;

  // The AI's model in the construction sequence: each element goes up with its trade's work on its level.
  const stateOf3d = useMemo(() => {
    if (!out || workspace !== 'sequence') return null;
    const span = new Map<string, { es: number; ef: number }>();
    const add = (k: string, t: { es: number; ef: number }) => {
      const o = span.get(k);
      span.set(k, o ? { es: Math.min(o.es, t.es), ef: Math.max(o.ef, t.ef) } : { es: t.es, ef: t.ef });
    };
    for (const a of acts) {
      const t = times[a.id];
      if (!t || a.kind !== 'work' || !a.trade) continue;
      add(a.trade, t);
      if (a.level) add(`${a.trade}|${a.level}`, t);
    }
    const lv = out.model.levels;
    const levelId = (name: string) => {
      const n = name.toLowerCase().trim();
      if (!n) return null;
      return lv.find((l) => l.name.toLowerCase() === n || l.id.toLowerCase() === n)?.id ?? lv.find((l) => l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase()))?.id ?? null;
    };
    return (e: Element3D): ModelState => {
      if (e.category === 'context') return 'done';
      const tr = tradeOf(e);
      const l = e.category === 'foundation' ? 'fdn' : levelId(e.level);
      const t = (l && span.get(`${tr}|${l}`)) || span.get(tr) || (tr === 'partitions' ? span.get('structure') : undefined);
      if (!t) return 'done';
      return dayInt < t.es ? 'todo' : dayInt < t.ef ? 'doing' : 'done';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out, workspace, acts, times, dayInt]);

  // The explorer plays Build It's schedule (generated, imported or own) on calendar days, each AI
  // model element on its trade's work on its level; with no plan it works one out from the model.
  const explorerSchedule = useMemo<ExplorerSchedule | null>(() => {
    if (!out || !cal || !acts.length) return null;
    const start = cal.date(0);
    const at = (i: number) => dayOf(start, cal.date(Math.max(0, i)));
    const shown = acts.filter((a) => times[a.id] && (['work', 'milestone', 'mobilize', 'testing', 'commissioning', 'closeout'].includes(a.kind)));
    if (!shown.some((a) => a.kind === 'work')) return null;
    const first = new Map<string, string>();
    for (const a of [...shown].sort((x, y) => times[x.id].es - times[y.id].es)) {
      if (a.kind !== 'work' || !a.trade) continue;
      if (a.level && !first.has(`${a.trade}|${a.level}`)) first.set(`${a.trade}|${a.level}`, a.id);
      if (!first.has(a.trade)) first.set(a.trade, a.id);
    }
    const lv = out.model.levels;
    const levelId = (name: string) => {
      const n = name.toLowerCase().trim();
      if (!n) return null;
      return lv.find((l) => l.name.toLowerCase() === n || l.id.toLowerCase() === n)?.id ?? lv.find((l) => l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase()))?.id ?? null;
    };
    return {
      start,
      source: userView ? (edits.schedules?.use === 'own' ? 'own' : 'imported') : 'generated',
      activities: shown.map((a) => {
        const t = times[a.id];
        const s0 = at(t.es);
        return { id: a.id, name: a.name, phase: phaseOfTrade(a.trade, a.kind), s: s0, e: a.kind === 'milestone' ? s0 : Math.max(s0 + 1, at(t.ef)), milestone: a.kind === 'milestone', count: 0 };
      }),
      activityOf: (e: Element3D) => {
        const tr = tradeOf(e);
        const l = e.category === 'foundation' ? 'fdn' : levelId(e.level);
        return (l && first.get(`${tr}|${l}`)) || first.get(tr) || (tr === 'partitions' ? first.get('structure') ?? null : null);
      },
    };
  }, [out, cal, acts, times, userView, edits.schedules?.use]);

  const levels = model?.levels ?? [];
  const tradesUsed = useMemo(() => TRADES.filter((t) => model?.elements.some((e) => e.trade === t.key)), [model]);
  const highlight = useMemo(() => (picking ? picks : sel?.kind === 'activity' ? new Set(actById.get(sel.id)?.elements ?? []) : treeSel && !sel ? new Set(treeSel.ids) : null), [sel, actById, treeSel, picking, picks]);
  // Colour by a parameter, like a BIM viewer's filters.
  const LEVEL_COLOURS = ['#5b9cff', '#ff9f43', '#5be3b0', '#c58cff', '#ffd35b', '#ff5fa2', '#5bd6ff'];
  const specMissing = useMemo(() => new Set(sections.filter((s) => s.missing).map((s) => s.key)), [sections]);
  const colourOf = (e: BuildElement): string => {
    if (colourMode === 'material') {
      if (view3d === 'building') {
        if (/roof/i.test(e.name) && e.shape?.type === 'surface') return '#3f474f';
        if (e.opening || /window|glaz|curtain/i.test(e.name)) return GLASS;
        if (e.shape?.type === 'surface') return '#b9b2a6';
        if (/parapet/i.test(e.name)) return '#bfb4a3';
        if (e.trade === 'envelope') return '#cfc3ae';
        return '#e2ddd3';
      }
      if (/roof/i.test(e.name) && e.shape?.type === 'surface') return '#586674';
      if (/window|glaz|curtain/i.test(e.name)) return '#91b7c9';
      if (e.shape?.type === 'surface') return e.trade === 'ceilings' ? '#e4e5e0' : '#aeb5b9';
      if (e.trade.startsWith('mech')) return '#97b7be';
      if (e.trade.startsWith('fire')) return '#bb7270';
      if (e.trade.startsWith('elec')) return '#bca981';
      return e.shape?.type === 'run' ? '#d7d4cb' : '#a4b4bd';
    }
    if (colourMode === 'level') return LEVEL_COLOURS[Math.max(0, levels.findIndex((l) => l.id === e.level)) % LEVEL_COLOURS.length];
    if (colourMode === 'status') {
      const t = times[actOfElement.get(e.id) ?? ''];
      return t?.late ? '#ff5f57' : t?.critical ? '#ff9f43' : '#3ddc84';
    }
    if (colourMode === 'spec') return !e.specs.length ? '#ff5f57' : e.specs.some((s) => specMissing.has(s.key)) ? '#ffb340' : '#4da3ff';
    if (colourMode === 'quality') return e.issues.length ? '#ffb340' : e.placement === 'documented' ? '#3ddc84' : e.placement === 'inferred' ? '#4da3ff' : '#c58cff';
    return tradeByKey.get(e.trade)?.colour ?? '#b8c4ff';
  };
  const tradeOrder = useMemo(() => new Map(TRADES.map((t, i) => [t.key, i])), []);
  const LEGENDS: Record<typeof colourMode, [string, string][]> = {
    material: view3d === 'building' ? [['#cfc3ae','Exterior walls'],['#e2ddd3','Interior walls'],['#b9b2a6','Floors'],['#3f474f','Roof'],['#8fb3c7','Glazing']] : [['#d7d4cb','Walls'],['#aeb5b9','Slabs'],['#586674','Roof'],['#91b7c9','Glazing'],['#97b7be','Services']],
    system: tradesUsed.map((t) => [t.colour, t.name]),
    status: [['#3ddc84', 'Has float'], ['#ff9f43', 'Critical path'], ['#ff5f57', 'Can’t make the target']],
    level: levels.map((l, i) => [LEVEL_COLOURS[i % LEVEL_COLOURS.length], l.name]),
    spec: [['#4da3ff', 'Spec section linked'], ['#ffb340', 'Its section isn’t issued'], ['#ff5f57', 'No spec section']],
    quality: [['#3ddc84', 'Documented'], ['#4da3ff', 'Inferred geometry'], ['#ffb340', 'Needs review'], ['#c58cff', 'Assumed geometry']],
  };
  const topZ = Math.max(4, ...levels.map((l) => l.elevation + 4));

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
  const exportIfc = async () => {
    if (!out) return;
    const { toIfc } = await import('../build/ifc');
    const text = toIfc({ model: out.model, schedule: out.schedule, project, sections });
    onSave(`${project.name || 'Project'} - Build It.ifc`, new Blob([text], { type: 'application/x-step' }));
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
    if (userSched) return scheduleGroups(userSched, acts);
    const g: { title: string; items: Activity[] }[] = [];
    const pre = acts.filter((a) => ['milestone', 'mobilize', 'submittal', 'review', 'resubmittal', 'procurement'].includes(a.kind) && a.id !== 'ms:substantial' && a.id !== 'ms:finish');
    g.push({ title: 'Start, submittals and procurement', items: pre });
    for (const l of [...levels.map((l) => l.id), null]) {
      const items = acts.filter((a) => a.kind === 'work' && a.level === l);
      if (items.length) g.push({ title: l ? levels.find((x) => x.id === l)?.name ?? l : 'Level not known', items });
    }
    g.push({ title: 'Testing, commissioning and closeout', items: acts.filter((a) => ['testing', 'commissioning', 'closeout'].includes(a.kind) || a.id === 'ms:substantial' || a.id === 'ms:finish') });
    return g.filter((x) => x.items.length);
  }, [acts, levels, userSched]);

  // With the user's schedule shown, its start and finish markers have nothing to edit.
  const selAct = sel?.kind === 'activity' && (!userSched || isUserActivity(sel.id)) ? actById.get(sel.id) : undefined;
  const selEl = sel?.kind === 'element' ? elById.get(sel.id) : undefined;
  const hoverEl = hover ? elById.get(hover) : undefined;

  return (
    <div className={`bld bld-workspace bld-mode-${workspace}`} role="region" aria-label="Build It">
      <header className={`bld-bar${showExplorer ? ' bld-bar-hidden' : ''}`}>
        {(busy || reading) && <div className="bld-live-status" role="status">{busy ?? `Reading the drawings… ${reading!.done} of ${reading!.of} sheets`}</div>}
        {!busy && !reading && revisionSheets.some((r) => !r.superseded) && (
          <div className="bld-live-status" role="note">
            {(() => {
              const live = revisionSheets.filter((r) => !r.superseded);
              const issues = [...new Set(live.map((r) => r.issue))];
              const moved = live.filter((r) => r.revises && project.measurements.some((m) => m.sheetId === r.revises));
              const again = live.filter((r) => r.revises).map((r) => r.name);
              const added = live.filter((r) => !r.revises).map((r) => r.name);
              return `${issues.join(', ')} ${again.length ? `re-issued ${again.join(', ')}` : ''}${again.length && added.length ? ' and ' : ''}${added.length ? `added ${added.join(', ')}` : ''}.${moved.length ? ` Takeoffs on ${moved.map((r) => r.name).join(', ')} are on the earlier issue.` : ''}`;
            })()}
          </div>
        )}
        {error && <div className="bld-live-error" role="alert">{error}</div>}
        <div className="bld-title">
          <Icon name="walls" size={16} />
          <strong>Build it</strong>
          <span className="bld-sub">{project.name}</span>
        </div>
        {out && <nav className="bld-workspace-switch" aria-label="Workspace">
          <button aria-pressed={workspace === 'model'} onClick={() => { setWorkspace('model'); setPlaying(false); }}>Model</button>
          <button aria-pressed={workspace === 'sequence' && !showExplorer} onClick={() => { setWorkspace('sequence'); if (showExplorer) setExplorer(false); }}>Construction</button>
        </nav>}
        {out && feas && (
          <FeasibilityBadge feas={feas} start={(setup ?? out.setup).start} />
        )}
        {stale && (
          <button className="bld-stale" onClick={() => void build()} title="The drawings, takeoff or specification changed since this was built">
            Documents changed · Rebuild
          </button>
        )}
        <div className="bld-actions">
          {showAiModel && (
            <button aria-pressed={explorer} className={explorer ? 'on' : ''} onClick={() => setExplorer(!explorer)} title="The 4D explorer: the model on its site, built up to the date on the timeline">
              4D explorer
            </button>
          )}
          <button className={setupOpen ? 'on' : ''} onClick={() => setSetupOpen((o) => !o)} title="The model browser and the setup">
            Browser
          </button>
          <button className={issuesOpen ? 'on' : ''} onClick={() => setIssuesOpen((o) => !o)} disabled={!out}>
            Issues {allIssues.length ? <i className={allIssues.some((i) => i.severity === 'conflict') ? 'bad' : ''}>{allIssues.length}</i> : null}
          </button>
          <button aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(v => !v)} disabled={!out}>Inspector</button>
          <ImportScheduleButton
            model={model}
            setup={out?.setup ?? null}
            onError={setError}
            onImported={(s, note) => {
              setSchedules({ ...(edits.schedules ?? { use: 'imported' }), use: 'imported', imported: s });
              setScheduleNote(note);
              setWorkspace('sequence');
              setBottom('activities');
              setDay(0);
              setSel(null);
            }}
          />
          <details className="bld-export"><summary>Export</summary><div>
          <button onClick={() => void exportIfc()} disabled={!out || !!busy} title="IFC 4: opens in Revit, Archicad, Solibri, Navisworks, Bonsai — elements with their takeoff, materials, spec sections and the 4D schedule">
            Export IFC
          </button>
          <button onClick={exportPlan} disabled={!out || !!busy} title="The model, the assumptions and the schedule, as data">
            Export plan
          </button>
          <button onClick={exportCsv} disabled={!out || !!busy} title="The schedule as a spreadsheet">
            Schedule CSV
          </button>
          </div></details>
          <button className="bld-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="bld-main" style={{ ['--bld-side-w' as string]: `${sideW}px` }}>
        {setupOpen ? (
          <div className="bld-side-edge" role="separator" aria-orientation="vertical" aria-label="Drag to resize the side panel" onPointerDown={dragSide}>
            <button className="bld-side-hide" onClick={() => setSetupOpen(false)} onPointerDown={(e) => e.stopPropagation()} title="Hide the side panel" aria-label="Hide the side panel">
              ‹
            </button>
          </div>
        ) : (
          <button className="bld-side-show" onClick={() => setSetupOpen(true)} title="Show the side panel" aria-label="Show the side panel">
            ›
          </button>
        )}
        {setupOpen && out && (
          <div className="bld-left-tabs" role="tablist" aria-label="Side panel">
            {/* "Elements", not "Model": the header's Model/Construction switch already has that name (and "Browser" opens this panel). */}
            <button role="tab" aria-selected={left === 'model'} className={left === 'model' ? 'on' : ''} onClick={() => setLeft('model')}>
              Elements
            </button>
            <button role="tab" aria-selected={left === 'setup'} className={left === 'setup' ? 'on' : ''} onClick={() => setLeft('setup')}>
              Setup
            </button>
          </div>
        )}
        {setupOpen && out && left === 'model' && model && (
          <aside className="bld-left">
            {(model.drawingGeometry?.length ?? 0) > 0 && <details className="bld-tree" aria-label="Drawing-derived geometry">
              <summary><strong>From drawings · {model.drawingGeometry!.length}</strong></summary>
              <p className="dim small">Read from the drawings, not measured · excluded from quantities and schedule</p>
              {model.drawingGeometry!.slice(0, 300).map(e => <button key={e.id} className="bld-spec-title" onClick={() => {
                setInspectorOpen(true);
                setTreeSel(null);
                setSel({ kind: 'element', id: e.id });
              }}>{e.name}</button>)}
            </details>}
            <ModelTree
              model={model}
              hidden={hidden}
              onHidden={setHidden}
              picked={treeSel?.key ?? null}
              onPick={(t) => {
                setInspectorOpen(true);
                setSel(null);
                setTreeSel(t);
              }}
              onIsolate={(ids) => setIsolate(new Set(ids))}
            />
          </aside>
        )}
        {setupOpen && (!out || left === 'setup') && (
          <SetupPanel
            project={project}
            setup={out?.setup ?? null}
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
            suggestions={out?.scopeSuggestions ?? []}
            unplacedSheets={model ? [...new Set(model.elements.filter((e) => !e.level && e.issues.some((x) => /level/.test(x))).map((e) => e.sheetId))] : []}
          />
        )}

        <section className="bld-stage">
          {showExplorer && scene3d ? (
            <Explorer
              scene={scene3d}
              projectName={project.name}
              schedule={explorerSchedule}
              onSave={onSave}
              extra={
                <>
                  {model && (
                    <select value={view3d} onChange={(e) => setView3d(e.target.value as typeof view3d)} aria-label="Show" title="What the view shows">
                      <option value="model">AI model</option>
                      <option value="building">Building (beta)</option>
                      <option value="takeoff">Takeoff</option>
                    </select>
                  )}
                  <button data-tour="ai" onClick={() => setAiOpen(true)} title="Build or carry on the 3D model with Claude or ChatGPT">
                    {aiRun.running ? 'AI building…' : 'Build 3D with AI'}
                  </button>
                  <button onClick={() => setExplorer(false)} title="The classic Build it view, with the Gantt, Issues and Inspector">
                    Classic view
                  </button>
                  <button className="x4d-exit" onClick={onClose} aria-label="Close" title="Close Build it">
                    <Icon name="close" size={14} />
                  </button>
                </>
              }
            />
          ) : showAiModel && scene3d ? (
            <>
              <ModelScene scene={scene3d} stateOf={stateOf3d} stateKey={`${workspace}|${dayInt}`} tour={tourOn} onTourEnd={endTour} />
              <div className="bld-toolbar" role="toolbar" aria-label="View">
                <div className="bld-tg" role="group" aria-label="Show">
                  {scene3d && (
                    <button className={view3d === 'model' ? 'on' : ''} aria-pressed={view3d === 'model'} onClick={() => setView3d('model')} title="The 3D model an AI built from the drawings">
                      AI model
                    </button>
                  )}
                  {model && (
                    <>
                      <button onClick={() => setView3d('building')} title="The building as drawn: walls read from the floor plans, floors, roof and glazing (experimental)">
                        Building
                        <span className="beta">BETA</span>
                      </button>
                      <button onClick={() => setView3d('takeoff')} title="The takeoff's measured elements, placed in 3D">
                        Takeoff
                      </button>
                    </>
                  )}
                </div>
                <div className="bld-tg">
                  {project.sample && (
                    <button className={tourOn ? 'on' : ''} onClick={() => setTourOn(true)} title="How to use the model view">
                      Help
                    </button>
                  )}
                  <button data-tour="ai" className={aiRun.running ? 'on' : ''} onClick={() => setAiOpen(true)} title="Build or carry on the 3D model with Claude or ChatGPT">
                    {aiRun.running ? 'AI building…' : 'Build 3D with AI'}
                    <span className="beta">BETA</span>
                  </button>
                </div>
              </div>
              {out && workspace === 'sequence' && cal && (
                <div className="bld-day">
                  <b>{fmt(cal.date(dayInt))}</b>
                  <span>{spanLabel(dayInt + 1, end)}</span>
                </div>
              )}
            </>
          ) : model ? (
            <>
              <BuildScene
                model={model}
                mode={view3d === 'model' ? 'building' : view3d}
                stateOf={stateOf}
                stateKey={stateKey}
                colourOf={colourOf}
                selected={selEl?.id ?? null}
                highlight={highlight}
                isolate={isolate}
                hidden={hidden}
                showGhosts={ghosts}
                explode={explode}
                explodeSystems={explodeSystems}
                cut={cut}
                view={view}
                tradeOrder={tradeOrder}
                onSelect={(id) => {
                  // Selecting for a link: each click adds (or takes away) one element.
                  if (picking) {
                    if (id)
                      setPicks((p) => {
                        const n = new Set(p);
                        if (!n.delete(id)) n.add(id);
                        return n;
                      });
                    return;
                  }
                  if (id) setInspectorOpen(true);
                  setTreeSel(null);
                  setSel(id ? { kind: 'element', id } : null);
                }}
                onHover={setHover}
              />
              <div className={`bld-toolbar ${toolsOpen ? "expanded" : ""}`} role="toolbar" aria-label="View">
                <div className="bld-tg" role="group" aria-label="Show">
                  {scene3d && (
                    <button className={view3d === 'model' ? 'on' : ''} aria-pressed={view3d === 'model'} onClick={() => setView3d('model')} title="The 3D model an AI built from the drawings">
                      AI model
                    </button>
                  )}
                  <button className={view3d === 'building' ? 'on' : ''} aria-pressed={view3d === 'building'} onClick={() => setView3d('building')} title="The building as drawn: walls read from the floor plans, floors, roof and glazing (experimental)">
                    Building
                    <span className="beta">BETA</span>
                  </button>
                  <button className={view3d === 'takeoff' ? 'on' : ''} aria-pressed={view3d === 'takeoff'} onClick={() => setView3d('takeoff')} title="The takeoff's measured elements, placed in 3D">
                    Takeoff
                  </button>
                  <button className={aiRun.running ? 'on' : ''} onClick={() => setAiOpen(true)} title="Have Claude or ChatGPT build a detailed 3D model from the drawings">
                    {aiRun.running ? 'AI building…' : '3D with AI'}
                    <span className="beta">BETA</span>
                  </button>
                </div>
                <div className="bld-tg" role="group" aria-label="Views">
                  {(
                    [
                      ['iso', 'Iso'],
                      ['top', 'Top'],
                      ['front', 'Front'],
                      ['side', 'Side'],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} onClick={() => go(k)} title={`${l} view`}>
                      {l}
                    </button>
                  ))}
                  <button onClick={() => go('frame')} title="Zoom to the selection (or everything)">
                    <Icon name="fit" size={13} />
                  </button>
                </div>
                <button className="bld-tools-toggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen(v => !v)}>View tools</button>
                <label className="bld-tg slider bld-advanced" title="Pull the levels apart (and the systems, when ticked)">
                  <span>Explode</span>
                  <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
                  <input type="checkbox" checked={explodeSystems} onChange={(e) => setExplodeSystems(e.target.checked)} title="Systems too" />
                  <em>systems</em>
                </label>
                <label className="bld-tg slider bld-advanced" title="Section cut: hide everything above this height">
                  <span>Section</span>
                  <input type="range" min={0} max={topZ} step={0.05} value={cut ?? topZ} onChange={(e) => setCut(Number(e.target.value) >= topZ - 0.01 ? null : Number(e.target.value))} />
                  <em>{cut === null ? 'off' : `${(project.units === 'imperial' ? cut / 0.3048 : cut).toFixed(1)} ${project.units === 'imperial' ? 'ft' : 'm'}`}</em>
                </label>
                <label className="bld-tg bld-advanced">
                  <span>Colour by</span>
                  <select value={colourMode} onChange={(e) => setColourMode(e.target.value as typeof colourMode)}>
                    <option value="material">Materials</option>
                    <option value="system">System</option>
                    <option value="status">Schedule status</option>
                    <option value="level">Level</option>
                    <option value="spec">Spec coverage</option>
                    <option value="quality">Data quality</option>
                  </select>
                </label>
                <div className="bld-tg bld-advanced">
                  <button className={ghosts ? 'on' : ''} onClick={() => setGhosts(!ghosts)} title="Show what isn’t built yet, as a ghost">
                    Ghosts
                  </button>
                  {(isolate || hidden.size > 0) && (
                    <button
                      className="on warn"
                      onClick={() => {
                        setIsolate(null);
                        setHidden(new Set());
                      }}
                    >
                      Show all
                    </button>
                  )}
                </div>
              </div>
              <div className="bld-legend2">
                {LEGENDS[colourMode].slice(0, 12).map(([c, l]) => (
                  <span key={l}>
                    <i style={{ background: c }} /> {l}
                  </span>
                ))}
              </div>
              <div className="bld-day">
                <b>{workspace === 'model' ? 'Building model' : cal ? fmt(cal.date(dayInt)) : ''}</b>
                <span>
                  {workspace === 'model' ? `${model.elements.filter(e => e.shape).length.toLocaleString()} represented · ${model.elements.filter(e => !e.shape).length.toLocaleString()} unplaced` : `${spanLabel(dayInt + 1, end)} · ${progress}% of work packages complete`}
                </span>
              </div>
              {hoverEl && (
                <div className="bld-hover">
                  {hoverEl.name} · {Math.round(hoverEl.quantity).toLocaleString()} {hoverEl.unit}
                </div>
              )}
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
                {busy ?? (!ready ? (reading ? `Reading the drawings… ${reading.done} of ${reading.of}` : 'Reading the documents…') : 'Build it')}
              </button>
              {!project.measurements.length && <p className="dim">There is no takeoff yet: take off the drawings first.</p>}
              <p className="dim">
                Or have an AI build a detailed 3D model straight from the drawings:{' '}
                <button className="link-button" onClick={() => setAiOpen(true)}>
                  Build 3D with AI
                </button>
              </p>
              {error && <p className="bld-error">{error}</p>}
            </div>
          )}
          {picking && out && (
            <PickBar
              count={picks.size}
              target={userActOf(sel?.kind === 'activity' ? sel.id : undefined)}
              aiModel={showAiModel}
              onLink={() => sel && linkPicks(sel.id)}
              onClear={() => setPicks(new Set())}
              onDone={() => startPicking(false)}
              onShowElements={() => setView3d('takeoff')}
            />
          )}
          {aiOpen && (
            <AiModelPanel
              projectName={project.name}
              elements={project.scene3d?.elements.length ?? 0}
              run={aiRun}
              onStart={startAi}
              onStop={() => void desktopApi?.agent?.stop()}
              onClose={() => setAiOpen(false)}
              onOpenSample={project.sample ? undefined : onOpenSample}
            />
          )}
        </section>

        {out && inspectorOpen && (
          <aside className="bld-inspect" ref={inspectRef}>
            {selAct && userActOf(selAct.id) ? (
              <UserActivityCard
                a={userActOf(selAct.id)!}
                t={times[selAct.id]}
                schedules={edits.schedules}
                levels={levels}
                elements={selAct.elements.map((id) => elById.get(id)!).filter(Boolean)}
                picks={picks}
                picking={picking}
                model={model!}
                onPicking={startPicking}
                onLink={() => linkPicks(selAct.id)}
                onPick={(id) => setSel({ kind: 'activity', id })}
                onElement={(id) => setSel({ kind: 'element', id })}
                onChange={setSchedules}
              />
            ) : selAct ? (
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
              <ElementProperties
                e={selEl}
                project={project}
                sections={sections}
                act={selEl.origin === 'drawing' ? undefined : actById.get(actOfElement.get(selEl.id) ?? '')}
                t={selEl.origin === 'drawing' ? undefined : times[actOfElement.get(selEl.id) ?? '']}
                state={stateOf(selEl)}
                render={renderSheet}
                onPickAct={(id) => setSel({ kind: 'activity', id })}
                onSection={(k, page) => {
                  const sc = sections.find((x) => x.key === k);
                  if (sc) onOpenSpec(sc.docId, page ?? sc.pages[0] ?? 1, sc.key);
                }}
                onSource={openSource}
                onFrame={() => go('frame')}
                onIsolate={() => setIsolate(new Set([selEl.id]))}
              />
            ) : treeSel && model ? (
              <GroupProperties
                sel={treeSel}
                model={model}
                project={project}
                sections={sections}
                onSection={openSection}
                onIsolate={() => setIsolate(new Set(treeSel.ids))}
                onFrame={() => go('frame')}
              />
            ) : feas ? (
              <div className="bld-card">
                <h3>{feas.target ? (feas.overBy ? 'The target can’t be met' : 'The plan meets the target') : 'Earliest finish'}</h3>
                <p className="bld-big">
                  {fmt(feas.earliestFinish)}
                  {feas.target && <span> · target {fmt(feas.target)}</span>}
                </p>
                {feas.target && feas.overBy > 0 && (
                  <p>
                    {feas.overBy} working days late under the current assumptions. The chain below shows the remaining production, sequencing and fixed constraints after any resource changes.
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
                {(feas.changes?.length ?? 0) > 0 && <div><strong>Changes to meet target</strong><ul>{feas.changes!.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
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
            <div className="bld-issue-filters" aria-label="Filter issues">
              {(['all','conflict','warning'] as const).map(filter=><button key={filter} aria-pressed={issueFilter===filter} onClick={()=>setIssueFilter(filter)}>{filter==='all'?'All issues':filter==='conflict'?'Conflicts':'Needs review'}</button>)}
            </div>
            <ul>
              {allIssues.filter(i=>issueFilter==='all'||i.severity===issueFilter).map((i) => (
                <li key={i.id} className={i.severity}>
                  {i.text}
                  {!!i.sources?.length && <details className="bld-issue-evidence"><summary>Source evidence</summary>{[...new Map(i.sources.map(source=>[`${source.id}:${source.page}`,source])).values()].map(source=><button className="link-button" key={`${source.id}:${source.page}`} onClick={()=>openSource(source)}>{source.label} · page {source.page}{source.quote ? ` — ${source.quote}` : ''}</button>)}</details>}
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

      {out && cal && workspace === 'sequence' && !showExplorer && (
        <footer className="bld-time">
          <div className="bld-controls">
            <div className="bld-btabs" role="tablist">
              <button role="tab" aria-selected={bottom === 'schedule'} className={bottom === 'schedule' ? 'on' : ''} onClick={() => setBottom('schedule')}>
                Schedule
              </button>
              <button role="tab" aria-selected={bottom === 'activities'} className={bottom === 'activities' ? 'on' : ''} onClick={() => setBottom('activities')} title="Import a schedule, or build your own and link it to the model">
                Activities
              </button>
              <button role="tab" aria-selected={bottom === 'quantities'} className={bottom === 'quantities' ? 'on' : ''} onClick={() => setBottom('quantities')}>
                Quantities
              </button>
            </div>
            <ScheduleSourcePicker schedules={edits.schedules} onChange={(next) => (setSchedules(next), setSel(null), setScheduleNote(null))} />
            <button className="primary" onClick={() => (day >= end ? (setDay(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
              <option value={5}>1 week / s</option>
              <option value={10}>2 weeks / s</option>
              <option value={21}>1 month / s</option>
              <option value={63}>3 months / s</option>
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
          {bottom === 'activities' && model ? (
            <ScheduleTable
              schedules={edits.schedules}
              generated={out.schedule.activities}
              times={times}
              levels={levels}
              model={model}
              selected={sel?.kind === 'activity' ? sel.id : null}
              picks={picks}
              picking={picking}
              note={scheduleNote}
              importButton={
                <ImportScheduleButton
                  className="primary"
                  model={model}
                  setup={out.setup}
                  onError={setError}
                  onImported={(s, note) => {
                    setSchedules({ ...(edits.schedules ?? { use: 'imported' }), use: 'imported', imported: s });
                    setScheduleNote(note);
                    setDay(0);
                  }}
                >
                  Import schedule…
                </ImportScheduleButton>
              }
              onPick={(id) => (setInspectorOpen(true), setTreeSel(null), setSel({ kind: 'activity', id }))}
              onPicking={startPicking}
              onLink={linkPicks}
              onChange={(next) => {
                if (next.use !== (edits.schedules?.use ?? 'generated')) (setSel(null), setScheduleNote(null));
                setSchedules(next);
              }}
              onSave={onSave}
            />
          ) : bottom === 'schedule' ? (
            <Gantt groups={groups} times={times} end={end} zoom={zoom} day={day} target={targetIdx} cal={cal} selected={sel?.kind === 'activity' ? sel.id : null} onPick={(id) => (setInspectorOpen(true), setTreeSel(null), setSel({ kind: 'activity', id }))} onDay={(d) => (setPlaying(false), setDay(d))} />
          ) : (
            model && (
              <QuantitySchedule
                model={model}
                picked={treeSel?.key ?? null}
                onPick={(t) => {
                  setSel(null);
                  setTreeSel(t);
                }}
              />
            )
          )}
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
    if (k === 'targetFor') { out.targetFor = v as PlanSetup['targetFor']; continue; }
    const cur = (out as unknown as Record<string, Assumption<unknown>>)[k];
    if (cur && JSON.stringify(cur.value) !== JSON.stringify(v)) (out as unknown as Record<string, Assumption<unknown>>)[k] = { value: v, basis: 'assumed', why: cur.basis === 'documented' ? `Set by you (the documents say ${JSON.stringify(cur.value)})` : 'Set by you' };
  }
  for (const [t, v] of Object.entries(edits.setup?.trades ?? {})) {
    const cur = out.trades[t];
    if (cur) out.trades[t] = { value: { ...cur.value, ...v, rates: { ...cur.value.rates, ...(v.rates ?? {}) } }, basis: 'assumed', why: 'Set by you' };
  }
  return out;
}

/** What an allowance is entered in, and a typical rate per crew-day to start from (provisional until set). */
const ALLOWANCE_DEFAULTS: Record<string, { metric: [string, number]; imperial: [string, number] }> = {
  site: { metric: ['m³', 50], imperial: ['CY', 65] },
  foundations: { metric: ['m³', 6], imperial: ['CY', 8] },
  structure: { metric: ['m²', 40], imperial: ['SF', 430] },
  envelope: { metric: ['m²', 30], imperial: ['SF', 320] },
  'mech-rough': { metric: ['m', 15], imperial: ['ft', 50] },
  'elec-rough': { metric: ['m', 30], imperial: ['ft', 100] },
  'fire-rough': { metric: ['m', 20], imperial: ['ft', 65] },
};

/**
 * Allowances: scope the takeoff doesn't measure (no drawing for it, or not taken off yet) entered
 * as a quantity and a rate, so the plan carries its time. Each becomes its own activity; nothing
 * is added to the takeoff or the model. A trade with measured work shows it, so an allowance is
 * only added on purpose.
 */
function AllowancesForm(props: {
  allowances: Record<string, ScopeAllowance>;
  measured: string[];
  metric: boolean;
  /** Allowances Build It proposes for trades with nothing measured: shown until accepted. */
  suggestions?: { key: string; allowance: ScopeAllowance; why: string }[];
  onChange: (next: Record<string, ScopeAllowance>) => void;
}) {
  const { allowances, measured, metric, onChange } = props;
  const suggested = (props.suggestions ?? []).filter((x) => !allowances[x.key] && !measured.includes(x.key));
  const keys = [{ key: 'foundations', name: 'Foundations', colour: '#ffb340' }, ...TRADES.filter((t) => t.key !== 'other')];
  const nameOf = (k: string) => keys.find((t) => t.key === k)?.name ?? k;
  const missing = keys.filter((t) => !allowances[t.key]);
  const put = (k: string, v: ScopeAllowance | null) => {
    const next = { ...allowances };
    if (v) next[k] = v;
    else delete next[k];
    onChange(next);
  };
  const add = (k: string) => {
    const d = ALLOWANCE_DEFAULTS[k]?.[metric ? 'metric' : 'imperial'] ?? (metric ? ['m²', 20] : ['SF', 200]);
    put(k, { quantity: 0, unit: d[0], rate: d[1], provisional: true });
  };
  const rows = Object.entries(allowances);
  return (
    <div className="bld-form">
      <p className="dim small">Scope the takeoff doesn’t measure, so the plan still carries its time: a quantity and how much one crew does a day. Each becomes its own activity in the schedule; nothing is added to the takeoff or the model. A quantity of 0 is a draft.</p>
      {suggested.length > 0 && (
        <>
          <h4>Suggested</h4>
          {suggested.map((x) => (
            <div key={x.key} className="bld-trade bld-allowance suggested">
              <b>
                {nameOf(x.key)}
                <button className="link-button" onClick={() => put(x.key, x.allowance)} title="Add this allowance to the plan; you can change it after">
                  Accept
                </button>
              </b>
              <p className="dim small">
                {Math.round(x.allowance.quantity)} {x.allowance.unit} at {x.allowance.rate} {x.allowance.unit}/crew-day ({Math.ceil(x.allowance.quantity / Math.max(x.allowance.rate, 1e-9))} days for one crew), provisional. {x.why}
              </p>
            </div>
          ))}
        </>
      )}
      {rows.length === 0 && <p className="dim">No allowances.</p>}
      {rows.map(([k, a]) => {
        const days = a.quantity > 0 && a.rate > 0 ? Math.ceil(a.quantity / a.rate) : 0;
        return (
          <div key={k} className="bld-trade bld-allowance">
            <b>
              {nameOf(k)}
              {measured.includes(k) && <em className="dim small"> · also measured in the takeoff</em>}
              <button className="link-button" onClick={() => put(k, null)} title="Remove this allowance">
                Remove
              </button>
            </b>
            <div>
              <label>
                <NumberField min={0} value={a.quantity} onCommit={(v) => put(k, { ...a, quantity: Math.max(0, v) })} />
                <input type="text" className="bld-unit" value={a.unit} onChange={(e) => put(k, { ...a, unit: e.target.value })} />
              </label>
              <label>
                <NumberField min={0} value={a.rate} onCommit={(v) => put(k, { ...a, rate: Math.max(0, v) })} /> {a.unit || 'units'}/crew-day
              </label>
              <label className="check">
                <input type="checkbox" checked={a.provisional} onChange={(e) => put(k, { ...a, provisional: e.target.checked })} /> provisional
              </label>
            </div>
            <p className="dim small">{days ? `${days} working day${days === 1 ? '' : 's'} for one crew` : a.quantity > 0 ? 'Set a rate above 0.' : 'Draft: not in the plan until it has a quantity.'}</p>
          </div>
        );
      })}
      {missing.length > 0 && (
        <label className="bld-field">
          <span>Add</span>
          <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">Allowance for…</option>
            {missing.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
                {measured.includes(t.key) ? ' (measured)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
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
  suggestions: ScopeSuggestion[];
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
  // A plain function, not a component made here: one made in render is a new type each time,
  // so its input was remounted (and lost focus) on every keystroke.
  const row = ({ k, label, unit, rebuild }: { k: keyof PlanSetup; label: string; unit: string; rebuild?: boolean }) => {
    const b = basisOf(k);
    return (
      <label className="bld-field" key={k}>
        <span>{label}</span>
        <NumberField min={0} step={k === 'floorToFloor' ? 0.1 : 1} value={val<number>(k, 0)} onCommit={(v) => set(k, v, rebuild)} />
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
  const [tab, setTab] = useState<'project' | 'trades' | 'scope' | 'levels'>('project');
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const wd = val<number[]>('workDays', [1, 2, 3, 4, 5]);
  return (
    <aside className="bld-setup">
      <div className="bld-tabs" role="tablist">
        {(['project', 'trades', 'scope', 'levels'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'project' ? 'Dates & reviews' : t === 'trades' ? 'Crews & rates' : t === 'scope' ? 'Allowances' : 'Levels'}
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
          <p className="dim small">Earlier targets test extra crews and overlapping levels. Later targets restore the baseline. Fixed reviews and lead times remain; changes and risks are shown.</p>
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
          {row({ k: 'submittalPrepDays', label: 'Preparing submittals', unit: 'days' })}
          {row({ k: 'reviewDays', label: 'Consultant review', unit: 'days' })}
          {!fact('reviewDays') && facts !== null && <p className="dim small">The specification doesn’t give a review period: this is an assumption.</p>}
          {row({ k: 'resubmitRounds', label: 'Resubmissions', unit: 'rounds' })}
          {row({ k: 'resubmitReviewDays', label: 'Re-review', unit: 'days' })}
          <h4>Site and finish</h4>
          {row({ k: 'mobilizeDays', label: 'Mobilization', unit: 'days' })}
          {row({ k: 'testingDays', label: 'Testing per trade', unit: 'days' })}
          {row({ k: 'commissioningDays', label: 'Commissioning', unit: 'days' })}
          {row({ k: 'closeoutDays', label: 'Closeout', unit: 'days' })}
          {row({ k: 'floorToFloor', label: 'Floor to floor', unit: metric ? 'm' : 'ft', rebuild: true })}
          <label className="bld-field check">
            <input type="checkbox" checked={val<boolean>('levelsInParallel', false)} onChange={(e) => set('levelsInParallel', e.target.checked)} />
            <span>A trade may work on more than one level at a time</span>
          </label>
          <label className="bld-field check">
            <input type="checkbox" checked={val<boolean>('dryInBeforeFinishes', true)} onChange={(e) => set('dryInBeforeFinishes', e.target.checked)} />
            <span>Interior finishes wait for the building to be weather-tight (roof and exterior walls)</span>
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
                          <NumberField min={0} value={mine.rates?.[u] ?? r} onCommit={(v) => setT({ rates: { ...(mine.rates ?? {}), [u]: v } })} /> {u}/day
                        </label>
                      ))}
                      <label>
                        <NumberField min={1} value={mine.crews ?? cur.crews} onCommit={(v) => setT({ crews: Math.max(1, Math.round(v)) })} /> crews
                      </label>
                      <label>
                        <NumberField min={0} value={mine.leadDays ?? cur.leadDays} onCommit={(v) => setT({ leadDays: Math.round(v) })} /> days lead
                      </label>
                    </div>
                  </div>
                );
              })}
        </div>
      )}
      {tab === 'scope' && <AllowancesForm allowances={val<Record<string, ScopeAllowance>>('allowances', {})} measured={props.tradeKeys} metric={metric} suggestions={props.suggestions} onChange={(next) => set('allowances', next)} />}
      {tab === 'levels' && (
        <div className="bld-form">
          <p className="dim small">Each measured plan sheet’s level, from its title or title block. Set the ones that aren’t known, or fix any that are wrong.</p>
          {props.levels.map((l) => (
            <label key={l.id} className="bld-field">
              <span>{l.name}</span>
              <NumberField step={0.1} value={edits.elevations?.[l.id] ?? Math.round(l.elevation * 100) / 100} onCommit={(v) => onEdit({ ...edits, elevations: { ...(edits.elevations ?? {}), [l.id]: v } }, true)} />
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
          Days <NumberField min={0} value={mine.duration ?? a.duration} onCommit={(v) => setA({ duration: Math.round(v) })} />
        </label>
        {a.kind === 'work' && (
          <label>
            Crews <NumberField min={1} value={mine.crews ?? a.crews ?? 1} onCommit={(v) => setA({ crews: Math.max(1, Math.round(v)) })} />
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

/**
 * The header's verdict on the target. "Fits" says when it only fits with recovery changes
 * (extra crews, overlapped levels: unpriced), and what the finish is without them; a start
 * date already behind us is pointed out rather than silently planned from.
 *
 * Data contract (src/build/replanTarget.ts, docs/build-it-review-fixes.md): `feasibility.changes`
 * lists the recovery changes accepted; `feasibility.baselineFinish` is the target milestone's
 * date before any recovery (always set by planToTarget).
 */
function FeasibilityBadge({ feas, start }: { feas: Feasibility; start: Assumption<string> }) {
  const changes = feas.changes ?? [];
  const baselineFinish = feas.baselineFinish;
  const n = changes.length;
  const recovery = n ? `${n} recovery change${n === 1 ? '' : 's'}` : '';
  const late = !!feas.target && feas.overBy > 0;
  const text = !feas.target
    ? `Earliest finish ${fmt(feas.earliestFinish)} · no target set`
    : late
      ? `${feas.overBy} working days late${n ? ` even with ${recovery}` : ''} · earliest ${fmt(feas.earliestFinish)}`
      : n
        ? `Fits only with ${recovery} · ${fmt(feas.earliestFinish)}`
        : `Fits the target · ${fmt(feas.earliestFinish)}`;
  const tip = [
    feas.target ? `Target ${fmt(feas.target)}` : 'No target set',
    baselineFinish && changes.length ? `Without recovery: ${fmt(baselineFinish)}` : '',
    ...changes.map((c) => `• ${c}`),
  ]
    .filter(Boolean)
    .join('\n');
  const past = start.value < today();
  return (
    <>
      <div className={`bld-feas ${!feas.target ? 'none' : late ? 'late' : n ? 'stretched' : 'ok'}`} title={tip}>
        {text}
        {baselineFinish && n > 0 && <em> · without: {fmt(baselineFinish)}</em>}
      </div>
      {past && (
        <div className="bld-feas past" title={`${start.why}. The plan runs from this date; set the real start in Setup if the work hasn't begun.`}>
          Starts {fmt(start.value)} · in the past
        </div>
      )}
    </>
  );
}
