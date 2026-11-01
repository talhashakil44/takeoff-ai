import {expect,it} from 'vitest';
import {gridAxes,matchGridAxes,type DrawingText} from '../src/build/building';
import type {Segment} from '../src/fill/vectors';
const tags:DrawingText[]=[{str:'1',cx:100,cy:20},{str:'2',cx:400,cy:20},{str:'A',cx:20,cy:100},{str:'B',cx:20,cy:400}];
const line=(x1:number,y1:number,x2:number,y2:number):Segment=>({x1,y1,x2,y2,width:.3,color:'#000000'} as Segment);
const strokes=[line(100,30,100,120),line(400,30,400,120),line(30,100,120,100),line(30,400,120,400),line(100,120,100,250),line(400,120,400,250),line(120,100,250,100),line(120,400,250,400)];
it('requires source strokes for two single-ended crossing families',()=>{
 expect(gridAxes(tags,600,600)).toEqual({});
 const a=gridAxes(tags,600,600,undefined,strokes);
 expect(a).toEqual({'1':{axis:'x',at:100},'2':{axis:'x',at:400},A:{axis:'y',at:100},B:{axis:'y',at:400}});
 expect(matchGridAxes(a,.1,a,.1)?.grids).toHaveLength(4);
});
it('rejects a conflicting witness instead of choosing a convenient bubble',()=>{
 const conflict={str:'1',cx:200,cy:20};
 expect(gridAxes([...tags,conflict],600,600,undefined,[...strokes,line(200,30,200,120),line(200,120,200,250)])).toEqual({});
});
it('does not use keynote alignment to complete a stroke-backed frame',()=>{
 const notes=Array.from({length:8},(_,i)=>({str:String(i+1),cx:500,cy:100+i*40}));
 const a=gridAxes([...tags,...notes],600,600,undefined,strokes);
 expect(a['1']).toEqual({axis:'x',at:100});expect(Object.keys(a)).toHaveLength(4);
 const partial=gridAxes([...tags,...notes],600,600,undefined,strokes.filter(l=>l.y1!==400));
 expect(matchGridAxes(partial,.1,a,.1)).toBeNull();
});
it('supports a quarter-turn match without changing established text-only frames',()=>{
 const a=gridAxes(tags,600,600,undefined,strokes);
 const turned=Object.fromEntries(Object.entries(a).map(([k,v])=>[k,{axis:v.axis==='x'?'y' as const:'x' as const,at:v.axis==='x'?v.at:-v.at}]));
 expect(matchGridAxes(a,.1,turned,.1)?.rotation).toBeCloseTo(Math.PI/2);
 const paired=[...tags,{str:'1',cx:100,cy:550},{str:'2',cx:400,cy:550},{str:'A',cx:550,cy:100},{str:'B',cx:550,cy:400}];
 expect(gridAxes(paired,700,700,undefined,strokes)).toEqual(gridAxes(paired,700,700));
});
