import {expect,it} from 'vitest';import fs from 'node:fs';
import {explainFoundationSlabOption} from '../src/build/foundationSlabOptionEvidence';
import type {BuildModel} from '../src/build/types';
const t=(str:string,cx:number,cy:number)=>({str,cx,cy});
const model={elements:[{id:'a',typeName:'SF-N – Strip footing 700 x ?',measurementSource:'foundations',shape:{type:'axis',points:[[0,0],[2,0]],z:-1.2},quantity:2,unit:'m',sources:[],issues:[]}]} as unknown as BuildModel;
const pages=[{docId:'d',page:1},{docId:'d',page:2}];
const texts={'spec:d:1':[t('CONCRETE FOOTING SCHEDULE',200,20),t('SF-N',100,70),t('ST',140,70),t('REFER TO DETAIL 10/S1.2',400,70)],'spec:d:2':[t('DETAIL - SLAB THICKENING OPTION',250,400),t('10',100,400),t('S1.2',100,416)]};
it('links the actual ST row and numbered detail without turning an option into geometry',()=>{
 const before=JSON.stringify(model),out=explainFoundationSlabOption(model,texts,pages),e=out.elements[0];
 expect(e.sources).toHaveLength(2);expect(e.issues[0]).toContain('assumed rectangular strip depth');
 expect(e.shape).toEqual(model.elements[0].shape);expect(e.quantity).toBe(2);expect(JSON.stringify(model)).toBe(before);
 for(const changed of [{...texts,'spec:d:1':texts['spec:d:1'].filter(x=>x.str!=='ST')},{...texts,'spec:d:2':texts['spec:d:2'].filter(x=>x.str!=='10')},{...texts,'spec:d:2':texts['spec:d:2'].map(x=>x.str==='S1.2'?{...x,str:'S1.3'}:x)}]){
  const withdrawn=explainFoundationSlabOption(out,changed,pages).elements[0];expect(withdrawn.sources).toEqual([]);expect(withdrawn.issues).toEqual([]);
 }
});
it('does not attach a conflicting second reference or apply the option to other footing codes',()=>{
 const ts={...texts,'spec:e:1':texts['spec:d:1'],'spec:e:2':texts['spec:d:2']};
 expect(explainFoundationSlabOption(model,ts,[...pages,{docId:'e',page:1},{docId:'e',page:2}]).elements[0].sources).toEqual([]);
 expect(explainFoundationSlabOption({...model,elements:[{...model.elements[0],typeName:'SF-1'}]},texts,pages).elements[0].sources).toEqual([]);
});
it.runIf(!!process.env.CANOPY_SOURCE_FIXTURE)('links revised source schedule19 to detail23 and withdraws if the reference row disappears',()=>{
 const d=JSON.parse(fs.readFileSync(process.env.CANOPY_SOURCE_FIXTURE!,'utf8')),docId='bec80a15-e5e2-4cdd-a142-c02af1b8f631',ps=[{docId,page:19},{docId,page:23}];
 const out=explainFoundationSlabOption(model,d.drawingTexts,ps);
 expect(out.elements[0].sources.map(s=>s.page)).toEqual([19,23]);
 const key=`spec:${docId}:19`,without={...d.drawingTexts,[key]:d.drawingTexts[key].filter((t:any)=>t.str!=='REFER TO DETAIL 10/S1.2')};
 expect(explainFoundationSlabOption(out,without,ps).elements[0].sources).toEqual([]);
},30000);
