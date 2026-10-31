import type {Project,Pt} from '../model';
import type {Segment} from '../fill/vectors';
import type {BuildModel} from './types';
import type {DrawingTexts} from './building';
import type {DrawingLines} from './roof';
import {frameRectangles} from './openingDetails';
import {readSchedules} from '../smart/schedules';
import {foundationMarks} from '../automate/foundations';
import {sheetFrame,worldPoint} from './sheetCoordinates';
import {foundationRevisionPages} from './foundationGeometry';
const prefix='Foundation plan candidate:';
const norm=(s:string)=>s.toUpperCase().replace(/[\s.-]/g,'');
/** A unique complete outline is plan evidence only, never elevation evidence. */
export function scheduledFootprint(lines:Segment[],tag:Pt,scale:number,width:number,length:number){
 if(![scale,width,length].every(n=>Number.isFinite(n)&&n>0))return null;
 const reach=2*Math.max(width,length)/scale;
 const rects=frameRectangles(lines,{x0:tag[0]-reach,y0:tag[1]-reach,x1:tag[0]+reach,y1:tag[1]+reach})
 .filter(r=>{
  const w=(r.x1-r.x0)*scale,h=(r.y1-r.y0)*scale;
  const fits=(Math.abs(w-width)<.015&&Math.abs(h-length)<.015)||(Math.abs(h-width)<.015&&Math.abs(w-length)<.015);
  const gap=Math.hypot(Math.max(r.x0-tag[0],0,tag[0]-r.x1),Math.max(r.y0-tag[1],0,tag[1]-r.y1))*scale;
  return fits&&gap<=Math.max(width,length);
 });
 const unique=[...new Map(rects.map(r=>[JSON.stringify(r),r])).values()];
 return unique.length===1?unique[0]:null;
}
export function retainFoundationPlanEvidence(project:Project,model:BuildModel,texts:DrawingTexts,lines:DrawingLines):BuildModel{
 model={...model,elements:model.elements.map(e=>{
  if(!e.planFootprint?.domain.startsWith('foundation:')&&!e.sources.some(s=>s.quote?.startsWith(prefix)))return e;
  const {planFootprint,...rest}=e;
  return {...rest,sources:e.sources.filter(s=>!s.quote?.startsWith(prefix)),issues:e.issues.filter(s=>!s.startsWith(prefix))};
 })};
 // Revised sheets need their own source registration; never overlay an obsolete base page.
 if(foundationRevisionPages(project).length)return model;
 const frames=new Map(project.sheets.map(s=>[s.id,sheetFrame(project,model,s)]));
 return {...model,elements:model.elements.map(e=>{
  if(e.measurementSource!=='foundations'||!/^F-?\d+\b/.test(e.typeName)||e.status==='demolished'||(e.shape&&e.shape.type!=='locator'))return e;
  const sheet=project.sheets.find(s=>s.id===e.sheetId),m=project.measurements.find(m=>m.id===e.measurementId);
  const frame=frames.get(e.sheetId??'');
  if(!sheet||sheet.superseded||!frame||!m?.points[0])return e;
  const ts=(texts[sheet.id]??[]).map(t=>({...t,w:t.w??0,h:t.h??0}));
  const schedules=readSchedules(ts,lines[sheet.id]??[]),code=/^F-?\d+\b/.exec(e.typeName)![0];
  const matches=foundationMarks(schedules,project.units==='metric').filter(s=>norm(s.mark)===norm(code)&&s.kind==='pad');
  const size=matches[0];
  if(!size?.width||!size.length||matches.some(s=>s.width!==size.width||s.length!==size.length))return e;
  const r=scheduledFootprint(lines[sheet.id]??[],m.points[0],Math.hypot(frame.a,frame.b),size.width,size.length);
  if(!r)return e;
  const ring:Pt[]=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]];
  return {...e,planFootprint:{ring:ring.map(p=>worldPoint(p,frame)),domain:`foundation:${sheet.id}`},
   sources:[...e.sources.filter(s=>!s.quote?.startsWith(prefix)),{kind:'sheet' as const,id:sheet.id,page:sheet.page,label:sheet.name,box:[r.x0,r.y0,r.x1,r.y1] as [number,number,number,number],quote:`${prefix} ${code} unique closed outline near the source tag matches scheduled ${size.width} x ${size.length} m. Tag association is inferred; local section and elevation remain unresolved.`}],
   issues:[...e.issues.filter(s=>!s.startsWith(prefix)),`${prefix} scheduled-size closed outline retained in 2D only. Its location follows drawing edges, not the grid snap. No physical solid or quantity change.`]};
 })};
}
