import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CATEGORIES, type Element3D, type Scene3D } from '../scene3d/scene';
import { MODEL_VIEWS, ModelRenderer, layerColour, type ElementState, type ModelView } from '../scene3d/render';
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
}

export function ModelScene({ scene, stateOf, stateKey }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const r = useRef<{ m: ModelRenderer; controls: OrbitControls; invalidate: () => void; fly: (to: THREE.Vector3, target: THREE.Vector3) => void; fitted: boolean } | null>(null);
  const [view, setView] = useState<ModelView>('exterior');
  const [layers, setLayers] = useState<Set<string>>(() => new Set(CATEGORIES.map(([k]) => k).filter((k) => k !== 'ceiling')));
  const [cut, setCut] = useState<number | null>(null);
  const [focus, setFocus] = useState<Set<string> | null>(null);
  const [picked, setPicked] = useState<Element3D | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
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
    const frame = (now: number) => {
      if (flying) {
        const t = Math.min(1, (now - flying.t0) / 850);
        const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        m.camera.position.lerpVectors(flying.from, flying.to, k);
        controls.target.lerpVectors(flying.tf, flying.tt, k);
        if (t >= 1) flying = null;
        dirty = true;
      }
      if (controls.update()) dirty = true;
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
    };
    // Picking: a click (not a drag).
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
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
    cv.addEventListener('pointerup', onUp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointerup', onUp);
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
    x.m.setStates(stateOf ?? null);
    x.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  useEffect(() => {
    const x = r.current;
    if (!x) return;
    x.m.view = { layers, cut, focus };
    x.m.apply();
    x.invalidate();
  }, [layers, cut, focus]);

  const go = (v: ModelView) => {
    const x = r.current;
    if (!x) return;
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
          <button key={v.id} className={view === v.id ? 'on' : ''} aria-pressed={view === v.id} onClick={() => go(v.id)} title={v.sub}>
            {v.label}
          </button>
        ))}
        <label className="mdl-cut" title="Section cut: hide everything above this height">
          <span>Cut</span>
          <input type="range" min={-1} max={top + 0.5} step={0.05} value={cut ?? top + 0.5} onChange={(e) => setCut(Number(e.target.value) >= top + 0.45 ? null : Number(e.target.value))} />
          <em>{cut === null ? 'off' : `${cut.toFixed(2)} m`}</em>
        </label>
      </div>
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
      <div className="mdl-credit">
        {scene.title} · built by {scene.builtBy} from the drawings · not a coordinated BIM model
      </div>
    </div>
  );
}
