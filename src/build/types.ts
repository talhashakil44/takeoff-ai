/**
 * Build It: the project as a proposed building and a plan to build it, from the takeoff and the
 * specification already in the project. One shared structure links every element, activity
 * and number back to where it came from, and says how sure it is:
 *
 *   documented — read from the drawings or the specification (with the page);
 *   inferred   — worked out from documented things (a level from a sheet's title);
 *   assumed    — a planning assumption (a default, or one the user set);
 *   unknown    — needed and not found: shown as an issue, never filled in silently.
 */

export type Basis = 'documented' | 'inferred' | 'assumed' | 'unknown';

/** Where something came from: a sheet (and a place on it), or a spec section's page. */
export interface SourceRef {
  kind: 'sheet' | 'spec';
  /** Sheet id, or spec file (doc) id. */
  id: string;
  page: number;
  /** Sheet name (A1.2) or section number (08 11 13). */
  label: string;
  /** On a sheet: the box [x0, y0, x1, y1] in sheet points. */
  box?: [number, number, number, number];
  /** A spec section key, to open it. */
  section?: string;
  /** The words the fact was read from. */
  quote?: string;
}

export interface Level {
  id: string;
  name: string;
  /** Floor elevation in metres above the lowest level. */
  elevation: number;
  basis: Basis;
  /** Plan sheets placed on this level. */
  sheets: string[];
}

export type ElementShape =
  /** A run (wall, duct, pipe): a polyline extruded to a height. */
  | { type: 'run'; points: [number, number][]; z0: number; height: number; thickness: number }
  /** A surface (floor, ceiling, slab): a polygon at a height. */
  | { type: 'surface'; ring: [number, number][]; holes: [number, number][][]; z: number; thickness: number }
  /** A counted thing (door, fixture, device): a box at a point. */
  | { type: 'point'; at: [number, number]; z: number; size: [number, number, number] };

export interface BuildElement {
  /** Stable: the measurement's id. */
  id: string;
  name: string;
  /** Work package (trade) it belongs to: 'partitions', 'mech-rough', … */
  trade: string;
  level: string | null;
  /** Null when it can't be placed (an enlarged plan, an unscaled sheet): listed, not drawn. */
  shape: ElementShape | null;
  /** Quantity in project units, with its unit (LF, SF, ea, m, m²). */
  quantity: number;
  unit: string;
  typeId: string;
  typeName: string;
  division: string;
  measurementId: string;
  sheetId: string;
  /** Spec sections it is governed by (keys), with how they were linked. */
  specs: { key: string; basis: Basis }[];
  sources: SourceRef[];
  placement: Basis;
  issues: string[];
}

export interface BuildModel {
  version: number;
  /** Hash of the project data it was made from (sheets, takeoffs, specs, settings). */
  sourceHash: string;
  units: 'metric' | 'imperial';
  levels: Level[];
  elements: BuildElement[];
  /** Model-wide issues: unplaced sheets, levels not found, … */
  issues: Issue[];
  /** Extent of what is drawn, in metres: [minX, minY, maxX, maxY]. */
  extent: [number, number, number, number];
}

export interface Issue {
  id: string;
  severity: 'info' | 'warning' | 'conflict';
  text: string;
  /** What it concerns: element, activity or sheet ids. */
  refs?: string[];
  sources?: SourceRef[];
}

/** A fact read from the specification that the plan uses (a review period, a completion date). */
export interface SpecFact {
  key: 'reviewDays' | 'resubmitReviewDays' | 'substantialDate' | 'durationWeeks' | 'closeoutDays' | 'commissioningRequired';
  value: number | string | boolean;
  /** For a duration: working or calendar days. */
  unit?: 'working days' | 'calendar days' | 'weeks' | 'date';
  source: SourceRef;
}

export type ActivityKind = 'milestone' | 'mobilize' | 'submittal' | 'review' | 'resubmittal' | 'procurement' | 'work' | 'testing' | 'commissioning' | 'closeout';

