import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { CATEGORIES, MATERIALS, type Element3D, type Scene3D } from '../scene3d/scene';
import { fitCamera } from '../scene3d/render';
import { dayOf, isoDay, modelSequence, nextStart, planSequence, progressOn, scheduleSequence, type Activity4D, type Phase, type Sequence4D } from '../scene3d/sequence';
import type { SiteStage } from '../scene3d/environment';
import type { Stop } from '../scene3d/walkplan';
import { ModelScene, type ModelApi } from './ModelScene';
import './Explorer.css';

/**
 * The 4D explorer of the AI's 3D model: the model on its site, built up to the date on the
 * timeline below. Views, layers, the programme and the finishes on the left; walk inside, a 4K
 * still and full screen on top. The dates come from Build It's schedule when there is one, or
 * else from a sequence worked out from the model itself.
 */

/** A schedule to play: calendar days from `start`, and which activity puts up each element. */
export interface ExplorerSchedule {
  start: string;
  activities: Activity4D[];
  activityOf: (e: Element3D) => string | null;
  source: Sequence4D['source'];
}

interface Props {
  scene: Scene3D;
  projectName: string;
  schedule: ExplorerSchedule | null;
  /** More buttons for the header (the switch back to the classic view, Build 3D with AI). */
  extra?: ReactNode;
  onSave: (name: string, data: Blob) => void;
}

type Tab = 'views' | 'layers' | 'schedule' | 'materials';
type ViewName = 'building' | 'access' | 'services' | 'landscape' | 'site' | 'inside';
const VIEWS: { id: ViewName; icon: string; label: string }[] = [
  { id: 'building', icon: '⌂', label: 'Building' },
  { id: 'access', icon: '↝', label: 'Site access' },
  { id: 'services', icon: '⌁', label: 'Services' },
  { id: 'landscape', icon: '♧', label: 'Landscape' },
  { id: 'site', icon: '⊞', label: 'Whole site' },
  { id: 'inside', icon: '▤', label: 'Inside' },
];
const SPEEDS: [number, string][] = [
  [1, '1 day / sec'],
  [3, '3 days / sec'],
  [7, '1 week / sec'],
  [30, '1 month / sec'],
];
const SERVICES = new Set(['mechanical', 'electrical', 'plumbing', 'fixtures', 'civil', 'floor', 'foundation']);
const SITE_LAYERS = new Set(['site', 'paving', 'context', 'civil']);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const longDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
const pretty = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');
/** The finishes drawn with photo textures: their swatch is the texture itself. */
const SWATCH: Record<string, string> = {
  timber: 'wood_table_001_grain_1k.jpg', wood: 'wood_table_001_grain_1k.jpg', door: 'wood_table_001_grain_1k.jpg',
  concrete: 'brushed_concrete_diff_2k.jpg', sealed_concrete: 'brushed_concrete_diff_2k.jpg', stone: 'concrete_floor_02_diff_1k.jpg',
  gravel: 'gravel_ground_01_diff_1k.jpg', asphalt: 'asphalt_diff_2k.jpg', grass: 'aerial_grass_rock_diff_1k.jpg', soil: 'brown_mud_leaves_01_diff_1k.jpg',
  block: 'concrete_block_diff_2k.jpg', stucco: 'plaster_diff_2k.jpg',
};
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);

