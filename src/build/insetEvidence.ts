import {taggedBeamTrace} from './insetBeamTrace';
import {worldPoint} from './sheetCoordinates';
import {readSchedules} from '../smart/schedules';
import type {Project} from '../model';
import type {BuildModel} from './types';
import type {DrawingTexts} from './building';
import type {DrawingLines} from './roof';
import {insetRegistrations} from './insetRegistration';
import {structuralRevisionContext} from './structuralRevisions';
import {sheetViews} from '../sheetViews';
const prefix='Inset registration:';
const tracePrefix='Inset beam trace:';
const own=(s:string)=>s.startsWith(tracePrefix)||s.startsWith(prefix)||s.startsWith('Canopy foundation registration:');
/** Register the source view, not a guessed foundation solid. A revised plate
 * designation remains a conflict against the saved takeoff, never a silent rename. */
export function retainInsetEvidence(project:Project,model:BuildModel,texts:DrawingTexts,lines:DrawingLines):BuildModel{
 const clean={...model,elements:model.elements.map(e=>({...e,
  ...(e.planTrace?.domain.startsWith('inset:')?{planTrace:undefined}:{}),
  sources:e.sources.filter(s=>!own(s.quote??'')),issues:e.issues.filter(s=>!own(s)),
 }))};
 const ctx=structuralRevisionContext(project,texts,lines);
 if(ctx.pending)return clean;
 const current={...ctx.project,sheets:ctx.project.sheets.map(s=>ctx.replacements[s.id]?{...s,
  views:sheetViews((ctx.texts[s.id]??[]).map(t=>({...t,w:t.w??0,h:t.h??0})),ctx.lines[s.id]??[],s.width,s.height),
 }:s)};
 const registrations=insetRegistrations(current,clean,ctx.texts,ctx.lines);
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
    for(const table of schedules.filter(s=>/(?:BASE\s*PLATE|BEARING\s*PLATE).*SCHEDULE/i.test(s.title.trim())))
     for(const row of table.rows.filter(row=>row.mark.toUpperCase()===mismatch.str.trim().toUpperCase()))
      sources.push(ctx.source({kind:'sheet',id:sh.id,page:sh.page,label:sh.name,box:row.box??table.box,
       quote:`${prefix} ${table.title}; ${row.cells.join('; ')}. Source designation conflicts with saved ${mark}; dimensions are evidence for review, not an automatic substitution.`}));
   }
   const sheet=current.sheets.find(s=>s.id===m!.sheetId)!;
   sources.push(ctx.source({kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,
    box:[mismatch.cx-(mismatch.w??20)/2,mismatch.cy-(mismatch.h??10)/2,mismatch.cx+(mismatch.w??20)/2,mismatch.cy+(mismatch.h??10)/2],
    quote:`${prefix} source plate designation ${mismatch.str}; saved takeoff ${mark}. Requires takeoff review; no automatic rename.`}));
  }
  let planTrace=e.planTrace;
  const traceIssues:string[]=[];
  if(m&&m.points.length===2&&/\bbeam\b/i.test(e.typeName)){
   const code=/^[A-Z]{1,3}-?\d+[A-Z]?/i.exec(e.typeName)?.[0];
   const vertical=Math.abs(m.points[1][1]-m.points[0][1])>Math.abs(m.points[1][0]-m.points[0][0]);
   const along=vertical?1:0,cross=vertical?0:1;
   const tags=(ctx.texts[m.sheetId]??[]).filter(t=>t.str.trim().toUpperCase()===code?.toUpperCase()&&
    (Math.abs(Math.sin(t.angle??0))>.7)===vertical&&
    (vertical?t.cy:t.cx)>=Math.min(m.points[0][along],m.points[1][along])-5&&
    (vertical?t.cy:t.cx)<=Math.max(m.points[0][along],m.points[1][along])+5&&
    Math.abs((vertical?t.cx:t.cy)-m.points[0][cross])*r.metersPerPoint<.4);
   const span=tags.length===1?taggedBeamTrace(tags[0],ctx.lines[m.sheetId]??[]):null;
   if(span&&span.every(([x,y])=>x>=r.bounds[0]&&x<=r.bounds[2]&&y>=r.bounds[1]&&y<=r.bounds[3])){
    planTrace={points:span.map(p=>worldPoint(p,r.frame)),domain:`inset:${m.sheetId}`};
    const sheet=current.sheets.find(s=>s.id===m.sheetId)!;
    sources.push(ctx.source({kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,
     box:[Math.min(...span.map(p=>p[0]),tags[0].cx),Math.min(...span.map(p=>p[1]),tags[0].cy),Math.max(...span.map(p=>p[0]),tags[0].cx),Math.max(...span.map(p=>p[1]),tags[0].cy)],
     quote:`${tracePrefix} ${code} candidate centreline from tagged beam ink, transformed by independently traced inset grids. Endpoints follow source ink, not the saved quantity trace. No section width or elevation inferred.`}));
    traceIssues.push(`${tracePrefix} selectable in 2D only. Centreline association and bearing endpoints need review; width and elevation are unresolved. No physical solid or accepted quantity change.`);
   }
  }
  return {...e,planTrace,sources:[...e.sources,...sources],issues:[...e.issues,...traceIssues,
   `${prefix} inset 1:${Math.round(r.metersPerPoint*72/.0254)} located using traced ${r.grids.join('/')} grid strokes and independent floor-plan spacing (residual ${(r.frame.residual*1000).toFixed(1)} mm). This registers the view only; member outlines and local elevation remain unresolved. No roof datum, physical solid or quantity change.`,
   ...(mismatch?[`${prefix} drawing label ${mismatch.str} conflicts with saved takeoff ${mark}. Review the revised plan and plate schedule before assigning geometry.`]:[]),
  ]};
 })};
}
