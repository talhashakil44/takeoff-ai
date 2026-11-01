import type { Project } from '../model';
import type { DrawingTexts } from './building';
import type { StructuralSection } from './structural';
/** Schedule envelopes for plan witnesses only. These are not solid steel sections. */
export function hssColumnPlanSections(project: Project, texts: DrawingTexts): Record<string, StructuralSection & { wall: number }> {
  const out: Record<string, StructuralSection & { wall: number }> = {};
  for (const sheet of project.sheets.filter(s=>!s.superseded && /^S/.test(s.name))) {
    const ts=texts[sheet.id]??[];
    for (const heading of ts.filter(t=>t.str.trim()==='COLUMN SCHEDULE')) {
      const header=ts.find(t=>t.str.trim()==='SIZE' && t.cy>heading.cy && t.cy-heading.cy<35 && Math.abs(t.cx-heading.cx)<150);
      if(!header)continue;
      const headers=ts.filter(t=>Math.abs(t.cy-header.cy)<2);
      const mark=headers.filter(t=>t.str.trim()==='MARK' && t.cx<header.cx).sort((a,b)=>b.cx-a.cx)[0];
      const right=headers.filter(t=>t.cx>header.cx+10).sort((a,b)=>a.cx-b.cx)[0];
      if(!mark || !right)continue;
      for(const tag of ts.filter(t=>/^C\d+$/.test(t.str.trim()) && Math.abs(t.cx-mark.cx)<10 && t.cy>header.cy && t.cy<header.cy+100)) {
        const sizes=ts.filter(t=>Math.abs(t.cy-tag.cy)<2 && t.cx>mark.cx+15 && t.cx<right.cx && /^HSS\b/i.test(t.str.trim()));
        if(sizes.length!==1)continue;
        const size=sizes[0], dims=size.str.trim().match(/^HSS\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i);
        if(!dims)continue;
        const width=+dims[1]/1000,depth=+dims[2]/1000,wall=+dims[3]/1000;
        if(!(wall>0 && wall*2<Math.min(width,depth)))continue;
        const code=tag.str.trim();
        if(out[code]) {
          if(out[code].description!==size.str)out[code].conflict='Conflicting HSS schedule rows; review revisions.';
          continue;
        }
        out[code]={code,width,depth,wall,description:size.str,source:{kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,
          box:[mark.cx-12,tag.cy-7,right.cx,tag.cy+12],quote:`COLUMN SCHEDULE: ${code} SIZE ${size.str}. Outside dimensions for plan footprint only; height and steel solid section unresolved.`}};
      }
    }
  }
  return out;
}