export interface Dependency {
  /** Predecessor activity id. */
  from: string;
  /** Finish-to-start (the default) or start-to-start. */
  type: 'FS' | 'SS';
  /** Working days after (FS: after it finishes; SS: after it starts). */
  lag: number;
  basis: Basis;
  why: string;
}

export interface Activity {
  /** Stable across rebuilds (so edits stay put): 'work:partitions:L1', 'sub:prep:doors'. */
  id: string;
  name: string;
  kind: ActivityKind;
  trade: string | null;
  level: string | null;
  /** Elements it builds (work activities). */
  elements: string[];
  /** Quantities by unit (work). */
  quantities?: Record<string, number>;
  /** Production per crew per day, by unit (work). */
  rates?: Record<string, number>;
  crews?: number;
  /** Working days. */
  duration: number;
  /** How the duration was set: from quantity and rate, a documented period, an assumption, or by hand. */
  durationBasis: Basis;
  durationWhy: string;
  deps: Dependency[];
  specs: string[];
  sources: SourceRef[];
  /** Edited by the user (duration, crews or links). */
  edited?: boolean;
}

/** Planning assumptions: each with where its value came from. */
export interface Assumption<T = number> {
  value: T;
  basis: Basis;
  why: string;
  source?: SourceRef;
}

export interface TradeSetup {
  /** Production per crew per day, by unit (LF, SF, ea; m, m²). */
  rates: Record<string, number>;
  crews: number;
  /** Lead time from approved submittal to material on site, working days. */
  leadDays: number;
}

export interface PlanSetup {
  start: Assumption<string>;
  /** The finish wanted: a target, never a reason to compress work arbitrarily. */
  target: Assumption<string | null>;
  workDays: Assumption<number[]>;
  holidays: Assumption<string[]>;
  mobilizeDays: Assumption;
  submittalPrepDays: Assumption;
  reviewDays: Assumption;
  resubmitRounds: Assumption;
  resubmitReviewDays: Assumption;
  floorToFloor: Assumption;
  /** Different trades may work on one level at once; the same trade's crews go level by level. */
  levelsInParallel: Assumption<boolean>;
  testingDays: Assumption;
  commissioningDays: Assumption;
  closeoutDays: Assumption;
  trades: Record<string, Assumption<TradeSetup>>;
  /** Which milestone the target is for: the documented substantial performance date, or the project's finish. */
  targetFor: 'ms:substantial' | 'ms:finish';
}

/** What the user changed: kept with the project, applied over each rebuild. */
export interface BuildEdits {
  setup?: Partial<Record<keyof PlanSetup, unknown>> & { trades?: Record<string, Partial<TradeSetup>> };
  activities?: Record<string, { duration?: number; crews?: number; addDeps?: { from: string; lag?: number }[]; dropDeps?: string[] }>;
  /** A plan sheet's level, set by hand. */
  levels?: Record<string, string>;
  /** Level elevations set by hand (metres). */
  elevations?: Record<string, number>;
}

export interface Scheduled {
  id: string;
  /** Working-day indexes: starts at the start of ES, finishes at the end of EF − 1. */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Total float in working days (to the earliest feasible finish). */
  float: number;
  start: string;
  finish: string;
  critical: boolean;
  /** The predecessor that set its start. */
  driver: string | null;
  /** Finishes after the target allows. */
  late: boolean;
}

export interface Feasibility {
  earliestFinish: string;
  target: string | null;
  /** Working days past the target (0 when it fits). */
  overBy: number;
  /** The chain of activities that sets the finish, first to last. */
  chain: { id: string; name: string; duration: number; basis: Basis; why: string; lag: number }[];
  /** Of the chain's days: how many come from documented requirements, and how many from assumptions. */
  documentedDays: number;
  assumedDays: number;
  /** What could be changed to finish sooner (editable assumptions on the chain). */
  levers: string[];
}

export interface Schedule {
  activities: Activity[];
  times: Record<string, Scheduled>;
  feasibility: Feasibility;
  issues: Issue[];
}
