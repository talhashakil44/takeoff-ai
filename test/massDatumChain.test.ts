import {expect,it} from 'vitest';
import {connectMassDatums, type MassFootprint} from '../src/build/massDatumChain';
import type {BuildElement,SourceRef} from '../src/build/types';
const source:SourceRef={kind:'spec',id:'d',page:21,label:'source'};
const elements=[0,1,2].map((i)=>({id:String(i),origin:'drawing',quantity:0,unit:'',sources:[source],issues:i===1?[]:['Foundation revision applied: direct local datum'],shape:i===1?null:{type:'point',at:[i*2+.5,.5],z:-.65,size:[1,1,.4]},typeName:'MF3'})) as BuildElement[];
const footprints=new Map(elements.map((e,i)=>[e.id,{box:[i*20,0,i*20+10,10],size:[1,1,.4],schedule:source} as MassFootprint]));
const plan:Parameters<typeof connectMassDatums>[2]={docId:'d',page:21,frame:{a:.1,b:0,tx:0,ty:0,residual:0},texts:[],lines:[10,30].flatMap(x=>[4,6].map(y=>({x1:x,y1:y,x2:x+10,y2:y,width:.6,filled:false})))};
const bands=[{a:4,b:6,top:-.25,source}];
const run=(es=elements,p=plan,step=false)=>connectMassDatums(es,footprints,p,bands,()=>step);
it('infers only the bracketed drawing mass using its own thickness and retains accepted quantities',()=>{
 const out=run();expect(out[1].shape).toEqual({type:'point',at:[2.5,.5],z:-.65,size:[1,1,.4],rotation:0});
 expect(out.map(e=>[e.quantity,e.unit])).toEqual(elements.map(e=>[e.quantity,e.unit]));
 expect(out[1].issues.join()).toContain('inferred');expect(run(out)).toEqual(out);
 const accepted=run(elements.map(e=>e.id==='1'?{...e,origin:'takeoff',quantity:2,unit:'ea'}:e))[1];expect(accepted.shape?.type).toBe('point');expect(accepted.quantity).toBe(2);
});
it('requires both agreeing seeds, both edges and no step',()=>{
 expect(run(elements,plan,true)[1].shape).toBeNull();
 expect(run(elements,{...plan,texts:[{str:'S.F.',cx:25,cy:5} ]})[1].shape).toBeNull();
 expect(run(elements,{...plan,lines:plan.lines.slice(1)})[1].shape).toBeNull();
 expect(run(elements.map(e=>e.id==='0'?{...e,shape:null}:e))[1].shape).toBeNull();
 expect(run(elements.map(e=>e.id==='2'?{...e,shape:{...e.shape!,type:'point',at:[4.5,.5],size:[1,1,.4],z:-.8}}:e))[1].shape).toBeNull();
});
it('does not bridge an undrawn junction or change a preexisting accepted solid',()=>{
 const broken={...plan,lines:plan.lines.map((l,i)=>i===0?{...l,x1:l.x1+2}:l)};
 expect(run(elements,broken)[1].shape).toBeNull();
 const known={...elements[1],shape:{type:'point' as const,at:[2.5,.5] as [number,number],z:-2,size:[1,1,.4] as [number,number,number]}};
 expect(run([elements[0],known,elements[2]])[1]).toEqual(known);
});
