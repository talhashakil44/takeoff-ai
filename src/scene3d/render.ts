import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CATEGORIES, MATERIALS, bounds, elementMesh, type Element3D, type Scene3D } from './scene';

/**
 * Draws a Scene3D as an architect's model: daylight, soft shadows, ambient occlusion, textured
 * finishes. Used by the model view in Build It and, off screen, to give the AI a picture of what
 * it has built (view_3d_model).
 */

export type ModelView = 'exterior' | 'exterior_ne' | 'cutaway' | 'plan' | 'structure' | 'services' | 'site';
export const MODEL_VIEWS: { id: ModelView; label: string; sub: string }[] = [
  { id: 'exterior', label: 'Exterior', sub: 'From the south-west' },
  { id: 'exterior_ne', label: 'Rear', sub: 'From the north-east' },
  { id: 'cutaway', label: 'Cutaway', sub: 'Cut at 1.8 m above each floor shown' },
  { id: 'structure', label: 'Structure', sub: 'Frame and foundations' },
  { id: 'services', label: 'Services', sub: 'Mechanical, electrical, plumbing' },
  { id: 'plan', label: 'Plan', sub: 'Top down, cut at 1.8 m' },
  { id: 'site', label: 'Site', sub: 'The whole site' },
];
export type ElementState = 'todo' | 'doing' | 'done';

const LAYER_COLOUR: Record<string, string> = {
  envelope: '#c9b48f', roof: '#4a3a33', glazing: '#8fb9cc', doors: '#e8e6df', structure: '#c45a2a', floor: '#a9adaa', interior: '#ece6da', stairs: '#3e4c55',
  mechanical: '#3f8fb0', electrical: '#f2d16b', plumbing: '#30383c', fixtures: '#f2f2ef', furniture: '#8a6a4a', ceiling: '#f4f4f1', foundation: '#9c9e98',
  civil: '#6b5a48', paving: '#4b4f52', site: '#7f9a5c', context: '#9aa39b',
};
export const layerColour = (k: string) => LAYER_COLOUR[k] ?? '#999999';

