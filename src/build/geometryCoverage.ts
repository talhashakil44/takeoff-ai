/** Arithmetic for development-corpus evaluation, not a geometry qualifier.
 * Callers must independently qualify each contribution against source evidence.
 * Never infer qualification from the presence of a rendered shape. */
export interface CoverageKey {
 code:string; kind:'count'|'length'|'area'; cat?:string;
 match?:string; division?:string; role?:string;
}
export interface CoverageContribution {
 /** Unique contribution identity (measurement + type + role), not mesh ID. */
 id:string; name:string; kind:CoverageKey['kind']; division:string; role?:string;
 quantity:number; qualifiedQuantity:number;
}
const codeOf=(name:string)=>name.split(/\s+[–-]\s+/)[0].trim().toUpperCase().replace(/[\s/.-]/g,'');
export function geometryCoverage(keys:CoverageKey[],contributions:CoverageContribution[]){
 const seen=new Set<string>();
 for(const c of contributions){
  if(seen.has(c.id))throw Error('Duplicate coverage contribution');
  seen.add(c.id);
  if(!Number.isFinite(c.quantity)||c.quantity<0||!Number.isFinite(c.qualifiedQuantity)||c.qualifiedQuantity<0)
   throw Error('Coverage quantities must be finite and nonnegative');
 }
 return keys.map(k=>{
  const matches=contributions.filter(c=>c.kind===k.kind&&(k.match
   ?new RegExp(k.match,'i').test(c.name)&&(k.division===undefined||new RegExp(k.division).test(c.division))&&(k.role===undefined||(c.role??'drawn')===k.role)
   :(/slab on grade/i.test(c.name)?'SLAB':codeOf(c.name))===k.code.toUpperCase().replace(/[\s/.-]/g,'')));
  const engineQuantity=matches.reduce((s,c)=>s+c.quantity,0);
  // Cap each contribution: an overqualified fragment cannot cover another record.
  const qualifiedQuantity=matches.reduce((s,c)=>s+Math.min(c.quantity,c.qualifiedQuantity),0);
  return {...k,engineQuantity,qualifiedQuantity,coverage:engineQuantity>0?Math.min(1,qualifiedQuantity/engineQuantity):0,
   missingEngineQuantity:engineQuantity===0,diagnosticOnly:k.cat==='walls-total'};
 });
}
/** Equal weight per keyed project; no-key projects are not scored.
 * Pooled coverage is a mean of dimensionless key fractions, not mixed quantities. */
export function summarizeGeometryCoverage(projects:ReturnType<typeof geometryCoverage>[]){
 const scored=projects.map(p=>p.filter(k=>!k.diagnosticOnly)).filter(p=>p.length);
 const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 return {projects:scored.length,items:scored.reduce((n,p)=>n+p.length,0),
  macro:mean(scored.map(p=>mean(p.map(k=>k.coverage))!)),pooled:mean(scored.flatMap(p=>p.map(k=>k.coverage)))};
}
