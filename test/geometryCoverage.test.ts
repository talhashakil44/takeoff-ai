import {expect,it} from 'vitest';
import {geometryCoverage,summarizeGeometryCoverage,type CoverageContribution} from '../src/build/geometryCoverage';
const c=(id:string,quantity:number,qualifiedQuantity:number):CoverageContribution=>({id,name:'W-1 – Wall',kind:'length',division:'09',quantity,qualifiedQuantity});
it('scores partial quantities, not existence of one placed record, and caps each contribution',()=>{
 const input=[c('a',10,100),c('b',30,0)];const before=JSON.stringify(input);
 expect(geometryCoverage([{code:'W1',kind:'length'}],input)[0]).toMatchObject({engineQuantity:40,qualifiedQuantity:10,coverage:.25});
 expect(JSON.stringify(input)).toBe(before);
});
it('matches finish contributions by role/division and never mixes units',()=>{
 const input=[{...c('a',50,25),name:'Gypsum ceiling',role:'ceiling',kind:'area' as const},
 {...c('b',100,100),name:'Gypsum ceiling',role:'walls',kind:'area' as const},
 {...c('c',50,50),name:'Gypsum ceiling',role:'ceiling'}];
 expect(geometryCoverage([{code:'ceiling',kind:'area',match:'gypsum',role:'ceiling',division:'^09$'}],input)[0]).toMatchObject({engineQuantity:50,coverage:.5});
});
it('keeps zero-engine keys as uncovered; excludes totals and no-key projects from macro',()=>{
 const a=geometryCoverage([{code:'W1',kind:'length'},{code:'W2',kind:'length'}, {code:'all',kind:'length',match:'Wall',cat:'walls-total'}],[c('a',10,10)]);
 const b=geometryCoverage([{code:'W1',kind:'length'}],[c('b',10,10)]);
 expect(a[1]).toMatchObject({coverage:0,missingEngineQuantity:true});
 expect(summarizeGeometryCoverage([a,b,[]])).toEqual({projects:2,items:3,macro:.75,pooled:2/3});
 expect(summarizeGeometryCoverage([]).macro).toBeNull();
});
it('rejects duplicate fragments and invalid quantities instead of inflating coverage',()=>{
 expect(()=>geometryCoverage([],[c('a',1,1),c('a',1,1)])).toThrow('Duplicate');
 for(const n of [NaN,Infinity,-1])expect(()=>geometryCoverage([],[c('a',n,0)])).toThrow('finite');
});
