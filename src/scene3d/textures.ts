import * as THREE from 'three';

/**
 * Photo-scanned surface textures (Poly Haven, CC0) for the model's finishes and the ground:
 * colour, a normal map and a roughness map each, 1k, shipped in public/textures so they load
 * from the app bundle offline. Loaded once, on first use; the picture redraws when they arrive.
 */

export type TextureSet = 'grass' | 'mud' | 'gravel' | 'concrete' | 'wood';
const FILES: Record<TextureSet, string> = {
  grass: 'aerial_grass_rock',
  mud: 'brown_mud_leaves_01',
  gravel: 'gravel_ground_01',
  concrete: 'concrete_floor_02',
  wood: 'wood_table_001',
};
/** Each colour map's average colour (sRGB 0-255), so a finish can be tinted to a target colour. */
const MEAN: Record<TextureSet | 'grain', [number, number, number]> = {
  grass: [114, 97, 37],
  mud: [101, 84, 51],
  gravel: [146, 131, 104],
  concrete: [120, 110, 91],
  wood: [90, 44, 18],
  grain: [206, 206, 206],
};

export interface Pbr {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const base = () => {
  try {
    return import.meta.env.BASE_URL ?? './';
  } catch {
    return './';
  }
};

export class TextureLibrary {
  private sets = new Map<string, Pbr>();
  private grainMap: THREE.Texture | null = null;
  private loader: THREE.TextureLoader;
  private pending = 0;
  /** A texture could not be loaded (the plain finishes stay). */
  failed = false;
  /** Called when a texture has arrived (to redraw). */
  onLoad?: () => void;

  constructor(private anisotropy = 8) {
    const mgr = new THREE.LoadingManager();
    this.loader = new THREE.TextureLoader(mgr);
  }

  private load(file: string, colour: boolean) {
    this.pending++;
    const t = this.loader.load(
      `${base()}textures/${file}`,
      () => {
        this.pending--;
        this.onLoad?.();
      },
      undefined,
      () => {
        this.pending--;
        this.failed = true;
        this.onLoad?.();
      },
    );
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.anisotropy;
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** True while textures are still on their way. */
  get loading() {
    return this.pending > 0;
  }

  get(set: TextureSet): Pbr {
    let s = this.sets.get(set);
    if (!s) {
      const f = FILES[set];
      s = { map: this.load(`${f}_diff_1k.jpg`, true), normalMap: this.load(`${f}_nor_gl_1k.jpg`, false), roughnessMap: this.load(`${f}_rough_1k.jpg`, false) };
      this.sets.set(set, s);
    }
    return s;
  }

  /** A light map of the wood's grain only, for timber tinted to its finish colour. */
  get grain() {
    return (this.grainMap ??= this.load('wood_table_001_grain_1k.jpg', true));
  }

  dispose() {
    for (const s of this.sets.values()) for (const t of Object.values(s)) t.dispose();
    this.grainMap?.dispose();
  }
}

/** The colour to multiply a texture by so it averages out to `hex` (linear, may go over 1). */
export function tintFor(set: TextureSet | 'grain', hex: string): THREE.Color {
  const want = new THREE.Color(hex);
  const m = MEAN[set].map((v) => new THREE.Color().setRGB(v / 255, v / 255, v / 255, THREE.SRGBColorSpace).r);
  return new THREE.Color(want.r / Math.max(0.02, m[0]), want.g / Math.max(0.02, m[1]), want.b / Math.max(0.02, m[2]));
}
