import { expect, it } from 'vitest';
import { sourceRegion } from '../src/explore/sourceRegion';
it('keeps a narrow source panel and nearby context within original page bounds', () => {
 const r = sourceRegion([2036.52,826.56,2049.48,899.88],2592,1728)!;
 expect(r.left).toBeCloseTo(2006.52); expect(r.top).toBeCloseTo(796.56);
 expect(r.width).toBeCloseTo(72.96); expect(r.height).toBeCloseTo(133.32);
 expect(r.scale).toBe(4);
});
it('bounds raster size and rejects invalid or unrelated page regions', () => {
 expect(sourceRegion([0,0,5000,4000],5000,4000)!.scale).toBe(.36);
 expect(sourceRegion([6000,0,7000,10],5000,4000)).toBeNull();
 expect(sourceRegion([3,0,2,10],5000,4000)).toBeNull();
 expect(sourceRegion([0,0,NaN,10],5000,4000)).toBeNull();
});
it('clamps padded detail bounds before passing them to the registered scene', () => {
 const r=sourceRegion([-5,70,110,105],100,100)!;
 expect([r.left,r.top,r.left+r.width,r.top+r.height]).toEqual([0,40,100,100]);
 expect(Math.ceil(r.width*r.scale)).toBeLessThanOrEqual(1800);
 expect(Math.ceil(r.height*r.scale)).toBeLessThanOrEqual(1800);
});
it('renders count points and axis lines with context without inventing measurement extents',()=>{
 const point:[number,number,number,number]=[290,1323,290,1323];
 expect(sourceRegion(point,2592,1728)).toEqual({left:260,top:1293,width:60,height:60,scale:4});
 expect(point).toEqual([290,1323,290,1323]);
 expect(sourceRegion([20,20,20,80],100,100)).toEqual({left:0,top:0,width:50,height:100,scale:4});
 expect(sourceRegion([0,0,0,0],100,100)).toEqual({left:0,top:0,width:30,height:30,scale:4});
 expect(sourceRegion([101,20,101,20],100,100)).toBeNull();
 expect(sourceRegion([-1,20,-1,20],100,100)).toBeNull();
});
