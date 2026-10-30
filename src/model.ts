import type { ExtractedAssembly } from './ai/schema';
import type { SpecBook } from './spec/parse';

export type Units = 'metric' | 'imperial';
export type Kind = 'area' | 'linear' | 'count';

/** A point in sheet space: PDF points (1/72 in) from the page's top-left corner. */
export type Pt = [number, number];

export interface SavedLegendRead {
  assemblies: ExtractedAssembly[];
  /** Type tags printed on the sheet, for the coverage check. */
  printed: string[];
  answeredBy: string;
  readAt: string;
  seconds: number;
}

export interface Doc {
  id: string;
  name: string;
  /** The building its sheets are for (unset: read from the file name). */
  building?: string;
}

/** Where a sheet's scale came from; 'verified' is a detected scale its dimension strings confirmed. */
export type ScaleSource = 'detected' | 'verified' | 'preset' | 'calibrated';

export interface Sheet {
  id: string;
  docId: string;
  /** 1-based page number within the document. */
  page: number;
  name: string;
  /** The building this sheet is for, when it differs from its drawing set's. */
  building?: string;
  /** The drawing's title from its title block ("Ground Floor Plan"), when read. */
  title?: string;
  width: number;
  height: number;
  /** Real-world metres represented by one PDF point; null until the scale is set. */
  metersPerPoint: number | null;
  scaleLabel: string | null;
  scaleSource: ScaleSource | null;
  /** Scale notations found on the sheet, offered as one-click choices. */
  scaleHints: string[];
  /** An older revision kept for reference after its takeoffs moved to a newer sheet. */
  superseded?: boolean;
  /** Its number was read from its title block by OCR (so a better reading of the set may change it). */
  ocr?: boolean;
  /** Marked finished by the estimator, to track progress through a set. */
  done?: boolean;
  /** How many times the sheet's takeoffs count, for a typical floor drawn once (unset is once). */
  repeat?: number;
  /** The last AI reading of this sheet's assembly legend, kept so it can be reviewed again without re-running. */
  aiAssemblies?: SavedLegendRead;
}

/**
 * One material line of an assembly. The formula is evaluated against the
 * type's totals: L (length), H (height), A (area), P (perimeter), N (count).
 */
export interface AssemblyItem {
  id: string;
  name: string;
  unit: string;
  formula: string;
}

export interface TakeoffType {
  id: string;
  name: string;
  color: string;
  kind: Kind;
  /** Wall or room height in project length units; drives A = L × H for linear types. */
  height: number;
  /** Other sizes the assembly formulas can use (W, D, T), in project length units: a footing's width and depth, a slab's thickness. */
  width?: number;
  depth?: number;
  thickness?: number;
  items: AssemblyItem[];
  /** Wall takeoff stops this partition type at door openings (the estimator measures it without them). */
  stopsAtDoors?: boolean;
  /** A length type whose total is shown as its area (length × height), as wall finishes are priced. */
  headline?: 'area';
  /** Estimate division the type is priced in, e.g. "09 Finishes". */
  division?: string;
  /** Subtrade package it is grouped under, e.g. "Drywall / ceiling sub". */
  package?: string;
  /** Assembly heading as scheduled, e.g. "TYPICAL INTERIOR WALL – 1HR F.R.R.". */
  assemblyTitle?: string;
  /** Assembly build-up, e.g. the layers from the legend. */
  description?: string;
  /**
   * The drawing file its assembly was read from. Two buildings in one project can use one
   * code for different walls (WE1 on the garage set and on the office set).
   */
  fromDoc?: string;
  /** The group it is filed under (none: ungrouped). */
  groupId?: string;
  /** Its takeoffs are hidden on the drawing (they still count in quantities and exports). */
  hidden?: boolean;
}

/** A folder of takeoff types, made by the estimator (e.g. "Phase 2", "Drywall"). */
export interface TakeoffGroup {
  id: string;
  name: string;
}

/** Estimate divisions, named as on the estimator's bid workbook tabs. */
export const DIVISIONS = [
  '01 General Requirements',
  '02 Existing Conditions',
  '03 Concrete',
  '04 Masonry',
  '05 Metals',
  '06 Wood Framing & Partitions',
  '06 Mass Timber (CLT Glulam)',
  '07 Thermal & Moisture',
  '07 Roofing',
  '08 Openings',
  '09 Finishes',
  '10 Specialties',
  '14 Conveying Equipment',
  '20-25 Mechanical',
  '26 Electrical',
  '31 Earthwork',
  '32 Exterior Improvements',
  '33 Utilities',
];

