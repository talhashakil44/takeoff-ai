import type { Pt, Sheet } from '../model';
import type { BuildElement } from '../build/types';
import { sheetPoint, type SheetFrame } from './spatial';

/** A dependency's datum evidence may be smaller than the member's own footprint.
 * Only select source regions containing the currently focused member centre. */
export function focusedTileBox(element: BuildElement, focus: Pt, frame: SheetFrame, source: Sheet) {
  const sh=element.shape;
  const centre=sh?.type==='point'?sh.at:sh?.type==='run'&&sh.points.length?
    [(sh.points[0][0]+sh.points.at(-1)![0])/2,(sh.points[0][1]+sh.points.at(-1)![1])/2] as Pt:null;
  if(!centre||Math.hypot(centre[0]-focus[0],centre[1]-focus[1])>.001)return null;
  const p=sheetPoint(centre,frame);
  const refs=element.sources.filter(s=>s.box &&
    (s.kind==='spec'?s.id===source.docId&&s.page===source.page:s.kind==='sheet'&&s.id===source.id) &&
    p[0]>=s.box[0]&&p[0]<=s.box[2]&&p[1]>=s.box[1]&&p[1]<=s.box[3] &&
    s.box[2]>s.box[0]&&s.box[3]>s.box[1]);
  return refs.sort((a,b)=>((a.box![2]-a.box![0])*(a.box![3]-a.box![1]))-((b.box![2]-b.box![0])*(b.box![3]-b.box![1])))[0]?.box ?? null;
}
