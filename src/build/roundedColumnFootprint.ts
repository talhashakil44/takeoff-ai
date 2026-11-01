import type { Pt } from '../model';
import type { DrawingLines } from './roof';
/** Rounded HSS plan symbols retain their actual closed stroke loop. No bounding
 * box of disconnected ink, white knockout, or missing corner is a footprint. */
export function roundedColumnFootprint(lines: DrawingLines[string], at: Pt, scale:number, width:number, depth:number, wall?:number): {at:Pt;width:number;depth:number;box:[number,number,number,number]} | null {
  if(![...at,scale,width,depth].every(Number.isFinite)||scale<=0||width<=0||depth<=0)return null;
  const nodes=new Map<string,{p:Pt; neighbours:Set<string>}>();
  const key=(p:Pt)=>p.map(v=>v.toFixed(2)).join(',');
  for(const l of lines){
    if(l.filled||l.curve||l.dashed||l.color!=='#000000')continue;
    const a:Pt=[l.x1,l.y1],b:Pt=[l.x2,l.y2];
    if(![...a,...b].every(Number.isFinite)||Math.max(Math.hypot(a[0]-at[0],a[1]-at[1]),Math.hypot(b[0]-at[0],b[1]-at[1]))>40)continue;
    const ka=key(a),kb=key(b);if(ka===kb)continue;
    for(const [k,p] of [[ka,a],[kb,b]] as [string,Pt][])if(!nodes.has(k))nodes.set(k,{p,neighbours:new Set()});
    nodes.get(ka)!.neighbours.add(kb);nodes.get(kb)!.neighbours.add(ka);
  }
  const seen=new Set<string>(),candidates:{at:Pt;width:number;depth:number;box:[number,number,number,number]}[]=[];
  for(const first of nodes.keys()){
    if(seen.has(first))continue;
    const component:string[]=[],queue=[first];seen.add(first);
    while(queue.length){const k=queue.pop()!;component.push(k);for(const n of nodes.get(k)!.neighbours)if(!seen.has(n)){seen.add(n);queue.push(n);}}
    if(component.length<8||component.length>32||component.some(k=>nodes.get(k)!.neighbours.size!==2))continue;
    const ring:Pt[]=[];let previous='',current=first;
    do {ring.push(nodes.get(current)!.p);const next=[...nodes.get(current)!.neighbours].find(n=>n!==previous)!;previous=current;current=next;}while(current!==first&&ring.length<=component.length);
    if(current!==first||ring.length!==component.length)continue;
    const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),w=x1-x0,h=y1-y0;
    const dims=[[width,depth],[depth,width]].find(([a,b])=>Math.abs(w*scale-a)<=.008&&Math.abs(h*scale-b)<=.008);
    if(!dims)continue;
    const cross=ring.map((a,i)=>{const b=ring[(i+1)%ring.length],c=ring[(i+2)%ring.length];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);}).filter(v=>Math.abs(v)>1e-6);
    if(!cross.length||cross.some(v=>Math.sign(v)!==Math.sign(cross[0])))continue;
    // Four real straight faces occupy at least half each side; transitions stay
    // in the corner quarters. Reject circles, diamonds and unrelated polygons.
    const edges=ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
    if(![y0,y1].every(y=>edges.some(([a,b])=>Math.abs(a[1]-y)<.02&&Math.abs(b[1]-y)<.02&&Math.abs(a[0]-b[0])>=w*.5))||
       ![x0,x1].every(x=>edges.some(([a,b])=>Math.abs(a[0]-x)<.02&&Math.abs(b[0]-x)<.02&&Math.abs(a[1]-b[1])>=h*.5)))continue;
    if(ring.some(p=>Math.min(p[0]-x0,x1-p[0])>.02&&Math.min(p[1]-y0,y1-p[1])>.02&&
      (Math.min(p[0]-x0,x1-p[0])>w*.25||Math.min(p[1]-y0,y1-p[1])>h*.25)))continue;
    candidates.push({at:[(x0+x1)/2,(y0+y1)/2],width:dims[0],depth:dims[1],box:[x0,y0,x1,y1]});
  }
  const outer=candidates.length===1?candidates[0]:null;
  if(!outer || wall===undefined)return outer;
  if(!(wall>0 && wall*2<Math.min(width,depth)))return null;
  const inner=roundedColumnFootprint(lines,at,scale,width-2*wall,depth-2*wall);
  return inner && Math.hypot(inner.at[0]-outer.at[0],inner.at[1]-outer.at[1])*scale<=.002 &&
    inner.box[0]>outer.box[0] && inner.box[1]>outer.box[1] && inner.box[2]<outer.box[2] && inner.box[3]<outer.box[3] ? outer : null;
}
