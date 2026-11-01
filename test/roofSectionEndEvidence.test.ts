import {it,expect} from 'vitest';
import fs from 'node:fs';
import {roofSectionEndEvidence} from '../src/build/roofSectionEndEvidence';
import {roofEndSection} from '../src/build/roofCantileverGeometry';
it.skipIf(!process.env.CANOPY_SOURCE_FIXTURE)('requires the actual bay cut, closed profile and calibrated datum for revised E8-9',()=>{
 const d=JSON.parse(fs.readFileSync(process.env.CANOPY_SOURCE_FIXTURE!,'utf8'));
 const plan=d.project.sheets.find((s:any)=>s.name==='S2.1'),section=d.project.sheets.find((s:any)=>s.name==='S4.0');
 const doc='spec:bec80a15-e5e2-4cdd-a142-c02af1b8f631:';
 const texts={...d.drawingTexts,[plan.id]:d.drawingTexts[doc+'25'],[section.id]:d.drawingTexts[doc+'31']};
 const lines={...d.drawingLines,[section.id]:d.drawingLines[doc+'31']};
 const run=(ts=texts,ls=lines)=>roofSectionEndEvidence(d.project,ts,ls,plan.id,[850,790,2100,1500],[[1911,1447],[2031,1447]],'E',.265,.608,10.428,600,roofEndSection);
 expect(run()).toHaveLength(1);expect(run()[0].source.quote).toContain('1/S4.0, grid E');
 // Removing the actual plan cut must not borrow a neighbouring section.
 expect(run({...texts,[plan.id]:texts[plan.id].filter((t:any)=>!(t.str==='S4.0'&&t.cx>1912&&t.cx<2030&&t.cy<790))})).toHaveLength(0);
 expect(run({...texts,[section.id]:texts[section.id].filter((t:any)=>t.str!=='10428')})).toHaveLength(0);
 // Withdrawing one face of this exact beam section invalidates its closed profile.
 expect(run(texts,{...lines,[section.id]:lines[section.id].filter((l:any)=>!(Math.abs(l.x1-1584.12)<.1&&Math.abs(l.x2-1584.12)<.1&&l.y1>1135&&l.y1<1160))})).toHaveLength(0);
},30000);
