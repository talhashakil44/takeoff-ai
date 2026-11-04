import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CATEGORIES, type Element3D, type Scene3D } from '../scene3d/scene';
import { MODEL_VIEWS, ModelRenderer, layerColour, type ElementState, type ModelView } from '../scene3d/render';
import { TourPlayer, Walker, tourShots, type Nav } from '../scene3d/walk';
import { walkPlan, type WalkPlan } from '../scene3d/walkplan';
import './ModelScene.css';

/**
 * The project's 3D model as the AI built it from the drawings: textured, lit, with views,
 * layers, a section cut and an inspector that names each element's source sheet. With a
 * schedule playing, each element shows as its trade's work reaches it.
 */
interface Props {
  scene: Scene3D;
  /** Each element's construction state on the day shown (null: all built). */
  stateOf?: ((e: Element3D) => ElementState) | null;
  stateKey?: string;
  /** The guided tour (the sample project): shown when true. */
  tour?: boolean;
  onTourEnd?: () => void;
}

/** The order a building goes up in, by layer: for the build sequence when no schedule is playing. */
const PHASES: { label: string; of: (e: Element3D) => boolean }[] = [
  { label: 'Site works & foundations', of: (e) => ['civil', 'foundation'].includes(e.category) },
  { label: 'Slab & structural steel', of: (e) => ['structure', 'stairs'].includes(e.category) || (e.category === 'floor' && !FINISH.has(e.material)) },
  { label: 'Walls & roof', of: (e) => ['envelope', 'roof'].includes(e.category) },
  { label: 'Doors & glazing', of: (e) => ['doors', 'glazing'].includes(e.category) },
  { label: 'Interior walls', of: (e) => e.category === 'interior' },
  { label: 'Mechanical, electrical & plumbing', of: (e) => ['mechanical', 'electrical', 'plumbing'].includes(e.category) },
  { label: 'Ceilings, fixtures & finishes', of: (e) => ['ceiling', 'fixtures', 'furniture'].includes(e.category) || (e.category === 'floor' && FINISH.has(e.material)) },
  { label: 'Paving & landscaping', of: (e) => e.category === 'paving' },
];
const FINISH = new Set(['epoxy', 'vinyl', 'carpet', 'tile', 'sealed_concrete']);
const phaseOf = (e: Element3D) => {
  const i = PHASES.findIndex((p) => p.of(e));
  return i < 0 ? -1 : i; // -1: there before the work starts (the ground, the neighbours)
};

/** The guided tour of the sample model: what to look at, and what each step shows. */
interface TourStep {
  target: string | null;
  title: string;
  text: string;
}
const TOUR: TourStep[] = [
  { target: null, title: 'A model built by AI', text: 'Claude built this building from its tender drawings: walls, doors, roofs, beams, fixtures, services and the site, each piece tied to the sheet it came from. Here is a quick look around.' },
  { target: '.mdl-views', title: 'Views', text: 'Jump between the exterior, the rear, a cutaway, the structure, the services, a plan and the whole site. Drag to orbit, scroll to zoom, right-drag to pan.' },
  { target: '.mdl-cut', title: 'Cut it open', text: 'The section cut hides everything above a height, so you can look into the rooms and check the layout against the plans.' },
  { target: '.mdl-layers', title: 'Layers', text: 'Turn trades on and off: envelope, roof, steel, interior walls, mechanical, electrical, the site.' },
  { target: '.mdl-inspect', title: 'Where it came from', text: 'Click anything in the model to see what it is, its finish, the sheet it was read from and how sure the AI was.' },
  { target: '.mdl-seq', title: 'Watch it go up', text: 'Play the build sequence to see the job go up in construction order, trade by trade.' },
  { target: '[data-tour="ai"]', title: 'Your own drawings', text: 'Open your own project and click Build 3D with AI. Claude or ChatGPT reads your drawing set and builds the model on your own plan. It is in beta and takes 20 to 60 minutes.' },
];

