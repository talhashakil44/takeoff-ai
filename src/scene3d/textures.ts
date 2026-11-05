import * as THREE from 'three';

/**
 * Photo-scanned surface textures (Poly Haven, CC0) for the model's finishes and the ground:
 * colour, a normal map and a roughness map each, 1k, shipped in public/textures so they load
 * from the app bundle offline. Loaded once, on first use; the picture redraws when they arrive.
 */

export type TextureSet =
  | 'grass' | 'mud' | 'gravel' | 'concrete' | 'wood'
  | 'ribbed' | 'corrugated' | 'asphalt' | 'bconcrete' | 'block' | 'plaster' | 'leafy';
/** File stem and resolution: the 2k sets have their roughness at 1k. */
const FILES: Record<TextureSet, [string, '1k' | '2k']> = {
  grass: ['aerial_grass_rock', '1k'],
  mud: ['brown_mud_leaves_01', '1k'],
  gravel: ['gravel_ground_01', '1k'],
  concrete: ['concrete_floor_02', '1k'],
  wood: ['wood_table_001', '1k'],
  ribbed: ['ribbed_metal', '2k'],
  corrugated: ['corrugated_metal', '2k'],
  asphalt: ['asphalt', '2k'],
  bconcrete: ['brushed_concrete', '2k'],
  block: ['concrete_block', '2k'],
  plaster: ['plaster', '2k'],
  leafy: ['leafy_grass', '2k'],
};
/** Each colour map's average colour (sRGB 0-255), so a finish can be tinted to a target colour. */
const MEAN: Record<TextureSet | 'grain', [number, number, number]> = {
  grass: [114, 97, 37],
  mud: [101, 84, 51],
  gravel: [146, 131, 104],
  concrete: [120, 110, 91],
  wood: [90, 44, 18],
  grain: [206, 206, 206],
  ribbed: [143, 143, 143],
  corrugated: [89, 88, 81],
  asphalt: [91, 90, 85],
  bconcrete: [107, 99, 88],
  block: [69, 61, 50],
  plaster: [171, 162, 160],
  leafy: [151, 131, 89],
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
  /** Decodes images off the main thread, so they don't stall the picture as they arrive. */
  private bitmaps: THREE.ImageBitmapLoader | null = null;
  private pending = 0;
  /** A texture could not be loaded (the plain finishes stay). */
  failed = false;
  /** Called when a texture has arrived (to redraw). */
  onLoad?: () => void;

  constructor(private anisotropy = 8) {
    const mgr = new THREE.LoadingManager();
    this.loader = new THREE.TextureLoader(mgr);
    // Safari's createImageBitmap ignores the flip option; there the plain loader stays.
    const safari = typeof navigator !== 'undefined' && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    if (typeof createImageBitmap === 'function' && !safari) this.bitmaps = new THREE.ImageBitmapLoader(mgr).setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  }

  private load(file: string, colour: boolean) {
    this.pending++;
    if (this.bitmaps) {
      const t = new THREE.Texture();
      t.flipY = false;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      if (colour) t.colorSpace = THREE.SRGBColorSpace;
      this.bitmaps.load(
        `${base()}textures/${file}`,
        (img) => {
          t.image = img;
          t.needsUpdate = true;
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
      return t;
    }
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
      const [f, res] = FILES[set];
      s = { map: this.load(`${f}_diff_${res}.jpg`, true), normalMap: this.load(`${f}_nor_gl_${res}.jpg`, false), roughnessMap: this.load(`${f}_rough_1k.jpg`, false) };
      this.sets.set(set, s);
    }
    return s;
  }

  private extra = new Map<string, THREE.Texture>();
  /** Any other texture in public/textures (leaf cards, bark), loaded once. */
  file(name: string, colour = true): THREE.Texture {
    let t = this.extra.get(name);
    if (!t) {
      t = this.load(name, colour);
      this.extra.set(name, t);
    }
    return t;
  }

  /** A light map of the wood's grain only, for timber tinted to its finish colour. */
  get grain() {
    return (this.grainMap ??= this.load('wood_table_001_grain_1k.jpg', true));
  }

  dispose() {
    for (const s of this.sets.values()) for (const t of Object.values(s)) t.dispose();
    this.grainMap?.dispose();
    for (const t of this.extra.values()) t.dispose();
  }
}

/** The colour to multiply a texture by so it averages out to `hex` (linear, may go over 1). */
export function tintFor(set: TextureSet | 'grain', hex: string): THREE.Color {
  const want = new THREE.Color(hex);
  const m = MEAN[set].map((v) => new THREE.Color().setRGB(v / 255, v / 255, v / 255, THREE.SRGBColorSpace).r);
  return new THREE.Color(want.r / Math.max(0.02, m[0]), want.g / Math.max(0.02, m[1]), want.b / Math.max(0.02, m[2]));
}
