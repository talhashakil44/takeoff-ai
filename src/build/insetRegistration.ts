import type {Project,Pt,Sheet} from '../model';
import type {BuildModel,SourceRef} from './types';
import {gridAxes,type DrawingText,type DrawingTexts} from './building';
import type {DrawingLines} from './roof';
import {traceGridStroke} from './gridStroke';
import {sheetFrame,worldPoint,type SheetFrame} from './sheetCoordinates';
export interface InsetRegistration {frame:SheetFrame;metersPerPoint:number;title:string;bounds:[number,number,number,number];grids:string[];sources:SourceRef[];}
type Axis={axis:'x'|'y';at:number};
/** Text is only a label candidate: each accepted axis must have a unique traced
 * straight/dogleg continuation. Repeated bubbles must describe the same line. */
export function tracedInsetAxes(texts:DrawingText[],lines:DrawingLines[string]):Record<string,Axis>{
 const found=new Map<string,Axis[]>();
 for(const t of texts.filter(t=>/^(?:[A-Z](?:[a-z])?|\d{1,2})$/.test(t.str.trim()))){
  const values:Axis[]=[];
  for(const axis of ['x','y'] as const)for(const direction of [1,-1] as const){
   const at=traceGridStroke(t,lines,axis,direction);
   if(at!==null&&!values.some(v=>v.axis===axis&&Math.abs(v.at-at)<.5))values.push({axis,at});
  }
  if(values.length===1)found.set(t.str.trim(),[...(found.get(t.str.trim())??[]),values[0]]);
 }
 return Object.fromEntries([...found].flatMap(([label,axes])=>axes.every(a=>a.axis===axes[0].axis&&Math.abs(a.at-axes[0].at)<.5)?[[label,axes[0]]]:[]));
}
/** Match the engine's small-view rule without requiring one scale for a
 * multi-scale sheet. A larger differently-scaled detected view supplies context. */
function smallViews(sheet:Sheet){
 const views=sheet.views??[],area=(v:typeof views[number])=>(v.box[2]-v.box[0])*(v.box[3]-v.box[1]);
 return views.filter(v=>v.metersPerPoint>0&&(!sheet.metersPerPoint||Math.abs(v.metersPerPoint/sheet.metersPerPoint-1)>.01)&&views.some(main=>area(main)>=2*area(v)&&Math.abs(main.metersPerPoint/v.metersPerPoint-1)>.01));
}
/** Small differently-scaled engine views, irrespective of their title. At least
 * three traced matching axes, crossing families and redundant spacing required.
 * Quarter-turns are tested; ambiguous reference frames withdraw registration. */
