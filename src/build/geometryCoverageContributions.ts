import type {Project} from '../model';
import {contributions,sheetRepeat,type Contribution} from '../quantities';
import type {CoverageContribution} from './geometryCoverage';

/** Quantity provenance is distinct from source-qualified geometric placement.
 * No callback means no placement credit. A qualifier returns a fraction of this
 * contribution, including repeated instances, not a fraction of rendered meshes.
 * Room finishes retain their originating room measurement for qualification. */
export function geometryCoverageContributions(
 project:Project,
 qualify:(contribution:Contribution)=>number=()=>0,
):CoverageContribution[]{
 const toM=project.units==='imperial'?.3048:1;
 return contributions(project).map(c=>{
  const kind=c.type.kind==='linear'?'length':c.type.kind;
  const quantity=kind==='count'?sheetRepeat(c.sheet):!c.vars?0:
   kind==='length'?c.vars.L*toM:c.vars.A*toM*toM;
  const fraction=qualify(c);
  if(!Number.isFinite(fraction)||fraction<0||fraction>1)
   throw Error('Geometry qualification fraction must be between zero and one');
  return {id:JSON.stringify([c.m.id,c.type.id,c.role??'drawn']),name:c.type.name,
   division:c.type.division??'',role:c.role,kind,quantity,qualifiedQuantity:quantity*fraction};
 });
}
