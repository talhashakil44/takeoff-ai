import type { ExtractedAssembly, ExtractedLayer } from './ai/schema';
import { newId, type AssemblyItem, type TakeoffType, type Units } from './model';
import { areaUnit, lengthUnit } from './units';

const PALETTE = ['#e4572e', '#17bebb', '#76b041', '#ffc914', '#7d5ba6', '#2e86ab', '#f18f01', '#c73e1d', '#44af69', '#8f2d56'];

/** Waste allowance applied to sheet goods and membranes. */
const WASTE = 1.1;

const round = (n: number, digits = 3) => Number(n.toFixed(digits));

/** Where the estimator's workbook prices each kind of assembly. */
const DIVISION_BY_CATEGORY: Record<ExtractedAssembly['category'], string | undefined> = {
  interior_wall: '06 Wood Framing & Partitions',
  exterior_wall: '06 Wood Framing & Partitions',
  floor: '03 Concrete',
  roof: '07 Roofing',
  ceiling: '09 Finishes',
  other: undefined,
};

/** Converts millimetres to project length units (m or ft), for use inside formulas. */
const mmToLength = (mm: number, units: Units) => round(units === 'metric' ? mm / 1000 : mm / 304.8, 4);

const volumeUnit = (units: Units) => (units === 'metric' ? 'm³' : 'CY');

/** Formula for volume from area and a layer thickness: m³ = m² × m, CY = SF × ft ÷ 27. */
function volumeFormula(thicknessMm: number, units: Units): string {
  const t = mmToLength(thicknessMm, units);
  return units === 'metric' ? `A * ${t}` : `A * ${t} / 27`;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Material lines for one layer. Linear types (walls) carry A = L × H; area types
 * (floors, roofs, ceilings) carry the measured area.
 */
function layerItems(layer: ExtractedLayer, kind: 'linear' | 'area', units: Units): AssemblyItem[] {
  const name = clean(layer.material);
  const item = (suffix: string, unit: string, formula: string): AssemblyItem => ({
    id: newId(),
    name: suffix ? `${name} – ${suffix}` : name,
    unit,
    formula,
  });
  const area = areaUnit(units);
  switch (layer.role) {
    case 'air_space':
      return [];
    case 'framing': {
      if (!layer.spacing_mm) return [item('', area, 'A')];
      const s = mmToLength(layer.spacing_mm, units);
      if (kind === 'linear') {
        return [item('members', 'ea', `ceil(L / ${s}) + N`), item('top & bottom track/plate', lengthUnit(units), '2 * L')];
      }
      // Members across an area: total run ≈ area ÷ spacing.
      return [item('member run', lengthUnit(units), `A / ${s}`)];
    }
    case 'board':
    case 'sheathing':
    case 'membrane': {
      // "2 LAYERS 16mm TYPE X GYPSUM BOARD" is two sheets' worth on that face.
      const plies = Number(/^\s*(\d+)\s*(?:LAYERS?|PLY)\b/i.exec(name)?.[1] ?? 1);
      const waste = `incl. ${Math.round((WASTE - 1) * 100)}% waste`;
      return plies > 1
        ? [item(`${plies} layers, ${waste}`, area, `${plies} * A * ${WASTE}`)]
        : [item(waste, area, `A * ${WASTE}`)];
    }
    case 'structure':
    case 'fill':
      return layer.thickness_mm
        ? [item('', area, 'A'), item('volume', volumeUnit(units), volumeFormula(layer.thickness_mm, units))]
        : [item('', area, 'A')];
    default:
      return [item('', area, 'A')];
  }
}

/** A wall with no framing whose structure is concrete or block is priced there, not with the stud walls. */
function divisionOf(a: ExtractedAssembly): string | undefined {
  const wall = a.category === 'interior_wall' || a.category === 'exterior_wall';
  if (wall && !a.layers.some((l) => l.role === 'framing')) {
    const structure = a.layers.filter((l) => l.role === 'structure').map((l) => l.material).join(' ');
    if (/MASONRY|\bCMU\b|\bBLOCK\b|BRICK/i.test(structure)) return '04 Masonry';
    if (/CONCRETE|\bICF\b/i.test(structure)) return '03 Concrete';
  }
  return DIVISION_BY_CATEGORY[a.category];
}

/** Turns an extracted assembly into a takeoff type with material lines. */
export function buildTakeoffType(a: ExtractedAssembly, units: Units, index: number, height: number): TakeoffType {
  const kind = a.category === 'interior_wall' || a.category === 'exterior_wall' ? 'linear' : 'area';
  const area = areaUnit(units);
  const headline: AssemblyItem =
    kind === 'linear'
      ? { id: newId(), name: 'Wall area', unit: area, formula: 'A' }
      : { id: newId(), name: `${a.category === 'roof' ? 'Roof' : a.category === 'ceiling' ? 'Ceiling' : 'Floor'} area`, unit: area, formula: 'A' };
  const title = clean(a.title);
  return {
    id: newId(),
    name: title ? `${clean(a.code)} – ${title}` : clean(a.code),
    color: PALETTE[index % PALETTE.length],
    kind,
    height,
    items: [headline, ...a.layers.flatMap((l) => layerItems(l, kind, units))],
    division: divisionOf(a),
    assemblyTitle: [title, ...a.notes.filter((n) => /F\.?R\.?R|STC|ULC|FIRE/i.test(n)).map(clean)].join(' – ') || undefined,
    description: a.layers.map((l) => `• ${clean(l.material)}`).join(' '),
  };
}

/** Assembly tags printed as standalone text on a legend sheet (W1, EW3C, FR2, F1, R1, …). */
export function findAssemblyCodes(texts: string[]): string[] {
  const codes = new Set<string>();
  for (const t of texts) {
    const s = t.trim();
    if (/^(?:EW|IW|W|FR|F|FW|R|RF|C|CB|CL|CW|PW|S)\d{1,2}[A-Z]?$/.test(s)) codes.add(s);
  }
  return [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
