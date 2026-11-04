import type { Doc, Measurement, Sheet, TakeoffType } from './model';
import { tradeOfNumber } from './sheetKind';

/** The disciplines of a drawing set, in the order the takeoff list shows them. */
export const DISCIPLINES = ['Architectural', 'Structural', 'Mechanical', 'Electrical', 'Civil', 'Plumbing', 'Landscape', 'Other'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/** The discipline a sheet number's letters say (A2-1 architectural, S1-1 structural, FP fire protection under mechanical). */
function ofNumber(name: string): Discipline | null {
  const n = name.trim().toUpperCase();
  if (/^(A|AD|AE|ID|I)[-.\s]?\d/.test(n)) return 'Architectural';
  const t = tradeOfNumber(n);
  if (!t) return null;
  if (t === 'S' || t === 'SD') return 'Structural';
  if (/^(P|PD|PL)$/.test(t)) return 'Plumbing';
  if (/^(E|ED|EL|EP|FA|T|TPP)$/.test(t)) return 'Electrical';
  if (/^(M|MD|MH|MP|ME|FP|F)$/.test(t)) return 'Mechanical';
  if (/^(C|CV|CS)$/.test(t)) return 'Civil';
  if (/^(L|LD|LP|LS)$/.test(t)) return 'Landscape';
  return null;
}

/** The discipline a drawing file's name says ("01 - Architectural.pdf", "Site servicing"). */
function ofFile(name: string): Discipline | null {
  if (/architect|\barch\b/i.test(name)) return 'Architectural';
  if (/structur|\bstruct\b/i.test(name)) return 'Structural';
  if (/plumbing/i.test(name)) return 'Plumbing';
  if (/mechanic|hvac|fire protection|sprinkler/i.test(name)) return 'Mechanical';
  if (/electric/i.test(name)) return 'Electrical';
  if (/civil|servicing|grading/i.test(name)) return 'Civil';
  if (/landscap/i.test(name)) return 'Landscape';
  return null;
}

/**
 * Which discipline a sheet is under: its sheet number's letters first (a combined set holds
 * every trade), else its drawing file's name. A number OCR read may be misread, so then the
 * file's name wins when it says one.
 */
export function disciplineOf(sheet: Pick<Sheet, 'name'> & { ocr?: boolean }, doc?: Pick<Doc, 'name'>): Discipline {
  const file = doc ? ofFile(doc.name) : null;
  if (sheet.ocr && file) return file;
  return ofNumber(sheet.name) ?? file ?? 'Other';
}

export interface TypeNode {
  type: TakeoffType;
  items: Measurement[];
}
export interface SheetNode {
  sheet: Sheet;
  types: TypeNode[];
  count: number;
}
export interface DisciplineNode {
  discipline: Discipline;
  sheets: SheetNode[];
  count: number;
}

/**
 * Takeoffs sorted the way the set is: by discipline, then sheet (in set order), then type
 * (in the order of the types list), each type's takeoffs as given.
 */
export function takeoffTree(project: { docs: Doc[]; sheets: Sheet[]; types: TakeoffType[] }, list: Measurement[]): DisciplineNode[] {
  const bySheet = new Map<string, Map<string, Measurement[]>>();
  for (const m of list) {
    let types = bySheet.get(m.sheetId);
    if (!types) bySheet.set(m.sheetId, (types = new Map()));
    const items = types.get(m.typeId);
    if (items) items.push(m);
    else types.set(m.typeId, [m]);
  }
  const docs = new Map(project.docs.map((d) => [d.id, d]));
  const out = new Map<Discipline, DisciplineNode>();
  for (const sheet of project.sheets) {
    const types = bySheet.get(sheet.id);
    if (!types) continue;
    const nodes = project.types.filter((t) => types.has(t.id)).map((type) => ({ type, items: types.get(type.id)! }));
    if (!nodes.length) continue;
    const count = nodes.reduce((n, t) => n + t.items.length, 0);
    const d = disciplineOf(sheet, docs.get(sheet.docId));
    const node = out.get(d) ?? { discipline: d, sheets: [], count: 0 };
    node.sheets.push({ sheet, types: nodes, count });
    node.count += count;
    out.set(d, node);
  }
  return DISCIPLINES.flatMap((d) => (out.has(d) ? [out.get(d)!] : []));
}
