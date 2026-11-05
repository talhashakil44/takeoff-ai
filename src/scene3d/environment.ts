import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tintFor, type TextureLibrary } from './textures';

/**
 * The world around the model: a large rolling terrain that takes the model's own grades on site
 * and rolls off into hills, a hazy sky, leafy trees, and the plant and temporary works of a job
 * in progress (crane, excavator, dump truck, fence, cones, site office, crew) that come and go
 * with the construction stage. All in three's Y-up metres; illustrative, not part of the model.
 */

// --------------------------------------------------------------------------- noise

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Smooth value noise, about −1 to 1. */
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = smooth(x - xi), fy = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 2 - 1;
}
function fbm(x: number, y: number, octaves = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(x * f, y * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}
const ramp = (a: number, b: number, x: number) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));
/** A repeatable random sequence. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

// --------------------------------------------------------------------------- stage

/** What is going on on site on the day shown (from the schedule). */
export interface SiteStage {
  /** Day number, for slow movements of the plant. */
  day: number;
  /** 0–1: how torn up the ground round the building is. */
  work: number;
  /** 0–1: the building's footprint dug out for the foundations. */
  dig: number;
  /** Excavator and dump truck on site. */
  earthworks: boolean;
  /** Crane on site. */
  structure: boolean;
  /** Fence, cones, site office and crew. */
  site: boolean;
}

/** A tree the model itself has (its canopy is drawn leafy instead). */
export interface ModelTree {
  /** The element it is part of (shown when that element is built). */
  id: string;
  at: THREE.Vector3;
  radius: number;
  cone: boolean;
  /** Cone height (cones only). */
  height?: number;
}

/** A surface the ground should follow (top-facing triangles, three coords). */
export interface GroundSource {
  positions: ArrayLike<number>;
  /** The ground is this surface (grass) rather than something laid on it (paving). */
  grade: boolean;
}

// --------------------------------------------------------------------------- materials

const std = (color: string, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Construction fence mesh: a fine grid with a top and bottom rail. */
function fenceTexture() {
  return canvasTexture(128, 128, (g) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.2;
    for (let k = 0; k <= 128; k += 10) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k, 128);
      g.moveTo(0, k);
      g.lineTo(128, k);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 6);
    g.fillRect(0, 122, 128, 6);
  });
}

// --------------------------------------------------------------------------- a kit of parts, merged per material

class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) {
    this.m.compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(this.m);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.getAttribute('position').count * 2) | 0), 2));
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
    return this;
  }
  box(mat: THREE.Material, pos: [number, number, number], size: [number, number, number], rot?: [number, number, number]) {
    return this.add(new THREE.BoxGeometry(...size), mat, pos, rot);
  }
  /** A cylinder along local Y. */
  cyl(mat: THREE.Material, pos: [number, number, number], r: number, h: number, rot?: [number, number, number], seg = 14, r2 = r) {
    return this.add(new THREE.CylinderGeometry(r2, r, h, seg), mat, pos, rot);
  }
  /** A rod between two points. */
  rod(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.add(g, mat, a.clone().add(b).multiplyScalar(0.5).toArray() as [number, number, number], [e.x, e.y, e.z]);
  }
  build(): THREE.Group {
    const g = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.parts.clear();
    return g;
  }
}

// --------------------------------------------------------------------------- the environment

