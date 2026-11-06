import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CATEGORIES, MATERIALS, bounds, meshOf, type Element3D, type Scene3D, cutOpenings } from './scene';
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
  // Lap siding: horizontal boards about 180 mm, each lit on its face and shadowed under its lap.
  lap: (c) => ({ w: 64, h: 256, size: 1.44, draw: (g, w) => { for (let k = 0; k < 8; k++) { const y = k * 32; const gr = g.createLinearGradient(0, y, 0, y + 32); gr.addColorStop(0, shade(c, 0.78)); gr.addColorStop(0.12, shade(c, 1.04)); gr.addColorStop(0.85, shade(c, 0.97)); gr.addColorStop(1, shade(c, 0.86)); g.fillStyle = gr; g.fillRect(0, y, w, 32); } } }),
  planks: (c) => ({ w: 256, h: 256, size: 1.6, draw: (g, w) => { for (let k = 0; k < 8; k++) { g.fillStyle = shade(c, 0.9 + ((k * 5) % 4) * 0.06); g.fillRect(0, k * 32, w, 30); } } }),
  tile: (c) => ({ w: 128, h: 128, size: 1.2, draw: (g, w, h) => { g.fillStyle = c; g.fillRect(0, 0, w, h); g.strokeStyle = shade(c, 0.85); g.lineWidth = 2; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32, h); g.moveTo(0, k * 32); g.lineTo(w, k * 32); g.stroke(); } } }),
};

/** Finishes drawn with photo-scanned textures (once loaded): the set, metres per tile, bump and grain. */
const PBR: Record<string, { set: TextureSet | 'grain'; size: number; normal?: number; rough?: number }> = {
  timber: { set: 'grain', size: 2.6, normal: 0.45 },
  wood: { set: 'grain', size: 2.0, normal: 0.45 },
  door: { set: 'grain', size: 1.8, normal: 0.3 },
  concrete: { set: 'bconcrete', size: 3.5, normal: 0.7 },
  sealed_concrete: { set: 'bconcrete', size: 4, normal: 0.35, rough: 0.55 },
  stone: { set: 'concrete', size: 1.3, normal: 1.4 },
  block: { set: 'block', size: 2.4, normal: 1 },
  stucco: { set: 'plaster', size: 3, normal: 0.5 },
  metal_panel: { set: 'ribbed', size: 2.2, normal: 1 },
  siding: { set: 'ribbed', size: 1.6, normal: 0.9 },
  roof_metal: { set: 'corrugated', size: 2.4, normal: 1 },
  roof_shingle: { set: 'asphalt', size: 1.4, normal: 1.4, rough: 0.95 },
  roof_membrane: { set: 'asphalt', size: 4, normal: 0.5 },
  overhead_door: { set: 'ribbed', size: 3.2, normal: 0.5 },
  gravel: { set: 'gravel', size: 3.4, normal: 0.6 },
  asphalt: { set: 'asphalt', size: 6, normal: 0.6 },
  grass: { set: 'grass', size: 10, normal: 0.9 },
  soil: { set: 'mud', size: 4, normal: 1 },
};
/** Patterned finishes that also get a fine surface bump. */
const BUMP: Record<string, number> = { brick: 0.5, epoxy: 0.12, lap_siding: 0.25 };
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
    // Glass: a dark, tinted pane that mirrors the sky (as real glazing does in daylight).
    const m =
      key === 'glass'
        ? new THREE.MeshPhysicalMaterial(
            this.lib
              ? { ...opts, color: '#2e4652', roughness: 0.02, metalness: 0, opacity: 0.55, depthWrite: false, ior: 1.52, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 }
              : { ...opts, clearcoat: 0.6, envMapIntensity: 1.6 },
          )
        : new THREE.MeshStandardMaterial(opts);
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

