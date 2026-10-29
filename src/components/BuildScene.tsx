import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tradeByKey } from '../build/extract';
import type { BuildElement, BuildModel } from '../build/types';

/**
 * The proposed building, drawn from the model: walls and runs extruded along their lines,
 * floors and ceilings as slabs, counted things as boxes. Each element shows the state its
 * activity is in on the day being shown — not started (a faint ghost), being built (lit in its
 * trade's colour), done (solid); existing work to be demolished stands until it's taken out.
 */

export type ElementState = 'todo' | 'doing' | 'done' | 'existing' | 'removing' | 'gone';

interface Props {
  model: BuildModel;
  /** Each element's state on the day shown. */
  stateOf: (e: BuildElement) => ElementState;
  /** Changes when the states need recomputing (the day, the schedule). */
  stateKey: string;
  selected: string | null;
  /** Elements of the selected activity. */
  highlight: Set<string> | null;
  levels: Set<string>;
  trades: Set<string>;
  showGhosts: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

function geometryOf(e: BuildElement): THREE.BufferGeometry | null {
  const s = e.shape;
  if (!s) return null;
  if (s.type === 'run') {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 1; i < s.points.length; i++) {
      const [x1, y1] = s.points[i - 1];
      const [x2, y2] = s.points[i];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 0.02) continue;
      const g = new THREE.BoxGeometry(len, s.height, s.thickness);
      g.rotateY(-Math.atan2(y2 - y1, x2 - x1));
      g.translate((x1 + x2) / 2, s.z0 + s.height / 2, (y1 + y2) / 2);
      parts.push(g);
    }
    if (!parts.length) return null;
    const g = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    if (parts.length > 1) for (const p of parts) p.dispose();
    return g;
  }
  if (s.type === 'surface') {
    if (s.ring.length < 3) return null;
    const shape = new THREE.Shape(s.ring.map(([x, y]) => new THREE.Vector2(x, -y)));
    for (const h of s.holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: s.thickness, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, s.z, 0);
    return g;
  }
  const g = new THREE.BoxGeometry(s.size[0], s.size[2], s.size[1]);
  g.translate(s.at[0], s.z + s.size[2] / 2, s.at[1]);
  return g;
}

