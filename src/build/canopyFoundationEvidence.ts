import {readSchedules} from '../smart/schedules';
import type {Project} from '../model';
import type {BuildModel} from './types';
import type {DrawingTexts} from './building';
import type {DrawingLines} from './roof';
import {canopyPlanRegistrations} from './canopyRegistration';
import {structuralRevisionContext} from './structuralRevisions';
import {sheetViews} from '../sheetViews';
const prefix='Canopy foundation registration:';
/** Register the source view, not a guessed foundation solid. A revised plate
 * designation remains a conflict against the saved takeoff, never a silent rename. */
export function retainCanopyFoundationEvidence(project:Project,model:BuildModel,texts:DrawingTexts,lines:DrawingLines):BuildModel{
 const clean={...model,elements:model.elements.map(e=>({...e,
  sources:e.sources.filter(s=>!s.quote?.startsWith(prefix)),issues:e.issues.filter(s=>!s.startsWith(prefix)),
 }))};
 const ctx=structuralRevisionContext(project,texts,lines);
 if(ctx.pending)return clean;
 const current={...ctx.project,sheets:ctx.project.sheets.map(s=>ctx.replacements[s.id]?{...s,
  views:sheetViews((ctx.texts[s.id]??[]).map(t=>({...t,w:t.w??0,h:t.h??0})),ctx.lines[s.id]??[],s.width,s.height),
 }:s)};
 const registrations=canopyPlanRegistrations(current,clean,ctx.texts,ctx.lines,'foundation');
 return {...clean,elements:clean.elements.map(e=>{
  const r=e.measurementId?registrations[e.measurementId]:undefined;
  if(!r||e.status==='demolished'||e.shape)return e;
  const m=current.measurements.find(m=>m.id===e.measurementId);
  const mark=/^BP\d+[A-Z]?\b/i.exec(e.typeName)?.[0];
  const near=mark&&m?.points.length===1?(ctx.texts[m.sheetId]??[]).filter(t=>/^BP\d+[A-Z]?$/i.test(t.str.trim())&&t.h&&Math.hypot(t.cx-m.points[0][0],t.cy-m.points[0][1])<t.h/2):[];
  const mismatch=near.length===1&&near[0].str.trim().toUpperCase()!==mark?.toUpperCase()?near[0]:null;
  const sources=r.sources.map(s=>ctx.source({...s,quote:`${prefix} ${s.quote}`}));
  if(mismatch){
   for(const sh of current.sheets.filter(s=>!s.superseded&&/^S/i.test(s.name))){
    const schedules=readSchedules((ctx.texts[sh.id]??[]).map(t=>({...t,w:t.w??0,h:t.h??0})),ctx.lines[sh.id]??[]);
    for(const table of schedules.filter(s=>/^BASE PLATE SCHEDULE$/i.test(s.title.trim())))
     for(const row of table.rows.filter(row=>row.mark.toUpperCase()===mismatch.str.trim().toUpperCase()))
      sources.push(ctx.source({kind:'sheet',id:sh.id,page:sh.page,label:sh.name,box:row.box??table.box,
       quote:`${prefix} ${table.title}; ${row.cells.join('; ')}. Source designation conflicts with saved ${mark}; dimensions are evidence for review, not an automatic substitution.`}));
   }
   const sheet=current.sheets.find(s=>s.id===m!.sheetId)!;
   sources.push(ctx.source({kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,
    box:[mismatch.cx-(mismatch.w??20)/2,mismatch.cy-(mismatch.h??10)/2,mismatch.cx+(mismatch.w??20)/2,mismatch.cy+(mismatch.h??10)/2],
    quote:`${prefix} source plate designation ${mismatch.str}; saved takeoff ${mark}. Requires takeoff review; no automatic rename.`}));
  }
  return {...e,sources:[...e.sources,...sources],issues:[...e.issues,
   `${prefix} inset 1:${Math.round(r.metersPerPoint*72/.0254)} located using traced ${r.grids.join('/')} grid strokes and independent floor-plan spacing (residual ${(r.frame.residual*1000).toFixed(1)} mm). This registers the view only; member outlines and local elevation remain unresolved. No roof datum, physical solid or quantity change.`,
   ...(mismatch?[`${prefix} drawing label ${mismatch.str} conflicts with saved takeoff ${mark}. Review the revised plan and plate schedule before assigning geometry.`]:[]),
  ]};
 })};
}