/** The photographed sky's haze at the horizon (the far terrain fades into it). */
const SKY_PHOTO_HAZE = '#a9b3c4';

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
  private hemi = new THREE.HemisphereLight('#e4eefb', '#7d7462', 0.6);
  /** Towards the sun (the photographed sky's, once it is in). */
  private sunDir = new THREE.Vector3(-0.55, 0.62, 0.45).normalize();
  private skyTurn = new THREE.Euler();
  /** The sky's HDR as an equirect (the path tracer lights with it). */
  private skyHdr: THREE.DataTexture | null = null;
  /** True while a path-traced still is being made (the live view waits). */
  tracing = false;
  private traceExtra: THREE.Mesh[] = [];
  /** The shadow's reach round the model's centre (set on load). */
  private sunFit = { c: new THREE.Vector3(), r: 30 };

  constructor(canvas?: HTMLCanvasElement, opts: { preserve?: boolean; site?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    const r = this.renderer;
    // Sharper when still: up to twice the screen's pixels at rest, the screen's own (or less) on the move.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.detail = { high: true, low: 1, top: Math.min(2, Math.max(dpr, 1.5)) };
    r.setPixelRatio(opts.site ? this.detail.top : Math.min(2, dpr));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    // The sun's shadow map is redrawn only when the model or the site changes, not every time the
    // camera moves: orbiting a big site with trees and grass stays quick.
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
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
    this.hemi.intensity = opts.site ? 0.55 : 0.65;
    s.add(this.hemi);
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
      for (const k of ['grass', 'mud', 'gravel', 'concrete', 'wood', 'ribbed', 'corrugated', 'asphalt', 'bconcrete', 'block', 'plaster', 'leafy'] as const) lib.get(k);
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
      this.loadSky(sunDir);
    }
    // Multisampled, half-float buffers: clean edges and no banding through the post passes.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: opts.site ? 2 : 0 });
    this.composer = new EffectComposer(r, target);
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

  /**
   * A photographed sky (Poly Haven, CC0): its HDR lights the model and shows in the glass, its
   * 4k photo is the backdrop. Turned so its sun sits where the shadows' sun is.
   */
  private loadSky(sunDir: THREE.Vector3) {
    let base = './';
    try {
      base = import.meta.env.BASE_URL ?? './';
    } catch {
      /* not under vite */
    }
    let hdr: THREE.DataTexture | null = null;
    let photo: THREE.Texture | null = null;
    const done = () => {
      if (!hdr || !photo) return;
      // The HDR's sun: its brightest texel, as a direction (three's equirect layout).
      const img = hdr.image as { data: Uint16Array | Float32Array; width: number; height: number };
      const read = img.data instanceof Uint16Array ? (v: number) => THREE.DataUtils.fromHalfFloat(v) : (v: number) => v;
      let best = -1, bi = 0;
      for (let i = 0; i < img.width * img.height; i++) {
        const l = read(img.data[i * 4]) + read(img.data[i * 4 + 1]) + read(img.data[i * 4 + 2]);
        if (l > best) {
          best = l;
          bi = i;
        }
      }
      const u = (bi % img.width + 0.5) / img.width;
      // Row 0 of the data is the top of the sky (flipY is off for data textures).
      const v = 1 - (Math.floor(bi / img.width) + 0.5) / img.height;
      const lon = (u - 0.5) * Math.PI * 2;
      const found = Math.atan2(Math.sin(lon), Math.cos(lon));
      const want = Math.atan2(sunDir.z, sunDir.x);
      const elev = (v - 0.5) * Math.PI;
      this.skyTurn = new THREE.Euler(0, found - want, 0);
      // The shadows' sun at the photo's own height.
      const horiz = Math.cos(elev);
      this.sunDir.set(Math.cos(want) * horiz, Math.sin(elev), Math.sin(want) * horiz).normalize();
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = this.pmrem.fromEquirectangular(hdr).texture;
      this.skyHdr = hdr;
      photo.mapping = THREE.EquirectangularReflectionMapping;
      photo.colorSpace = THREE.SRGBColorSpace;
      const s = this.scene;
      s.environment?.dispose();
      s.environment = env;
      s.environmentIntensity = 0.5;
      s.environmentRotation.copy(this.skyTurn);
      s.background = photo;
      this.renderer.toneMappingExposure = 0.9;
      s.backgroundRotation.copy(this.skyTurn);
      s.backgroundIntensity = 1;
      this.sky.visible = false;
      this.hemi.intensity = 0.18;
      if (this.scene.fog) (this.scene.fog as THREE.Fog).color.set(SKY_PHOTO_HAZE);
      this.placeSun();
      this.onChange?.();
    };
    new HDRLoader().load(`${base}env/sky_1k.hdr`, (t) => ((hdr = t), done()), undefined, () => undefined);
    new THREE.TextureLoader().load(`${base}env/sky_4k.jpg`, (t) => ((photo = t), done()), undefined, () => undefined);
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
    // Walls drawn through their doors and windows get the openings cut, so rooms open up.
    const opened = cutOpenings(model.elements);
    for (const el of model.elements) {
      let geo: THREE.BufferGeometry;
      try {
        const cut = opened.get(el.id);
        geo = elementGeometry(cut ? { ...el, shapes: cut } : el, this.finishes.textureSize(el.material), this.finishes.grain(el.material));
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
      this.scene.fog = new THREE.Fog(this.sky.visible ? SKY.horizon : SKY_PHOTO_HAZE, Math.max(180, siteSize * 1.1), far * 1.15);
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
    this.sunFit = { c: c.clone(), r };
    this.placeSun();
    // Shaders compile in parallel (KHR_parallel_shader_compile) before the first picture, not in it.
    if (this.env) {
      const warm: Promise<void> = this.renderer
        .compileAsync(this.scene, this.camera)
        .catch(() => undefined)
        .then(() => {
          if (this.warming === warm) this.warming = null;
          this.onChange?.();
        });
      this.warming = warm;
    }
    this.gtao?.updateGtaoMaterial({ radius: Math.max(0.6, Math.min(2, span * 0.03)), distanceExponent: 1.4, thickness: 1.2, scale: 1 });
    this.apply();
  }

  /** The sun along sunDir, its shadow fitted to the building and its near site. */
  private placeSun() {
    const { c, r } = this.sunFit;
    const d = r * 1.6;
    this.sun.position.copy(c).addScaledVector(this.sunDir, d);
    this.sun.target.position.copy(c);
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: d + r * 2 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Something that casts shadows moved or changed: redraw the sun's shadow map next frame. */
  shadowsChanged() {
    this.shadowDirty = true;
  }
  private shadowDirty = true;
  private shadowAt = 0;

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
    this.shadowsChanged();
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
    if (this.tracing || !this.env || this.detail.high === high) return false;
    this.detail.high = high;
    // Ambient occlusion only on the still picture; on the move it's the costliest pass.
    if (this.gtao) this.gtao.enabled = high;
    if (this.detail.low === this.detail.top) return true;
    const ratio = high ? this.detail.top : this.detail.low;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.setSize(this.size.w, this.size.h);
    return true;
  }

  /** A still at a set size (4K by default), as a PNG; the view on screen is left as it was. */
  async capture(width = 3840, height = 2160): Promise<Blob | null> {
    if (this.warming) await this.warming;
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
    // A still is being traced at its own size: the screen's size applies when it is done.
    if (screen && this.tracing) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * A photoreal still: path traced (light bounced between every surface, soft sky shadows, true
   * reflections), at a set size, as a PNG. Falls back to the live renderer's still if the GPU
   * can't. `onProgress` gets 0–1.
   */
  async captureTraced(width = 3840, height = 2160, samples = 160, onProgress?: (k: number) => void): Promise<Blob | null> {
    if (!this.env || !this.skyHdr) return this.capture(width, height);
    const r = this.renderer;
    const { w, h } = this.size;
    const ratio = r.getPixelRatio();
    const s = this.scene;
    const swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    const hidden: THREE.Object3D[] = [];
    const keep = { env: s.environment, fog: s.fog, envI: s.environmentIntensity };
    this.tracing = true;
    let pt: { dispose(): void; samples: number; renderSample(): void } | null = null;
    try {
      const { WebGLPathTracer } = await import('three-gpu-pathtracer');
      // What the tracer can't read: the terrain's blended shader becomes a plain textured ground,
      // the sky dome and the faint ghost layers go.
      const terrain = this.env.terrain;
      if (terrain) {
        const g = terrain.geometry;
        if (!g.getAttribute('uv')) {
          const p = g.getAttribute('position');
          const uv = new Float32Array(p.count * 2);
          for (let i = 0; i < p.count; i++) {
            // Warped, so the tile's repeats don't line up into rows across the meadow.
            const x = p.getX(i), z = p.getZ(i);
            uv[i * 2] = (x + 9 * (patch(x / 53, z / 53) - 0.5)) / 11;
            uv[i * 2 + 1] = (z + 9 * (patch(x / 47 + 5.3, z / 47 + 2.1) - 0.5)) / 11;
          }
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        }
        if (!g.getAttribute('color')) {
          // Patches lusher and drier, so the ground doesn't read as one repeated tile.
          const p = g.getAttribute('position');
          // RGBA: the tracer merges colours as four components.
          const col = new Float32Array(p.count * 4);
          for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            const a = patch(x / 37, z / 37), b = patch(x / 9 + 3.1, z / 9 - 1.7);
            const v = 0.72 + 0.28 * a + 0.12 * b;
            col.set([v * (1 + 0.12 * (1 - a)), v, v * (0.92 + 0.1 * a), 1], i * 4);
          }
          g.setAttribute('color', new THREE.BufferAttribute(col, 4));
        }
        const grass = this.lib!.get('grass');
        swaps.push([terrain, terrain.material]);
        terrain.material = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, color: tintFor('grass', '#56613a'), roughness: 1, vertexColors: true });
      }
      // The tracer reads plain meshes: each instanced set (leaves, grass, trunks) as one merged mesh.
      const merged: THREE.Mesh[] = [];
      s.traverseVisible((o) => {
        if (!(o instanceof THREE.InstancedMesh) || !o.count) return;
        const m = flattenInstances(o);
        if (!m) return;
        merged.push(m);
        hidden.push(o);
      });
      for (const m of merged) s.add(m);
      this.traceExtra = merged;
      for (const it of this.items) if (it.mesh.visible && it.mesh.material === this.finishes.ghost) hidden.push(it.mesh);
      hidden.push(this.sky);
      for (const o of hidden) o.visible = false;
      s.fog = null;
      s.environment = this.skyHdr;
      r.setPixelRatio(1);
      r.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      const tracer = new WebGLPathTracer(r);
      pt = tracer;
      Object.assign(tracer, { renderScale: 1, dynamicLowRes: false, minSamples: 0, renderDelay: 0, fadeDuration: 0, bounces: 6, filterGlossyFactor: 0.4, renderToCanvas: true });
      tracer.tiles.set(3, 3);
      // Builds the ray-tracing structure (a few seconds on a big site).
      await new Promise((ok) => setTimeout(ok, 30));
      tracer.setScene(s, this.camera);
      for (let i = 0; i < samples; i++) {
        tracer.renderSample();
        if (i % 3 === 2) {
          onProgress?.(tracer.samples / samples);
          await new Promise((ok) => setTimeout(ok, 0));
        }
      }
      // One more pass and the copy in the same task, before the canvas can be cleared.
      tracer.renderSample();
      onProgress?.(1);
      return await new Promise<Blob | null>((ok) => r.domElement.toBlob(ok, 'image/png'));
    } catch (e) {
      console.warn('Path tracing failed; using the live renderer', e);
      this.tracing = false;
      this.restoreTrace(swaps, hidden, keep, ratio, w, h);
      return this.capture(width, height);
    } finally {
      pt?.dispose();
      if (this.tracing) {
        this.tracing = false;
        this.restoreTrace(swaps, hidden, keep, ratio, w, h);
      }
    }
  }

  private restoreTrace(swaps: [THREE.Mesh, THREE.Material | THREE.Material[]][], hidden: THREE.Object3D[], keep: { env: THREE.Texture | null; fog: THREE.Fog | THREE.FogExp2 | null; envI: number }, ratio: number, w: number, h: number) {
    for (const [m, mat] of swaps.splice(0)) {
      (m.material as THREE.Material).dispose();
      m.material = mat;
    }
    for (const o of hidden.splice(0)) if (o !== this.sky) o.visible = true;
    for (const m of this.traceExtra.splice(0)) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const s = this.scene;
    s.environment = keep.env;
    s.environmentIntensity = keep.envI;
    s.fog = keep.fog;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.setSize(w, h);
    this.render();
  }

  render() {
    if (this.tracing) return;
    // Over the head, so its shine on glass ahead sits high rather than dead centre.
    if (this.lamp.intensity) this.lamp.position.copy(this.camera.position).y += 1.2;
    this.sky.position.copy(this.camera.position);
    // On the move (playing, scrubbing, orbiting) the sun's shadow redraws a few times a second;
    // the still picture gets it at once.
    if (this.shadowDirty && (this.detail.high || !this.env || performance.now() - this.shadowAt > 300)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.shadowAt = performance.now();
    }
    if (this.warming) return;
    this.composer.render();
  }
  private warming: Promise<void> | null = null;

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
    this.skyHdr?.dispose();
    this.sun.shadow.dispose();
    (this.scene.background as THREE.Texture | null)?.dispose?.();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

/** Smooth 0–1 noise for ground patches. */
function patch(x: number, y: number) {
  const h = (a: number, b: number) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * An instanced mesh as one plain mesh in world space, its per-instance colours baked into the
 * vertices (for the path tracer). The material is a copy without shader tweaks.
 */
function flattenInstances(o: THREE.InstancedMesh): THREE.Mesh | null {
  const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  const pos = src.getAttribute('position'), nor = src.getAttribute('normal'), uv = src.getAttribute('uv'), vc = src.getAttribute('color');
  if (!pos) return null;
  const n = pos.count, count = o.count;
  if (n * count > 4e6) return null;
  const P = new Float32Array(n * count * 3), N = new Float32Array(n * count * 3), C = new Float32Array(n * count * 4);
  const U = uv ? new Float32Array(n * count * 2) : null;
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), col = new THREE.Color(1, 1, 1);
  o.updateWorldMatrix(true, false);
  for (let i = 0; i < count; i++) {
    o.getMatrixAt(i, m);
    m.premultiply(o.matrixWorld);
    nm.getNormalMatrix(m);
    if (o.instanceColor) o.getColorAt(i, col);
    for (let k = 0; k < n; k++) {
      const j = i * n + k;
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      P.set([v.x, v.y, v.z], j * 3);
      if (nor) {
        v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
        N.set([v.x, v.y, v.z], j * 3);
      }
      const r = vc ? vc.getX(k) : 1, g = vc ? vc.getY(k) : 1, b = vc ? vc.getZ(k) : 1;
      C.set([r * col.r, g * col.g, b * col.b, 1], j * 4);
      if (U && uv) U.set([uv.getX(k), uv.getY(k)], j * 2);
    }
  }
  if (src !== o.geometry) src.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nor) geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  else geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(C, 4));
  if (U) geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  const base = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshStandardMaterial({
    color: base.color ?? new THREE.Color(1, 1, 1),
    map: base.map ?? null,
    normalMap: base.normalMap ?? null,
    roughness: base.roughness ?? 0.8,
    metalness: base.metalness ?? 0,
    alphaTest: base.alphaTest,
    side: base.side,
    vertexColors: true,
  });
  const out = new THREE.Mesh(geo, mat);
  out.castShadow = o.castShadow;
  out.receiveShadow = o.receiveShadow;
  return out;
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
