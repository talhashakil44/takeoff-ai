import type { Sheet } from './model';

/** What a sheet of a drawing set is, as an estimator sorts it. */
export type SheetClass = 'floor plan' | 'RCP' | 'finish plan' | 'schedule' | 'legend' | 'assembly' | 'other';

/** Which plan of the building a floor plan is: a level's, the foundation's or the roof's (walls are taken off all three, rooms only off levels). */
export type PlanLevel = 'level' | 'foundation' | 'roof' | 'enlarged';

export interface SheetKind {
  kind: SheetClass;
  why: string;
  level?: PlanLevel;
  /** A floor plan that is the reflected ceiling plan too ("Ground floor plan & RCP"): ceilings are read off it as well. */
  ceilings?: boolean;
  /** A plan of part of the building (a washroom's, an enlarged plan): the floor plan of a set that has no other. */
  part?: boolean;
}

/** Plans that are not the plan of a level of the building (walls, rooms and doors are not taken off them). */
const NOT_A_FLOOR_PLAN =
  /SITE|KEY PLAN|ENLARGED?|STAIR|WASHROOM|ELEVATOR|PART(IAL)? PLAN|DETAIL|SECTION|ELEVATION|LIFE SAFETY|FIRE SEPARATION|DISTANCE|PHASING|SEQUENC|STAGING|HOARDING|CODE|BID FORM|MILLWORK|FURNITURE|EQUIPMENT|FIXTURE|SIGNAGE|LANDSCAPE|GRADING|SERVICING|DRAINAGE|PAVING|SURVEY|LAYOUT PLAN|CONTROL PLAN|FRAMING/;
const TRADE = /SPRINKLER|SUPPRESSION|FIRE PROTECTION|FIRE ALARM|LIGHTING|POWER|ELECTRICAL|MECHANICAL|PLUMBING|HVAC|DUCT|LAYOUT|STRUCTURAL|FRAMING|COMMUNICATION|DATA|SECURITY|AIR DISTRIBUTION|VENTILATION/;
const RCP = /REFLECTED CEILING|\bR\.?C\.?P\b|\bCEILINGS?\b.*\bPLANS?\b|\bCEILING LAYOUT\b/;
const PLAN = /\bPLANS?\b/;

/**
 * The discipline a sheet number says a sheet is for, when it says one other than architecture or
 * interiors: structural (S), mechanical (M), plumbing (P), electrical (E), fire protection (FP),
 * civil (C), landscape (L) and the like. An estimator takes the building's walls, rooms, doors,
 * finishes and ceilings off the architectural sheets; the trades' plans repeat the floor plan
 * under their own work.
 */
export function tradeOfNumber(name: string): string | null {
  const m = /^([A-Z]{1,3})[-.\s]?\d/.exec(name.trim().toUpperCase());
  if (!m) return null;
  return /^(S|SD|M|MD|MH|MP|ME|P|PD|PL|E|ED|EL|EP|FP|FA|F|C|CV|CS|L|LD|LP|LS|T|TPP|HC|SP)$/.test(m[1]) ? m[1] : null;
}

/** A title split at "&", "and", "+", "," into the drawings it names ("Ground floor plan & finishes schedule"). */
const partsOf = (t: string) =>
  t
    .split(/\s*(?:&|\+|,|;|\bAND\b)\s*/)
    .map((p) => p.replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, ''))
    .filter(Boolean);

/**
 * What a sheet is, from its sheet number and title, as an estimator sorts a set: the plans the
 * wall, room and door tools run on are new-work plans of the building (a level's, its
 * foundation's or its roof's). Demolition / removals / existing plans, enlarged plans, site and
 * life-safety plans and trade drawings (by their title, or a structural / mechanical / electrical
 * sheet number) are not. A title naming several drawings ("Ground floor plan & finishes
 * schedule", "Roof plan and canopy details") is the plan it names. `why` says what decided it.
 */