export function ModelScene({ scene, stateOf, stateKey, tour, onTourEnd }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef<{ m: ModelRenderer; controls: OrbitControls; invalidate: () => void; fly: (to: THREE.Vector3, target: THREE.Vector3) => void; fitted: boolean; drive: (n: Nav | null) => void } | null>(null);
  // Walking and the fly-through tour: what drives the camera instead of the orbit controls.
  const [mode, setMode] = useState<'orbit' | 'walk' | 'tour'>('orbit');
  const walker = useRef<Walker | null>(null);
  const player = useRef<TourPlayer | null>(null);
  const plan = useRef<{ scene: Scene3D; plan: WalkPlan } | null>(null);
  const orbit = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const [walkLevel, setWalkLevel] = useState('');
  const [shot, setShot] = useState<{ i: number; n: number; title: string; text: string } | null>(null);
  const [touring, setTouring] = useState(true);
  const navFailed = useRef<() => void>(() => {});
  const [view, setView] = useState<ModelView>('exterior');
  const [layers, setLayers] = useState<Set<string>>(() => new Set(CATEGORIES.map(([k]) => k).filter((k) => k !== 'ceiling')));
  const [cut, setCut] = useState<number | null>(null);
  const [focus, setFocus] = useState<Set<string> | null>(null);
  const [picked, setPicked] = useState<Element3D | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  // The build sequence (when no schedule is playing): the phase reached, or null for the finished building.
  const [seq, setSeq] = useState<number | null>(null);
  const [seqPlaying, setSeqPlaying] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourBox, setTourBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const counts = useMemo(() => scene.elements.reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + 1), new Map<string, number>()), [scene]);
  const top = useMemo(() => Math.max(3, ...scene.elements.flatMap((e) => e.shapes.map((s) => ('z1' in s ? s.z1 : 'max' in s ? s.max[2] : 'to' in s && s.to.length === 3 ? s.to[2] : 0)))), [scene]);

  // The renderer, made once.
  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    const m = new ModelRenderer(cv);
    const controls = new OrbitControls(m.camera, cv);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.497;
    let dirty = true;
    let flying: { from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3; t0: number } | null = null;
    controls.addEventListener('change', () => (dirty = true));
    const size = () => {
      m.setSize(el.clientWidth, el.clientHeight);
      dirty = true;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    let raf = 0;
    let last = performance.now();
    // Walking or touring drives the camera; the orbit controls rest.
    let nav: Nav | null = null;
    const frame = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      if (nav) {
        try {
          if (nav.update(now, dt)) dirty = true;
        } catch (err) {
          // Never freeze the view: back to orbiting.
          console.error(err);
          navFailed.current();
        }
      } else {
        if (flying) {
          const t = Math.min(1, (now - flying.t0) / 850);
          const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          m.camera.position.lerpVectors(flying.from, flying.to, k);
          controls.target.lerpVectors(flying.tf, flying.tt, k);
          if (t >= 1) flying = null;
          dirty = true;
        }
        if (controls.update()) dirty = true;
      }
      if (dirty) {
        dirty = false;
        m.render();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    r.current = {
      m,
      controls,
      fitted: false,
      invalidate: () => (dirty = true),
      fly: (to, target) => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
          m.camera.position.copy(to);
          controls.target.copy(target);
          controls.update();
          dirty = true;
          return;
        }
        flying = { from: m.camera.position.clone(), to, tf: controls.target.clone(), tt: target, t0: performance.now() };
      },
      drive: (n) => {
        nav = n;
        flying = null;
        controls.enabled = !n;
        dirty = true;
      },
    };
    // Picking: a click (not a drag). Walking, a drag looks round.
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    let drag: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      if (nav?.look) {
        drag = [e.clientX, e.clientY];
        cv.setPointerCapture?.(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || !nav?.look) return;
      nav.look(e.clientX - drag[0], e.clientY - drag[1]);
      drag = [e.clientX, e.clientY];
    };
    const onEnd = () => (drag = null);
    const onUp = (e: PointerEvent) => {
      drag = null;
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const b = cv.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), m.camera);
      const live = m.items.filter((i) => i.mesh.visible && i.mesh.material !== m.finishes.ghost);
      const hit = ray.intersectObjects(live.map((i) => i.mesh), false).find((h) => m.finishes.clip.distanceToPoint(h.point) >= -0.01);
      const it = hit ? live.find((i) => i.mesh === hit.object) ?? null : null;
      m.selected = it;
      m.apply();
      dirty = true;
      setPicked(it?.el ?? null);
    };
    if (import.meta.env.DEV) Object.assign(window, { __model: { m, controls } });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onEnd);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onEnd);
      walker.current = null;
      player.current = null;
      controls.dispose();
      m.dispose();
      r.current = null;
    };
  }, []);

  // The model: rebuilt when the AI adds to it; the camera stays where the estimator put it.
  useEffect(() => {
    const x = r.current;
    if (!x) return;
    x.m.load(scene);
    x.m.setStates(stateOf ?? null);
    // The first view once there is something to see; after that the camera is the estimator's.
    if (!x.fitted && scene.elements.length) {
      x.fitted = true;
      const v = x.m.viewOf('exterior');
      x.m.camera.position.copy(v.position);
      x.controls.target.copy(v.target);
      x.controls.update();
    }
    x.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  useEffect(() => {
    const x = r.current;
    if (!x) return;
    const s = seq;
    x.m.setStates(stateOf ?? (s === null ? null : (e) => { const p = phaseOf(e); return p < s ? 'done' : p === s ? 'doing' : 'todo'; }));
    x.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, seq, scene]);

  // Playing the sequence: a phase every 1.6 s, then the finished building.
  useEffect(() => {
    if (!seqPlaying) return;
    const t = setTimeout(() => {
      if (seq === null || seq >= PHASES.length - 1) {
        setSeq(null);
        setSeqPlaying(false);
      } else setSeq(seq + 1);
    }, seq === null ? 0 : 1600);
    return () => clearTimeout(t);
  }, [seqPlaying, seq]);
  const playSeq = () => {
    if (seqPlaying) {
      setSeqPlaying(false);
      setSeq(null);
      return;
    }
    setSeq(0);
    setSeqPlaying(true);
  };

  // The tour: each step sets the model up to show what it talks about, then rings its control.
  const step = tour ? TOUR[tourStep] : null;
  useEffect(() => {
    if (!tour) return;
    const x = r.current;
    if (tourStep === 1) go('exterior');
    if (tourStep === 2) go('cutaway');
    if (tourStep === 3) setLayersOpen(true);
    if (tourStep === 4 && x) {
      setLayersOpen(false);
      go('exterior');
      const it = x.m.items.find((i) => i.el.category === 'doors' && /overhead/i.test(i.el.name)) ?? x.m.items.find((i) => i.el.category === 'doors');
      if (it) {
        x.m.selected = it;
        x.m.apply();
        x.invalidate();
        setPicked(it.el);
      }
    }
    if (tourStep === 5 && x) {
      x.m.selected = null;
      x.m.apply();
      setPicked(null);
      if (!seqPlaying) playSeq();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, tourStep]);
  useEffect(() => {
    if (!step) return;
    const place = () => {
      const h = host.current?.getBoundingClientRect();
      const el = step.target ? document.querySelector(step.target) : null;
      const b = el?.getBoundingClientRect();
      setTourBox(h && b ? { x: b.left - h.left, y: b.top - h.top, w: b.width, h: b.height } : null);
    };
    place();
    const t = setInterval(place, 300);
    return () => clearInterval(t);
  }, [step, picked, layersOpen]);
  const endTour = () => {
    setTourStep(0);
    onTourEnd?.();
  };

  useEffect(() => {
    const x = r.current;
    if (!x) return;
    x.m.view = { layers, cut, focus };
    x.m.apply();
    x.invalidate();
  }, [layers, cut, focus]);

  // ------------------------------------------------------------------ walking and the tour

  /** The walk plan for this model, worked out once per model when first needed. */
  const planOf = () => {
    if (plan.current?.scene !== scene) plan.current = { scene, plan: walkPlan(scene) };
    return plan.current.plan;
  };
  /** Takes the camera from the orbit controls, remembering where it was. */
  const takeCamera = () => {
    const x = r.current;
    if (!x) return null;
    if (mode === 'orbit') orbit.current = { position: x.m.camera.position.clone(), target: x.controls.target.clone() };
    walker.current = null;
    player.current = null;
    setPicked(null);
    x.m.selected = null;
    x.m.apply();
    setFocus(null);
    setCut(null);
    x.m.eye(true);
    // Keys go to walking, not to the button just pressed (Space would press it again).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return x;
  };
  /** Back to orbiting: from where the estimator left it, unless a view is about to fly somewhere. */
  const leave = (flyBack = true) => {
    const x = r.current;
    walker.current = null;
    player.current = null;
    setShot(null);
    setMode('orbit');
    setCut(null);
    if (!x) return;
    x.drive(null);
    x.m.eye(false);
    const o = orbit.current;
    if (flyBack && o) x.fly(o.position.clone(), o.target.clone());
    x.invalidate();
  };
  navFailed.current = () => leave(false);
  const startWalk = () => {
    if (!scene.elements.length) return;
    // From inside the tour, walk on from where it stopped; otherwise start outside the front door.
    const t = player.current;
    const inside = t && t.i > 0 && t.i < t.shots.length - 1 ? t.shots[t.i] : null;
    const x = takeCamera();
    if (!x) return;
    const p = planOf();
    const w = new Walker(x.m, p);
    w.onLevel = (i) => setWalkLevel(p.levels[i]?.name ?? '');
    const model = (v: THREE.Vector3): [number, number, number] => [v.x, -v.z, v.y];
    if (inside) w.begin(model(inside.pos), model(inside.look));
    else w.begin();
    walker.current = w;
    x.drive(w);
    if (import.meta.env.DEV) Object.assign(window, { __walk: w });
    setShot(null);
    setMode('walk');
  };
  const startTour = () => {
    if (!scene.elements.length) return;
    const x = takeCamera();
    if (!x) return;
    const shots = tourShots(x.m, planOf());
    const t = new TourPlayer(x.m, shots);
    t.onShot = (i) => {
      setShot({ i, n: shots.length, title: shots[i].title, text: shots[i].text });
      setCut(shots[i].cut);
    };
    t.onEnd = () => setTouring(false);
    player.current = t;
    x.drive(t);
    if (import.meta.env.DEV) Object.assign(window, { __tour: t });
    setTouring(true);
    setMode('tour');
    t.go(0);
  };
  const playPause = () => {
    const t = player.current;
    if (!t) return;
    // At the end, Play starts again from the top.
    if (!t.playing && t.i === t.shots.length - 1) t.go(0);
    t.play(!t.playing);
    setTouring(t.playing);
  };

  // The keys while walking or touring.
  useEffect(() => {
    if (mode === 'orbit') return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
    const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        leave();
        return;
      }
      const w = walker.current, t = player.current;
      if (w) {
        w.run = e.shiftKey;
        if (MOVE.has(e.code)) {
          w.keys.add(e.code);
          e.preventDefault();
        } else if (e.code === 'KeyE' || e.code === 'PageUp') {
          w.changeLevel(1);
          e.preventDefault();
        } else if (e.code === 'KeyQ' || e.code === 'PageDown') {
          w.changeLevel(-1);
          e.preventDefault();
        }
      } else if (t) {
        if (e.code === 'ArrowRight') t.next();
        else if (e.code === 'ArrowLeft') t.back();
        else if (e.code === 'Space') playPause();
        else return;
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const w = walker.current;
      if (!w) return;
      w.run = e.shiftKey;
      w.keys.delete(e.code);
    };
    const onBlur = () => walker.current?.keys.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  /** An on-screen arrow: held down, it holds its key. */
  const hold = (code: string) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      walker.current?.keys.add(code);
    },
    onPointerUp: () => walker.current?.keys.delete(code),
    onPointerCancel: () => walker.current?.keys.delete(code),
    onLostPointerCapture: () => walker.current?.keys.delete(code),
  });

  const go = (v: ModelView) => {
    const x = r.current;
    if (!x) return;
    if (mode !== 'orbit') leave(false);
    setView(v);
    const to = x.m.viewOf(v);
    setFocus(to.view.focus);
    setCut(to.view.cut);
    x.fly(to.position, to.target);
  };
  const toggle = (k: string) => setLayers((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  return (
    <div className="mdl" ref={host}>
      <canvas ref={canvas} aria-label={`3D model: ${scene.title}`} />
      {!scene.elements.length && <div className="mdl-empty">The model is empty so far.</div>}
      <div className="mdl-views" role="group" aria-label="Views">
        {MODEL_VIEWS.map((v) => (
          <button key={v.id} className={mode === 'orbit' && view === v.id ? 'on' : ''} aria-pressed={mode === 'orbit' && view === v.id} onClick={() => go(v.id)} title={v.sub}>
            {v.label}
          </button>
        ))}
        <span className="mdl-go">
          <button className={mode === 'walk' ? 'on' : ''} aria-pressed={mode === 'walk'} disabled={!scene.elements.length} onClick={() => (mode === 'walk' ? leave() : startWalk())} title="Walk inside at eye height: W A S D or the arrows to move, drag to look">
            Walk
          </button>
          <button className={mode === 'tour' ? 'on' : ''} aria-pressed={mode === 'tour'} disabled={!scene.elements.length} onClick={() => (mode === 'tour' ? leave() : startTour())} title="A guided fly-through: the approach, the front door, each floor, then a cutaway">
            Tour
          </button>
        </span>
        <label className="mdl-cut" title="Section cut: hide everything above this height">
          <span>Cut</span>
          <input type="range" min={-1} max={top + 0.5} step={0.05} value={cut ?? top + 0.5} onChange={(e) => setCut(Number(e.target.value) >= top + 0.45 ? null : Number(e.target.value))} />
          <em>{cut === null ? 'off' : `${cut.toFixed(2)} m`}</em>
        </label>
      </div>
      {mode === 'walk' && (
        <div className="mdl-walk" role="region" aria-label="Walking">
          <div className="mdl-walk-head">
            <strong>Walking</strong>
            <em>{walkLevel}</em>
            <span className="mdl-walk-lv">
              <button onClick={() => walker.current?.changeLevel(-1)} title="Down a level (Q or Page Down)" aria-label="Down a level">
                ▼
              </button>
              <button onClick={() => walker.current?.changeLevel(1)} title="Up a level (E or Page Up)" aria-label="Up a level">
                ▲
              </button>
            </span>
            <button className="mdl-walk-x" onClick={() => leave()}>
              Exit
            </button>
          </div>
          <p>
            <kbd>W A S D</kbd> or arrows to move · drag to look · <kbd>Shift</kbd> runs · <kbd>Q</kbd>/<kbd>E</kbd> change level · <kbd>Esc</kbd> exits
          </p>
          <div className="mdl-pad" aria-label="Move">
            <button {...hold('ArrowUp')} aria-label="Forward" className="up">
              ▲
            </button>
            <button {...hold('ArrowLeft')} aria-label="Turn left" className="lt">
              ◀
            </button>
            <button {...hold('ArrowDown')} aria-label="Back" className="dn">
              ▼
            </button>
            <button {...hold('ArrowRight')} aria-label="Turn right" className="rt">
              ▶
            </button>
          </div>
        </div>
      )}
      {mode === 'tour' && shot && (
        <div className="mdl-trip" role="region" aria-label="Tour" aria-live="polite">
          <small>
            Tour · {shot.i + 1} of {shot.n}
          </small>
          <h3>{shot.title}</h3>
          <p>{shot.text}</p>
          <div className="mdl-trip-bar" aria-hidden="true">
            <i style={{ width: `${((shot.i + 1) / shot.n) * 100}%` }} />
          </div>
          <div className="mdl-tour-btns">
            <button className="ghost" onClick={() => leave()}>
              Exit
            </button>
            <button onClick={() => player.current?.back()} disabled={shot.i === 0}>
              Back
            </button>
            <button onClick={playPause} aria-pressed={touring}>
              {touring ? 'Pause' : shot.i === shot.n - 1 ? 'Replay' : 'Play'}
            </button>
            <button className="primary" onClick={() => (shot.i === shot.n - 1 ? leave() : player.current?.next())}>
              {shot.i === shot.n - 1 ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      )}
      <div className={`mdl-layers ${layersOpen ? 'open' : ''}`}>
        <button className="mdl-layers-head" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
          Layers <em>{scene.elements.length}</em>
        </button>
        {layersOpen && (
          <ul>
            {CATEGORIES.filter(([k]) => counts.get(k)).map(([k, name]) => (
              <li key={k}>
                <label>
                  <input type="checkbox" checked={layers.has(k)} onChange={() => toggle(k)} />
                  <i style={{ background: layerColour(k) }} />
                  <span>{name}</span>
                  <em>{counts.get(k)}</em>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {picked && (
        <div className="mdl-inspect" role="dialog" aria-label={picked.name}>
          <h3>{picked.name}</h3>
          <dl>
            <dt>Layer</dt>
            <dd>{CATEGORIES.find(([k]) => k === picked.category)?.[1] ?? picked.category}</dd>
            {picked.level && (
              <>
                <dt>Level</dt>
                <dd>{picked.level}</dd>
              </>
            )}
            <dt>Finish</dt>
            <dd>{picked.material.replace(/_/g, ' ')}</dd>
            <dt>Source</dt>
            <dd>{picked.source || '—'}</dd>
            <dt>Basis</dt>
            <dd>{picked.basis || '—'}</dd>
          </dl>
          <button
            onClick={() => {
              const x = r.current;
              if (x) {
                x.m.selected = null;
                x.m.apply();
                x.invalidate();
              }
              setPicked(null);
            }}
          >
            Close
          </button>
        </div>
      )}
      {!stateOf && scene.elements.length > 0 && (
        <div className="mdl-seq">
          <button onClick={playSeq} aria-pressed={seqPlaying} title="Show the building going up in construction order">
            {seqPlaying ? '■ Stop' : '▶ Build sequence'}
          </button>
          {seq !== null && (
            <span>
              <em>
                {seq + 1}/{PHASES.length}
              </em>{' '}
              {PHASES[seq].label}
            </span>
          )}
        </div>
      )}
      {step && (
        <>
          {tourBox && <div className="mdl-ring" style={{ left: tourBox.x - 6, top: tourBox.y - 6, width: tourBox.w + 12, height: tourBox.h + 12 }} aria-hidden="true" />}
          <div className={`mdl-tour ${tourBox ? '' : 'center'}`} role="dialog" aria-label={step.title} style={tourCardPos(tourBox, host.current)}>
            <small>
              Tour · {tourStep + 1} of {TOUR.length}
            </small>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <div className="mdl-tour-btns">
              <button className="ghost" onClick={endTour}>
                {tourStep === TOUR.length - 1 ? 'Close' : 'Skip tour'}
              </button>
              {tourStep > 0 && <button onClick={() => setTourStep((n) => n - 1)}>Back</button>}
              {tourStep < TOUR.length - 1 ? (
                <button className="primary" onClick={() => setTourStep((n) => n + 1)}>
                  Next
                </button>
              ) : (
                <button className="primary" onClick={endTour}>
                  Done
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div className="mdl-credit">
        {scene.title} · built by {scene.builtBy} from the drawings · not a coordinated BIM model
      </div>
    </div>
  );
}

/** Where the tour card goes: beside the ringed control, inside the model, or in the middle. */
function tourCardPos(box: { x: number; y: number; w: number; h: number } | null, host: HTMLElement | null): CSSProperties {
  if (!box || !host) return {};
  const W = host.clientWidth, H = host.clientHeight, cw = Math.min(340, W - 24), ch = 190;
  const below = box.y + box.h + 16;
  const above = box.y - ch - 16;
  const top = below + ch < H ? below : above > 8 ? above : Math.max(8, Math.min(H - ch - 8, box.y));
  const left = Math.max(12, Math.min(W - cw - 12, box.x + box.w / 2 - cw / 2));
  return { top, left, width: cw };
}
