import {expect,it} from 'vitest';
import type {Project,Sheet,TakeoffType} from '../src/model';
import {geometryCoverageContributions} from '../src/build/geometryCoverageContributions';
import {geometryCoverage} from '../src/build/geometryCoverage';
const type=(id:string,kind:TakeoffType['kind']):TakeoffType=>({id,name:id,kind,color:'#000',height:3,items:[]});
function fixture(units:Project['units']='metric'):Project{
 return {version:1,name:'synthetic',units,docs:[],
 sheets:[{id:'s',docId:'d',page:1,name:'plan',width:100,height:100,metersPerPoint:1,scaleLabel:null,scaleSource:null,scaleHints:[],repeat:3} as Sheet],
 types:[type('W1','linear'),type('room','area'),type('ceiling','area'),type('door','count')],
 measurements:[{id:'line',sheetId:'s',typeId:'W1',points:[[0,0],[10,0]],holes:[]},
 {id:'room',sheetId:'s',typeId:'room',points:[[0,0],[10,0],[10,5],[0,5]],holes:[],finishes:{ceiling:'ceiling'}},
 {id:'door',sheetId:'s',typeId:'door',points:[[1,1]],holes:[]}]};
}
it('uses repeated engine quantities once and defaults every placement to unqualified',()=>{
 const p=fixture(),before=JSON.stringify(p),cs=geometryCoverageContributions(p);
 expect(cs.map(c=>c.quantity)).toEqual([30,150,150,3]);
 expect(cs.every(c=>c.qualifiedQuantity===0)).toBe(true);
 expect(new Set(cs.map(c=>c.id)).size).toBe(4);
 expect(JSON.stringify(p)).toBe(before);
});
it('qualifies finishes through the originating room, without qualifying its other roles',()=>{
 const cs=geometryCoverageContributions(fixture(),c=>c.m.id==='room'&&c.role==='ceiling'?1/3:0);
 const row=geometryCoverage([{code:'ceiling',kind:'area',match:'ceiling',role:'ceiling'}],cs)[0];
 expect(row).toMatchObject({engineQuantity:150,qualifiedQuantity:50,coverage:1/3});
 expect(cs.find(c=>c.name==='room')?.qualifiedQuantity).toBe(0);
});
it('converts imperial contributions to metres and square metres without rescaling counts',()=>{
 const cs=geometryCoverageContributions(fixture('imperial'));
 expect(cs[0].quantity).toBeCloseTo(30);
 expect(cs[1].quantity).toBeCloseTo(150);
 expect(cs[2].quantity).toBeCloseTo(150);
 expect(cs[3].quantity).toBe(3);
});
it('keeps unscaled contributions uncovered and rejects invalid qualification',()=>{
 const p=fixture();p.sheets[0].metersPerPoint=null;
 expect(geometryCoverageContributions(p).slice(0,3).map(c=>c.quantity)).toEqual([0,0,0]);
 for(const n of [NaN,Infinity,-.1,1.1])expect(()=>geometryCoverageContributions(p,()=>n)).toThrow('fraction');
});
