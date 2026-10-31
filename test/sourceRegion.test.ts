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
