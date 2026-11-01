import type {Project} from '../model';
import type {BuildModel,SourceRef} from './types';
import type {DrawingTexts} from './building';
import type {DrawingLines} from './roof';
import {insetRegistrations,type InsetRegistration} from './insetRegistration';
export {traceGridStroke} from './gridStroke';
export interface CanopyRegistration extends InsetRegistration {topDatum:number;}
function canopyDatum(
  project: Project,
  texts: DrawingTexts,
): { value: number; sources: SourceRef[] } | null {
  const found: { value: number; source: SourceRef }[] = [];
  for (const sheet of project.sheets.filter(
    (s) => !s.superseded && /^S/i.test(s.name),
  )) {
    const ts = texts[sheet.id] ?? [];
    for (const label of ts.filter((t) =>
      /^T\/O ENTRY CANOPY$/i.test(t.str.trim()),
    )) {
      const values = ts.filter(
        (t) =>
          /^\d{4,5}$/.test(t.str.trim()) &&
          t.cy > label.cy &&
          t.cy - label.cy < 15 &&
          Math.abs(t.cx - label.cx) < 45,
      );
      if (values.length !== 1) continue;
      const t = values[0];
      found.push({
        value: Number(t.str) / 1000,
        source: {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [label.cx - 65, label.cy - 10, t.cx + 20, t.cy + 10],
          quote: `${label.str}: ${t.str} mm`,
        },
      });
    }
  }
  if (
    new Set(found.map((f) => f.source.id)).size < 2 ||
    found.some((f) => Math.abs(f.value - found[0].value) > 0.01)
  )
    return null;
  return { value: found[0].value, sources: found.map((f) => f.source) };
}


/** Roof datum qualification is separate from generic XY registration. The
 * canopy datum applies only to canopy views on roof sheets, never foundations
 * or unrelated framing insets sharing that sheet. */
export function canopyRegistrations(project:Project,model:BuildModel,texts:DrawingTexts,lines:DrawingLines):Record<string,CanopyRegistration>{
 const datum=canopyDatum(project,texts);if(!datum)return {};
 const roofIds=new Set(project.sheets.filter(s=>{
  if(/FOUNDATION|FLOOR|CEILING/i.test(s.title??''))return false;
  if(/ROOF/i.test(s.title??''))return true;
  const titles=(s.views??[]).map(v=>v.title);
  return titles.some(t=>/ROOF/i.test(t)&&!/CEILING/i.test(t))&&!titles.some(t=>/FOUNDATION|FLOOR|CEILING/i.test(t));
 }).map(s=>s.id));
 const eligible=new Set(project.measurements.filter(m=>roofIds.has(m.sheetId)).map(m=>m.id));
 return Object.fromEntries(Object.entries(insetRegistrations(project,model,texts,lines))
  .filter(([id,plan])=>eligible.has(id)&&/\bCANOPY\b/i.test(plan.title)&&!/FOUNDATION|FLOOR|CEILING/i.test(plan.title))
  .map(([id,plan])=>[id,{...plan,topDatum:datum.value,sources:[...plan.sources,...datum.sources]}]));
}
