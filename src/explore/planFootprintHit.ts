import type { BuildElement } from '../build/types';
import type { Pt } from '../model';
import { inside } from './spatial';
/** Caller supplies visible plan-only records. Coincident records remain separate:
 * repeated clicks cycle stable IDs rather than silently reconciling counts. */
export function planFootprintHit(elements: BuildElement[], point: Pt, selected: string | null): string | null {
  if(!point.every(Number.isFinite))return null;
  const ids=[...new Set(elements.filter(e=>{
    if(e.status==='demolished'||(e.shape&&e.shape.type!=='locator'))return false;
    const trace=e.planTrace?.points;
    if(trace&&trace.length>=2&&trace.every(p=>p.every(Number.isFinite)))return trace.slice(1).some((b,i)=>{
      const a=trace[i],dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;if(!d)return false;
      const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/d));
      return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)<=.08;
    });
    const ring=e.planFootprint?.ring;
    return ring && ring.length>=3 &&
      ring.every(p=>p.every(Number.isFinite)) && inside(point,ring);
  }).map(e=>e.id))].sort();
  if(!ids.length)return null;
  const index=selected ? ids.indexOf(selected) : -1;
  return ids[(index+1)%ids.length];
}
