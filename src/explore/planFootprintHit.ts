import type { BuildElement } from '../build/types';
import type { Pt } from '../model';
import { inside } from './spatial';
/** Caller supplies visible plan-only records. Coincident records remain separate:
 * repeated clicks cycle stable IDs rather than silently reconciling counts. */
export function planFootprintHit(elements: BuildElement[], point: Pt, selected: string | null): string | null {
  if(!point.every(Number.isFinite))return null;
  const ids=[...new Set(elements.filter(e=>{
    const ring=e.planFootprint?.ring;
    return e.status!=='demolished' && (!e.shape || e.shape.type==='locator') && ring && ring.length>=3 &&
      ring.every(p=>p.every(Number.isFinite)) && inside(point,ring);
  }).map(e=>e.id))].sort();
  if(!ids.length)return null;
  const index=selected ? ids.indexOf(selected) : -1;
  return ids[(index+1)%ids.length];
}
