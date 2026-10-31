import {it,expect} from 'vitest';
import {hasLocalRoofCantilever} from '../src/build/roofCantileverMark';
it('requires this span beam mark and adjacent cantilever note',()=>{
 const p:any=[[0,50],[250,50]],ts:any=[{str:'B2',cx:150,cy:45},{str:'(CANT.)',cx:150,cy:65}];
 expect(hasLocalRoofCantilever(p,'B2',ts)).toBe(true);
 expect(hasLocalRoofCantilever(p,'B3',ts)).toBe(false);
 expect(hasLocalRoofCantilever(p,'B2',ts.slice(0,1))).toBe(false);
 expect(hasLocalRoofCantilever(p,'B2',ts.map((t:any)=>({...t,cy:t.cy+100})))).toBe(false);
 expect(hasLocalRoofCantilever(p,'B2',ts.map((t:any)=>({...t,cx:t.cx+300})))).toBe(false);
 expect(hasLocalRoofCantilever([[0,0],[250,50]],'B2',ts)).toBe(false);
});
