import type {DrawingText,DrawingTexts} from './building';
import {gridAxes} from './building';
import type {Project} from '../model';
import type {BuildElement,SourceRef} from './types';
import type {DrawingLines} from './roof';
const norm=(s:string)=>s.toUpperCase().replace(/[\s/.-]/g,'');
/** Explicit grid-labelled sections only. Numeric elevation is not frost-cover
 * minimum, scaled section depth, or a project-wide nearest datum. */
export function gridFootingSections(ts:DrawingText[]){
 const titles=ts.flatMap(t=>{const m=/^SECTION\s+AT\s+G\/?L\s+([A-Z]|\d{1,2})$/i.exec(t.str.trim());return m?[{t,grid:m[1].toUpperCase()}]:[];}).sort((a,b)=>a.t.cx-b.t.cx);
 // Horizontal midpoint panels are valid only for one aligned title row.
 // Stacked/staggered sections need actual panel boundaries; otherwise a lower
 // title can borrow a zero datum and footing mark from an unrelated upper detail.
 if(titles.some(v=>!v.t.h||!Number.isFinite(v.t.cy))||titles.length>1&&Math.max(...titles.map(v=>v.t.cy))-Math.min(...titles.map(v=>v.t.cy))>2*Math.min(...titles.map(v=>v.t.h!)))return [];
 return titles.flatMap((v,i)=>{
  const lo=i?(titles[i-1].t.cx+v.t.cx)/2:-Infinity,hi=i+1<titles.length?(titles[i+1].t.cx+v.t.cx)/2:Infinity;
  const local=ts.filter(t=>t.cx>lo&&t.cx<hi&&t.cy<v.t.cy);
  const datum=(pattern:RegExp)=>local.filter(t=>pattern.test(t.str.trim())).flatMap(t=>{
   if(!t.h||!t.w)return [];
   const ns=local.filter(n=>/^-?\d[\d,]*(?:\.\d+)?$/.test(n.str.trim())&&n.h&&t.cy-n.cy>=Math.min(t.h!,n.h)&&t.cy-n.cy<=3*Math.max(t.h!,n.h)&&Math.abs(n.cx-t.cx)<=t.w!/2);
   return ns.length===1?[{label:t,number:ns[0],value:Number(ns[0].str.replaceAll(',',''))/1000}]:[];
  });
  const floor=datum(/^(?:(?:FINISHED|FIN\.?)\s+)?GROUND FLOOR$/i),foot=datum(/^T\s*[/.]?\s*O\.?\s+FOOTING$/i);
  if(floor.length!==1||floor[0].value!==0||foot.length!==1||foot[0].value>=0||foot[0].value< -10)return [];
  const allMarks=local.filter(t=>/^S\/?F-?\d+$/i.test(t.str.trim())).map(t=>norm(t.str));
  const marks=allMarks.filter((mark,_,all)=>all.filter(m=>m===mark).length===1);
  return marks.map(mark=>({grid:v.grid,mark,z:foot[0].value,evidence:[v.t,floor[0].label,floor[0].number,foot[0].label,foot[0].number,...local.filter(t=>norm(t.str)===mark)]}));
 });
}
export function localStripDatum(project:Project,e:BuildElement,width:number,texts:DrawingTexts,lines:DrawingLines):{z:number;sources:SourceRef[];start:number;end:number}|null{
 if(project.units!=='metric')return null;
 const m=project.measurements.find(m=>m.id===e.measurementId),sheet=project.sheets.find(s=>s.id===e.sheetId);
 if(!m||!sheet?.metersPerPoint||m.points.length<2)return null;
 const code=/^S\/?F-?\d+\b/i.exec(e.typeName)?.[0];if(!code)return null;
 const plan=texts[sheet.id]??[];
 // A stepped plan requires a bounded step-region resolver, not whole-grid propagation.
 if(plan.some(t=>/^(?:S\.\s*F\.|STEP(?:PED)? FOOTING)$/i.test(t.str.trim())))return null;
 const axes=gridAxes(plan,sheet.width,sheet.height,undefined,lines[sheet.id]);
 const records=project.sheets.filter(s=>s.docId===sheet.docId&&!s.superseded&&/SECTION/i.test(s.title??'')).flatMap(s=>gridFootingSections(texts[s.id]??[]).filter(v=>v.mark===norm(code)).map(v=>({...v,sheet:s})));
 const used:typeof records=[];
 const segments:number[]=[];
 for(let i=1;i<m.points.length;i++){
  const a=m.points[i-1],b=m.points[i];if(Math.hypot(a[0]-b[0],a[1]-b[1])<.1)continue;
  const matches=records.filter(r=>{const ax=axes[r.grid];if(!ax)return false;const j=ax.axis==='x'?0:1;return Math.abs(a[j]-b[j])*sheet.metersPerPoint!<.01&&Math.max(Math.abs(a[j]-ax.at),Math.abs(b[j]-ax.at))*sheet.metersPerPoint!<=width/2;});
  if(!matches.length||matches.some(r=>Math.abs(r.z-matches[0].z)>.001))continue;
  segments.push(i);used.push(...matches);
 }
 if(!used.length||used.some(r=>Math.abs(r.z-used[0].z)>.001)||segments.some((n,i)=>i>0&&n!==segments[i-1]+1))return null;
 return {z:used[0].z,start:segments[0]-1,end:segments.at(-1)!,sources:[...new Map(used.map(r=>{const ts=r.evidence;const source:SourceRef={kind:'sheet',id:r.sheet.id,page:r.sheet.page,label:r.sheet.name,box:[Math.min(...ts.map(t=>t.cx-(t.w??0)/2)),Math.min(...ts.map(t=>t.cy-(t.h??0)/2)),Math.max(...ts.map(t=>t.cx+(t.w??0)/2)),Math.max(...ts.map(t=>t.cy+(t.h??0)/2))],quote:`${r.mark}: SECTION AT G/L ${r.grid}; GROUND FLOOR 0; T/O FOOTING ${r.z} m. Matched measured run to this grid within scheduled footing half-width; plan path remains inferred.`};return [JSON.stringify(source),source];})).values()]};
}
