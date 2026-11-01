import { expect,it } from 'vitest';
import { hssColumnPlanSections } from '../src/build/hssColumnPlanSections';
import { structuralSections } from '../src/build/structural';
import type { Project } from '../src/model';
const p={sheets:[{id:'s',name:'S0.3',page:1}]} as Project;
const t=(str:string,cx:number,cy:number)=>({str,cx,cy});
const rows=[t('COLUMN SCHEDULE',100,10),t('MARK',20,30),t('SIZE',100,30),t('NOTES',200,30),t('C2',20,50),t('HSS 127 x 127 x 9.5',100,50)];
it('reads only a schedule-linked HSS plan envelope, leaving the solid section parser unchanged',()=>{
 const a=hssColumnPlanSections(p,{s:rows}).C2;
 expect([a.width,a.depth]).toEqual([.127,.127]);
 expect(a.source.quote).toContain('height and steel solid section unresolved');
 expect(structuralSections(p,{s:rows}).C2).toBeUndefined();
 for(const bad of [rows.slice(1),rows.filter(x=>x.str!=='MARK'),rows.map(x=>x.str.startsWith('HSS')?{...x,cx:230}:x),rows.map(x=>x.str.startsWith('HSS')?{...x,str:'HSS 127 x 127 x 80'}:x)])expect(hssColumnPlanSections(p,{s:bad}).C2).toBeUndefined();
});
it('does not let a later duplicate erase conflicting schedule evidence',()=>{
 const sheets=['a','b','c'].map(id=>({id,name:'S0.3',page:1}));
 const alternate=rows.map(x=>x.str.startsWith('HSS')?{...x,str:'HSS 152 x 152 x 9.5'}:x);
 expect(hssColumnPlanSections({...p,sheets} as Project,{a:rows,b:alternate,c:rows}).C2.conflict).toBeTruthy();
});