export function Explorer({ scene, projectName, schedule, extra, onSave }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ModelApi | null>(null);
  // The user's own or imported schedule first, then a plan the model carries (a renovation's), then
  // Build It's generated one, then an order worked out from the model.
  const seq = useMemo<Sequence4D>(() => {
    if (schedule && schedule.source !== 'generated') return scheduleSequence(scene, schedule);
    return planSequence(scene) ?? (schedule ? scheduleSequence(scene, schedule) : modelSequence(scene, nextStart()));
  }, [scene, schedule]);
  const [date, setDate] = useState(() => seq.days);
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  const [speed, setSpeed] = useState(3);
  const [tab, setTab] = useState<Tab>('views');
  const [view, setView] = useState<ViewName>('building');
  const [section, setSection] = useState('none');
  const [reveal, setReveal] = useState(false);
  const [equipment, setEquipment] = useState(true);
  const [context, setContext] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(['ceiling']));
  const [storey, setStorey] = useState('all');
  const [finish, setFinish] = useState<string | null>(null);
  const [mode, setMode] = useState<{ mode: 'orbit' | 'walk' | 'tour'; level: string }>({ mode: 'orbit', level: '' });
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [findFinish, setFindFinish] = useState('');
  const [walkInfo, setWalkInfo] = useState<{ levels: string[]; stops: Stop[] } | null>(null);

  // A new schedule (or model): show it finished, as the reference does.
  useEffect(() => {
    setDate(seq.days);
    setDir(0);
  }, [seq]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const building = useMemo(() => scene.title.replace(/^sample:\s*/i, '').trim() || projectName, [scene, projectName]);
  const counts = useMemo(() => scene.elements.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + 1), new Map<string, number>()), [scene]);
  const levels = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of scene.elements) if (e.level) seen.set(e.level, (seen.get(e.level) ?? 0) + 1);
    return [...seen.keys()];
  }, [scene]);
  const finishes = useMemo(() => {
    const m = new Map<string, { n: number; layers: Set<string> }>();
    for (const e of scene.elements) {
      const f = m.get(e.material) ?? { n: 0, layers: new Set<string>() };
      f.n++;
      f.layers.add(CATEGORIES.find(([k]) => k === e.category)?.[1] ?? e.category);
      m.set(e.material, f);
    }
    return [...m].sort((a, b) => b[1].n - a[1].n);
  }, [scene]);

  // ------------------------------------------------------------------ the day shown

  const day = Math.max(0, Math.min(seq.days, date));
  const buildKey = `${seq.start}|${seq.days}|${day.toFixed(2)}`;
  const build = useCallback((e: Element3D) => progressOn(seq, e, day), [seq, day]);
  const live = useMemo(() => seq.activities.filter((a) => !a.milestone && day >= a.s && day < a.e), [seq, day]);
  // Temporary works (taken away again) aren't counted as installed components.
  const scheduled = useMemo(() => scene.elements.filter((e) => seq.install.has(e.id) && !seq.install.get(e.id)!.gone), [scene, seq]);
  const installed = useMemo(() => scheduled.filter((e) => progressOn(seq, e, day) >= 1).length, [scheduled, seq, day]);
  const stage = useMemo<SiteStage | null>(() => {
    if (!equipment) return null;
    const work = seq.activities.filter((a) => !a.milestone);
    const of = (...p: Phase[]) => work.filter((a) => p.includes(a.phase));
    const on = (...p: Phase[]) => of(...p).some((a) => day >= a.s && day < a.e);
    const land = of('landscape');
    const landS = land.length ? Math.min(...land.map((a) => a.s)) : seq.days;
    const landE = land.length ? Math.max(...land.map((a) => a.e)) : seq.days;
    const site = day < seq.days && day < landS + (landE - landS) * 0.5;
    const dug = of('earthworks', 'foundations');
    const digS = dug.length ? Math.min(...dug.map((a) => a.s)) : -1;
    const digE = of('foundations').length ? Math.max(...of('foundations').map((a) => a.e)) : dug.length ? Math.max(...dug.map((a) => a.e)) : -1;
    const dig = digS < 0 || day < digS ? 0 : day < digE ? Math.min(1, (day - digS) / 7) : Math.max(0, 1 - (day - digE) / 7);
    // A renovation (no ground or structural work) keeps its lawn.
    const groundwork = of('earthworks', 'underground', 'foundations', 'structure').length > 0;
    const work01 = !groundwork || day >= landE ? 0 : day >= landS ? 1 - (day - landS) / Math.max(1, landE - landS) : Math.min(1, day / 5);
    return { day, work: work01, dig, earthworks: on('earthworks', 'underground') || (on('foundations') && dig > 0.5), structure: on('structure', 'roof'), site };
  }, [seq, day, equipment]);

  // Playing: forwards or back at the chosen days per second.
  useEffect(() => {
    if (!dir) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let stop = false;
      setDate((d) => {
        const n = d + dir * speed * dt;
        if (n >= seq.days || n <= 0) stop = true;
        return Math.max(0, Math.min(seq.days, n));
      });
      api?.invalidate(true);
      if (stop) setDir(0);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dir, speed, seq, api]);
  const play = (d: 1 | -1) => {
    if (dir === d) return setDir(0);
    if (d === 1 && date >= seq.days) setDate(0);
    if (d === -1 && date <= 0) setDate(seq.days);
    setDir(d);
  };
  const jump = (d: number) => {
    setDir(0);
    setDate(Math.max(0, Math.min(seq.days, d)));
  };

  // Space plays or pauses (not while walking or typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e) || mode.mode !== 'orbit' || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      setDir((d) => (d ? 0 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode.mode]);

  // ------------------------------------------------------------------ what shows

  // Revealing what is buried brings the underground layer back even if it was switched off.
  const layers = useMemo(() => new Set(CATEGORIES.map(([k]) => k).filter((k) => !hidden.has(k) || (reveal && k === 'civil'))), [hidden, reveal]);
  const levelCut = useMemo(() => {
    // "Open <level>": cut 1.8 m over that level's floor, from the walk plan's levels.
    const m = /^open:(.*)$/.exec(section);
    if (!m || !walkInfo) return null;
    const i = walkInfo.levels.indexOf(m[1]);
    const z = api?.plan().levels[i]?.z;
    return z === undefined ? null : z + 1.8;
  }, [section, walkInfo, api]);
  const focus = useMemo(() => (section === 'structure' ? new Set(['structure', 'foundation', 'floor', 'stairs']) : view === 'services' && section === 'none' ? SERVICES : null), [section, view]);
  const only = useMemo(() => {
    if (storey === 'all' && !finish) return null;
    return (e: Element3D) => (storey === 'all' || e.level === storey) && (!finish || e.material === finish);
  }, [storey, finish]);

  // First the building, from the site, as you'd stand to look at it.
  const framed = useRef<Scene3D | null>(null);
  useEffect(() => {
    if (!api || framed.current === scene || !scene.elements.length) return;
    framed.current = scene;
    const t = setTimeout(() => {
      const f = buildingView(api);
      api.m.camera.position.copy(f.position);
      api.fly(f.position, f.target);
    }, 50);
    return () => clearTimeout(t);
  }, [api, scene]);

  // The walk plan's levels and rooms, worked out once the model is up.
  useEffect(() => {
    if (!api) return;
    setWalkInfo(null);
    const t = setTimeout(() => {
      try {
        const p = api.plan();
        setWalkInfo({ levels: p.levels.map((l) => l.name), stops: p.stops.filter((s) => s.title) });
      } catch {
        setWalkInfo({ levels: [], stops: [] });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [api, scene]);

  // ------------------------------------------------------------------ views

  const boxOf = useCallback(
    (pick: (e: Element3D) => boolean) => {
      const b = new THREE.Box3();
      for (const it of api?.m.items ?? []) if (pick(it.el)) b.union(it.mesh.geometry.boundingBox ?? new THREE.Box3());
      return b.isEmpty() ? null : b;
    },
    [api],
  );
  const show = (v: ViewName) => {
    if (!api) return;
    if (mode.mode !== 'orbit') api.leave();
    setView(v);
    setFinish(null);
    setStorey('all');
    const m = api.m;
    let to = m.viewOf('exterior');
    let cut = 'none';
    let under = false;
    if (v === 'building') {
      to = { ...to, ...buildingView(api) };
    } else if (v === 'access') {
      const b = boxOf((e) => e.category === 'paving') ?? m.all;
      to = { ...to, ...fitCamera(m.camera, b.clone().union(m.box), new THREE.Vector3(-0.35, 0.85, 0.55)) };
    } else if (v === 'services') {
      to = { ...to, ...fitCamera(m.camera, m.box, new THREE.Vector3(-0.5, 0.6, 0.7)) };
      under = true;
    } else if (v === 'landscape') {
      // The grounds right round the building, from the far side.
      const near = m.box.clone().expandByVector(new THREE.Vector3(16, 0, 16));
      near.min.y = Math.max(near.min.y, -0.5);
      to = { ...to, ...fitCamera(m.camera, near, new THREE.Vector3(0.7, 0.4, -0.6)) };
    } else if (v === 'site') {
      // The site the model covers, but not out to every far-off pipe or path.
      const reach = m.box.clone().expandByScalar(Math.max(40, m.box.getSize(new THREE.Vector3()).length() * 0.7));
      const all = m.all.clone().intersect(reach);
      all.min.y = Math.max(all.min.y, -0.5);
      to = { ...to, ...fitCamera(m.camera, all, new THREE.Vector3(0.55, 0.7, 0.6)) };
    }
    else if (v === 'inside') {
      to = m.viewOf('cutaway');
      cut = walkInfo?.levels[0] ? `open:${walkInfo.levels[0]}` : 'cut';
    }
    setSection(cut);
    setReveal(under);
    api.fly(to.position, to.target);
  };
  const cut = section === 'cut' ? (api?.m.viewOf('cutaway').view.cut ?? null) : levelCut;

  // ------------------------------------------------------------------ actions

  const capture = async () => {
    if (!api) return;
    setToast('Rendering a photoreal 3840 × 2160 image…');
    await new Promise((r) => setTimeout(r, 30));
    let shown = -1;
    const blob = await api.capture((k) => {
      const pct = Math.round(k * 100);
      if (pct !== shown) setToast(`Rendering a photoreal 3840 × 2160 image… ${(shown = pct)}%`);
    });
    if (!blob) return setToast('The image could not be made on this computer.');
    onSave(`${projectName || building} - ${isoDay(seq.start, day)} 4K.png`, blob);
    setToast('Saved a 3840 × 2160 image of this construction stage.');
  };
  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => setToast('Full screen is not available here.'));
  };
  const walk = (level?: number, stop?: Stop) => {
    if (!api) return;
    setSection('none');
    api.walk(level, stop);
  };
  const walkFinished = () => {
    jump(seq.days);
    setTimeout(() => walk(), 60);
  };
  const toggleLayer = (k: string) =>
    setHidden((s) => {
      const n = new Set(s);
      if (!n.delete(k)) n.add(k);
      return n;
    });
  const resetVisibility = () => {
    setHidden(new Set(['ceiling']));
    setStorey('all');
    setFinish(null);
    setReveal(false);
    setContext(true);
    setEquipment(true);
    setSection('none');
  };
  const onMode = useCallback((m: 'orbit' | 'walk' | 'tour', level: string) => setMode((o) => (o.mode === m && o.level === level ? o : { mode: m, level })), []);

  // ------------------------------------------------------------------ the timeline

  const start = useMemo(() => new Date(`${seq.start}T12:00:00Z`), [seq.start]);
  const months = useMemo(() => {
    const out: { at: number; label: string }[] = [];
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12));
    const all: { at: number; m: number; y: number }[] = [];
    for (; ; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const at = dayOf(seq.start, d.toISOString().slice(0, 10));
      if (at > seq.days) break;
      all.push({ at, m: d.getUTCMonth(), y: d.getUTCFullYear() });
    }
    const every = Math.max(1, Math.ceil(all.length / 7));
    out.push({ at: 0, label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}` });
    all.forEach((x, i) => {
      if ((i + 1) % every || x.at < seq.days * 0.07 || x.at > seq.days * 0.88) return;
      out.push({ at: x.at, label: x.m === 0 ? `JAN ${x.y}` : MONTHS[x.m] });
    });
    const end = isoDay(seq.start, seq.days);
    out.push({ at: seq.days, label: `${MONTHS[Number(end.slice(5, 7)) - 1]} ${end.slice(0, 4)}` });
    return out;
  }, [seq, start]);
  const dots = useMemo(() => {
    const ms = seq.activities.filter((a) => a.milestone);
    return ms.length >= 3 ? ms : seq.activities.filter((a) => !a.milestone).slice(0, 14);
  }, [seq]);
  const shownDate = isoDay(seq.start, day);
  const doneAt = [...seq.activities].reverse().find((a) => a.milestone);

  const sourceNote =
    seq.source === 'model'
      ? 'Worked out from the model: site, foundations, frame, envelope, roof, interiors, services, finishes, landscape. Plan it in Build It’s Construction view for real dates.'
      : seq.source === 'plan'
        ? 'The construction plan the model was built with: its activities and durations, temporary works included. Import your own schedule to replace it.'
        : seq.source === 'generated'
        ? 'From the Build It schedule.'
        : `From your ${seq.source === 'imported' ? 'imported' : 'own'} schedule.`;
  const acts = seq.activities.filter((a) => (a.name + ' ' + a.id).toLowerCase().includes(find.toLowerCase()));

  return (
    <div className="x4d" ref={root}>
      <header className="x4d-top">
        <div className="x4d-brand">
          <b>4D</b>
          <span>
            {projectName.toUpperCase()}
            <small>4D BIM EXPLORER · {building.toUpperCase()}</small>
          </span>
        </div>
        <div className="x4d-actions">
          {extra}
          <button onClick={() => (mode.mode === 'walk' ? api?.leave() : walk())} aria-pressed={mode.mode === 'walk'}>
            {mode.mode === 'walk' ? 'Exit walking' : 'Walk inside'}
          </button>
          <button onClick={() => setHelp(true)}>Controls ?</button>
          <button onClick={() => void capture()}>4K image</button>
          <button onClick={fullScreen}>Full screen</button>
        </div>
      </header>

      <aside className="x4d-side">
        <nav className="x4d-tabs" aria-label="Explorer panels">
          {(['views', 'layers', 'schedule', 'materials'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {pretty(t)}
            </button>
          ))}
        </nav>
        {tab === 'views' && (
          <section className="x4d-panel">
            <p className="x4d-kicker">EXPLORE THE PROJECT</p>
            <h1>
              One site.
              <br />
              Every construction stage.
            </h1>
            <p className="x4d-muted">Choose a view, then move through the schedule below.</p>
            <div className="x4d-grid">
              {VIEWS.map((v) => (
                <button key={v.id} className={view === v.id && mode.mode === 'orbit' ? 'on' : ''} onClick={() => show(v.id)}>
                  <i aria-hidden="true">{v.icon}</i>
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
            <label className="x4d-field">
              Building section
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="none">Complete exterior</option>
                {(walkInfo?.levels ?? []).slice().reverse().map((l) => (
                  <option key={l} value={`open:${l}`}>
                    Open {l.toLowerCase()}
                  </option>
                ))}
                <option value="structure">Structure only</option>
              </select>
            </label>
            <label className="x4d-check">
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Reveal underground services
            </label>
            <label className="x4d-check">
              <input type="checkbox" checked={equipment} onChange={(e) => setEquipment(e.target.checked)} /> Show equipment &amp; temporary works
            </label>
            <div className="x4d-divider" />
            <p className="x4d-kicker">WALK AT THE SELECTED DATE</p>
            <button className="x4d-wide" onClick={() => walk()}>
              Walk in from the entrance
            </button>
            {(walkInfo?.levels.length ?? 0) > 0 && (
              <div className="x4d-two">
                {walkInfo!.levels.map((l, i) => (
                  <button key={l} onClick={() => walk(i)}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            {(walkInfo?.stops.length ?? 0) > 0 && (
              <label className="x4d-field">
                Go to a room
                <select
                  value=""
                  onChange={(e) => {
                    const s = walkInfo!.stops[Number(e.target.value)];
                    if (s) walk(undefined, s);
                  }}
                >
                  <option value="">Choose a room…</option>
                  {walkInfo!.stops.map((s, i) => (
                    <option key={i} value={i}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="x4d-wide" onClick={walkFinished}>
              Walk the completed building →
            </button>
            <button className="x4d-wide" onClick={() => api?.tour()}>
              Guided fly-through
            </button>
            <p className="x4d-small x4d-muted">WASD or arrows to move. Drag to look. Shift moves faster. Q / E change level. Esc returns to orbit.</p>
            <details className="x4d-basis">
              <summary>Model basis</summary>
              <p>
                Built by {scene.builtBy} from the drawings{scene.updated ? `, ${scene.updated.slice(0, 10)}` : ''}. Origin: {scene.origin || 'not stated'}. A drawing-derived model for review, not a coordinated BIM
                model; the terrain, trees, plant and temporary works are illustrative.
              </p>
            </details>
          </section>
        )}
        {tab === 'layers' && (
          <section className="x4d-panel">
            <p className="x4d-kicker">VISIBILITY</p>
            <h2>Layers &amp; systems</h2>
            <div className="x4d-two">
              <button onClick={() => (setHidden(new Set(['ceiling'])), setContext(true))}>Show all</button>
              <button onClick={() => (setHidden(new Set(['ceiling', ...SITE_LAYERS])), setContext(false))}>Building only</button>
            </div>
            <label className="x4d-field">
              Storey
              <select value={storey} onChange={(e) => setStorey(e.target.value)}>
                <option value="all">All storeys</option>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {CATEGORIES.filter(([k]) => counts.get(k)).map(([k, name]) => (
              <label key={k} className="x4d-check">
                <input type="checkbox" checked={!hidden.has(k)} onChange={() => toggleLayer(k)} />
                {name}
                <span>{counts.get(k)}</span>
              </label>
            ))}
            <label className="x4d-check">
              <input type="checkbox" checked={context} onChange={(e) => setContext(e.target.checked)} /> Surrounding hills &amp; trees
            </label>
            <label className="x4d-check">
              <input type="checkbox" checked={equipment} onChange={(e) => setEquipment(e.target.checked)} /> Equipment &amp; temporary works
            </label>
            <button className="x4d-wide" onClick={resetVisibility}>
              Reset visibility
            </button>
            <p className="x4d-small x4d-muted">Layers follow their construction dates: future elements stay unbuilt.</p>
          </section>
        )}
        {tab === 'schedule' && (
          <section className="x4d-panel">
            <p className="x4d-kicker">{seq.activities.filter((a) => !a.milestone).length} LINKED ACTIVITIES</p>
            <h2>Project programme</h2>
            <p className="x4d-small x4d-muted">{sourceNote}</p>
            <input type="search" placeholder="Find activity…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find schedule activity" />
            <div>
              {acts.map((a) => {
                const running = !a.milestone && day >= a.s && day < a.e;
                const pc = a.milestone ? (day >= a.s ? 100 : 0) : Math.max(0, Math.min(100, ((day - a.s) / Math.max(1, a.e - a.s)) * 100));
                return (
                  <div key={a.id} className={`x4d-act ${running ? 'running' : ''} ${a.milestone ? 'milestone' : ''}`}>
                    <button onClick={() => jump(a.milestone ? a.s : a.s + 0.01)}>
                      {a.milestone ? '◆ ' : ''}
                      {a.name}
                      <small>
                        {isoDay(seq.start, a.s)}
                        {a.milestone ? '' : ` → ${isoDay(seq.start, a.e)}`}
                        {a.count ? ` · ${a.count} components` : ''}
                      </small>
                    </button>
                    <div className="x4d-bar">
                      <i style={{ width: `${pc}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {tab === 'materials' && (
          <section className="x4d-panel">
            <p className="x4d-kicker">FINISHES IN THE MODEL</p>
            <h2>Materials &amp; finishes</h2>
            <input type="search" placeholder="Search finish or layer…" value={findFinish} onChange={(e) => setFindFinish(e.target.value)} aria-label="Search finishes" />
            <p className="x4d-small x4d-muted">Click a finish to show only it. Colours and textures are illustrative.</p>
            {finishes
              .filter(([k, f]) => (k + ' ' + [...f.layers].join(' ')).toLowerCase().includes(findFinish.toLowerCase()))
              .map(([k, f]) => (
                <button key={k} className={`x4d-finish ${finish === k ? 'on' : ''}`} onClick={() => setFinish(finish === k ? null : k)}>
                  <i style={SWATCH[k] ? { backgroundImage: `url(${import.meta.env.BASE_URL}textures/${SWATCH[k]})`, backgroundColor: MATERIALS[k]?.color, backgroundBlendMode: /grain/.test(SWATCH[k]) ? 'multiply' : 'normal' } : { background: MATERIALS[k]?.color ?? (/^#/.test(k) ? k : '#bbb') }} />
                  <span>
                    {pretty(k)}
                    <small>{[...f.layers].slice(0, 3).join(' · ')}</small>
                  </span>
                  <em>{f.n}</em>
                </button>
              ))}
          </section>
        )}
      </aside>

      <div className="x4d-view">
        <ModelScene
          scene={scene}
          bare
          build={build}
          buildKey={buildKey}
          stage={stage}
          layers={layers}
          cut={section === 'none' || section === 'structure' ? null : cut}
          focus={focus}
          only={only}
          reveal={reveal}
          context={context}
          onApi={setApi}
          onMode={onMode}
        />
        <div className="x4d-hud">
          <span className="x4d-pill">{mode.mode === 'walk' ? (mode.level || 'Walking').toUpperCase() : building.toUpperCase()}</span>
          <span className="x4d-pill">{mode.mode === 'walk' ? 'WALK · WASD · DRAG TO LOOK · SPACE JUMPS · F OR CLICK OPENS DOORS' : mode.mode === 'tour' ? 'FLY-THROUGH' : 'ORBIT · DRAG / SCROLL'}</span>
          {mode.mode !== 'orbit' && <button onClick={() => api?.leave()}>Exit {mode.mode === 'walk' ? 'walking' : 'fly-through'} · Esc</button>}
          {finish && <button onClick={() => setFinish(null)}>Show other finishes</button>}
        </div>
        {toast && (
          <div className="x4d-toast" role="status">
            {toast}
          </div>
        )}
      </div>

      <section className="x4d-time" aria-label="Construction timeline">
        <div className="x4d-time-head">
          <div>
            <span className="x4d-kicker">{seq.source === 'model' ? 'PLANNED CONSTRUCTION DATE' : 'SCHEDULED CONSTRUCTION DATE'}</span>
            <strong>{longDate(new Date(`${shownDate}T12:00:00Z`))}</strong>
          </div>
          <div className="x4d-transport">
            <button onClick={() => jump(0)} title="Go to the start" aria-label="Go to the start">
              |◀
            </button>
            <button onClick={() => jump(Math.floor(day) - 1)} title="Previous day">
              −1d
            </button>
            <button className={dir === -1 ? 'active' : ''} onClick={() => play(-1)} title="Play backwards" aria-label="Play backwards">
              {dir === -1 ? 'Ⅱ' : '◀'}
            </button>
            <button className="primary" onClick={() => play(1)} title="Play or pause (Space)">
              {dir === 1 ? 'Ⅱ Pause' : '▶ Play'}
            </button>
            <button onClick={() => jump(Math.floor(day) + 1)} title="Next day">
              +1d
            </button>
            <button onClick={() => jump(seq.days)} title="Go to completion" aria-label="Go to completion">
              ▶|
            </button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
              {SPEEDS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input type="date" value={shownDate} min={seq.start} max={isoDay(seq.start, seq.days)} onChange={(e) => e.target.value && jump(dayOf(seq.start, e.target.value))} aria-label="Construction date" />
          </div>
        </div>
        <div className="x4d-rail">
          <div className="x4d-dots">
            {dots.map((a) => (
              <button key={a.id} style={{ left: `${(a.s / seq.days) * 100}%` }} title={`${a.name} · ${isoDay(seq.start, a.s)}`} aria-label={a.name} onClick={() => jump(a.s)} className={day >= a.s ? 'past' : ''} />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={seq.days}
            step={0.1}
            value={day}
            onChange={(e) => jump(Number(e.target.value))}
            aria-label="Construction timeline"
            style={{ ['--x4d-fill' as string]: `${(day / seq.days) * 100}%` }}
          />
          <div className="x4d-months">
            {months.map((m, i) => (
              <span key={i} style={i === months.length - 1 ? { right: 0 } : { left: `${(m.at / seq.days) * 100}%` }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
        <div className="x4d-time-foot">
          <span className="x4d-live">
            {live.length
              ? live.map((a) => a.name).join('  /  ')
              : day >= seq.days
                ? `${doneAt?.name ?? 'Completion'} · ${longDate(new Date(`${isoDay(seq.start, seq.days)}T12:00:00Z`))}`
                : 'No scheduled work on this date'}
          </span>
          <span>
            {installed.toLocaleString()} / {scheduled.length.toLocaleString()} components installed
          </span>
        </div>
      </section>

      {help && (
        <div className="x4d-dialog-back" onClick={() => setHelp(false)}>
          <div className="x4d-dialog" role="dialog" aria-label="Controls" onClick={(e) => e.stopPropagation()}>
            <button className="x4d-close" onClick={() => setHelp(false)} aria-label="Close controls help">
              ×
            </button>
            <p className="x4d-kicker">YOU CONTROL THE MODEL</p>
            <h2>Look. Walk. Build. Rewind.</h2>
            <p>
              <b>Orbit:</b> left-drag rotates, right-drag pans, scroll zooms. Click an element for what it is, its finish and the sheet it came from.
            </p>
            <p>
              <b>Walk:</b> WASD or arrows move, drag to look, Shift moves faster, Q and E change level. Walls stop you; doors don’t. Esc returns to orbit.
            </p>
            <p>
              <b>Time:</b> scrub the timeline to any day, play forwards or backwards, or pick a date. Space plays or pauses. Your viewpoint stays where you put it.
            </p>
            <p>
              <b>Layers:</b> switch systems and storeys on and off, open a level or reveal what is underground. Click an activity to jump to its start.
            </p>
            <p className="x4d-small x4d-muted">{sourceNote}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** The building from the site, low, as you'd stand to look at it (some sky above). */
function buildingView(api: ModelApi) {
  const m = api.m;
  // Above ground only: deep foundations would pull the view down into the earth.
  const b = m.box.clone();
  b.min.y = Math.max(b.min.y, -0.5);
  const f = fitCamera(m.camera, b, new THREE.Vector3(-0.72, 0.2, 0.68));
  f.target.y = b.min.y + (b.max.y - b.min.y) * 0.4;
  return f;
}

/** Helper for Build It: a calendar-day schedule from its activities' working-day times. */
export function phaseOfTrade(trade: string | null | undefined, kind: string): Phase {
  if (kind === 'milestone') return 'closeout';
  return (
    ({
      site: 'earthworks', demolition: 'earthworks', structure: 'structure', envelope: 'envelope', doors: 'openings', partitions: 'interiors',
      'mech-rough': 'services', 'elec-rough': 'services', 'fire-rough': 'services', ceilings: 'finishes', flooring: 'finishes', 'mech-trim': 'finishes',
      'elec-trim': 'finishes', specialties: 'finishes', painting: 'finishes', landscape: 'landscape', paving: 'landscape',
    } as Record<string, Phase>)[trade ?? ''] ?? (kind === 'work' ? 'finishes' : 'mobilize')
  );
}
