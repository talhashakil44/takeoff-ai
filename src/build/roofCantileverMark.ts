import type {Pt} from '../model';
import type {DrawingTexts} from './building';
export function roofBeamMarkMatches(text:string,code:string):boolean {
 if(!code)return false;
 const escaped=code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp(`^${escaped}(?:\\s+\\(?CANT(?:ILEVER)?\\.?\\)?)?$`,'i').test(text.trim());
}
/** Local annotation distances follow the mark's glyph size, not PDF point units. */
export function hasLocalRoofCantilever(points:Pt[],code:string,texts:DrawingTexts[string]):boolean {
 if(points.length!==2||!code)return false;
 const axis=Math.abs(points[0][1]-points[1][1])<.3?0:Math.abs(points[0][0]-points[1][0])<.3?1:null;
 if(axis===null)return false;
 const cross=1-axis,lo=Math.min(points[0][axis],points[1][axis]),hi=Math.max(points[0][axis],points[1][axis]);
 const cant=/\bCANT(?:ILEVER)?\b/i;
 return texts.some(t=>{
   if(!roofBeamMarkMatches(t.str,code))return false;
   const h=t.h??0,w=t.w??0;
   if(!(h>0&&w>0))return false;
   const along=axis===0?t.cx:t.cy,across=cross===0?t.cx:t.cy;
   if(along<=lo||along>=hi||Math.abs(across-points[0][cross])>3.5*h)return false;
   return cant.test(t.str)||texts.some(c=>/^\(?CANT(?:ILEVER)?\.?\)?$/i.test(c.str.trim())&&
     Math.max(0,Math.abs((axis===0?c.cx:c.cy)-along)-((axis===0?w:h)+(axis===0?(c.w??0):(c.h??0)))/2)<=2*w&&Math.abs((cross===0?c.cx:c.cy)-across)<=3.5*h);
 });
}
