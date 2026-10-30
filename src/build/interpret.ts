import type { Measurement, Project, Sheet, TakeoffType } from '../model';
import type { DrawingTexts } from './building';

export type PlanningExclusion =
  | 'egress-demolition'
  | 'unverified-demo-type'
  | 'room-context'
  | 'elevation-window'
  | 'open-ceiling'
  | 'unverified-ceiling-type'
  | 'duplicate-roof-view';

const roofPlan = (sheet: Sheet) => /\bROOF\b.*\bPLAN\b/i.test(sheet.title ?? '');
const equipmentId = (type: TakeoffType) => /^equipment identification\b/i.test(type.name);

/** Match only the same generic roof marker at virtually the same PDF position and scale. */
export function roofViewEvidence(project: Project): { duplicates: Set<string>; inferredRoofSheets: Set<string> } {
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const types = new Map(project.types.map((t) => [t.id, t]));
  const marks = project.measurements.filter((m) => {
    const s = sheets.get(m.sheetId), t = types.get(m.typeId);
    return s && !s.superseded && t?.kind === 'count' && equipmentId(t) && m.points.length === 1;
  });
  const pairs: { duplicate: string; sheetPair: string; sheetA: string; sheetB: string }[] = [];
  const duplicates = new Set<string>();
  const inferredRoofSheets = new Set<string>();
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i], sa = sheets.get(a.sheetId)!;
    for (let j = i + 1; j < marks.length; j++) {
      const b = marks[j], sb = sheets.get(b.sheetId)!;
      if (a.sheetId === b.sheetId || !roofPlan(sa) && !roofPlan(sb) || a.typeId !== b.typeId || !sa.metersPerPoint || !sb.metersPerPoint ||
          Math.abs(sa.metersPerPoint - sb.metersPerPoint) > 1e-5 ||
          Math.abs(sa.width - sb.width) > 2 || Math.abs(sa.height - sb.height) > 2 ||
          Math.hypot(a.points[0][0] - b.points[0][0], a.points[0][1] - b.points[0][1]) > 1) continue;
      const keepA = roofPlan(sa) !== roofPlan(sb) ? roofPlan(sa) : sa.name.localeCompare(sb.name) > 0;
      pairs.push({ duplicate: keepA ? b.id : a.id, sheetPair: [a.sheetId, b.sheetId].sort().join('|'), sheetA: a.sheetId, sheetB: b.sheetId });
    }
  }
  const pairCounts = new Map<string, number>();
  for (const pair of pairs) pairCounts.set(pair.sheetPair, (pairCounts.get(pair.sheetPair) ?? 0) + 1);
  // A lone coincident PDF coordinate across sheets is not enough to call a duplicate.
  for (const pair of pairs) if ((pairCounts.get(pair.sheetPair) ?? 0) >= 3) {
    duplicates.add(pair.duplicate);
    if (!roofPlan(sheets.get(pair.sheetA)!)) inferredRoofSheets.add(pair.sheetA);
    if (!roofPlan(sheets.get(pair.sheetB)!)) inferredRoofSheets.add(pair.sheetB);
  }
  return { duplicates, inferredRoofSheets };
}

/** Keep unverified source takeoffs visible, but do not turn them into construction scope. */
export function planningExclusion(m: Measurement, type: TakeoffType, sheet: Sheet, duplicateRoofIds: Set<string>): PlanningExclusion | undefined {
  const name = type.name;
  if (m.source === 'rooms' && type.kind === 'area' && /^rooms?\b/i.test(name)) return 'room-context';
  if (m.source === 'windows' && type.kind === 'count' && /\bELEVATIONS?\b/i.test(sheet.title ?? '') && !/\bPLAN\b/i.test(sheet.title ?? '')) return 'elevation-window';
  if (m.source === 'demolition' && /\bEGRESS\b.*\bDIAGRAM|\bOBC\b.*\bMATRIX/i.test(sheet.title ?? '') && /^demo/i.test(name)) return 'egress-demolition';
  if (m.source === 'demolition' && /^demo\s*0\s*:/i.test(name)) return 'unverified-demo-type';
  if (m.source === 'ceilings' && /\bceiling\s*[–-]\s*open\b|\bnone shown\b/i.test(name)) return 'open-ceiling';
  if (m.source === 'ceilings' && /^\s*0\s*[–-]\s*See A0+\b/i.test(name)) return 'unverified-ceiling-type';
  if (duplicateRoofIds.has(m.id)) return 'duplicate-roof-view';
  return undefined;
}

/** An existing equipment mark needs both a nearby "as exist" note and its X-coded tag. */
export function existingEquipmentNote(m: Measurement, type: TakeoffType, sheet: Sheet, texts: DrawingTexts | undefined): boolean {
  if (m.source !== 'trades' || type.kind !== 'count' || !equipmentId(type) || m.points.length !== 1) return false;
  const words = texts?.[sheet.id] ?? [];
  const [x, y] = m.points[0];
  return words.some((note) => /\bas\s+exist\b/i.test(note.str) && Math.hypot(note.cx - x, note.cy - y) <= 100 &&
    words.some((tag) => /\b(?:BB|WH)-X\d*\b/i.test(tag.str) && Math.hypot(tag.cx - note.cx, tag.cy - note.cy) <= 22));
}
