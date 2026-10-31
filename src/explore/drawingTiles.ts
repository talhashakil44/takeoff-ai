import type { Pt } from '../model';
import type { SourceBox } from './sourceRegion';

/** Clip a convex, registered drawing polygon in PDF coordinates. */
function clip(points: Pt[], box: SourceBox): Pt[] {
  let out=points;
  for(const [axis,edge,sign] of [[0,box[0],1],[0,box[2],-1],[1,box[1],1],[1,box[3],-1]]) {
    const input=out;out=[];
    for(let i=0;i<input.length;i++) {
      const a=input[i],b=input[(i+1)%input.length];
      const ina=(a[axis]-edge)*sign>=0,inb=(b[axis]-edge)*sign>=0;
      if(ina)out.push(a);
      if(ina!==inb) { const t=(edge-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]); }
    }
  }
  return out;
}

/** Non-overlapping pieces replace low-resolution ink inside the detail region;
 * drawing the two textures on top of one another would double-darken the ink. */
export function drawingTiles(points: Pt[], width: number, height: number, detail: SourceBox) {
  if(![width,height,...detail,...points.flat()].every(Number.isFinite)||width<=0||height<=0||
    detail[0]<0||detail[1]<0||detail[2]>width||detail[3]>height||detail[2]<=detail[0]||detail[3]<=detail[1])return [];
  const [x0,y0,x1,y1]=detail;
  const boxes:SourceBox[]=[[0,0,width,y0],[0,y1,width,height],[0,y0,x0,y1],[x1,y0,width,y1],detail];
  return boxes.flatMap((box,i)=>{
    if(box[2]<=box[0]||box[3]<=box[1])return [];
    const polygon=clip(points,box);
    if(polygon.length<3)return [];
    const area=Math.abs(polygon.reduce((s,p,j)=>{const q=polygon[(j+1)%polygon.length];return s+p[0]*q[1]-p[1]*q[0];},0))/2;
    return area>1e-8?[{points:polygon,detail:i===4,uvBox:i===4?detail:[0,0,width,height] as SourceBox}]:[];
  });
}