export function classifySheet(sheet: Pick<Sheet, 'name' | 'title'> & { ocr?: boolean }): SheetKind {
  const raw = `${sheet.title ?? ''}`.toUpperCase().replace(/\s+/g, ' ').trim();
  // The sheet number, or one the title starts with (an addendum page listing "S2.01 – Foundation plan").
  // A number OCR read may be misread (T-3 for A2), so it alone does not make a sheet a trade's.
  const trade = (sheet.ocr ? null : tradeOfNumber(sheet.name ?? '')) ?? (/^[A-Z]{1,3}[-.]?\d+(?:\.\d+)?\b/.test(raw) ? tradeOfNumber(raw) : null);
  // On an architectural sheet a "layout" with no trade named is a plan ("Proposed washroom layouts").
  const t = !trade && /\bLAYOUTS?\b/.test(raw) && !TRADE.test(raw.replace(/\bLAYOUTS?\b/g, '')) ? raw.replace(/\bLAYOUT(S?)\b/g, 'PLAN$1') : raw;
  const parts = partsOf(t);
  const planParts = parts.filter((p) => PLAN.test(p) || RCP.test(p));
  const named = planParts.length ? planParts : parts;
  const plan = planParts.length > 0;
  const any = (re: RegExp) => named.some((p) => re.test(p));

  if (/ASSEMBL|\b(WALL|PARTITION|FLOOR|ROOF|CEILING|CONSTRUCTION)\s+TYPES?\b|^TYPES\b/.test(t)) return { kind: 'assembly', why: 'title names assembly types' };
  if (!plan && /SCHEDULE/.test(t)) return { kind: 'schedule', why: 'title says schedule' };
  if (/LEGEND|SYMBOLS|ABBREVIATIONS/.test(t) && !(plan && named.some((p) => !/LEGEND|SYMBOLS|ABBREVIATIONS/.test(p)))) return { kind: 'legend', why: 'title says legend' };
  if (trade) return { kind: 'other', why: `${trade} sheet (not architectural)` };
  const demo = /DEMO|REMOVAL|EXISTING/.test(t);
  const rcp = any(RCP);
  // "Floor plan & RCP" on one sheet is a floor plan and a ceiling plan; "RCP ground floor plan" a ceiling plan.
  const floorToo = rcp && parts.some((p) => PLAN.test(p) && !RCP.test(p) && /FLOOR|LEVEL|GROUND|BASEMENT|MAIN|MEZZANINE/.test(p));
  if (rcp && !floorToo) return { kind: 'RCP', why: demo ? 'reflected ceiling plan (demolition / existing)' : 'reflected ceiling plan' };
  // A plan of finishes: "Finish plan", "Floor finishes plan", "First floor plan finishes",
  // "Paint colours plan", or a plan whose sheet is about finishes ("Finishes & millwork - floor plan").
  const finishWord = /FINISH(ES)?\b|FLOORING|PAINT|COLOU?RS?\b/;
  if (plan && parts.some((p) => finishWord.test(p) && !/SCHEDULE/.test(p)))
    return { kind: 'finish plan', why: 'title says finish plan' };
  if (!plan && /SCHEDULE/.test(t)) return { kind: 'schedule', why: 'title says schedule' };
  if (any(TRADE)) return { kind: 'other', why: 'trade drawing' };
  // An existing / demolition floor plan drawn with its RCP ("Level 1 - existing and demo - floor plan & RCP"):
  // no walls or rooms to take off, but its ceilings are (to demolish, or to take down and put back).
  if (demo) return { kind: 'other', why: 'demolition / existing plan', ...(rcp ? { ceilings: true } : {}) };
  // A bare "plan" beside other drawings ("Plan and section details") is one of them: the whole title says which.
  const p = /^PLANS?$/.test(named.join(' ')) && parts.length > 1 ? t : named.join(' ');
  // An enlarged plan shows walls of the floor plan at a larger scale, often tagging the types the overall plan leaves to it.
  if (plan && /ENLARGED\b[^&]*\bPLANS?\b/.test(p) && !/SITE|KEY PLAN|LIFE SAFETY|FURNITURE|SIGNAGE|ACCESSOR|MILLWORK|CASEWORK|EQUIPMENT|LANDSCAPE/.test(p))
    return { kind: 'floor plan', why: 'enlarged plan (walls only, types the overall plans leave out)', level: 'enlarged' };
  // A plan of part of the building (a washroom's): an enlarged plan by another name, and the
  // set's floor plan when it has no other (see classifySet).
  const PART = /WASHROOM|ENLARGED?|PART(IAL)? PLAN/g;
  if (plan && PART.test(p) && !NOT_A_FLOOR_PLAN.test(p.replace(PART, '')) && !/ACCESSOR|CASEWORK/.test(p))
    return { kind: 'floor plan', why: 'part plan (walls only, types the overall plans leave out)', level: 'enlarged', part: true };
  if (plan && NOT_A_FLOOR_PLAN.test(p)) return { kind: 'other', why: 'site, enlarged, life-safety or other special plan' };
  const both = floorToo ? { ceilings: true } : {};
  if (/ROOF/.test(p) && plan) return { kind: 'floor plan', why: 'roof plan (walls only)', level: 'roof', ...both };
  if (/FOUNDATION|FOOTING/.test(p) && plan) return { kind: 'floor plan', why: 'foundation plan (walls only)', level: 'foundation', ...both };
  const level = /\b(LEVEL|FLOOR|BASEMENT|CELLAR|GROUND|MAIN|MEZZANINE|STOREY|STORY|PENTHOUSE|FIRST|SECOND|THIRD|FOURTH|FIFTH|UPPER|LOWER)\b/.test(p);
  const work = /\b(PROPOSED|NEW|CONSTRUCTION|RENOVATION|ADDITION|OVERALL|GENERAL ARRANGEMENT)\b/.test(p);
  if (plan && (level || work)) return { kind: 'floor plan', why: floorToo ? 'floor plan and reflected ceiling plan' : 'floor plan', level: 'level', ...both };
  // A title that is just a level ("LEVEL 1", "BASEMENT").
  if (/^(LEVEL\s*\w+|BASEMENT|CELLAR|GROUND( FLOOR)?|MAIN( FLOOR)?|MEZZANINE|\w+ FLOOR)$/.test(t)) return { kind: 'floor plan', why: 'titled by its level', level: 'level' };
  if (/^(FLOOR )?PLANS?$/.test(p)) return { kind: 'floor plan', why: 'titled plan', level: 'level' };
  return { kind: 'other', why: t ? 'not a plan of the building' : 'no title read' };
}

/** Whether ceilings are read off a sheet: a reflected ceiling plan, or a floor plan drawn as the RCP too. */
export const hasCeilingPlan = (sheet: Pick<Sheet, 'name' | 'title'>) => {
  const k = classifySheet(sheet);
  return k.kind === 'RCP' || !!k.ceilings;
};

/**
 * Every sheet of a set sorted, as `classifySheet` does each, with the set in view: a set with no
 * plan of a level (a washroom renovation drawn only as enlarged layouts) takes its part plans as
 * its floor plans.
 */
export function classifySet(sheets: (Pick<Sheet, 'name' | 'title'> & { ocr?: boolean })[]): SheetKind[] {
  const kinds = sheets.map(classifySheet);
  if (kinds.some((k) => k.kind === 'floor plan' && k.level === 'level')) return kinds;
  return kinds.map((k) => (k.part ? { kind: 'floor plan', why: 'part plan (the set has no plan of a whole level)', level: 'level' } : k));
}
