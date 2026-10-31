import {expect,it} from 'vitest';
import {planFootprintHit} from '../src/explore/planFootprintHit';
import type {BuildElement} from '../src/build/types';
const a={id:'a',shape:null,planFootprint:{ring:[[1,0],[2,1],[1,2],[0,1]],domain:'canopy'}} as BuildElement;
it('picks the actual rotated envelope, not its bounding box or the room below',()=>{
 expect(planFootprintHit([a],[1,1],null)).toBe('a');
 expect(planFootprintHit([a],[.1,.1],null)).toBeNull();
 expect(planFootprintHit([a],[NaN,1],null)).toBeNull();
 expect(planFootprintHit([],[1,1],null)).toBeNull();
});
it('cycles coincident records without deduplicating quantities or mutating evidence',()=>{
 const b={...a,id:'b'}, elements=[b,a],before=JSON.stringify(elements);
 expect(planFootprintHit(elements,[1,1],null)).toBe('a');
 expect(planFootprintHit(elements,[1,1],'a')).toBe('b');
 expect(planFootprintHit(elements,[1,1],'b')).toBe('a');
 expect(JSON.stringify(elements)).toBe(before);
});
it('ignores physical solids, demolished records and withdrawn envelopes',()=>{
 expect(planFootprintHit([{...a,shape:{type:'point',at:[1,1],size:[1,1,1],z:0}}],[1,1],null)).toBeNull();
 expect(planFootprintHit([{...a,status:'demolished'}],[1,1],null)).toBeNull();
 expect(planFootprintHit([{...a,planFootprint:undefined}],[1,1],null)).toBeNull();
});
