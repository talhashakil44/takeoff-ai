import { geometryOf } from '../build/sceneGeometry';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuildElement, BuildModel } from '../build/types';

/**
 * The proposed building, drawn from the model: walls and runs extruded along their lines,
 * floors and ceilings as slabs, counted things as boxes. Each element shows the state its
 * activity is in on the day shown — not started (a faint ghost), being built (lit), done
 * (solid); existing work to be demolished stands until it's taken out. Like a BIM viewer:
 * exploded by level and by system, cut by a section plane, isolated, coloured by any
 * parameter, seen from preset views.
 */

export type ElementState = | 'todo' | 'doing' | 'done' | 'existing' | 'removing' | 'gone';
/**
 * Where the camera goes to show a box filling the view, looking along -dir: far enough that
 * every corner of the box is inside the frustum (both ways), with a little margin.
 */
function fitCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3, dir: THREE.Vector3): { position: THREE.Vector3; target: THREE.Vector3 } {
  const c = box.getCenter(new THREE.Vector3());
  const v = dir.clone().normalize();
  const worldUp = Math.abs(v.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, v).normalize();
  const up = new THREE.Vector3().crossVectors(v, right).normalize();
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  const corners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  let d = 0;
  // A box seen at an angle is not centred on its centre: aim at the middle of what is seen.
  for (let pass = 0; pass < 3; pass++) {
    d = 0;
    for (const k of corners) {
      const p = k.clone().sub(c);
      const z = p.dot(v);
      d = Math.max(d, z + Math.abs(p.dot(right)) / tanH, z + Math.abs(p.dot(up)) / tanV);
    }
    if (pass === 2) break;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const k of corners) {
      const p = k.clone().sub(c);
      const w = d - p.dot(v);
      const sx = p.dot(right) / (w * tanH);
      const sy = p.dot(up) / (w * tanV);
      [x0, x1, y0, y1] = [Math.min(x0, sx), Math.max(x1, sx), Math.min(y0, sy), Math.max(y1, sy)];
    }
    c.addScaledVector(right, ((x0 + x1) / 2) * d * tanH).addScaledVector(up, ((y0 + y1) / 2) * d * tanV);
  }
  d = Math.max(3, d * 1.14);
  return { position: c.clone().add(v.multiplyScalar(d)), target: c };
}

export type ViewCommand = { kind: 'iso' | 'top' | 'front' | 'side' | 'frame'; n: number };

interface Props {
  model: BuildModel;
  /** Each element's state on the day shown. */
  stateOf: (e: BuildElement) => ElementState;
  /** Each element's colour in the current colour mode. */
  colourOf: (e: BuildElement) => string;
  /** Changes when states or colours need recomputing. */
  stateKey: string;
  selected: string | null;
  /** Elements to outline (an activity's, a type's). */
  highlight: Set<string> | null;
  /** Only these are shown, when set. */
  isolate: Set<string> | null;
  hidden: Set<string>;
  showGhosts: boolean;
  /** 0–1: levels pulled apart, and (above 0.5) the systems within each level. */
  explode: number;
  explodeSystems: boolean;
  /** Section cut: metres above the lowest floor; null = none. */
  cut: number | null;
  view: ViewCommand | null;
  /** Order of trades for exploding systems. */
  tradeOrder: Map<string, number>;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}


interface Item {
  mesh: THREE.Mesh;
  el: BuildElement;
  state?: ElementState;
  colour?: string;
  level: number;
}