// --------------------------------------------------------------------------- finishes

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;
const noise = (base: string, amt: number): Draw => (g, w, h) => {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d.data[i] += n;
    d.data[i + 1] += n;
    d.data[i + 2] += n;
  }
  g.putImageData(d, 0, 0);
};
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const PATTERNS: Record<string, (c: string) => { w: number; h: number; size: number; draw: Draw }> = {
  block: (c) => ({ w: 256, h: 256, size: 0.8, draw: (g, w) => { g.fillStyle = c; g.fillRect(0, 0, w, w); g.strokeStyle = shade(c, 0.78); g.lineWidth = 3; for (let r = 0; r < 4; r++) { const y = r * 64; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let k = 0; k < 3; k++) { const x = (k * 128 + (r % 2) * 64) % w; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } } } }),
  brick: (c) => ({ w: 256, h: 256, size: 0.8, draw: (g, w) => { g.fillStyle = '#cfc7bb'; g.fillRect(0, 0, w, w); for (let r = 0; r < 12; r++) for (let k = -1; k < 4; k++) { g.fillStyle = shade(c, 0.85 + ((r * 7 + k * 3) % 5) * 0.06); g.fillRect(k * 80 + (r % 2) * 40 + 2, r * 21.3 + 2, 76, 18); } } }),
  ribs: (c) => ({ w: 256, h: 64, size: 2, draw: (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); for (let k = 0; k <= 8; k++) gr.addColorStop(k / 8, k % 2 ? shade(c, 1.06) : shade(c, 0.94)); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(40,30,20,.3)'; for (let k = 0; k < 2; k++) g.fillRect(k * 128 + 126, 0, 3, h); } }),
  seam: (c) => ({ w: 128, h: 64, size: 0.5, draw: (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = shade(c, 1.2); g.fillRect(0, 0, 6, h); g.fillStyle = shade(c, 0.75); g.fillRect(6, 0, 3, h); } }),
  noise: (c) => ({ w: 256, h: 256, size: 2.5, draw: noise(c, 20) }),
  grass: (c) => ({ w: 256, h: 256, size: 6, draw: (g, w, h) => { noise(c, 40)(g, w, h); g.fillStyle = 'rgba(40,60,20,.08)'; for (let i = 0; i < 400; i++) g.fillRect((i * 97) % w, (i * 53) % h, 2, 6); } }),
  panels: (c) => ({ w: 64, h: 256, size: 1.4, draw: (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,.13)'; for (let k = 0; k < 16; k++) g.fillRect(0, k * 16, w, 2); } }),
  planks: (c) => ({ w: 256, h: 256, size: 1.6, draw: (g, w) => { for (let k = 0; k < 8; k++) { g.fillStyle = shade(c, 0.9 + ((k * 5) % 4) * 0.06); g.fillRect(0, k * 32, w, 30); } } }),
  tile: (c) => ({ w: 128, h: 128, size: 1.2, draw: (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.strokeStyle = shade(c, 0.85); g.lineWidth = 2; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32, h); g.moveTo(0, k * 32); g.lineTo(w, k * 32); g.stroke(); } } }),
};

class Finishes {
  private textures = new Map<string, THREE.Texture>();
  private cache = new Map<string, THREE.Material>();
  readonly clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
  readonly ghost = new THREE.MeshStandardMaterial({ color: '#c9d2d6', transparent: true, opacity: 0.1, depthWrite: false, roughness: 1, side: THREE.DoubleSide, clippingPlanes: [this.clip] });

  /** A material key, or a #colour. */
  look(key: string, colour?: string) {
    const d = MATERIALS[key] ?? { color: colour ?? (/^#[0-9a-f]{6}$/i.test(key) ? key : '#b8b8b4'), rough: 0.7 };
    return { ...d, color: colour ?? d.color };
  }
  textureSize(key: string) {
    const d = this.look(key);
    return d.pattern ? PATTERNS[d.pattern]?.(d.color).size ?? 1 : 1;
  }
  get(key: string, colour?: string, state: ElementState | 'selected' = 'done'): THREE.Material {
    const k = `${key}|${colour ?? ''}|${state}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const d = this.look(key, colour);
    let map: THREE.Texture | null = null;
    if (d.pattern && PATTERNS[d.pattern] && typeof document !== 'undefined') {
      const tk = `${d.pattern}|${d.color}`;
      map = this.textures.get(tk) ?? null;
      if (!map) {
        const p = PATTERNS[d.pattern](d.color);
        const c = document.createElement('canvas');
        c.width = p.w;
        c.height = p.h;
        p.draw(c.getContext('2d')!, p.w, p.h);
        map = new THREE.CanvasTexture(c);
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 8;
        this.textures.set(tk, map);
      }
    }
    const opts: THREE.MeshPhysicalMaterialParameters = {
      color: map ? '#ffffff' : d.color, map, roughness: d.rough ?? 0.7, metalness: d.metal ?? 0, side: THREE.DoubleSide, clippingPlanes: [this.clip],
    };
    if (key === 'light') Object.assign(opts, { emissive: '#fff3c0', emissiveIntensity: 0.6 });
    if (d.opacity !== undefined) Object.assign(opts, { transparent: true, opacity: d.opacity, depthWrite: d.opacity > 0.6 });
    if (state === 'doing') Object.assign(opts, { emissive: '#ff9f43', emissiveIntensity: 0.45 });
    if (state === 'selected') Object.assign(opts, { emissive: '#e2611b', emissiveIntensity: 0.55 });
    const m = key === 'glass' ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 0.6, envMapIntensity: 1.6 }) : new THREE.MeshStandardMaterial(opts);
    this.cache.set(k, m);
    return m;
  }
  dispose() {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.ghost.dispose();
  }
}

/** An element as three geometry: Z-up metres to three's Y-up, UVs projected per face in metres of texture. */
export function elementGeometry(e: Element3D, textureSize = 1): THREE.BufferGeometry {
  const m = elementMesh(e);
  const v = m.positions;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = [m.indices[i] * 3, m.indices[i + 1] * 3, m.indices[i + 2] * 3];
    const A = [v[a], v[a + 1], v[a + 2]], B = [v[b], v[b + 1], v[b + 2]], C = [v[c], v[c + 1], v[c + 2]];
    const n = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
    const [ax, ay, az] = n.map(Math.abs);
    for (const P of [A, B, C]) {
      pos.push(P[0], P[2], -P[1]);
      if (az >= ax && az >= ay) uv.push(P[0] / textureSize, P[1] / textureSize);
      else if (ax >= ay) uv.push(P[1] / textureSize, P[2] / textureSize);
      else uv.push(P[0] / textureSize, P[2] / textureSize);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

interface Item {
  mesh: THREE.Mesh;
  el: Element3D;
  z0: number;
  state: ElementState;
}

export interface ViewState {
  layers: Set<string>;
  /** Cut height above the model's 0 (m), or null. */
  cut: number | null;
  /** Layers drawn solid; the rest faint (a view of the structure or services). */
  focus: Set<string> | null;
}

/** Everything the model needs to be drawn: scene, lights, camera, its elements. */
export class ModelRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.2, 4000);
  readonly finishes = new Finishes();
  readonly items: Item[] = [];
  private composer: EffectComposer;
  private gtao: GTAOPass | null = null;
  private pmrem: THREE.PMREMGenerator;
  private sun = new THREE.DirectionalLight('#fff0d6', 2.6);
  private ground: THREE.Mesh | null = null;
  /** The building's box (Y-up), without the context and site. */
  box = new THREE.Box3();
  /** Everything's box. */
  all = new THREE.Box3();
  view: ViewState = { layers: new Set(CATEGORIES.map(([k]) => k).filter((k) => k !== 'ceiling')), cut: null, focus: null };
  selected: Item | null = null;
  /** Goes up whenever the meshes or what is shown change (walking keeps its lists by it). */
  version = 0;
  /** A lamp at the eye while walking, so rooms under the roof aren't dark. Off (0) otherwise. */
  private lamp = new THREE.PointLight('#fff2df', 0, 26, 1.1);

  constructor(canvas?: HTMLCanvasElement, opts: { preserve?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    const r = this.renderer;
    r.setPixelRatio(Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.localClippingEnabled = true;
    const s = this.scene;
    const sky = document.createElement('canvas');
    sky.width = 4;
    sky.height = 512;
    const g = sky.getContext('2d')!;
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#5f88b3');
    gr.addColorStop(0.55, '#a9c3d9');
    gr.addColorStop(0.8, '#dfe6e8');
    gr.addColorStop(1, '#eceae3');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 512);
    const skyT = new THREE.CanvasTexture(sky);
    skyT.colorSpace = THREE.SRGBColorSpace;
    s.background = skyT;
    this.pmrem = new THREE.PMREMGenerator(r);
    s.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.45;
    s.add(new THREE.HemisphereLight('#e4eefb', '#7d7462', 0.65));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    s.add(this.sun, this.sun.target);
    s.add(this.lamp);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(s, this.camera));
    try {
      this.gtao = new GTAOPass(s, this.camera, 800, 600);
      this.gtao.blendIntensity = 0.9;
      this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1 });
      this.composer.addPass(this.gtao);
    } catch {
      this.gtao = null;
    }
    this.composer.addPass(new OutputPass());
  }

  /** (Re)builds the meshes from the scene. */
  load(model: Scene3D) {
    for (const it of this.items) {
      this.scene.remove(it.mesh);
      it.mesh.geometry.dispose();
    }
    this.items.length = 0;
    this.selected = null;
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
    }
    this.box.makeEmpty();
    this.all.makeEmpty();
    for (const el of model.elements) {
      let geo: THREE.BufferGeometry;
      try {
        geo = elementGeometry(el, this.finishes.textureSize(el.material));
      } catch {
        continue;
      }
      const mesh = new THREE.Mesh(geo, this.finishes.get(el.material, el.color));
      mesh.castShadow = !['site', 'paving', 'glazing'].includes(el.category) && el.material !== 'glass';
      mesh.receiveShadow = true;
      mesh.userData.id = el.id;
      this.scene.add(mesh);
      geo.computeBoundingBox();
      const b = geo.boundingBox!;
      this.all.union(b);
      if (!['site', 'paving', 'context', 'civil'].includes(el.category)) this.box.union(b);
      this.items.push({ mesh, el, z0: b.min.y, state: 'done' });
    }
    if (this.box.isEmpty()) this.box.copy(this.all);
    if (this.box.isEmpty()) this.box.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 6, 10));
    const c = this.box.getCenter(new THREE.Vector3());
    const span = Math.max(20, this.box.max.x - this.box.min.x, this.box.max.z - this.box.min.z);
    // Ground under everything the model doesn't cover itself.
    const hasGround = model.elements.some((e) => e.category === 'site');
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(span * 10, 64), new THREE.MeshStandardMaterial({ color: hasGround ? '#8d9a72' : '#bdb8ab', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(c.x, Math.min(0, this.all.min.y < -0.5 ? -0.02 : this.all.min.y) - 0.03, c.z);
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    // Haze only past the whole site, so the Site view stays clear.
    const reach = Math.max(span * 5, this.all.getSize(new THREE.Vector3()).length() * 1.6);
    this.scene.fog = new THREE.Fog('#dfe5e6', reach, reach * 3.2);
    this.camera.far = span * 40;
    this.camera.updateProjectionMatrix();
    // The sun from the south-west, its shadow fitted to the building and its near site.
    const r = Math.max(span * 0.9, Math.min(span * 3, this.all.getSize(new THREE.Vector3()).length() / 2));
    this.sun.position.set(c.x - r * 0.9, r * 1.1, c.z + r * 0.7);
    this.sun.target.position.copy(c);
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: r * 4 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.gtao?.updateGtaoMaterial({ radius: Math.max(0.6, Math.min(2, span * 0.03)), distanceExponent: 1.4, thickness: 1.2, scale: 1 });
    this.apply();
  }

  /** Shows the layers, cut, focus and states. */
  apply() {
    const { layers, cut, focus } = this.view;
    for (const it of this.items) {
      it.mesh.visible = layers.has(it.el.category) && it.state !== 'todo';
      const faint = (focus && !focus.has(it.el.category) && !['site', 'paving'].includes(it.el.category)) || false;
      it.mesh.material = faint ? this.finishes.ghost : this.finishes.get(it.el.material, it.el.color, it === this.selected ? 'selected' : it.state === 'doing' ? 'doing' : 'done');
      it.mesh.castShadow = !faint && !['site', 'paving', 'glazing'].includes(it.el.category) && it.el.material !== 'glass';
    }
    this.finishes.clip.constant = cut ?? 1e5;
    this.version++;
  }

  /** The ground under everything (for walking on). */
  get groundMesh() {
    return this.ground;
  }

  /** A person's eye for walking and touring: a wider lens, a near plane close enough for doorways, a lamp. */
  eye(on: boolean) {
    this.camera.fov = on ? 62 : 36;
    this.camera.near = on ? 0.05 : 0.2;
    this.camera.updateProjectionMatrix();
    this.lamp.intensity = on ? 9 : 0;
  }

  /** Each element's construction state (from the schedule); null = all built. */
  setStates(stateOf: ((e: Element3D) => ElementState) | null) {
    for (const it of this.items) it.state = stateOf ? stateOf(it.el) : 'done';
    this.apply();
  }

  /** The camera for a named view, and the layers it shows. */
  viewOf(v: ModelView): { position: THREE.Vector3; target: THREE.Vector3; view: ViewState } {
    const b = this.box;
    const c = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const span = Math.max(12, size.x, size.z);
    const all = new Set(CATEGORIES.map(([k]) => k).filter((k) => k !== 'ceiling'));
    const ground = Math.max(b.min.y, 0);
    const fit = (dir: THREE.Vector3, box = b) => fitCamera(this.camera, box, dir);
    switch (v) {
      case 'exterior_ne':
        return { ...fit(new THREE.Vector3(0.75, 0.42, -0.7)), view: { layers: all, cut: null, focus: null } };
      case 'cutaway':
        return { ...fit(new THREE.Vector3(-0.45, 0.9, 0.7)), view: { layers: all, cut: ground + 1.8, focus: null } };
      case 'plan': {
        const t = c.clone();
        t.y = ground;
        const d = (span / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.12 * Math.max(1, 1 / Math.max(0.5, this.camera.aspect));
        return { position: new THREE.Vector3(t.x, ground + d, t.z + 0.01), target: t, view: { layers: all, cut: ground + 1.8, focus: null } };
      }
      case 'structure':
        return { ...fit(new THREE.Vector3(-0.6, 0.55, 0.75)), view: { layers: all, cut: null, focus: new Set(['structure', 'foundation', 'floor', 'stairs']) } };
      case 'services':
        return { ...fit(new THREE.Vector3(-0.5, 0.65, 0.7)), view: { layers: all, cut: null, focus: new Set(['mechanical', 'electrical', 'plumbing', 'fixtures', 'floor']) } };
      case 'site':
        return { ...fit(new THREE.Vector3(0.6, 0.75, 0.55), this.all), view: { layers: all, cut: null, focus: null } };
      default:
        return { ...fit(new THREE.Vector3(-0.65, 0.4, 0.75)), view: { layers: all, cut: null, focus: null } };
    }
  }

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() {
    // Over the head, so its shine on glass ahead sits high rather than dead centre.
    if (this.lamp.intensity) this.lamp.position.copy(this.camera.position).y += 1.2;
    this.composer.render();
  }

  dispose() {
    for (const it of this.items) it.mesh.geometry.dispose();
    this.finishes.dispose();
    this.ground?.geometry.dispose();
    this.composer.dispose();
    this.pmrem.dispose();
    this.sun.shadow.dispose();
    (this.scene.background as THREE.Texture | null)?.dispose?.();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

/** Where the camera goes for a box to fill the view, looking along -dir. */
export function fitCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3, dir: THREE.Vector3): { position: THREE.Vector3; target: THREE.Vector3 } {
  const c = box.getCenter(new THREE.Vector3());
  const v = dir.clone().normalize();
  const worldUp = Math.abs(v.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(worldUp, v).normalize();
  const up = new THREE.Vector3().crossVectors(v, right).normalize();
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  let d = 0;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
    const z = p.dot(v);
    d = Math.max(d, z + Math.abs(p.dot(right)) / tanH, z + Math.abs(p.dot(up)) / tanV);
  }
  d = Math.max(3, d * 1.08);
  return { position: c.clone().add(v.multiplyScalar(d)), target: c };
}

/** A JPEG (base64, no prefix) of the model from a named view, for the AI to check its work. */
export async function snapshot(model: Scene3D, view: ModelView, width = 1280, height = 820): Promise<string> {
  const canvas = document.createElement('canvas');
  const r = new ModelRenderer(canvas, { preserve: true });
  try {
    r.renderer.setPixelRatio(1);
    r.setSize(width, height);
    r.load(model);
    const v = r.viewOf(view);
    r.view = v.view;
    r.apply();
    r.camera.position.copy(v.position);
    r.camera.lookAt(v.target);
    r.render();
    return canvas.toDataURL('image/jpeg', 0.86).split(',')[1];
  } finally {
    r.dispose();
  }
}

/** The extent of a model in metres (for the AI's summary). */
export const modelExtent = (m: Scene3D) => bounds(m.elements);
export { OrbitControls };
