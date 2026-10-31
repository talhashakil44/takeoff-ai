import { expect, it } from 'vitest';
import { explainFoundationSteps } from '../src/build/foundationStepEvidence';
import type { BuildModel } from '../src/build/types';
it('links held strip axes to step evidence without changing quantities or promoting them to solids', () => {
 const e = { id:'axis', measurementSource:'foundations', sheetId:'s', typeName:'SF-2', quantity:11.65, unit:'m', issues:[], sources:[], shape:{type:'axis',points:[[0,0],[0,12]],z:-1.2} };
 const model = {elements:[e]} as unknown as BuildModel;
 const plan = {docId:'d',page:21,sheetId:'s',frame:{a:1,b:0,tx:0,ty:0,residual:0}};
 const texts = {'spec:d:23':[{str:'DETAIL - STEPPED FOOTING',cx:100,cy:500}]};
 const run=(m=model,has=true)=>explainFoundationSteps(m,plan,[.9],()=>has,texts,[{docId:'d',page:23}]);
 const out=run();
 expect(out.elements[0].shape).toEqual(e.shape);
 expect(out.elements[0].quantity).toBe(11.65);
 expect(out.elements[0].sources).toHaveLength(2);
 expect(out.elements[0].issues.join()).toContain('maximum rise is not an actual rise');
 expect(run(out)).toEqual(out);
 expect(run(out,false)).toEqual(model);
 const solid={...model,elements:[{...model.elements[0],shape:{type:'run' as const,points:[[0,0],[0,12]] as [number,number][],z0:-1.2,height:.3,thickness:.9}}]};
 expect(run(solid)).toEqual(solid);
});