export function BuildScene(props: Props) {
  const { model, stateKey, selected, highlight, isolate, hidden, showGhosts, explode, explodeSystems, cut, view } = props;
  const host = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<string, Item>());
  const scene = useRef<{
    s: THREE.Scene;
    mat: (colour: string, st: ElementState) => THREE.Material;
    outline: THREE.Group;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    plane: THREE.Plane;
    cutCap: THREE.Mesh;
    levelLabels: THREE.Group;
    span: number;
    top: number;
    invalidate: () => void;
  } | null>(null);
  const compass = useRef<HTMLButtonElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const fly = useRef<{ from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number } | null>(null);

  // The scene, made once per model.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const s = new THREE.Scene();
    // A studio sky: dark at the top, a lift at the horizon.
    const sky = document.createElement('canvas');
    sky.width = 2;
    sky.height = 256;
    const sx = sky.getContext('2d')!;
    const grad = sx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#202b36');
    grad.addColorStop(0.65, '#293642');
    grad.addColorStop(1, '#3a4854');
    sx.fillStyle = grad;
    sx.fillRect(0, 0, 2, 256);
    s.background = new THREE.CanvasTexture(sky);
    const [x0, y0, x1, y1] = model.extent;
    const span = Math.max(20, x1 - x0, y1 - y0);
    const centerX = (x0 + x1) / 2, centerY = (y0 + y1) / 2;
    s.fog = new THREE.Fog('#293642', span * 3, span * 9);
    const camera = new THREE.PerspectiveCamera(38, el.clientWidth / el.clientHeight, 0.3, span * 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * 0.495;
    s.add(new THREE.HemisphereLight('#e6eeff', '#1c2233', 0.9));
    const sun = new THREE.DirectionalLight('#fff4e6', 1.8);
    sun.position.set(centerX + span * 0.6, span * 1.2, centerY + span * 0.4);
    sun.target.position.set(centerX, 0, centerY);
    s.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.far = span * 4;
    sun.shadow.bias = -0.0005;
    s.add(sun);
    const fill = new THREE.DirectionalLight('#9fb8ff', 0.5);
    fill.position.set(-span, span * 0.5, -span * 0.6);
    s.add(fill);
    // Ground: a shadow catcher and a fine grid.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 6, span * 6), new THREE.ShadowMaterial({ opacity: 0.35 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.03, centerY);
    ground.receiveShadow = true;
    s.add(ground);
    const grid = new THREE.GridHelper(Math.ceil(span * 3), Math.ceil((span * 3) / 2), '#45515c', '#303d48');
    grid.position.set(centerX, -0.04, centerY);
    for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) { material.transparent=true; material.opacity=.18; }
    s.add(grid);

    // The section plane (keeps what is below it) and its materials.
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
    const cache = new Map<string, THREE.Material>();
    const mat = (colour: string, st: ElementState) => {
      const k = `${colour}|${st}`;
      let m = cache.get(k);
      if (m) return m;
      const c = new THREE.Color(colour);
      if (st === 'todo') m = new THREE.MeshBasicMaterial({ color: '#8fa3d6', transparent: true, opacity: 0.05, depthWrite: false });
      else if (st === 'doing') m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.45 });
      else if (st === 'existing') m = new THREE.MeshStandardMaterial({ color: "#aeb5bf", transparent: true, opacity: 1, roughness: 0.9, depthWrite: true });
      else if (st === 'removing') m = new THREE.MeshStandardMaterial({ color: '#ff6b6b', emissive: '#ff3b30', emissiveIntensity: 0.7, transparent: true, opacity: 0.85 });
      else m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.04 });
      m.clippingPlanes = [plane];
      m.side = THREE.DoubleSide;
      cache.set(k, m);
      return m;
    };
    // The cut's cap: a faint red glass at the section height.
    const cutCap = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.6, span * 1.6), new THREE.MeshBasicMaterial({ color: '#ff5f57', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    cutCap.rotation.x = -Math.PI / 2;
    cutCap.position.set(centerX, 0, centerY);
    cutCap.visible = false;
    s.add(cutCap);
    const outline = new THREE.Group();
    s.add(outline);
    const levelLabels = new THREE.Group();
    s.add(levelLabels);

    // The elements.
    items.current.clear();
    const levelIndex = new Map(model.levels.map((l, i) => [l.id, i]));
    for (const e of model.elements) {
      const g = geometryOf(e);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat('#8fa3d6', 'todo'));
      mesh.userData.id = e.id;
      mesh.castShadow = e.shape?.type !== 'point';
      mesh.receiveShadow = true;
      s.add(mesh);
      items.current.set(e.id, { mesh, el: e, level: levelIndex.get(e.level ?? '') ?? 0 });
    }
    const top = Math.max(3, ...model.levels.map((l) => l.elevation + 4));
    scene.current = { s, mat, outline, renderer, camera, controls, plane, cutCap, levelLabels, span, top, invalidate: () => {} };
    {
      // Start on the whole building, filling the view, from the usual three-quarter angle.
      const box = new THREE.Box3();
      const context=[...items.current.values()].filter(x=>x.el.origin==='building');
      for (const x of context.length ? context : items.current.values()) box.expandByObject(x.mesh);
      if (box.isEmpty()) box.set(new THREE.Vector3(-span / 2, 0, -span / 2), new THREE.Vector3(span / 2, top, span / 2));
      const to = fitCamera(camera, box, new THREE.Vector3(0.62, 0.62, 0.8).normalize());
      camera.position.copy(to.position);
      controls.target.copy(to.target);
      controls.update();
    }

    // Drawn on demand: when the camera moves or the model changes, not sixty times a second.
    let dirty = true;
    scene.current.invalidate = () => (dirty = true);
    controls.addEventListener('change', () => (dirty = true));
    let raf = 0;
    const frame = (now: number) => {
      const f = fly.current;
      if (f) {
        dirty = true;
        const t = Math.min(1, (now - f.t0) / 700);
        const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        camera.position.lerpVectors(f.from, f.to, k);
        controls.target.lerpVectors(f.tFrom, f.tTo, k);
        if (t >= 1) fly.current = null;
      }
      if (controls.update()) dirty = true;
      if (dirty) {
        dirty = false;
        renderer.render(s, camera);
        // The compass: which way the sheets' up is on the screen now.
        const c = compass.current;
        if (c) c.style.setProperty('--az', `${Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z)}rad`);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
      dirty = true;
    });
    ro.observe(el);

    // Picking: a click (not a drag) selects; hovering names.
    const ray = new THREE.Raycaster();
    const pickAt = (ev: PointerEvent): string | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      const all = [...items.current.values()].filter((x) => x.mesh.visible);
      const solid = all.filter((x) => x.state !== 'todo').map((x) => x.mesh);
      const ghosts = all.filter((x) => x.state === 'todo').map((x) => x.mesh);
      const below = (h: THREE.Intersection) => plane.distanceToPoint(h.point) >= -0.01;
      const hit = ray.intersectObjects(solid, false).find(below) ?? ray.intersectObjects(ghosts, false).find(below);
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
    const onDbl = (ev: MouseEvent) => {
      const id = pickAt(ev as PointerEvent);
      const it = id ? items.current.get(id) : null;
      if (it) frameBox(new THREE.Box3().setFromObject(it.mesh));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('dblclick', onDbl);
    if (import.meta.env.DEV) Object.assign(window, { __buildScene: { scene: s, camera, meshes: items.current } });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      fly.current = null;
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>(cache.values());
      s.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      if (s.background instanceof THREE.Texture) s.background.dispose();
      sun.shadow.dispose();
      items.current.clear();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      scene.current = null;
    };
  }, [model]);

  /** Flies the camera to frame a box, from the side it is seen from now (or snaps there). */
  const frameBox = (box: THREE.Box3, dir?: THREE.Vector3, snap = false) => {
    const sc = scene.current;
    if (!sc || box.isEmpty()) return;
    const to = fitCamera(sc.camera, box, dir ?? sc.camera.position.clone().sub(sc.controls.target).normalize());
    if (snap) {
      sc.camera.position.copy(to.position);
      sc.controls.target.copy(to.target);
      sc.controls.update();
      return;
    }
    fly.current = { from: sc.camera.position.clone(), to: to.position, tFrom: sc.controls.target.clone(), tTo: to.target, t0: performance.now() };
  };

  // Preset views and framing.
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !view) return;
    const box = new THREE.Box3();
    const sel = selected ? items.current.get(selected) : null;
    if (view.kind === 'frame' && sel) box.setFromObject(sel.mesh);
    else for (const x of items.current.values()) if (x.mesh.visible && (!highlight || highlight.has(x.el.id) || view.kind !== 'frame')) box.expandByObject(x.mesh);
    const dirs: Record<string, THREE.Vector3> = { iso: new THREE.Vector3(0.62, 0.62, 0.8), top: new THREE.Vector3(0, 1, 0.0001), front: new THREE.Vector3(0, 0.12, 1), side: new THREE.Vector3(1, 0.12, 0) };
    frameBox(box, view.kind === 'frame' ? undefined : dirs[view.kind].clone().normalize());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.n]);

  // States, colours, filters, explode and the cut.
  useEffect(() => {
    const sc = scene.current;
    if (!sc) return;
    const { stateOf, colourOf, tradeOrder } = cb.current;
    const lift = explode * Math.max(6, sc.span * 0.22);
    const layer = explodeSystems ? explode * 2.2 : 0;
    for (const x of items.current.values()) {
      const st = stateOf(x.el);
      const colour = colourOf(x.el);
      const shown = !hidden.has(x.el.id) && (!isolate || isolate.has(x.el.id)) && st !== 'gone' && (showGhosts || st !== 'todo');
      x.mesh.visible = shown;
      if (st !== x.state || colour !== x.colour) {
        x.state = st;
        x.colour = colour;
        x.mesh.material = sc.mat(colour, st);
        x.mesh.renderOrder = st === 'todo' || st === 'existing' ? 2 : 0;
      }
      x.mesh.position.y = x.level * lift + (tradeOrder.get(x.el.trade) ?? 0) * layer;
    }
    // The cut, measured from the lowest floor (and lifted with an exploded level, it cuts each level alike).
    if (cut === null) {
      sc.plane.constant = 1e6;
      sc.cutCap.visible = false;
    } else {
      sc.plane.constant = cut;
      sc.cutCap.position.y = cut;
      sc.cutCap.visible = true;
    }
    // The selection, outlined (and an activity's or type's elements).
    for (const c of [...sc.outline.children]) {
      sc.outline.remove(c);
      (c as THREE.LineSegments).geometry.dispose();
      const material = (c as THREE.LineSegments).material;
      for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    }
    const ids = new Set<string>([...(highlight ?? []), ...(selected ? [selected] : [])]);
    const mat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false });
    const selMat = new THREE.LineBasicMaterial({ color: '#ffd60a', depthTest: false });
    let n = 0;
    for (const id of ids) {
      const x = items.current.get(id);
      if (!x || !x.mesh.visible || n++ > 800) continue;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(x.mesh.geometry, 30), id === selected ? selMat : mat);
      edges.position.copy(x.mesh.position);
      edges.renderOrder = 20;
      sc.outline.add(edges);
    }
    if (!sc.outline.children.some(c => (c as THREE.LineSegments).material === mat)) mat.dispose();
    if (!sc.outline.children.some(c => (c as THREE.LineSegments).material === selMat)) selMat.dispose();
    sc.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, selected, highlight, isolate, hidden, showGhosts, explode, explodeSystems, cut, model]);

  const toTop = () => {
    const sc = scene.current;
    if (!sc) return;
    const box = new THREE.Box3();
    for (const x of items.current.values()) if (x.mesh.visible) box.expandByObject(x.mesh);
    frameBox(box, new THREE.Vector3(0, 1, 0.0001));
  };
  return (
    <div className="bld-scene" ref={host}>
      <button className="bld-compass" ref={compass} onClick={toTop} aria-label="View plan with sheet top up" title="Sheet top — drawing north may differ. Click for plan view.">
        <svg viewBox="-22 -22 44 44" width="46" height="46">
          <circle r="20" className="ring" />
          <g className="needle">
            <path d="M0 -11 L4 1 L0 -1.5 L-4 1 Z" className="n" />
            <path d="M0 11 L4 1 L0 3.5 L-4 1 Z" className="s" />
            <text y="-15.5" textAnchor="middle" dominantBaseline="central">UP</text>
          </g>
        </svg>
      </button>
    </div>
  );
}