export function insetRegistrations(project:Project,model:BuildModel,texts:DrawingTexts,lines:DrawingLines):Record<string,InsetRegistration>{
 const out:Record<string,InsetRegistration>={},ambiguous=new Set<string>();
 const needed=new Set<string>();
 for(const sheet of project.sheets.filter(s=>!s.superseded))for(const view of smallViews(sheet)){
  for(const t of texts[sheet.id]??[])if(t.cx>=view.box[0]&&t.cx<=view.box[2]&&t.cy>=view.box[1]&&t.cy<=view.box[3]&&/^(?:[A-Z](?:[a-z])?|\d{1,2})$/.test(t.str.trim()))needed.add(t.str.trim());
 }
 if(!needed.size)return out;
 const refs=project.sheets.filter(s=>!s.superseded&&/^A/i.test(s.name)&&s.metersPerPoint&&/FLOOR PLAN/i.test(s.title??'')&&!/CEILING|FIRE|ENLARG|DETAIL/i.test(s.title??'')).flatMap(sheet=>{
  const frame=sheetFrame(project,model,sheet);
  const ts=texts[sheet.id]??[],seeds=gridAxes(ts,sheet.width,sheet.height);
  const tags=ts.filter(t=>{
   const key=t.str.trim();if(!needed.has(key))return false;
   const axis=seeds[key];
   if(axis)return Math.abs((axis.axis==='x'?t.cx:t.cy)-axis.at)<2;
   if(!/^[A-Z][a-z]$/.test(key))return false;
   const parent=seeds[key[0]];if(!parent)return false;
   return ts.some(p=>p.str.trim()===key[0]&&Math.abs((parent.axis==='x'?p.cx:p.cy)-parent.at)<2&&Math.abs(parent.axis==='x'?p.cy-t.cy:p.cx-t.cx)<3&&!ts.some(other=>other.str.trim()===key[0]&&Math.abs(parent.axis==='x'?other.cy-t.cy:other.cx-t.cx)<3&&Math.abs(parent.axis==='x'?other.cx-t.cx:other.cy-t.cy)<Math.abs(parent.axis==='x'?p.cx-t.cx:p.cy-t.cy)));
  });
  return frame?[{sheet,frame,axes:tracedInsetAxes(tags,lines[sheet.id]??[])}]:[];
 });
 for(const sheet of project.sheets.filter(s=>!s.superseded)){
  for(const view of smallViews(sheet)){
   const ts=texts[sheet.id]??[],title=ts.filter(t=>t.str.trim().toUpperCase()===view.title.trim().toUpperCase());
   if(title.length!==1||title[0].cx<view.box[0]||title[0].cx>view.box[2]||title[0].cy<view.box[1]-35||title[0].cy>view.box[3]+35)continue;
   const scales=ts.flatMap(t=>{const m=/^1\s*:\s*(\d+(?:\.\d+)?)$/.exec(t.str.trim());return m&&t.cy>title[0].cy&&t.cy-title[0].cy<35&&Math.abs(t.cx-title[0].cx)<180?[Number(m[1])*.0254/72]:[];});
   if(scales.length!==1||Math.abs(scales[0]/view.metersPerPoint-1)>.001)continue;
   const local=ts.filter(t=>t.cx>=view.box[0]&&t.cx<=view.box[2]&&t.cy>=view.box[1]&&t.cy<=view.box[3]);
   const axes=tracedInsetAxes(local,lines[sheet.id]??[]),candidates:InsetRegistration[]=[];
   for(const ref of refs)for(const turn of [0,1,2,3]){
    const c=Math.round(Math.cos(turn*Math.PI/2)),s=Math.round(Math.sin(turn*Math.PI/2));
    const offsets:{axis:'x'|'y';value:number;label:string}[]=[];
    for(const [label,axis] of Object.entries(axes)){
     const target=ref.axes[label];if(!target)continue;
     const swapped=turn%2!==0, dest=swapped?(axis.axis==='x'?'y':'x'):axis.axis;
     if(dest!==target.axis)continue;
     const sign=axis.axis==='x'?(swapped?s:c):(swapped?-s:c);
     offsets.push({axis:dest,value:target.at*ref.sheet.metersPerPoint!-sign*axis.at*view.metersPerPoint,label});
    }
    const xs=offsets.filter(o=>o.axis==='x'),ys=offsets.filter(o=>o.axis==='y');
    if(offsets.length<3||!xs.length||!ys.length)continue;
    const mean=(v:typeof offsets)=>v.reduce((a,b)=>a+b.value,0)/v.length;
    const dx=mean(xs),dy=mean(ys),residual=Math.max(...xs.map(o=>Math.abs(o.value-dx)),...ys.map(o=>Math.abs(o.value-dy)));
    if(residual>.03)continue;
    const ratio=1/ref.sheet.metersPerPoint!,scale=view.metersPerPoint;
    const frame:SheetFrame={a:(ref.frame.a*c-ref.frame.b*s)*scale*ratio,b:(ref.frame.b*c+ref.frame.a*s)*scale*ratio,
     tx:ref.frame.tx+(ref.frame.a*dx-ref.frame.b*dy)*ratio,ty:ref.frame.ty+(ref.frame.b*dx+ref.frame.a*dy)*ratio,residual:Math.max(residual,ref.frame.residual)};
    candidates.push({frame,metersPerPoint:scale,title:view.title,bounds:view.box,grids:offsets.map(o=>o.label),sources:[
     {kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,box:[view.box[0],view.box[1],view.box[2],Math.max(view.box[3],title[0].cy+35)],quote:`${view.title}; printed ${view.scaleLabel}; independently traced grids ${offsets.map(o=>o.label).join('/')}`},
     {kind:'sheet',id:ref.sheet.id,page:ref.sheet.page,label:ref.sheet.name,quote:`Reference grid strokes ${offsets.map(o=>o.label).join('/')}; spacing residual ${(residual*1000).toFixed(1)} mm; label centres are not grid axes`},
    ]});
   }
   const best=candidates[0];if(!best)continue;
   if(candidates.some(r=>[[view.box[0],view.box[1]],[view.box[2],view.box[3]]].some(p=>Math.hypot(...worldPoint(p as Pt,r.frame).map((v,i)=>v-worldPoint(p as Pt,best.frame)[i]))>.05)))continue;
   for(const m of project.measurements.filter(m=>m.sheetId===sheet.id&&m.points.length&&m.points.every(([x,y])=>x>=view.box[0]&&x<=view.box[2]&&y>=view.box[1]&&y<=view.box[3]))){
    // Overlapping differently-scaled insets cannot silently overwrite each other.
    if(out[m.id]){delete out[m.id];ambiguous.add(m.id);}else if(!ambiguous.has(m.id))out[m.id]=best;
   }
  }
 }
 return out;
}
