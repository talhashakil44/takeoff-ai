import {expect,it} from 'vitest';
import {drawingTiles} from '../src/explore/drawingTiles';
import type {Pt} from '../src/model';
const area=(ps:Pt[])=>Math.abs(ps.reduce((a,p,i)=>{const q=ps[(i+1)%ps.length];return a+p[0]*q[1]-p[1]*q[0];},0))/2;
it('partitions a rotated drawing viewport without overlapping or missing ink',()=>{
 const polygon:Pt[]=[[50,10],[90,50],[50,90],[10,50]];
 const tiles=drawingTiles(polygon,100,100,[30,30,70,70]);
 expect(tiles.reduce((s,t)=>s+area(t.points),0)).toBeCloseTo(area(polygon),8);
 expect(tiles.filter(t=>t.detail)).toHaveLength(1);
 expect(area(tiles.find(t=>t.detail)!.points)).toBe(1600);
 expect(tiles.find(t=>t.detail)!.uvBox).toEqual([30,30,70,70]);
 for(const t of tiles.filter(t=>!t.detail))expect(t.points.every(p=>p[0]<=30||p[0]>=70||p[1]<=30||p[1]>=70)).toBe(true);
});
it('clips page-edge detail and viewport overhang to the actual sheet',()=>{
 const tiles=drawingTiles([[-20,-20],[120,-20],[120,120],[-20,120]],100,100,[0,0,50,50]);
 expect(tiles.reduce((s,t)=>s+area(t.points),0)).toBe(10000);
 expect(tiles).toHaveLength(3);
 expect(area(tiles.find(t=>t.detail)!.points)).toBe(2500);
 expect(tiles.flatMap(t=>t.points).every(p=>p.every(v=>v>=0&&v<=100))).toBe(true);
});
it('rejects invalid source bounds rather than guessing crop registration',()=>{
 const p:Pt[]=[[0,0],[100,0],[100,100],[0,100]];
 for(const box of [[1,1,1,10],[-1,0,10,10],[0,0,101,100],[0,NaN,20,20]] as [number,number,number,number][])
  expect(drawingTiles(p,100,100,box)).toEqual([]);
});
