import type {BuildModel,SourceRef} from './types';
import type {DrawingTexts} from './building';
const label='Schedule-linked slab thickening';
const prefix='Foundation slab option unresolved:';
/** A schedule's ST/detail reference is review evidence, not permission to turn
 * an assumed rectangular strip into a slab thickening at a guessed datum. */
export function explainFoundationSlabOption(model:BuildModel,texts:DrawingTexts,pages:{docId:string;page:number}[]):BuildModel {
  const links:SourceRef[][]=[];
  for(const p of pages){
    const ts=texts[`spec:${p.docId}:${p.page}`]??[];
    for(const tag of ts.filter(t=>/^SF-?N$/i.test(t.str.trim()))){
      if(!ts.some(t=>/^CONCRETE FOOTING SCHEDULE$/i.test(t.str.trim()) && t.cy<tag.cy && tag.cy-t.cy<220 && Math.abs(t.cx-tag.cx)<400))continue;
      const row=ts.filter(t=>Math.abs(t.cy-tag.cy)<2 && t.cx>tag.cx && t.cx<tag.cx+550);
      if(!row.some(t=>t.str.trim()==='ST' && t.cx-tag.cx<80))continue;
      const refs=row.filter(t=>/^REFER TO DETAIL\s+\d+\s*\/\s*S\d+\.\d+$/i.test(t.str.trim()));
      if(refs.length!==1)continue;
      const match=refs[0].str.match(/(\d+)\s*\/\s*(S\d+\.\d+)/i)!;
      for(const page of pages.filter(v=>v.docId===p.docId)){
        const dt=texts[`spec:${page.docId}:${page.page}`]??[];
        for(const title of dt.filter(t=>/^DETAIL\s*-\s*SLAB THICKENING OPTION$/i.test(t.str.trim()))){
          const nums=dt.filter(t=>t.str.trim()===match[1] && Math.abs(t.cy-title.cy)<2 && t.cx<title.cx && title.cx-t.cx<220);
          if(nums.length!==1)continue;
          const n=nums[0];
          if(!dt.some(t=>t.str.trim().toUpperCase()===match[2].toUpperCase() && Math.abs(t.cx-n.cx)<2 && t.cy-n.cy>8 && t.cy-n.cy<22))continue;
          links.push([{kind:'spec',id:p.docId,page:p.page,label:`${label} schedule`,box:[tag.cx-15,tag.cy-8,refs[0].cx+55,tag.cy+12],quote:`SF-N schedule row: type ST; ${refs[0].str}. A slab-thickening reference, not a dimensioned rectangular strip section.`},
            {kind:'spec',id:page.docId,page:page.page,label:`${label} detail`,quote:`${match[1]}/${match[2]}: ${title.str}. Reference option only. Local slab thickness, top elevation, sloped profile and applicability must be established before physical geometry is generated.`}]);
        }
      }
    }
  }
  const unique=[...new Map(links.map(l=>[JSON.stringify(l),l])).values()];
  return {...model,elements:model.elements.map(e=>{
    const sources=e.sources.filter(s=>!s.label.startsWith(label)),issues=e.issues.filter(i=>!i.startsWith(prefix));
    const qualifies=e.measurementSource==='foundations' && /^SF-?N\b/i.test(e.typeName) && (!e.shape || ['axis','locator'].includes(e.shape.type));
    if(!qualifies || unique.length!==1)return sources.length===e.sources.length && issues.length===e.issues.length?e:{...e,sources,issues};
    return {...e,sources:[...sources,...unique[0]],issues:[...issues,`${prefix} the schedule identifies ST and refers to a slab-thickening option. An assumed rectangular strip depth is not a verified profile. Resolve local slab thickness/elevation, sloped sides and applicability; no physical solid generated and accepted quantities retained.`]};
  })};
}
