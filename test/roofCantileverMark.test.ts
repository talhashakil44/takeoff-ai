import {it,expect} from 'vitest';
import {hasLocalRoofCantilever} from '../src/build/roofCantileverMark';
it('requires this span beam mark and adjacent cantilever note',()=>{
 const p:any=[[0,50],[250,50]],ts:any=[{str:'B2',cx:150,cy:45,h:10,w:15},{str:'(CANT.)',cx:150,cy:65}];
 expect(hasLocalRoofCantilever(p,'B2',ts)).toBe(true);
 expect(hasLocalRoofCantilever(p,'B3',ts)).toBe(false);
 expect(hasLocalRoofCantilever(p,'B2',ts.slice(0,1))).toBe(false);
 expect(hasLocalRoofCantilever(p,'B2',ts.map((t:any)=>({...t,cy:t.cy+100})))).toBe(false);
 expect(hasLocalRoofCantilever(p,'B2',ts.map((t:any)=>({...t,cx:t.cx+300})))).toBe(false);
 expect(hasLocalRoofCantilever([[0,0],[250,50]],'B2',ts)).toBe(false);
});
it('is invariant to text/drawing scale and supports vertical spans and combined annotations',()=>{
 for(const scale of [.25,1,4])for(const vertical of [false,true]){
  const pt=(x:number,y:number):[number,number]=>vertical?[y*scale,x*scale]:[x*scale,y*scale];
  const points=[pt(0,50),pt(250,50)],at=pt(150,45);
  for(const str of ['X7 (CANT.)','X7 CANTILEVER'])expect(hasLocalRoofCantilever(points,'X7',[{str,cx:at[0],cy:at[1],h:10*scale,w:45*scale}])).toBe(true);
  expect(hasLocalRoofCantilever(points,'X7',[{str:'X7',cx:at[0],cy:at[1]}])).toBe(false);
 }
});
it('uses the gap between text boxes for a long adjacent CANT label',()=>{
 for(const s of [.25,1,4]){
 const p:any=[[0,50*s],[250*s,50*s]],ts:any=[{str:'B2',cx:150*s,cy:45*s,w:9*s,h:5*s},{str:'(CANT.)',cx:173*s,cy:45*s,w:27*s,h:5*s}];
 expect(hasLocalRoofCantilever(p,'B2',ts)).toBe(true);
 expect(hasLocalRoofCantilever(p,'B2',[ts[0],{...ts[1],cx:250*s}])).toBe(false);
 }
});