export interface Measurement {
  id: string;
  sheetId: string;
  typeId: string;
  points: Pt[];
  /** Cutouts subtracted from an area measurement. */
  holes: Pt[][];
  /** Made by the automatic wall or room takeoff, so a re-run can replace it; 'ai' was added by an AI over MCP, to review. */
  source?: 'walls' | 'rooms' | 'legend' | 'sprinklers' | 'ceilings' | 'symbols' | 'windows' | 'runs' | 'trades' | 'demolition' | 'foundations' | 'structure' | 'site' | 'pipes' | 'ducts' | 'envelope' | 'ai';
  /** A name for this takeoff, e.g. the room it covers ("112 RECEIVING & GEN. STORAGE"). */
  label?: string;
  /**
   * A run's length as the drawing writes it, in metres ("80.2m - 75mmØ HDPE SANITARY FORCEMAIN"
   * on a civil plan): the quantity, instead of the drawn line's length. The line then only marks
   * where the label is. Cleared when the run is redrawn by hand.
   */
  statedLength?: number;
  /**
   * For a filled room: how much of its outline crosses door and window openings, in sheet
   * points. Base and wall finishes leave it out. Cleared when the outline is edited by hand.
   */
  openings?: number;
  /**
   * Room finishes: the takeoff type each finish of this room is priced under. The room's
   * outline counts toward each: floor and ceiling as area, base and walls as its perimeter.
   */
  finishes?: Partial<Record<FinishRole, string>>;
  /**
   * A room's ceiling height above its floor, in project length units, as the room finish
   * schedule gives it. Its wall finishes run up to it (instead of the wall type's height).
   */
  ceilingHeight?: number;
  /**
   * Walls finished more than one way (a schedule with a column per wall: tile on two walls,
   * paint on two): the share of the room's walls each wall finish type takes, by type id. Used
   * while it includes `finishes.walls`; a wall finish picked by hand replaces it.
   */
  wallShares?: Record<string, number>;
}

export type FinishRole = 'floor' | 'base' | 'walls' | 'ceiling';

/** Room finishes in schedule order, with the kind of type each is measured as. */
export const FINISH_ROLES: { role: FinishRole; label: string; kind: Kind }[] = [
  { role: 'floor', label: 'Floor', kind: 'area' },
  { role: 'base', label: 'Base', kind: 'linear' },
  { role: 'walls', label: 'Walls', kind: 'linear' },
  { role: 'ceiling', label: 'Ceiling', kind: 'area' },
];

export interface Project {
  version: 1;
  /** Set when the project is first saved; projects from older versions get one on load. */
  id?: string;
  name: string;
  units: Units;
  docs: Doc[];
  sheets: Sheet[];
  types: TakeoffType[];
  /** Groups the takeoff types are filed in, in the order they are listed. */
  groups?: TakeoffGroup[];
  measurements: Measurement[];
  /** The project's specification files, each read into its sections once. */
  specs?: SpecDoc[];
  /** Build It: the planning assumptions and edits the user made (the generated model and schedule are kept apart). */
  build?: import('./build/types').BuildEdits;
}

/** A specification file: its PDF is kept like a drawing's, its reading with the project. */
export interface SpecDoc extends Doc {
  book?: SpecBook;
}

/** Every PDF the project keeps: its drawings and its specifications. */
export const filesOf = (p: Pick<Project, 'docs' | 'specs'>): Doc[] => [...p.docs, ...(p.specs ?? [])];

export const newId = (): string => crypto.randomUUID();

const item = (name: string, unit: string, formula: string): AssemblyItem => ({
  id: newId(),
  name,
  unit,
  formula,
});

/** Height of a standard door opening, in project length units: paint stops at it, not at the ceiling. */
export const doorHeight = (units: Units) => (units === 'metric' ? 2.1 : 7);

