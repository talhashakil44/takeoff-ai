import { expect, it } from 'vitest';
import { explainFoundationRevisionLabels } from '../src/build/foundationRevisionLabels';
import type { BuildModel } from '../src/build/types';
const model = { elements: [{ id:'wall', measurementSource:'foundations', sheetId:'s', typeName:'FW-5', quantity:5.78, unit:'m', issues:['Foundation revision unresolved: local datum missing.'], sources:[], shape:{type:'axis',points:[[100,0],[100,200]],z:-1.2} }] } as unknown as BuildModel;
const plan = {docId:'d',page:21,sheetId:'s',frame:{a:.04,b:0,tx:0,ty:0,residual:0},texts:[{str:'FW-1',cx:2446,cy:100,w:20,h:6}],lines:[{x1:2464,y1:100,x2:2500,y2:100,width:.8,filled:false},{x1:2491,y1:100,x2:2509,y2:100,width:2.2,filled:false}]};
it('reports a revised leader type conflict without changing accepted geometry or quantities',()=>{
 const out=explainFoundationRevisionLabels(model,plan);
 expect(out.elements[0].issues.join()).toContain('type conflict');
 expect(out.elements[0].shape).toEqual(model.elements[0].shape);
 expect(out.elements[0].quantity).toBe(5.78);
 expect(out.elements[0].typeName).toBe('FW-5');
 expect(out.elements[0].sources).toHaveLength(1);
 expect(explainFoundationRevisionLabels(out,plan)).toEqual(out);
 expect(explainFoundationRevisionLabels(out,{...plan,lines:[]})).toEqual(model);
});
it('does not attach remote, ambiguous or untargeted labels',()=>{
 expect(explainFoundationRevisionLabels(model,{...plan,lines:plan.lines.slice(0,1)})).toEqual(model);
 expect(explainFoundationRevisionLabels(model,{...plan,texts:[...plan.texts,{...plan.texts[0],str:'FW-2'}]})).toEqual(model);
 expect(explainFoundationRevisionLabels(model,{...plan,texts:[{...plan.texts[0],cy:130}]})).toEqual(model);
});
it('matching type is source context, not a resolved shape or conflict',()=>{
 const out=explainFoundationRevisionLabels(model,{...plan,texts:[{...plan.texts[0],str:'FW-5'}]});
 expect(out.elements[0].issues).toEqual(model.elements[0].issues);
 expect(out.elements[0].sources[0].quote).toContain('does not validate old extents');
});