export function BuildScene({ model, stateOf, stateKey, selected, highlight, levels, trades, showGhosts, onSelect, onHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const meshes = useRef(new Map<string, { mesh: THREE.Mesh; el: BuildElement; state?: ElementState }>());
  const scene = useRef<{ s: THREE.Scene; mats: (trade: string, st: ElementState) => THREE.Material; outline: THREE.Group; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls; fit: () => void } | null>(null);
  const cb = useRef({ onSelect, onHover });
  cb.current = { onSelect, onHover };

  // The scene, made once per model.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const s = new THREE.Scene();
    s.background = new THREE.Color('#0b0f1a');
    s.fog = new THREE.Fog('#0b0f1a', 260, 900);
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.5, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    s.add(new THREE.HemisphereLight('#dfe8ff', '#20283a', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(60, 120, 40);
    s.add(sun);
    const [x0, y0, x1, y1] = model.extent;
    const span = Math.max(20, x1 - x0, y1 - y0);
    const grid = new THREE.GridHelper(Math.ceil(span * 1.6), Math.ceil((span * 1.6) / 2), '#2a3550', '#161d2e');
    grid.position.y = -0.02;
    s.add(grid);

    // Materials: one per trade and state, shared.
    const cache = new Map<string, THREE.Material>();
    const mats = (trade: string, st: ElementState) => {
      const k = `${trade}|${st}`;
      let m = cache.get(k);
      if (m) return m;
      const c = new THREE.Color(tradeByKey.get(trade)?.colour ?? '#b8c4ff');
      if (st === 'todo') m = new THREE.MeshBasicMaterial({ color: '#8fa3d6', transparent: true, opacity: 0.06, depthWrite: false });
      else if (st === 'doing') m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.75, roughness: 0.5 });
      else if (st === 'existing') m = new THREE.MeshStandardMaterial({ color: '#c9a7a7', transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false });
      else if (st === 'removing') m = new THREE.MeshStandardMaterial({ color: '#ff6b6b', emissive: '#ff3b30', emissiveIntensity: 0.8, transparent: true, opacity: 0.8 });
      else m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.05 });
      cache.set(k, m);
      return m;
    };
    const outline = new THREE.Group();
    s.add(outline);

    // The elements.
    meshes.current.clear();
    for (const e of model.elements) {
      const g = geometryOf(e);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mats(e.trade, 'todo'));
      mesh.userData.id = e.id;
      s.add(mesh);
      meshes.current.set(e.id, { mesh, el: e });
    }

    const top = Math.max(3, ...model.levels.map((l) => l.elevation + 4));
    const fit = () => {
      const r = span * 0.9;
      camera.position.set(r * 0.7, top + r * 0.75, r * 0.95);
      controls.target.set(0, top / 3, 0);
      controls.update();
    };
    fit();
    scene.current = { s, mats, outline, renderer, camera, controls, fit };

    let raf = 0;
    const frame = () => {
      controls.update();
      renderer.render(s, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    // Picking: a click (not a drag) selects; hovering names.
    const ray = new THREE.Raycaster();
    const pickAt = (ev: PointerEvent): string | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      const vis = [...meshes.current.values()].filter((x) => x.mesh.visible && x.state !== 'todo' && x.state !== 'gone').map((x) => x.mesh);
      const ghosts = [...meshes.current.values()].filter((x) => x.mesh.visible && x.state === 'todo').map((x) => x.mesh);
      const hit = ray.intersectObjects(vis, false)[0] ?? ray.intersectObjects(ghosts, false)[0];
      return (hit?.object.userData.id as string) ?? null;
    };
    let down: [number, number] | null = null;
    const onDown = (ev: PointerEvent) => (down = [ev.clientX, ev.clientY]);
    const onUp = (ev: PointerEvent) => {
      if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5) cb.current.onSelect(pickAt(ev));
      down = null;
    };
    let last = 0;
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons || performance.now() - last < 60) return;
      last = performance.now();
      cb.current.onHover(pickAt(ev));
    };
    const onLeave = () => cb.current.onHover(null);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    if (import.meta.env.DEV) Object.assign(window, { __buildScene: { scene: s, camera, meshes: meshes.current } });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const { mesh } of meshes.current.values()) mesh.geometry.dispose();
      for (const m of cache.values()) m.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      scene.current = null;
    };
  }, [model]);

  // States on the day shown, filters, and the selection.
  useEffect(() => {
    const sc = scene.current;
    if (!sc) return;
    for (const x of meshes.current.values()) {
      const st = stateOf(x.el);
      const shown = (x.el.level ? levels.has(x.el.level) : true) && trades.has(x.el.trade) && st !== 'gone' && (showGhosts || st !== 'todo');
      x.mesh.visible = shown;
      if (st !== x.state) {
        x.state = st;
        x.mesh.material = sc.mats(x.el.trade, st);
        x.mesh.renderOrder = st === 'todo' || st === 'existing' ? 2 : 0;
      }
    }
    // The selection, outlined (and an activity's elements).
    for (const c of [...sc.outline.children]) {
      sc.outline.remove(c);
      (c as THREE.LineSegments).geometry.dispose();
    }
    const ids = new Set<string>([...(highlight ?? []), ...(selected ? [selected] : [])]);
    const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false });
    let n = 0;
    for (const id of ids) {
      const x = meshes.current.get(id);
      if (!x || !x.mesh.visible || n++ > 600) continue;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(x.mesh.geometry, 30), id === selected ? new THREE.LineBasicMaterial({ color: '#ffd60a', depthTest: false }) : mat);
      edges.renderOrder = 20;
      sc.outline.add(edges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, selected, highlight, levels, trades, showGhosts, model]);

  return <div className="bld-scene" ref={host} />;
}
