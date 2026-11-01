import {it,expect} from 'vitest';
import {gridLocationFailure,nearestGridIntersection} from '../src/build/gridCounts';
it('distinguishes scale, registration and incomplete registered grid families',()=>{
 const axes={A:{axis:'x' as const,at:0},'1':{axis:'y' as const,at:0}};
 expect(gridLocationFailure(axes,undefined,[0,0],0)).toContain('scale is unavailable');
 expect(gridLocationFailure(axes,undefined,[0,0],.01)).toContain('no verified grid registration');
 expect(gridLocationFailure(axes,['A'],[0,0],.01)).toContain('both intersecting axis families');
});
it('reports distance while the existing snap gate still withholds the tag',()=>{
 const axes={A:{axis:'x' as const,at:0},'1':{axis:'y' as const,at:0}};
 expect(nearestGridIntersection(axes,['A','1'],[300,400],.01)).toBeNull();
 expect(gridLocationFailure(axes,['A','1'],[300,400],.01)).toContain('A/1 is 5.00 m away');
});
