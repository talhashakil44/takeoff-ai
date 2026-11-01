import {expect,it} from 'vitest';
import {gridFootingSections,localStripDatum} from '../src/build/localFootingDatum';
import type {DrawingText} from '../src/build/building';
import type {Project} from '../src/model';
import type {BuildElement} from '../src/build/types';
const t=(str:string,cx:number,cy:number,w=100):DrawingText=>({str,cx,cy,w,h:8});
const section=(grid='A',mark='S/F-5',z='-1220')=>[t(`SECTION AT G/L ${grid}`,200,400),t('GROUND FLOOR',250,100),t('0',250,84,10),t('T/O FOOTING',250,300),t(z,250,284,35),t(mark,150,250)];
it('reads explicit local elevations and normalized marks, not project names',()=>{
 expect(gridFootingSections(section())[0]).toMatchObject({grid:'A',mark:'SF5',z:-1.22});
 expect(gridFootingSections(section('6','SF-8','-1,800'))[0]).toMatchObject({grid:'6',mark:'SF8',z:-1.8});
});
it('rejects minimum-cover, nonzero datum origins, ambiguous numbers and low-footing labels',()=>{
 expect(gridFootingSections(section().map(v=>v.str==='T/O FOOTING'?{...v,str:'MIN 1200 FROST COVER'}:v))).toEqual([]);
 expect(gridFootingSections(section().map(v=>v.str==='0'?{...v,str:'100000'}:v))).toEqual([]);
 expect(gridFootingSections([...section(),t('-1500',260,282,35)])).toEqual([]);
 expect(gridFootingSections(section().map(v=>v.str==='T/O FOOTING'?{...v,str:'T/O FOOTING (LOW)'}:v))).toEqual([]);
});
const plan=[t('A',20,100),t('A',550,100),t('B',20,400),t('B',550,400),t('1',100,20),t('1',100,550),t('2',400,20),t('2',400,550)];
const project={units:'metric',measurements:[{id:'m',sheetId:'p',points:[[100,100],[400,100]]}],sheets:[{id:'p',docId:'d',metersPerPoint:.01,width:700,height:700},{id:'s',docId:'d',title:'WALL SECTIONS',name:'S9',page:3}]} as unknown as Project;
const element={measurementId:'m',sheetId:'p',typeName:'S/F-5 – Strip footing'} as BuildElement;
it('joins every segment to an applicable section grid and retains source references',()=>{
 const r=localStripDatum(project,element,.6,{p:plan,s:section()},{});
 expect(r?.z).toBe(-1.22);expect(r?.sources[0]).toMatchObject({id:'s',page:3});
 const bad=structuredClone(project);bad.measurements[0].points.push([400,200]);
 expect(localStripDatum(bad,element,.6,{p:plan,s:section()},{})).toMatchObject({start:0,end:1});
});
it('withholds stepped plans, conflicting sections, other-document sections and unmatched marks',()=>{
 expect(localStripDatum(project,element,.6,{p:[...plan,t('S.F.',200,100)],s:section()},{})).toBeNull();
 const p=structuredClone(project);p.sheets.push({...p.sheets[1],id:'s2'});
 expect(localStripDatum(p,element,.6,{p:plan,s:section(),s2:section('A','SF5','-1800')},{})).toBeNull();
 p.sheets[1].docId='other';p.sheets.pop();
 expect(localStripDatum(p,element,.6,{p:plan,s:section()},{})).toBeNull();
 expect(localStripDatum(project,element,.6,{p:plan,s:section('A','SF9')},{})).toBeNull();
});

it('does not assign a datum to duplicate mark locations inside one section',()=>{expect(gridFootingSections([...section(),t('S/F-5',180,260)])).toEqual([]);});
it('rejects disjoint supported spans instead of silently choosing one fragment',()=>{
 const p=structuredClone(project);p.measurements[0].points=[[100,100],[400,100],[400,200],[100,200],[100,100],[200,100]];
 expect(localStripDatum(p,element,.6,{p:plan,s:section()},{})).toBeNull();
});

it('does not borrow an upper detail datum for a staggered lower section title',()=>{
 // Old midpoint partition assigned all upper evidence to the lower title B.
 const upper=section().map(v=>v.str.startsWith('SECTION')?{...v,cx:500}:v);
 expect(gridFootingSections([...upper,t('SECTION AT G/L B',200,800)])).toEqual([]);
 // Slight title baseline variation within one row remains supported.
 const beside=section('B','SF8','-1800').map(v=>({...v,cx:v.cx+600,cy:v.cy+4}));
 expect(gridFootingSections([...section(),...beside]).map(v=>[v.grid,v.z])).toEqual([['A',-1.22],['B',-1.8]]);
});
