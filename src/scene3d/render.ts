import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CATEGORIES, MATERIALS, bounds, meshOf, type Element3D, type Scene3D } from './scene';
import { TextureLibrary, tintFor, type TextureSet } from './textures';
import { SiteEnvironment, type GroundSource, type ModelTree, type SiteStage } from './environment';

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

/** Finishes drawn with photo-scanned textures (once loaded): the set, metres per tile, bump and grain. */
const PBR: Record<string, { set: TextureSet | 'grain'; size: number; normal?: number; rough?: number }> = {
  timber: { set: 'grain', size: 2.6, normal: 0.45 },
  wood: { set: 'grain', size: 2.0, normal: 0.45 },
  door: { set: 'grain', size: 1.8, normal: 0.3 },
  concrete: { set: 'concrete', size: 3.2, normal: 0.8 },
  sealed_concrete: { set: 'concrete', size: 4, normal: 0.35, rough: 0.55 },
  stone: { set: 'concrete', size: 1.3, normal: 1.4 },
  gravel: { set: 'gravel', size: 3.4, normal: 0.6 },
  asphalt: { set: 'gravel', size: 1.6, normal: 0.4 },
  grass: { set: 'grass', size: 10, normal: 0.9 },
  soil: { set: 'mud', size: 4, normal: 1 },
};
/** Patterned finishes that also get a fine surface bump. */
const BUMP: Record<string, number> = { block: 0.6, brick: 0.5, stucco: 0.35, epoxy: 0.12 };
/** Finishes whose texture runs along the member (wood grain). */
const GRAIN = new Set(['timber', 'wood', 'door']);

class Finishes {
  private textures = new Map<string, THREE.Texture>();
  private cache = new Map<string, THREE.Material>();
  /** The photo textures, once they have all arrived. */
  lib: TextureLibrary | null = null;
  readonly clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
  readonly ghost = new THREE.MeshStandardMaterial({ color: '#c9d2d6', transparent: true, opacity: 0.1, depthWrite: false, roughness: 1, side: THREE.DoubleSide, clippingPlanes: [this.clip], clipShadows: true });