export class SiteEnvironment {
  readonly group = new THREE.Group();
  terrain: THREE.Mesh | null = null;
  private trees = new THREE.Group();
  /** The model's trees, by element. */
  private treeOf = new Map<string, THREE.Group>();
  private background = new THREE.Group();
  private props = new THREE.Group();
  private crane: { g: THREE.Group; upper: THREE.Group; yaw: number } | null = null;
  private digger: { g: THREE.Group; body: THREE.Group; y0: number } | null = null;
  private truck: THREE.Group | null = null;
  private fence: THREE.Group | null = null;
  private office: THREE.Group | null = null;
  private crew: THREE.Group | null = null;
  private stacks: THREE.Group | null = null;
  private uniforms = {
    uWork: { value: 0 },
    uDig: { value: 0 },
    uFoot: { value: new THREE.Vector4() },
    uR: { value: new THREE.Vector2(3, 18) },
  };
  private grid: { x0: number; z0: number; cell: number; nx: number; nz: number; h: Float32Array; laid: Float32Array } | null = null;
  private grass: THREE.InstancedMesh | null = null;
  private mats = {
    yellow: std('#e2a531', 0.45, 0.2),
    white: std('#e9e9e3', 0.45, 0.1),
    dark: std('#262b2d', 0.7, 0.2),
    steel: std('#6b7375', 0.4, 0.75),
    tyre: std('#1d2021', 0.95),
    glass: new THREE.MeshStandardMaterial({ color: '#36505a', roughness: 0.08, metalness: 0.6 }),
    orange: std('#ef7a2f', 0.6),
    vest: new THREE.MeshStandardMaterial({ color: '#f2a03a', roughness: 0.6, emissive: '#5a2c00', emissiveIntensity: 0.25 }),
    blue: std('#36526b', 0.7),
    skin: std('#b88c68', 0.7),
    bark: std('#5d4c39', 1),
    timber: std('#c99e68', 0.75),
    post: std('#55605d', 0.5, 0.6),
    fence: new THREE.MeshStandardMaterial({ color: '#3f7a66', roughness: 0.8, alphaTest: 0.45, side: THREE.DoubleSide }),
    leaf: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, alphaTest: 0.45, side: THREE.DoubleSide }),
    needle: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, alphaTest: 0.4, side: THREE.DoubleSide }),
    gravel: std('#9a958a', 1),
  };
  private ground: THREE.MeshStandardMaterial;

  constructor(private lib: TextureLibrary) {
    this.group.add(this.trees, this.background, this.props);
    // Photo-scanned leaf sprays and pine twigs on the cards (Poly Haven, CC0), with their relief.
    this.mats.leaf.map = lib.file('leaves_card.png');
    this.mats.leaf.normalMap = lib.file('leaves_card_nor.jpg', false);
    this.mats.leaf.normalScale.set(0.6, 0.6);
    this.mats.needle.map = lib.file('pine_twig.png');
    const bark = lib.file('bark_diff_1k.jpg'), barkN = lib.file('bark_nor_gl_1k.jpg', false);
    for (const t of [bark, barkN]) t.repeat.set(2, 3);
    Object.assign(this.mats.bark, { map: bark, normalMap: barkN, color: new THREE.Color('#ffffff') });
    this.mats.fence.map = fenceTexture();
    this.mats.fence.map.wrapS = this.mats.fence.map.wrapT = THREE.RepeatWrapping;
    const grav = lib.get('gravel');
    Object.assign(this.mats.gravel, { map: grav.map, normalMap: grav.normalMap, color: tintFor('gravel', '#8f8a7e') });
    const grain = lib.grain;
    Object.assign(this.mats.timber, { map: grain, color: tintFor('grain', '#c99e68') });
    this.ground = this.groundMaterial();
  }

  // ----------------------------------------------------------------------- terrain

  private groundMaterial() {
    const grass = this.lib.get('grass'), mud = this.lib.get('mud'), leafy = this.lib.get('leafy');
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, envMapIntensity: 0.45 });
    const u = this.uniforms;
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, u, {
        tGrass: { value: grass.map }, nGrass: { value: grass.normalMap }, rGrass: { value: grass.roughnessMap },
        tMud: { value: mud.map }, nMud: { value: mud.normalMap }, rMud: { value: mud.roughnessMap },
        tLeafy: { value: leafy.map }, nLeafy: { value: leafy.normalMap },
        uGrassTint: { value: tintFor('grass', '#6d7a3f') }, uMudTint: { value: tintFor('mud', '#6e5e48') },
      });
      const box = /* glsl */ `
        uniform vec4 uFoot; uniform float uWork; uniform float uDig; uniform vec2 uR;
        float footDist(vec2 p) { vec2 c = (uFoot.xy + uFoot.zw) * 0.5, h = (uFoot.zw - uFoot.xy) * 0.5; vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      `;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>\n${box}\nvarying vec3 vTW; varying vec3 vTN;`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTN = normalize(mat3(modelMatrix) * objectNormal);')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 tw = (modelMatrix * vec4(transformed, 1.0)).xz;
          transformed.y -= uDig * 0.9 * (1.0 - smoothstep(-0.5, 3.0, footDist(tw)));
          vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${box}\nvarying vec3 vTW; varying vec3 vTN;
          uniform sampler2D tGrass, nGrass, rGrass, tMud, nMud, rMud, tLeafy, nLeafy; uniform vec3 uGrassTint, uMudTint;
          float tMix; float nearK;`,
        )
        .replace(
          '#include <map_fragment>',
          `vec2 w = vTW.xz;
          // Two scales of the grass, turned against each other and swapped patchily, so it doesn't tile.
          mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
          vec3 g1 = texture2D(tGrass, w / 13.0).rgb;
          vec3 g2 = texture2D(tGrass, turn * w / 31.0 + vec2(0.37, 0.11)).rgb;
          float swapK = smoothstep(0.25, 0.65, texture2D(tMud, turn * w / 170.0).g);
          vec3 grassC = mix(g1, g2, 0.3 + 0.5 * swapK);
          // Further off, coarser scales only: the near tile's grid would show across the meadow.
          vec3 g3 = texture2D(tGrass, turn * turn * w / 83.0 + vec2(0.71, 0.29)).rgb;
          float far = smoothstep(25.0, 160.0, length(vTW - cameraPosition));
          grassC = mix(grassC, mix(g2, g3, 0.55), far * 0.85);
          grassC *= 0.68 + 0.95 * texture2D(tGrass, turn * w / 450.0).g;
          float dry = smoothstep(0.3, 0.7, texture2D(tMud, w / 700.0 + vec2(0.2)).r);
          grassC *= mix(vec3(0.95, 1.0, 0.9), vec3(1.12, 1.0, 0.72), dry);
          // Bright flecks (the stones in the scan) toned down, so the meadow reads as grass.
          float lum = dot(grassC, vec3(0.3, 0.59, 0.11));
          grassC = mix(grassC, vec3(lum) * vec3(1.05, 1.0, 0.8), smoothstep(0.12, 0.4, lum) * 0.7);
          grassC = min(grassC, vec3(0.3, 0.27, 0.16));
          // Close up, a ground-level scan (blades, clover, leaf litter) instead of the aerial one.
          float camD = length(vTW - cameraPosition);
          nearK = 1.0 - smoothstep(6.0, 34.0, camD);
          vec3 leafyC = mix(texture2D(tLeafy, w / 2.3).rgb, texture2D(tLeafy, turn * w / 5.7 + vec2(0.3)).rgb, 0.35) * vec3(0.56, 0.54, 0.24);
          grassC = mix(grassC, leafyC, nearK * 0.8);
          vec3 mudC = mix(texture2D(tMud, w / 4.5).rgb, texture2D(tMud, w / 15.0 + vec2(0.5)).rgb, 0.4);
          float breakup = texture2D(tMud, w / 70.0).r;
          float fd = footDist(w);
          tMix = (1.0 - smoothstep(uR.x, uR.y, fd + (breakup - 0.3) * 14.0)) * uWork;
          tMix = max(tMix, uDig * (1.0 - smoothstep(-0.5, 4.0, fd)));
          diffuseColor.rgb *= mix(grassC * uGrassTint, mudC * uMudTint, tMix);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * mix(texture2D(rGrass, w / 11.0).g * 0.4 + 0.6, texture2D(rMud, w / 4.5).g * 0.5 + 0.5, tMix);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
            vec3 tg = mix(texture2D(nGrass, w / 11.0).xyz, texture2D(nLeafy, w / 2.3).xyz, nearK * 0.8) * 2.0 - 1.0;
            vec3 tm = texture2D(nMud, w / 4.5).xyz * 2.0 - 1.0;
            vec3 tn = mix(tg, tm, tMix);
            tn.xy *= 0.9;
            vec3 N = normalize(vTN);
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
            vec3 B = cross(N, T);
            vec3 wn = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.2));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`,
        );
    };
    m.customProgramCacheKey = () => 'site-terrain';
    return m;
  }

  /** The height of the ground (three Y) at x, z. */
  heightAt(x: number, z: number): number {
    const g = this.grid;
    if (!g) return 0;
    const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
    const cx = Math.min(g.nx - 1.001, Math.max(0, fx)), cz = Math.min(g.nz - 1.001, Math.max(0, fz));
    const i = Math.floor(cx), j = Math.floor(cz), u = cx - i, v = cz - j;
    const at = (a: number, b: number) => g.h[b * g.nx + a];
    const edge = at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
    // Beyond the site: the edge's level, rolling into hills further out.
    const dx = Math.max(0, -fx, fx - (g.nx - 1)) * g.cell, dz = Math.max(0, -fz, fz - (g.nz - 1)) * g.cell;
    const d = Math.hypot(dx, dz);
    if (d <= 0) return edge;
    const span = g.cell * Math.max(g.nx, g.nz);
    return edge + ramp(0, 45, d) * (fbm(x / 70, z / 70, 3) * 1.6 + 0.4) + ramp(span * 0.4, span * 4 + 400, d) * (fbm(x / 260 + 7, z / 260 - 3, 4) + 0.55) * Math.max(18, span * 0.18);
  }

  /** Builds the terrain, trees and plant around a model (three coords). */
  build(opts: { building: THREE.Box3; all: THREE.Box3; sources: GroundSource[]; trees: ModelTree[]; floor: number }) {
    this.clear();
    const { building, all } = opts;
    const size = all.getSize(new THREE.Vector3());
    const span = Math.max(40, size.x, size.z);
    // The site's own grades, on a grid: the grass the model drew, under its paving.
    // Finer on long sites (an access road), so the grades near the building stay true.
    const cell = Math.min(4, Math.max(0.8, span / (span > 250 ? 340 : 170)));
    const x0 = all.min.x - cell * 2, z0 = all.min.z - cell * 2;
    const nx = Math.ceil((size.x + cell * 4) / cell) + 1, nz = Math.ceil((size.z + cell * 4) / cell) + 1;
    const grade = new Float32Array(nx * nz).fill(NaN);
    const laid = new Float32Array(nx * nz).fill(NaN);
    for (const s of opts.sources) this.raster(s.positions, s.grade ? grade : laid, x0, z0, cell, nx, nz, s.grade);
    const fallback = opts.floor - 0.05;
    const h = fillGaps(grade, nx, nz, fallback);
    const fx0 = building.min.x + 0.3, fx1 = building.max.x - 0.3, fz0 = building.min.z + 0.3, fz1 = building.max.z - 0.3;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = x0 + i * cell, z = z0 + j * cell;
        // Under the building: just below its ground floor (where the model drew no grade).
        if (Number.isNaN(grade[k]) && x > fx0 && x < fx1 && z > fz0 && z < fz1) h[k] = Math.min(h[k], opts.floor - 0.12);
        // Under paving: just below it, so it shows rather than the grass.
        if (!Number.isNaN(laid[k])) h[k] = Math.min(h[k], laid[k] - 0.07);
      }
    this.grid = { x0, z0, cell, nx, nz, h, laid };
    this.uniforms.uFoot.value.set(building.min.x, building.min.z, building.max.x, building.max.z);
    const bsize = building.getSize(new THREE.Vector3());
    this.uniforms.uR.value.set(2.5, 6 + Math.max(bsize.x, bsize.z) * 0.35);

    // The mesh: fine over the site, coarser and coarser out to the horizon.
    const reach = Math.max(1600, span * 9);
    const axis = (lo: number, hi: number, c: number) => {
      const v: number[] = [];
      for (let p = lo - 40; p <= hi + 40; p += c) v.push(p);
      let step = c;
      let p = v[v.length - 1];
      while (p < (lo + hi) / 2 + reach) v.push((p += step *= 1.14));
      step = c;
      p = v[0];
      const before: number[] = [];
      while (p > (lo + hi) / 2 - reach) before.push((p -= step *= 1.14));
      return [...before.reverse(), ...v];
    };
    const c2 = Math.max(cell, 1.2);
    const xs = axis(all.min.x, all.max.x, c2), zs = axis(all.min.z, all.max.z, c2);
    const pos = new Float32Array(xs.length * zs.length * 3);
    let n = 0;
    for (const z of zs) for (const x of xs) {
      pos[n++] = x;
      pos[n++] = this.heightAt(x, z);
      pos[n++] = z;
    }
    const idx: number[] = [];
    for (let j = 0; j < zs.length - 1; j++)
      for (let i = 0; i < xs.length - 1; i++) {
        const a = j * xs.length + i, b = a + 1, c = a + xs.length, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.terrain = new THREE.Mesh(geo, this.ground);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    // Walking asks straight down many times a second: answered from the height grid, not 100k triangles.
    const meshCast = this.terrain.raycast.bind(this.terrain);
    const terrain = this.terrain;
    terrain.raycast = (rc, hits) => {
      const r = rc.ray;
      if (r.direction.y > -0.999) return meshCast(rc, hits);
      const y = this.heightAt(r.origin.x, r.origin.z);
      const d = r.origin.y - y;
      if (d < rc.near || d > rc.far) return;
      hits.push({ distance: d, point: new THREE.Vector3(r.origin.x, y, r.origin.z), object: terrain });
    };
    this.group.add(this.terrain);

    this.plantTrees(opts.trees, all, span);
    this.plantGrass(building, span);
    this.buildPlant(building);
  }

  /** Top-facing triangles' heights onto the grid (the highest wins). */
  private raster(p: ArrayLike<number>, out: Float32Array, x0: number, z0: number, cell: number, nx: number, nz: number, grade: boolean) {
    for (let t = 0; t + 8 < p.length; t += 9) {
      const ax = p[t], ay = p[t + 1], az = p[t + 2], bx = p[t + 3], by = p[t + 4], bz = p[t + 5], cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
      // Only surfaces facing up (the tops of slabs), not their sides or undersides.
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nyv = uz * vx - ux * vz;
      const len = Math.hypot(uy * vz - uz * vy, nyv, ux * vy - uy * vx);
      if (len < 1e-9 || Math.abs(nyv) / len < 0.25) continue;
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * cell, z = z0 + j * cell;
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
          const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * ay + l2 * by + l3 * cy;
          const k = j * nx + i;
          // Grass: the top surface. Paving: its lowest top, so the ground stays under it.
          if (Number.isNaN(out[k]) || (grade ? y > out[k] : y < out[k])) out[k] = y;
        }
    }
  }

  // ----------------------------------------------------------------------- trees

  private plantTrees(model: ModelTree[], all: THREE.Box3, span: number) {
    const r = rng(2517);
    const clumpsOf = new Map<string, { c: THREE.Vector3; r: number; cone?: number }[]>();
    const trunks: { at: THREE.Vector3; h: number; r: number }[] = [];
    for (const t of model) {
      const clumps = clumpsOf.get(t.id) ?? [];
      clumpsOf.set(t.id, clumps);
      if (t.cone) clumps.push({ c: t.at, r: t.radius, cone: t.height ?? t.radius * 2.5 });
      else {
        // A round canopy as a few overlapping clumps, like a real crown.
        clumps.push({ c: t.at, r: t.radius * 0.75 });
        for (let k = 0; k < 4; k++) {
          const a = r() * Math.PI * 2;
          clumps.push({ c: t.at.clone().add(new THREE.Vector3(Math.cos(a) * t.radius * 0.45, (r() - 0.3) * t.radius * 0.5, Math.sin(a) * t.radius * 0.45)), r: t.radius * (0.45 + r() * 0.2) });
        }
      }
    }
    // Groves round the site, out to the middle distance.
    const bg: { c: THREE.Vector3; r: number }[] = [];
    const c = all.getCenter(new THREE.Vector3());
    const half = all.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const groves = Math.round(18 + span / 12);
    for (let g = 0; g < groves; g++) {
      const a = r() * Math.PI * 2;
      const d = 14 + Math.pow(r(), 1.6) * (span * 2.2 + 220);
      const gx = c.x + Math.cos(a) * (half.x + d), gz = c.z + Math.sin(a) * (half.z + d);
      const n = 2 + Math.floor(r() * 7);
      for (let k = 0; k < n; k++) {
        const x = gx + (r() - 0.5) * 26, z = gz + (r() - 0.5) * 26;
        if (x > all.min.x - 6 && x < all.max.x + 6 && z > all.min.z - 6 && z < all.max.z + 6) continue;
        const h = 6 + r() * 7, y = this.heightAt(x, z);
        trunks.push({ at: new THREE.Vector3(x, y, z), h: h * 0.62, r: 0.16 + h * 0.012 });
        for (let j = 0; j < 8; j++)
          bg.push({ c: new THREE.Vector3(x + (r() - 0.5) * h * 0.55, y + h * 0.58 + r() * h * 0.4, z + (r() - 0.5) * h * 0.55), r: h * (0.17 + r() * 0.1) });
      }
    }
    const leaves = (all: { c: THREE.Vector3; r: number; cone?: number }[], perR: number, parent: THREE.Group, shadows: boolean) => {
      // Broadleaf sprays and conifer twigs: each kind on its own cards.
      for (const cone of [false, true]) {
        const list = all.filter((l) => !!l.cone === cone);
        const per = (l: { r: number }) => Math.min(220, Math.max(32, Math.round(l.r * l.r * perR * 3.4)));
        const count = list.reduce((s, l) => s + per(l), 0);
        if (!count) continue;
        const mat = cone ? this.mats.needle : this.mats.leaf;
        const geo = cone ? new THREE.PlaneGeometry(0.5, 1) : new THREE.PlaneGeometry(1, 1);
        const out = new Float32Array(count * 3);
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        const d = new THREE.Object3D();
        const col = new THREE.Color();
        let i = 0;
        for (const l of list) {
          const n = per(l);
          // Each tree a little different in tone: some yellower, some bluer, some darker.
          const tone = r(), dark = 0.78 + r() * 0.3;
          for (let k = 0; k < n; k++) {
            let p: THREE.Vector3;
            if (l.cone) {
              // A conifer: twigs in a cone, wider at the bottom, drooping outward.
              const t = Math.pow(r(), 0.7), a = r() * Math.PI * 2, rad = l.r * (1 - t) * Math.sqrt(r());
              p = new THREE.Vector3(Math.cos(a) * rad, (t - 0.5) * l.cone, Math.sin(a) * rad);
            } else {
              // Mostly on the crown's skin, as real foliage is: the inside is branches and shade.
              const a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1), rad = l.r * (0.55 + 0.45 * Math.sqrt(r()));
              p = new THREE.Vector3(Math.cos(a) * Math.sin(b) * rad, Math.cos(b) * rad * 0.85, Math.sin(a) * Math.sin(b) * rad);
            }
            const dir = p.clone().normalize();
            d.position.copy(l.c).add(p);
            if (l.cone) d.rotation.set(-Math.PI / 2 + (r() - 0.5) * 0.9, Math.atan2(dir.x, dir.z) + (r() - 0.5) * 0.6, (r() - 0.5) * 0.8);
            else d.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI);
            d.scale.setScalar(l.cone ? 0.9 + r() * 0.6 : 0.75 + r() * 0.45);
            d.updateMatrix();
            mesh.setMatrixAt(i, d.matrix);
            // Inner cards darker (self-shade), outer ones lit; a tint per tree.
            const shade = (0.62 + 0.38 * Math.min(1, p.length() / Math.max(0.1, l.r))) * dark * (0.92 + r() * 0.16);
            col.setRGB(shade * (0.96 + tone * 0.1), shade, shade * (1.02 - tone * 0.1));
            mesh.setColorAt(i, col);
            out.set([dir.x, dir.y + 0.35, dir.z], i * 3);
            i++;
          }
        }
        geo.setAttribute('aOut', new THREE.InstancedBufferAttribute(out, 3));
        mesh.castShadow = shadows;
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map, alphaTest: mat.alphaTest, side: THREE.DoubleSide });
        mesh.instanceMatrix.needsUpdate = true;
        parent.add(mesh);
      }
    };
    // Leaves shade like a crown, not like flat cards: their normals lean outward.
    for (const [m, key] of [[this.mats.leaf, 'leaf-cards'], [this.mats.needle, 'needle-cards']] as const) {
      m.onBeforeCompile = (s) => {
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec3 aOut;')
          .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\ntransformedNormal = normalize(mix(transformedNormal, normalMatrix * normalize(aOut), 0.7));');
        // Light through the leaves: the side away from the sun glows a little green, not black.
        s.fragmentShader = s.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.10, 0.13, 0.05);',
        );
      };
      m.customProgramCacheKey = () => key;
    }
    for (const [id, clumps] of clumpsOf) {
      const g = new THREE.Group();
      leaves(clumps, 9, g, true);
      this.trees.add(g);
      this.treeOf.set(id, g);
    }
    leaves(bg, 6, this.background, true);
    if (trunks.length) {
      const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.6, 1, 1, 7), this.mats.bark, trunks.length);
      const d = new THREE.Object3D();
      trunks.forEach((t, i) => {
        d.position.set(t.at.x, t.at.y + t.h / 2 - 0.2, t.at.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(t.r, t.h + 0.2, t.r);
        d.updateMatrix();
        tm.setMatrixAt(i, d.matrix);
      });
      tm.castShadow = true;
      this.background.add(tm);
    }
  }

  // ----------------------------------------------------------------------- grass

  /** True where the model laid paving (or a slab) at x, z. */
  private paved(x: number, z: number) {
    const g = this.grid;
    if (!g) return false;
    const i = Math.round((x - g.x0) / g.cell), j = Math.round((z - g.z0) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return false;
    return !Number.isNaN(g.laid[j * g.nx + i]);
  }

  /**
   * Real 3D grass round the building: clumps of tapered blades, denser close in, thinning out to
   * the textured meadow. Not on paving or under the building; flattened where the ground is dug.
   */
  private plantGrass(b: THREE.Box3, span: number) {
    const r = rng(9031);
    // One clump: blades of two segments, leaning out, each a little different.
    const blades = 9, pos: number[] = [], nor: number[] = [], colr: number[] = [], h: number[] = [];
    for (let k = 0; k < blades; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.16;
      const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const face = r() * Math.PI, w = 0.012 + r() * 0.01, tall = 0.16 + r() * 0.22;
      const lean = 0.25 + r() * 0.35, la = a + (r() - 0.5);
      const ox = Math.cos(face) * w, oz = Math.sin(face) * w;
      const P = (t: number, side: number) => {
        const off = lean * t * t * tall;
        return [bx + Math.cos(la) * off + side * ox * (1 - t), tall * t * (1 - 0.15 * lean * t), bz + Math.sin(la) * off + side * oz * (1 - t)];
      };
      const tris = [
        [P(0, -1), P(0, 1), P(0.55, 1)],
        [P(0, -1), P(0.55, 1), P(0.55, -1)],
        [P(0.55, -1), P(0.55, 1), P(1, 0)],
      ];
      const ts = [[0, 0, 0.55], [0, 0.55, 0.55], [0.55, 0.55, 1]];
      tris.forEach((tri, ti) =>
        tri.forEach((v, vi) => {
          pos.push(v[0], v[1], v[2]);
          // Lit mostly as the ground under them is, so blades seen edge-on aren't black.
          nor.push(Math.cos(face + Math.PI / 2) * 0.35, 1, Math.sin(face + Math.PI / 2) * 0.35);
          const t = ts[ti][vi];
          colr.push(0.025 + 0.07 * t, 0.04 + 0.1 * t, 0.01 + 0.025 * t);
          h.push(t);
        }),
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    geo.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
    geo.normalizeNormals();

    // Where: out to a band round the building, thinning with distance.
    const band = Math.min(45, Math.max(22, span * 0.45));
    const x0 = b.min.x - band, x1 = b.max.x + band, z0 = b.min.z - band, z1 = b.max.z + band;
    const spots: number[] = [];
    const cap = 32000;
    const step = 0.5;
    for (let z = z0; z < z1 && spots.length / 4 < cap; z += step)
      for (let x = x0; x < x1; x += step) {
        const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
        const dx = Math.max(b.min.x - px, 0, px - b.max.x), dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
        const d = Math.hypot(dx, dz);
        if (d < 0.6) continue;
        if (r() > 1 - smooth(Math.min(1, d / band)) * 0.85) continue;
        if (this.paved(px, pz)) continue;
        spots.push(px, this.heightAt(px, pz), pz, 0.7 + r() * 0.7);
        if (spots.length / 4 >= cap) break;
      }
    const n = spots.length / 4;
    if (!n) return;
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.5 });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aH; uniform vec4 uFoot; uniform float uWork; uniform float uDig; uniform vec2 uR;
          float footDistG(vec2 p) { vec2 c = (uFoot.xy + uFoot.zw) * 0.5, h = (uFoot.zw - uFoot.xy) * 0.5; vec2 d = abs(p - c) - h; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 gw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
          float fd = footDistG(gw);
          float torn = max((1.0 - smoothstep(uR.x, uR.y, fd)) * uWork, uDig * (1.0 - smoothstep(-0.5, 4.0, fd)));
          transformed.y *= 1.0 - torn;
          transformed.xz *= 1.0 - torn * 0.7;`,
        );
    };
    mat.customProgramCacheKey = () => 'grass-blades';
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const d = new THREE.Object3D();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      d.position.set(spots[i * 4], spots[i * 4 + 1] - 0.02, spots[i * 4 + 2]);
      d.rotation.set(0, r() * Math.PI * 2, 0);
      d.scale.setScalar(spots[i * 4 + 3]);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      // Patches drier or lusher, as a real meadow is.
      const dry = Math.max(0, fbm(spots[i * 4] / 9, spots[i * 4 + 2] / 9, 2) + 0.15) * 1.4;
      const v = 0.85 + r() * 0.3;
      col.setRGB(v * (1 + dry * 0.55), v * (1 + dry * 0.25), v * (1 - dry * 0.1));
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.name = 'grass';
    this.grass = mesh;
    this.group.add(mesh);
  }

  // ----------------------------------------------------------------------- plant and temporary works

  private buildPlant(b: THREE.Box3) {
    const M = this.mats;
    const size = b.getSize(new THREE.Vector3());
    const ctr = b.getCenter(new THREE.Vector3());
    const tall = Math.max(6, b.max.y - Math.max(b.min.y, -1));
    const y = (x: number, z: number) => this.heightAt(x, z);

    // The mobile crane, on the west side, its boom over the building.
    {
      const k = new Kit();
      k.box(M.yellow, [0, 1.25, 0], [11, 0.75, 2.6]);
      k.box(M.dark, [0, 0.85, 0], [10.4, 0.3, 2.3]);
      for (const x of [-3.9, -2.4, 2.2, 3.7]) for (const s of [-1, 1]) {
        k.cyl(M.tyre, [x, 0.68, s * 1.2], 0.68, 0.5, [Math.PI / 2, 0, 0], 20);
        k.cyl(M.steel, [x, 0.68, s * 1.46], 0.36, 0.04, [Math.PI / 2, 0, 0], 12);
      }
      k.box(M.yellow, [4.6, 2.1, 0.55], [1.8, 1.5, 1.4]);
      k.box(M.glass, [5.1, 2.35, 0.55], [0.9, 0.9, 1.42]);
      for (const x of [-4.4, 3.2]) for (const s of [-1, 1]) {
        k.box(M.yellow, [x, 1.0, s * 2.5], [0.35, 0.35, 2.6]);
        k.cyl(M.steel, [x, 0.5, s * 3.8], 0.12, 0.9);
        k.box(M.timber, [x, 0.08, s * 3.8], [1.1, 0.16, 1.1]);
      }
      const upper = new Kit();
      upper.cyl(M.steel, [0, 0.12, 0], 1.1, 0.25, undefined, 24);
      upper.box(M.yellow, [-1.2, 0.85, 0], [3.4, 1.3, 2.5]);
      upper.box(M.dark, [-2.8, 0.75, 0], [0.9, 1.1, 2.7]);
      upper.box(M.yellow, [0.9, 0.95, 1.05], [1.4, 1.5, 0.95]);
      upper.box(M.glass, [1.3, 1.1, 1.05], [0.7, 0.9, 0.97]);
      // The boom: nested telescopic sections, raised.
      const reach = Math.max(14, Math.hypot(size.x, size.z) * 0.2 + 9);
      const rise = tall + 9;
      const L = Math.hypot(reach, rise - 1.6);
      const ang = Math.atan2(rise - 1.6, reach);
      const pivot = new THREE.Vector3(0.6, 1.6, 0);
      const dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
      const sec = 4;
      for (let i = 0; i < sec; i++) {
        const s0 = (i / sec) * L * 0.97, s1 = ((i + 1) / sec) * L;
        const a = pivot.clone().addScaledVector(dir, s0), c = pivot.clone().addScaledVector(dir, s1);
        const w = 0.85 - i * 0.13;
        upper.add(new THREE.BoxGeometry(c.distanceTo(a), w, w), i % 2 ? M.white : M.yellow, a.clone().add(c).multiplyScalar(0.5).toArray() as [number, number, number], [0, 0, ang]);
      }
      upper.rod(M.yellow, new THREE.Vector3(-0.2, 1.4, 0), pivot.clone().addScaledVector(dir, L * 0.33), 0.17);
      const tip = pivot.clone().addScaledVector(dir, L);
      upper.cyl(M.steel, tip.toArray() as [number, number, number], 0.35, 0.3, [Math.PI / 2, 0, 0], 14);
      // The hook and its load: a bundle of timber on slings.
      const load = tip.clone().setY(Math.max(3, tall * 0.55 + 2));
      upper.rod(M.dark, tip, load.clone().setY(load.y + 2.3), 0.025, 5);
      upper.cyl(M.yellow, [load.x, load.y + 2.4, load.z], 0.14, 0.4);
      upper.rod(M.orange, load.clone().add(new THREE.Vector3(-2, 0.3, 0)), load.clone().setY(load.y + 2.25), 0.025, 5);
      upper.rod(M.orange, load.clone().add(new THREE.Vector3(2, 0.3, 0)), load.clone().setY(load.y + 2.25), 0.025, 5);
      for (let j = 0; j < 3; j++) upper.box(M.timber, [load.x, load.y + 0.12 + j * 0.24, load.z], [6, 0.22, 0.9]);
      const g = k.build();
      const up = upper.build();
      up.position.set(-0.9, 1.6, 0);
      g.add(up);
      const px = b.min.x - 9.5, pz = ctr.z - size.z * 0.3;
      g.position.set(px, y(px, pz), pz);
      g.rotation.y = Math.PI / 2;
      // Slew the boom to point at the middle of the building.
      const toward = Math.atan2(-(ctr.z - pz), ctr.x - px);
      up.rotation.y = toward - g.rotation.y;
      this.crane = { g, upper: up, yaw: up.rotation.y };
      this.props.add(g);
    }

    // The excavator and a dump truck at the front corner.
    {
      const k = new Kit();
      for (const s of [-1, 1]) {
        k.box(M.tyre, [0, 0.5, s * 1.05], [4.2, 0.9, 0.72]);
        for (let i = 0; i < 6; i++) k.cyl(M.dark, [-1.6 + i * 0.64, 0.5, s * 1.05], 0.36, 0.76, [Math.PI / 2, 0, 0], 12);
      }
      k.cyl(M.steel, [0, 1.1, 0], 0.95, 0.3, undefined, 20);
      const body = new Kit();
      body.box(M.yellow, [-0.5, 0.55, 0], [2.7, 1.1, 2.4]);
      body.box(M.dark, [-1.75, 0.65, 0], [0.5, 1.2, 2.45]);
      body.box(M.yellow, [0.55, 1.05, -0.65], [1.3, 1.9, 1.05]);
      body.box(M.glass, [0.62, 1.45, -0.65], [1.18, 1.0, 1.08]);
      body.box(M.dark, [0.55, 2.05, -0.65], [1.4, 0.1, 1.15]);
      const b0 = new THREE.Vector3(0.9, 0.9, 0.35), b1 = new THREE.Vector3(3.3, 4.0, 0.35), b2 = new THREE.Vector3(5.1, 1.2, 0.35);
      body.rod(M.yellow, b0, b1, 0.22);
      body.rod(M.yellow, b1, b2, 0.17);
      body.rod(M.steel, b0.clone().add(new THREE.Vector3(0.2, 0.2, -0.25)), b1.clone().lerp(b0, 0.35).add(new THREE.Vector3(0, 0, -0.25)), 0.08);
      body.box(M.dark, [5.35, 0.75, 0.35], [0.9, 0.85, 1.25], [0, 0, 0.5]);
      const g = k.build();
      const bg = body.build();
      bg.position.y = 1.25;
      g.add(bg);
      // In the dig, at the front corner.
      const ex = b.min.x + Math.min(4, size.x * 0.2), ez = ctr.z + size.z * 0.28;
      g.position.set(ex, y(ex, ez), ez);
      g.rotation.y = 0.4;
      this.digger = { g, body: bg, y0: g.position.y };
      this.props.add(g);
    }
    {
      const k = new Kit();
      k.box(M.dark, [0, 1.0, 0], [7.2, 0.35, 2.3]);
      k.box(M.white, [2.75, 2.0, 0], [1.8, 2.1, 2.4]);
      k.box(M.glass, [3.1, 2.45, 0], [1.2, 0.85, 2.42]);
      k.box(M.white, [2.7, 3.1, 0], [1.95, 0.12, 2.48]);
      k.box(M.steel, [3.75, 1.1, 0], [0.18, 0.25, 2.5]);
      for (const x of [-2.2, -0.9, 2.6]) for (const s of [-1, 1]) {
        k.cyl(M.tyre, [x, 0.7, s * 1.22], 0.68, 0.42, [Math.PI / 2, 0, 0], 20);
        k.cyl(M.steel, [x, 0.7, s * 1.44], 0.36, 0.04, [Math.PI / 2, 0, 0], 12);
      }
      k.box(M.yellow, [-0.65, 1.6, 0], [4.9, 0.2, 2.45]);
      for (const s of [-1, 1]) k.box(M.yellow, [-0.65, 2.3, s * 1.18], [4.9, 1.4, 0.12]);
      k.box(M.yellow, [-3.05, 2.3, 0], [0.12, 1.4, 2.45]);
      k.box(M.yellow, [1.75, 2.3, 0], [0.12, 1.4, 2.45]);
      k.box(M.gravel, [-0.65, 2.55, 0], [4.6, 0.6, 2.25]);
      const g = k.build();
      const tx = b.min.x - 2.2, tz = ctr.z - size.z * 0.05;
      g.position.set(tx, y(tx, tz), tz);
      g.rotation.y = Math.PI / 2 + 0.25;
      this.truck = g;
      this.props.add(g);
    }

    // Temporary fence round the work, with a gate gap at the front; cones along the gate.
    {
      const k = new Kit();
      const off = 5;
      const x0 = b.min.x - off, x1 = b.max.x + off, z0 = b.min.z - off, z1 = b.max.z + off;
      const gate = [ctr.x - 6, ctr.x + 6];
      const run = (ax: number, az: number, bx: number, bz: number, skip?: (t: number) => boolean) => {
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3.2));
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n;
          const px = ax + (bx - ax) * t0, pz = az + (bz - az) * t0, qx = ax + (bx - ax) * t1, qz = az + (bz - az) * t1;
          if (skip?.((px + qx) / 2)) continue;
          const h0 = y(px, pz), mx = (px + qx) / 2, mz = (pz + qz) / 2, hm = y(mx, mz);
          const plen = Math.hypot(qx - px, qz - pz);
          k.add(new THREE.PlaneGeometry(plen, 1.9), M.fence, [mx, hm + 1.0, mz], [0, -Math.atan2(qz - pz, qx - px), 0]);
          k.cyl(M.post, [px, h0 + 1.0, pz], 0.03, 2.0, undefined, 6);
          k.box(M.dark, [px, h0 + 0.06, pz], [0.6, 0.12, 0.22], [0, -Math.atan2(qz - pz, qx - px), 0]);
        }
      };
      run(x0, z0, x1, z0);
      run(x1, z0, x1, z1);
      run(x1, z1, x0, z1, (x) => x > gate[0] && x < gate[1]);
      run(x0, z1, x0, z0);
      for (let i = 0; i < 7; i++) {
        const cx = gate[0] - 1 + i * 2.3, cz = z1 + 2.2, h = y(cx, cz);
        k.box(M.dark, [cx, h + 0.03, cz], [0.38, 0.06, 0.38]);
        k.cyl(M.orange, [cx, h + 0.36, cz], 0.17, 0.62, undefined, 12, 0.03);
        k.cyl(M.white, [cx, h + 0.42, cz], 0.12, 0.1, undefined, 12, 0.1);
      }
      this.fence = k.build();
      this.fence.traverse((o) => (o.castShadow = false));
      this.props.add(this.fence);
    }

    // The site office and stacked material, outside the fence.
    {
      const k = new Kit();
      k.box(M.white, [0, 1.55, 0], [9, 2.6, 3]);
      k.box(M.dark, [0, 2.92, 0], [9.15, 0.14, 3.15]);
      for (const x of [-3, -1, 2.5]) k.box(M.glass, [x, 1.9, 1.51], [1.2, 0.8, 0.04]);
      k.box(M.blue, [0.8, 1.35, 1.51], [0.9, 2.05, 0.05]);
      k.box(M.steel, [0.8, 0.12, 2.0], [1.3, 0.24, 0.9]);
      k.box(M.blue, [-6.5, 1.3, 0.2], [3, 2.6, 2.4]);
      this.office = k.build();
      const ox = b.min.x - 13, oz = b.min.z - 4;
      this.office.position.set(ox, y(ox, oz) + 0.2, oz);
      this.office.rotation.y = Math.PI / 2;
      this.props.add(this.office);
      const s = new Kit();
      for (let j = 0; j < 3; j++)
        for (let layer = 0; layer < 4; layer++) {
          for (let q = 0; q < 4; q++) s.box(M.timber, [j * 2.4, 0.22 + layer * 0.27, q * 0.32], [0.29, 0.24, 6], [0, Math.PI / 2, 0]);
          s.box(M.dark, [j * 2.4, 0.08 + layer * 0.27, 0.5], [1.4, 0.07, 0.1]);
        }
      this.stacks = s.build();
      const sx = b.min.x - 4, sz = b.min.z - 1;
      this.stacks.position.set(sx, y(sx, sz), sz);
      this.props.add(this.stacks);
    }

    // A few of the crew, in hi-vis.
    {
      const k = new Kit();
      const r = rng(77);
      for (let i = 0; i < 7; i++) {
        const px = b.min.x - 2 - r() * 6, pz = b.min.z + r() * size.z, h = y(px, pz), turn = r() * Math.PI * 2;
        const at = (dx: number, dy: number, dz: number): [number, number, number] => [px + dx * Math.cos(turn) - dz * Math.sin(turn), h + dy, pz + dx * Math.sin(turn) + dz * Math.cos(turn)];
        k.box(M.vest, at(0, 1.18, 0), [0.4, 0.58, 0.26], [0, -turn, 0]);
        k.box(M.skin, at(0, 1.6, 0), [0.21, 0.24, 0.21], [0, -turn, 0]);
        k.cyl(M.yellow, at(0, 1.76, 0), 0.15, 0.1, undefined, 10, 0.12);
        for (const s of [-0.1, 0.1]) k.box(M.blue, at(0, 0.45, s), [0.15, 0.9, 0.14], [0, -turn, 0]);
      }
      this.crew = k.build();
      this.props.add(this.crew);
    }
    this.setStage(null);
  }

  /** Shows the stage of work on the day (null: no schedule, nothing temporary). */
  setStage(s: SiteStage | null) {
    const u = this.uniforms;
    u.uWork.value = s?.work ?? 0;
    u.uDig.value = s?.dig ?? 0;
    const on = (o: THREE.Object3D | null, v: boolean) => o && (o.visible = v);
    on(this.crane?.g ?? null, !!s?.structure);
    on(this.digger?.g ?? null, !!s?.earthworks);
    on(this.truck, !!s?.earthworks || (!!s?.site && (s?.work ?? 0) > 0.95 && !s?.structure));
    on(this.fence, !!s?.site);
    on(this.office, !!s?.site);
    on(this.crew, !!s?.site);
    on(this.stacks, !!s?.structure);
    if (s && this.crane) this.crane.upper.rotation.y = this.crane.yaw + Math.sin(s.day * 0.45) * 0.32;
    if (s && this.digger) {
      this.digger.body.rotation.y = Math.sin(s.day * 0.8) * 0.9;
      // Down in the dig with the ground it is digging.
      this.digger.g.position.y = this.digger.y0 - s.dig * 0.9;
    }
  }

  /** Background trees and hills on or off. */
  setContext(on: boolean) {
    this.background.visible = on;
  }

  /** The model's own trees: each shows when its element is (built, its layer on). */
  setTree(id: string, on: boolean) {
    const g = this.treeOf.get(id);
    if (g) g.visible = on;
  }

  /** See-through ground, to look at what is buried. */
  setReveal(on: boolean) {
    const m = this.ground;
    m.transparent = on;
    m.opacity = on ? 0.28 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
  }

  private clear() {
    for (const g of [this.trees, this.background, this.props]) {
      for (const o of [...g.children]) {
        g.remove(o);
        o.traverse((x) => {
          if (x instanceof THREE.Mesh) x.geometry.dispose();
        });
      }
    }
    if (this.terrain) {
      this.group.remove(this.terrain);
      this.terrain.geometry.dispose();
      this.terrain = null;
    }
    if (this.grass) {
      this.group.remove(this.grass);
      this.grass.geometry.dispose();
      (this.grass.material as THREE.Material).dispose();
      this.grass = null;
    }
    this.treeOf.clear();
    this.crane = this.digger = null;
    this.truck = this.fence = this.office = this.crew = this.stacks = null;
  }

  dispose() {
    this.clear();
    this.ground.dispose();
    for (const m of Object.values(this.mats)) {
      m.map?.dispose();
      m.dispose();
    }
  }
}

/** Fills the cells nothing covered from their neighbours (the edges from the nearest known). */
function fillGaps(src: Float32Array, nx: number, nz: number, fallback: number) {
  const h = src.slice();
  if (!h.some((v) => !Number.isNaN(v))) return h.fill(fallback);
  for (let pass = 0; pass < 400; pass++) {
    let left = 0;
    const next = h.slice();
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!Number.isNaN(h[k])) continue;
        let s = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const v = h[b * nx + a];
          if (!Number.isNaN(v)) {
            s += v;
            n++;
          }
        }
        if (n) next[k] = s / n;
        else left++;
      }
    h.set(next);
    if (!left) break;
  }
  for (let k = 0; k < h.length; k++) if (Number.isNaN(h[k])) h[k] = fallback;
  return h;
}
