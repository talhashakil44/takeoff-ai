import type {Project,Pt} from '../model';
import type {DrawingTexts} from './building';
import type {DrawingLines} from './roof';
import type {SourceRef} from './types';

/** A cut inside the measured bay identifies the section; a matching closed beam
 * profile and independently calibrated high/low datums establish its level. */
export function roofSectionEndEvidence(project:Project,texts:DrawingTexts,lines:DrawingLines,
  planId:string,bounds:number[],supports:Pt[],letter:string,width:number,depth:number,expectedTop:number,headerTop:number,
  trace:(lines:DrawingLines[string],x:number,scale:number,width:number,depth:number,min:number,max:number)=>{top:number;bottom:number}|null,
):{top:number;source:SourceRef;references:SourceRef[]}[] {
  const planSheet=project.sheets.find(s=>s.id===planId);
  if(!planSheet)return [];
  const pt=texts[planId]??[],out:{top:number;source:SourceRef;references:SourceRef[]}[]=[];
  const lo=Math.min(...supports.map(p=>p[0])),hi=Math.max(...supports.map(p=>p[0]));
  for(const ref of pt.filter(t=>/^S\d+\.\d+$/.test(t.str)&&t.cx>lo+1&&t.cx<hi-1&&t.cy<bounds[1]&&t.cy>headerTop)){
    const ns=pt.filter(t=>/^\d+$/.test(t.str)&&Math.abs(t.cx-ref.cx)<2&&ref.cy-t.cy>8&&ref.cy-t.cy<18);
    if(ns.length!==1)continue;
    const sheet=project.sheets.find(s=>!s.superseded&&s.name===ref.str);
    if(!sheet)continue;
    const ts=texts[sheet.id]??[],ls=lines[sheet.id]??[];
    const titles=ts.filter(t=>t.str.trim()===`BUILDING SECTION - ${ns[0].str}`);
    if(titles.length!==1)continue;
    const title=titles[0],scales=ts.filter(t=>/1\s*:\s*\d+/.test(t.str)&&t.cy>title.cy&&t.cy<title.cy+25&&Math.abs(t.cx-title.cx)<110);
    if(scales.length!==1)continue;
    const scale=Number(scales[0].str.match(/1\s*:\s*(\d+)/)![1])*.0254/72;
    const grids=ts.filter(t=>t.str===letter&&t.cx>title.cx-50&&t.cx<title.cx+850&&t.cy<title.cy-100&&t.cy>title.cy-650);
    if(grids.length!==1)continue;
    const grid=grids[0];
    const datum=(name:string)=>{
      const labels=ts.filter(t=>t.str===name&&t.cx>title.cx&&t.cx<title.cx+850&&t.cy>grid.cy&&t.cy<title.cy);
      if(labels.length!==1)return null;
      const label=labels[0],nums=ts.filter(t=>/^\d{4,5}$/.test(t.str)&&Math.abs(t.cx-label.cx)<60&&t.cy-label.cy>5&&t.cy-label.cy<11);
      if(nums.length!==1)return null;
      const y=(label.cy+nums[0].cy)/2;
      const leaders=ls.filter(l=>!l.filled&&!l.curve&&Math.abs(l.y1-l.y2)<.05&&Math.abs(l.y1-y)<.4&&Math.abs((l.x1+l.x2)/2-label.cx)<80&&Math.abs(l.x2-l.x1)>3);
      const groups=leaders.map(l=>({y:l.y1,n:leaders.filter(v=>Math.abs(v.y1-l.y1)<.05).length})).filter(v=>v.n>=3);
      if(!groups.length||groups.some(v=>Math.abs(v.y-groups[0].y)>.05))return null;
      return {y:groups[0].y,z:Number(nums[0].str)/1000};
    };
    const high=datum('T/O HIGH BEAM'),low=datum('T/O LOW BEAM');
    if(!high||!low||Math.abs((low.y-high.y)*scale-(high.z-low.z))>.02)continue;
    const profile=trace(ls,grid.cx,scale,width,depth,high.y-1,low.y+1);
    if(!profile)continue;
    const top=high.z-(profile.top-high.y)*scale;
    if(Math.abs(top-expectedTop)>.02)continue;
    out.push({top:expectedTop,source:{kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,box:[grid.cx-20,profile.top-10,grid.cx+20,profile.bottom+10],quote:`${ns[0].str}/${sheet.name}, grid ${letter}: plan cut lies inside this bearing bay. Closed ${(width*1000).toFixed(0)}×${(depth*1000).toFixed(0)}mm scheduled beam section at ${scales[0].str}; high/low beam datums calibrate traced top ${top.toFixed(3)}m, agreeing with structural beam plane ${expectedTop.toFixed(3)}m within20mm. Beam identity is associated through the plan, not a mark in the section.`},references:[{kind:'sheet',id:planId,page:planSheet.page,label:'Roof bay section reference',box:[ref.cx-15,ns[0].cy-10,ref.cx+15,ref.cy+10],quote:`${ns[0].str}/${ref.str} cut inside bearing bay at row ${letter}; section is evidence of the member profile, not the free-end length.`}]});
  }
  return out;
}