/** Starter takeoff types modelled on common GC scopes. Users edit or delete them freely. */
export function defaultTypes(units: Units): TakeoffType[] {
  const m = units === 'metric';
  const len = m ? 'm' : 'ft';
  const area = m ? 'm²' : 'SF';
  // Stud spacing, board sheet area (4×8), standard wall height.
  const s610 = m ? 0.61 : 2;
  const s406 = m ? 0.406 : 1.333;
  const sheet = m ? 2.973 : 32;
  const h = m ? 3.0 : 10;
  // Sizes as the trade names them in each system.
  const stud = m ? '92mm' : '3-5/8"';
  const furring = m ? '64mm' : '2-1/2"';
  const gwb = m ? '16mm' : '5/8"';
  const at610 = m ? '@ 610' : '@ 24" o.c.';
  const at406 = m ? '@ 406' : '@ 16" o.c.';

  return [
    {
      id: newId(),
      name: `W1 – Interior wall (${stud} steel stud ${at610}, ${gwb} GWB both sides)`,
      color: '#e4572e',
      kind: 'linear',
      height: h,
      division: '06 Wood Framing & Partitions',
      package: 'Drywall & framing sub',
      items: [
        item('Wall area', area, 'A'),
        item(`${stud} steel studs`, 'ea', `ceil(L / ${s610}) + N`),
        item(`${stud} track (top + bottom)`, len, '2 * L'),
        item(`${gwb} GWB, 2 sides + 10% waste`, area, '2 * A * 1.1'),
        item('GWB sheets 4×8', 'ea', `ceil(2 * A * 1.1 / ${sheet})`),
        item('Tape & finish', area, '2 * A'),
      ],
    },
    {
      id: newId(),
      name: `FR1 – Exterior wall furring (${furring} stud ${at406}, ${gwb} GWB)`,
      color: '#17bebb',
      kind: 'linear',
      height: h,
      division: '06 Wood Framing & Partitions',
      package: 'Drywall & framing sub',
      items: [
        item('Furring area', area, 'A'),
        item(`${furring} steel studs`, 'ea', `ceil(L / ${s406}) + N`),
        item(`${furring} track`, len, '2 * L'),
        item(`${gwb} GWB, 1 side + 10% waste`, area, 'A * 1.1'),
      ],
    },
    {
      id: newId(),
      name: 'Floor finish',
      color: '#76b041',
      kind: 'area',
      height: h,
      division: '09 Finishes',
      package: 'Flooring sub',
      items: [
        item('Floor area', area, 'A'),
        item('Floor finish + 10% waste', area, 'A * 1.1'),
        item('Base (doorways left out)', len, 'P - O'),
      ],
    },
    {
      id: newId(),
      name: 'Ceiling',
      color: '#ffc914',
      kind: 'area',
      height: h,
      division: '09 Finishes',
      package: 'Drywall & ceiling sub',
      items: [
        item('Ceiling area', area, 'A'),
        item('Wall paint (perimeter × height, less door openings)', area, `P * H - O * ${doorHeight(units)}`),
      ],
    },
    {
      id: newId(),
      name: 'Doors',
      color: '#7d5ba6',
      kind: 'count',
      height: h,
      division: '08 Openings',
      items: [item('Door, frame & hardware', 'ea', 'N')],
    },
  ];
}

/** A new takeoff type for a room finish code from a schedule, e.g. "CPT-1" as a floor. */
export function finishType(role: FinishRole, code: string, units: Units, color: string): TakeoffType {
  const m = units === 'metric';
  const len = m ? 'm' : 'ft';
  const area = m ? 'm²' : 'SF';
  const h = m ? 3.0 : 10;
  const base = { id: newId(), color, height: h, division: '09 Finishes' };
  switch (role) {
    case 'floor':
      return { ...base, name: `${code} – Floor finish`, kind: 'area', package: 'Flooring sub', items: [item('Floor area', area, 'A'), item('Floor finish + 10% waste', area, 'A * 1.1')] };
    case 'base':
      return { ...base, name: `${code} – Base`, kind: 'linear', package: 'Flooring sub', items: [item('Base', len, 'L'), item('Base + 5% waste', len, 'L * 1.05')] };
    case 'walls':
      return { ...base, name: `${code} – Wall finish`, kind: 'linear', headline: 'area', package: 'Painting sub', items: [item('Wall finish area (perimeter × height, less door openings)', area, 'A')] };
    case 'ceiling':
      return { ...base, name: `${code} – Ceiling`, kind: 'area', package: 'Drywall & ceiling sub', items: [item('Ceiling area', area, 'A'), item('Perimeter trim', len, 'P')] };
  }
}

/**
 * A new, empty project. It starts with no takeoff types: you add your own, copy them from
 * another project or the trade library, or set a starting set under More (`defaultTypes`
 * is only for the sample plan and tests).
 */
export function newProject(units: Units = 'metric'): Project {
  return {
    version: 1,
    id: newId(),
    name: 'Untitled project',
    units,
    docs: [],
    sheets: [],
    types: [],
    measurements: [],
  };
}
