import {expect,it} from 'vitest';
import {imperialFeet,imperialDatumEvidence} from '../src/build/datumEvidence';
import type {Project} from '../src/model';
const project={sheets:[{id:'s',title:'BUILDING SECTIONS',name:'A4',page:4}]} as unknown as Project;
const pair=(label:string,value:string,y:number)=>[{str:label,cx:200,cy:y},{str:value,cx:280,cy:y}];
it('applies a negative datum sign to feet, inches and fractional inches',()=>{
 expect(imperialFeet(`-1'-6"`)).toBe(-1.5);
 expect(imperialFeet(`-0'-6 1/2"`)).toBeCloseTo(-6.5/12);
 expect(imperialFeet(`-12′-3 3/4″`)).toBeCloseTo(-12.3125);
 expect(imperialFeet(`12'-3 3/4"`)).toBeCloseTo(12.3125);
});
it('rejects malformed fractions and noncanonical inches rather than emitting invalid elevations',()=>{
 for(const v of [`1'-3 1/0"`,`1'-12"`,`1'-3 4/3"`])expect(imperialFeet(v)).toBeNull();
});
it('preserves signed source elevations when computing relative floor heights',()=>{
 const evidence=imperialDatumEvidence(project,{s:[...pair('T.O. BASEMENT FLOOR',`-1'-6"`,100),...pair('T.O. GROUND FLOOR',`0'-0"`,200),...pair('T.O. ROOF DECK',`10'-0"`,300)]});
 expect(evidence.map(e=>e.elevation)).toEqual([0,1.5*.3048,11.5*.3048]);
});
it('withholds roof-only evidence without a floor datum instead of producing minus infinity',()=>{
 expect(imperialDatumEvidence(project,{s:pair('T.O. ROOF DECK',`10'-0"`,100)})).toEqual([]);
});
