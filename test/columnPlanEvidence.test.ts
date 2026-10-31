import {expect,it} from 'vitest';
import {retainColumnPlanEvidence, type ColumnPlanWitness} from '../src/build/columnPlanEvidence';
import type {BuildModel} from '../src/build/types';
const witness=(id:string,domain:string,at:[number,number]=[4,5]):ColumnPlanWitness=>({at,ring:[[3,4],[5,4],[5,6],[3,6]],code:'C1',width:.265,depth:.342,domain,source:{kind:'sheet',id,label:id,page:1,box:[1,2,3,4]}});
const model={elements:[{id:'a',shape:null,quantity:1,issues:['Calibrated floor registration is required.'],sources:[]},{id:'b',shape:{type:'point',at:[4,5],z:4,size:[.265,.342,3]},quantity:1,issues:[],sources:[]}]} as unknown as BuildModel;
it('retains footprint evidence and flags cross-plan candidates without changing shapes or quantities',()=>{
 const before=JSON.stringify(model);
 const out=retainColumnPlanEvidence(model,new Map([['a',witness('floor','floor')],['b',witness('roof','roof')]]));
 expect(out.elements.map(e=>[e.id,e.shape,e.quantity])).toEqual(model.elements.map(e=>[e.id,e.shape,e.quantity]));
 expect(out.elements[0].issues.join(' ')).toContain('possibly the same column line');
 expect(out.elements[0].issues.join(' ')).toContain('base/top elevations');
 expect(out.elements[0].issues).not.toContain('Calibrated floor registration is required.');
 expect(out.elements[0].sources[0].box).toEqual([1,2,3,4]);
 expect(out.elements[0].planFootprint).toEqual({ring:[[3,4],[5,4],[5,6],[3,6]],domain:'floor'});
 expect(JSON.stringify(model)).toBe(before);
});
it('does not pair nearby but distinct columns or different scheduled sections',()=>{
 for(const b of [witness('roof','roof',[4.02,5]),{...witness('roof','roof'),depth:.4}]){
 const out=retainColumnPlanEvidence(model,new Map([['a',witness('floor','floor')],['b',b]]));
 expect(out.elements[0].issues.join(' ')).not.toContain('possibly the same');
 }
});
it('withdraws stale footprint evidence when the source no longer qualifies',()=>{
 const out=retainColumnPlanEvidence(model,new Map([['a',witness('floor','floor')]]));
 const withdrawn=retainColumnPlanEvidence(out,new Map());
 expect(withdrawn.elements[0].sources).toEqual([]);
 expect(withdrawn.elements[0].planFootprint).toBeUndefined();
 expect(withdrawn.elements[0].issues.join(' ')).not.toContain('Registered column footprint:');
 expect(withdrawn.elements[0].quantity).toBe(1);
});
