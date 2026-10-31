import {it,expect} from 'vitest';
import {scheduledFootprint} from '../src/build/foundationPlanEvidence';
const rect=(x:number,y:number,w:number,h:number)=>[[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]].map(([x1,y1,x2,y2])=>({x1,y1,x2,y2,width:1,filled:false}));
it.each([.5,1,3])('finds drawn off-grid edges independently of page scale %s',n=>{
 const lines=rect(100*n,200*n,75*n,75*n);
 expect(scheduledFootprint(lines,[180*n,190*n],.02/n,1.5,1.5)?.x0).toBe(100*n);
 expect(scheduledFootprint(lines.slice(1),[180*n,190*n],.02/n,1.5,1.5)).toBeNull();
});
it('withholds ambiguous outlines and incorrect scheduled sizes',()=>{
 const lines=rect(100,200,75,75);
 expect(scheduledFootprint(lines,[180,190],.02,1.8,1.8)).toBeNull();
 expect(scheduledFootprint([...lines,...rect(200,200,75,75)],[190,190],.02,1.5,1.5)).toBeNull();
});
it('withdraws stale foundation candidates when source evidence is unavailable',async()=>{
 const {retainFoundationPlanEvidence}=await import('../src/build/foundationPlanEvidence');
 const e={id:'pad',quantity:1,unit:'ea',measurementSource:'foundations',typeName:'F-2',planFootprint:{domain:'foundation:old',ring:[[0,0],[1,0],[1,1]]},sources:[{quote:'Foundation plan candidate: old'}],issues:['Foundation plan candidate: old']};
 const out=retainFoundationPlanEvidence({sheets:[],measurements:[],specs:[]} as any,{elements:[e]} as any,{},{}).elements[0];
 expect(out.planFootprint).toBeUndefined();expect(out.sources).toEqual([]);expect(out.quantity).toBe(1);
});