  /** A material key, or a #colour. */
  look(key: string, colour?: string) {
    const d = MATERIALS[key] ?? { color: colour ?? (/^#[0-9a-f]{6}$/i.test(key) ? key : '#b8b8b4'), rough: 0.7 };
    return { ...d, color: colour ?? d.color };
  }
  textureSize(key: string) {
    if (PBR[key]) return PBR[key].size;
    const d = this.look(key);
    return d.pattern ? PATTERNS[d.pattern]?.(d.color).size ?? 1 : 1;
  }
  grain(key: string) {
    return GRAIN.has(key);
  }
  /** Drops the materials made so far (they are made again, with the textures, as needed). */
  reset() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
  get(key: string, colour?: string, state: ElementState | 'selected' = 'done'): THREE.Material {
    const k = `${key}|${colour ?? ''}|${state}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const d = this.look(key, colour);
    const pbr = this.lib && PBR[key];
    if (pbr && this.lib) {
      const lib = this.lib;
      const set = pbr.set === 'grain' ? lib.get('wood') : lib.get(pbr.set);
      const m = new THREE.MeshStandardMaterial({
        color: tintFor(pbr.set, d.color),
        map: pbr.set === 'grain' ? lib.grain : set.map,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(pbr.normal ?? 1, pbr.normal ?? 1),
        roughnessMap: set.roughnessMap,
        roughness: (pbr.rough ?? d.rough ?? 0.8) * 1.15,
        metalness: d.metal ?? 0,
        side: THREE.DoubleSide,
        clippingPlanes: [this.clip], clipShadows: true,
      });
      if (['gravel', 'asphalt', 'grass', 'soil'].includes(key)) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      this.state(m, state);
      this.cache.set(k, m);
      return m;
    }
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
      color: map ? '#ffffff' : d.color, map, roughness: d.rough ?? 0.7, metalness: d.metal ?? 0, side: THREE.DoubleSide, clippingPlanes: [this.clip], clipShadows: true,
    };
    if (key === 'light') Object.assign(opts, { emissive: '#fff3c0', emissiveIntensity: 0.6 });
    if (d.opacity !== undefined) Object.assign(opts, { transparent: true, opacity: d.opacity, depthWrite: d.opacity > 0.6 });
    if (this.lib && BUMP[key]) {
      const n = this.lib.get('concrete').normalMap;
      Object.assign(opts, { normalMap: n, normalScale: new THREE.Vector2(BUMP[key], BUMP[key]) });
    }
    const m = key === 'glass' ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 0.6, envMapIntensity: 1.6 }) : new THREE.MeshStandardMaterial(opts);
    this.state(m, state);
    this.cache.set(k, m);
    return m;
  }
  /** Going up (a warm glow) or picked (orange). */
  private state(m: THREE.MeshStandardMaterial, state: ElementState | 'selected') {
    if (state === 'doing') Object.assign(m, { emissive: new THREE.Color('#ff9f43'), emissiveIntensity: 0.22 });
    if (state === 'selected') Object.assign(m, { emissive: new THREE.Color('#e2611b'), emissiveIntensity: 0.55 });
  }
  dispose() {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.ghost.dispose();
  }
}

/**
 * An element as three geometry: Z-up metres to three's Y-up, UVs projected per face in metres of
 * texture. With `grain`, each shape's texture runs along its longest side (wood along a beam).
 */
export function elementGeometry(e: Element3D, textureSize = 1, grain = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const s of e.shapes) {
    const m = meshOf(s);
    const v = m.positions;
    let long = -1;
    if (grain) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < v.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], v[i + k]);
          hi[k] = Math.max(hi[k], v[i + k]);
        }
      const ext = hi.map((h, k) => h - lo[k]);
      long = ext.indexOf(Math.max(...ext));
    }
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = [m.indices[i] * 3, m.indices[i + 1] * 3, m.indices[i + 2] * 3];
      const A = [v[a], v[a + 1], v[a + 2]], B = [v[b], v[b + 1], v[b + 2]], C = [v[c], v[c + 1], v[c + 2]];
      const n = [(B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]), (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]), (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])];
      const [ax, ay, az] = n.map(Math.abs);
      const facing = az >= ax && az >= ay ? 2 : ax >= ay ? 0 : 1;
      const across = long >= 0 && long !== facing ? [0, 1, 2].find((k) => k !== facing && k !== long)! : -1;
      for (const P of [A, B, C]) {
        pos.push(P[0], P[2], -P[1]);
        if (across >= 0) uv.push(P[across] / textureSize, P[long] / textureSize);
        else if (facing === 2) uv.push(P[0] / textureSize, P[1] / textureSize);
        else if (facing === 0) uv.push(P[1] / textureSize, P[2] / textureSize);
        else uv.push(P[0] / textureSize, P[2] / textureSize);
      }
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
  /** How far up it is while being built (0–1). */
  grow: number;
  /** Drawn by the surroundings instead (the grass is the terrain, a canopy is leafy trees). */
  replaced: boolean;
}

export interface ViewState {
  layers: Set<string>;
  /** Cut height above the model's 0 (m), or null. */
  cut: number | null;
  /** Layers drawn solid; the rest faint (a view of the structure or services). */
  focus: Set<string> | null;
  /** Only these elements (a level, a finish), or all. */
  only?: ((e: Element3D) => boolean) | null;
}

/** The sky: deep blue overhead to a warm haze at the horizon, a glow round the sun. */
const SKY = { top: '#5d8fbf', mid: '#a9c6dc', horizon: '#e3e9e6', ground: '#7d7a62' };
function skyMaterial(sun: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY.top) },
      mid: { value: new THREE.Color(SKY.mid) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      ground: { value: new THREE.Color(SKY.ground) },
      sunDir: { value: sun },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 vDir; uniform vec3 top, mid, horizon, ground, sunDir;
      void main(){
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(mix(horizon, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.18, 0.85, h)) : mix(horizon, ground, smoothstep(0.0, -0.25, h));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += vec3(1.0, 0.92, 0.78) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
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
  /** Terrain, trees and site plant (the live view only; snapshots for the AI go without). */
  readonly env: SiteEnvironment | null = null;
  private lib: TextureLibrary | null = null;
  private sky: THREE.Mesh;
  private size = { w: 1, h: 1 };
  private detail = { high: true, low: 1, top: 1 };
  /** Called when something arrives that changes the picture (textures). */
  onChange?: () => void;
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

  constructor(canvas?: HTMLCanvasElement, opts: { preserve?: boolean; site?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    const r = this.renderer;
    // Sharper when still: up to twice the screen's pixels at rest, the screen's own (or less) on the move.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.detail = { high: true, low: Math.min(1.25, dpr), top: Math.min(2, Math.max(dpr, 1.5)) };
    r.setPixelRatio(opts.site ? this.detail.top : Math.min(2, dpr));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.localClippingEnabled = true;
    const s = this.scene;
    s.background = new THREE.Color(SKY.horizon);
    // The sun high in the south-west; the sky dome drawn behind everything, glowing round it.
    const sunDir = new THREE.Vector3(-0.55, 0.62, 0.45).normalize();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial(sunDir));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    s.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(r);
    if (opts.site) {
      // Reflections of the same sky (glass shows sky and haze, not a studio).
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(sunDir)));
      s.environment = this.pmrem.fromScene(envScene, 0.02).texture;
      s.environmentIntensity = 0.75;
    } else {
      s.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      s.environmentIntensity = 0.45;
    }
    s.add(new THREE.HemisphereLight('#e4eefb', '#7d7462', opts.site ? 0.55 : 0.65));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    if (opts.site) this.sun.intensity = 2.9;
    s.add(this.sun, this.sun.target);
    s.add(this.lamp);
    if (opts.site) {
      const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
      const lib = new TextureLibrary(aniso);
      this.lib = lib;
      (this as { env: SiteEnvironment | null }).env = new SiteEnvironment(lib);
      this.env!.group.visible = false;
      s.add(this.env!.group);
      for (const k of ['grass', 'mud', 'gravel', 'concrete', 'wood'] as const) lib.get(k);
      void lib.grain;
      // The textures in: the finishes and the ground switch to them together.
      lib.onLoad = () => {
        if (lib.loading || lib.failed || this.finishes.lib) return;
        this.finishes.lib = lib;
        this.finishes.reset();
        this.env!.group.visible = true;
        if (this.ground) this.ground.visible = false;
        this.apply();
        this.onChange?.();
      };
    }
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
    const sources: GroundSource[] = [];
    const trees: ModelTree[] = [];
    for (const el of model.elements) {
      let geo: THREE.BufferGeometry;
      try {
        geo = elementGeometry(el, this.finishes.textureSize(el.material), this.finishes.grain(el.material));
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
      // With the surroundings on, the model's grass becomes the terrain and its canopies leafy trees.
      let replaced = false;
      if (this.env) {
        const grade = el.category === 'site' && el.material === 'grass';
        if (grade || el.category === 'paving' || el.category === 'site') sources.push({ positions: geo.getAttribute('position').array, grade });
        replaced = grade;
        if (el.material === 'tree' && el.shapes.length && el.shapes.every((s) => s.type === 'sphere' || s.type === 'cone')) {
          replaced = true;
          for (const s of el.shapes) {
            if (s.type === 'sphere') trees.push({ id: el.id, at: new THREE.Vector3(s.at[0], s.at[2], -s.at[1]), radius: s.radius, cone: false });
            if (s.type === 'cone') trees.push({ id: el.id, at: new THREE.Vector3(s.at[0], (s.z0 + s.z1) / 2, -s.at[1]), radius: s.radius, cone: true, height: s.z1 - s.z0 });
          }
        }
      }
      this.items.push({ mesh, el, z0: b.min.y, state: 'done', grow: 1, replaced });
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
    this.ground.visible = !this.envOn;
    this.scene.add(this.ground);
    const siteSize = this.all.getSize(new THREE.Vector3()).length();
    if (this.env) {
      // The terrain rolls out to the horizon; haze takes the far hills.
      this.env.build({ building: this.box, all: this.all, sources, trees, floor: 0 });
      const far = Math.max(1600, siteSize * 5);
      this.scene.fog = new THREE.Fog(SKY.horizon, Math.max(180, siteSize * 1.1), far * 1.15);
      this.camera.far = far * 2.2;
    } else {
      // Haze only past the whole site, so the Site view stays clear.
      const reach = Math.max(span * 5, siteSize * 1.6);
      this.scene.fog = new THREE.Fog('#dfe5e6', reach, reach * 3.2);
      this.camera.far = span * 40;
    }
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

  /** True once the terrain and trees are showing. */
  get envOn() {
    return !!this.env && this.env.group.visible;
  }

  /** Shows the layers, cut, focus and states. */
  apply() {
    const { layers, cut, focus, only } = this.view;
    const envOn = this.envOn;
    for (const it of this.items) {
      const shown = layers.has(it.el.category) && it.state !== 'todo' && (!only || only(it.el));
      it.mesh.visible = !(it.replaced && envOn) && shown;
      if (it.replaced) this.env?.setTree(it.el.id, shown);
      const faint = (focus && !focus.has(it.el.category) && !['site', 'paving'].includes(it.el.category)) || false;
      it.mesh.material = faint ? this.finishes.ghost : this.finishes.get(it.el.material, it.el.color, it === this.selected ? 'selected' : it.state === 'doing' ? 'doing' : 'done');
      it.mesh.castShadow = !faint && !['site', 'paving', 'glazing'].includes(it.el.category) && it.el.material !== 'glass';
      // Going up: rises from its base.
      const k = it.state === 'doing' ? Math.max(0.04, it.grow) : 1;
      it.mesh.scale.y = k;
      it.mesh.position.y = it.z0 * (1 - k);
    }
    this.finishes.clip.constant = cut ?? 1e5;
    this.version++;
  }

  /** The ground under everything (for walking on). */
  get groundMesh() {
    return this.envOn && this.env?.terrain ? this.env.terrain : this.ground;
  }

  /**
   * The model on a day of the build: each element's progress, below 0 not started, 0–1 going up,
   * 1 or more in place (null: all built).
   */
  setBuild(progress: ((e: Element3D) => number) | null) {
    for (const it of this.items) {
      const p = progress ? progress(it.el) : 1;
      it.state = p < 0 ? 'todo' : p < 1 ? 'doing' : 'done';
      it.grow = Math.min(1, Math.max(0, p));
    }
    this.apply();
  }

  /** The site's plant and earthworks on the day shown (null: none). */
  setStage(s: SiteStage | null) {
    this.env?.setStage(s);
  }

  /** Sharper while still, quicker on the move: true when the pixel ratio changed. */
  setDetail(high: boolean) {
    if (!this.env || this.detail.high === high || this.detail.low === this.detail.top) return false;
    this.detail.high = high;
    const ratio = high ? this.detail.top : this.detail.low;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.setSize(this.size.w, this.size.h);
    return true;
  }

  /** A still at a set size (4K by default), as a PNG; the view on screen is left as it was. */
  async capture(width = 3840, height = 2160): Promise<Blob | null> {
    const r = this.renderer;
    const ratio = r.getPixelRatio();
    const { w, h } = this.size;
    r.setPixelRatio(1);
    this.composer.setPixelRatio(1);
    this.setSize(width, height, false);
    this.render();
    // The canvas is copied when asked, so it can go back to the screen's size straight away.
    const blob = new Promise<Blob | null>((ok) => r.domElement.toBlob(ok, 'image/png'));
    r.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.setSize(w, h);
    this.render();
    return blob;
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
    for (const it of this.items) {
      it.state = stateOf ? stateOf(it.el) : 'done';
      it.grow = 1;
    }
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

  /** The drawing size; `screen` false for an off-screen still (the screen's size is kept). */
  setSize(w: number, h: number, screen = true) {
    if (screen) this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render() {
    // Over the head, so its shine on glass ahead sits high rather than dead centre.
    if (this.lamp.intensity) this.lamp.position.copy(this.camera.position).y += 1.2;
    this.sky.position.copy(this.camera.position);
    this.composer.render();
  }

  dispose() {
    for (const it of this.items) it.mesh.geometry.dispose();
    this.finishes.dispose();
    this.env?.dispose();
    this.lib?.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
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
