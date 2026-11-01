import {it,expect} from 'vitest';
import {traceGridStroke} from '../src/build/gridStroke';
import type {Segment} from '../src/fill/vectors';
it('keeps tracing invariant under reversed endpoints, noise and duplicates; rejects branches',()=>{
 let state=1729;const rand=()=>((state=(state*1664525+1013904223)>>>0)/4294967296);
 for(let sample=0;sample<120;sample++){
  const lines:Segment[]=Array.from({length:500},()=>({x1:rand()*800,y1:rand()*800,x2:rand()*800,y2:rand()*800,width:rand(),filled:rand()<.1,curve:rand()<.1} as Segment));
  const tag={str:'A',cx:100,cy:100};
  lines.push(...[{x1:100,y1:112,x2:100,y2:140},{x1:100,y1:140,x2:110,y2:155},{x1:110,y1:155,x2:110,y2:300}].map(l=>({...l,width:.3} as Segment)));
  if(sample%3===0)lines.push({x1:100,y1:140,x2:90,y2:160,width:.3} as Segment);
  if(sample%4===0)lines.push({...lines[500]});
  if(sample%2===0)for(const l of lines){[l.x1,l.x2]=[l.x2,l.x1];[l.y1,l.y2]=[l.y2,l.y1];}
  for(const axis of ['x','y'] as const)for(const direction of [-1,1] as const)
   expect(traceGridStroke(tag,lines,axis,direction)).toBe(axis==='x' && direction===1 && sample%3!==0 ? 110 : null);
 }
});
