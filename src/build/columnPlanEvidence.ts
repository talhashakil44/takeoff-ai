import type { BuildModel, SourceRef } from './types';
import type { Pt } from '../model';
export interface ColumnPlanWitness {
  at: Pt; code: string; width: number; depth: number; domain: string;
  source: SourceRef;
}
const prefix='Registered column footprint:';
/** Plan placement is evidence, not a height or a count reconciliation. */
export function retainColumnPlanEvidence(model: BuildModel, located: Map<string,ColumnPlanWitness>): BuildModel {
  return {...model,elements:model.elements.map(e=>{
    const p=located.get(e.id);
    const sources=e.sources.filter(s=>!s.quote?.startsWith(prefix));
    const issues=e.issues.filter(s=>!s.startsWith(prefix));
    if(!p)return sources.length===e.sources.length&&issues.length===e.issues.length?e:{...e,sources,issues};
    const matches=[...located].filter(([id,q])=>id!==e.id && q.code===p.code &&
      q.width===p.width && q.depth===p.depth && Math.hypot(q.at[0]-p.at[0],q.at[1]-p.at[1])<.01 &&
      (q.source.id!==p.source.id || q.domain!==p.domain || JSON.stringify(q.source.box)!==JSON.stringify(p.source.box)))
      .map(([id])=>id).sort();
    const notes=issues.filter(s=>s!=='Calibrated floor registration is required.' &&
      !/has no scale: its quantity and place are unknown\.$/.test(s) &&
      !s.startsWith('Counted footing, pier, base plate or column retained; its grid position is unverified'));
    if((!e.shape || e.shape.type==='locator') && !issues.some(s=>/^Physical (roof|floor) column: coincident viewport record/.test(s)))notes.push(`${prefix} plan position and section size are source-backed; base/top elevations or distinct-storey identity remain unresolved. No new physical solid generated; accepted quantity retained.`);
    if(matches.length)notes.push(`${prefix} possibly the same column line across drawing views as ${matches.map(id=>{const q=located.get(id)!;return `${q.code} on ${q.source.label}, page ${q.source.page} (${q.domain} view)`;}).join('; ')}. Registered centres agree within 10mm and scheduled sections match; separate storeys versus a continuous post require section review. Counts remain unreconciled.`);
    return {...e,sources:[...sources,{...p.source,quote:`${prefix} ${p.code} closed plan rectangle matches scheduled ${p.width} x ${p.depth}m section; viewport registered to architectural grids. Plan centre is from the rectangle, not the tag. Height is not established by this footprint.${p.source.quote ? ` Registration: ${p.source.quote}` : ''}`}],issues:notes};
  })};
}
