import type {Pt} from '../model';
import type {DrawingTexts} from './building';
/** Qualify only an axis-aligned measured span's own beam/CANT annotation. */
export function hasLocalRoofCantilever(points:Pt[],code:string,texts:DrawingTexts[string]):boolean {
 if(points.length!==2||!/^B\d+$/.test(code))return false;
 const axis=Math.abs(points[0][1]-points[1][1])<.3?0:Math.abs(points[0][0]-points[1][0])<.3?1:null;
 if(axis===null)return false;
 const cross=1-axis,lo=Math.min(points[0][axis],points[1][axis]),hi=Math.max(points[0][axis],points[1][axis]);
 return texts.some(t=>t.str.trim()===code&&(axis===0?t.cx:t.cy)>lo&&(axis===0?t.cx:t.cy)<hi&&Math.abs((cross===0?t.cx:t.cy)-points[0][cross])<30&&texts.some(c=>/^\(?CANT\.?\)?$/i.test(c.str.trim())&&Math.abs(t.cx-c.cx)<30&&Math.abs(t.cy-c.cy)<30));
}
