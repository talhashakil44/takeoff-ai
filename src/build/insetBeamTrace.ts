import type {Pt} from '../model';
import type {Segment} from '../fill/vectors';
import type {DrawingText} from './building';
/** A plan-only candidate, never a beam section or bearing cut. Tags may be on
 * either side of the drawn line. Search distances follow text size; equally
 * plausible nearby ink withdraws the association instead of selecting a wall. */
export function taggedBeamTrace(tag:DrawingText,lines:Segment[]):[Pt,Pt]|null{
 if(!tag.h||tag.h<=0)return null;
 const vertical=Math.abs(Math.sin(tag.angle??0))>.7;
 const along=(x:number,y:number)=>vertical?y:x,cross=(x:number,y:number)=>vertical?x:y;
 const at=along(tag.cx,tag.cy),off=cross(tag.cx,tag.cy);
 const candidates=lines.filter(l=>!l.filled&&!l.curve&&l.width>=.6&&/^#(?:000000|191919)$/i.test(l.color??'')&&Math.abs(cross(l.x1,l.y1)-cross(l.x2,l.y2))<.1)
 .map(l=>({off:cross(l.x1,l.y1),lo:Math.min(along(l.x1,l.y1),along(l.x2,l.y2)),hi:Math.max(along(l.x1,l.y1),along(l.x2,l.y2))}))
 .filter(l=>l.lo<=at&&at<=l.hi&&l.hi-l.lo>=6*tag.h!&&Math.abs(l.off-off)<=3*tag.h!);
 const unique=[...new Map(candidates.map(c=>[JSON.stringify(c),c])).values()].sort((a,b)=>Math.abs(a.off-off)-Math.abs(b.off-off));
 const best=unique[0];if(!best)return null;
 if(unique.slice(1).some(c=>Math.abs(c.off-off)-Math.abs(best.off-off)<tag.h!/2&&(Math.abs(c.off-best.off)>.1||Math.abs(c.lo-best.lo)>.1||Math.abs(c.hi-best.hi)>.1)))return null;
 return vertical?[[best.off,best.lo],[best.off,best.hi]]:[[best.lo,best.off],[best.hi,best.off]];
}
