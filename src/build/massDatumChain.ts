import type { DrawingText } from './building';
import type { DrawingLines } from './roof';
import { worldPoint, type SheetFrame } from './sheetCoordinates';
import type { BuildElement, SourceRef } from './types';

export interface MassFootprint {
  box: [number, number, number, number];
  size: [number, number, number];
  schedule: SourceRef;
}

/** Conservative horizontal-row inference: a missing mass datum must be bracketed
 * by agreeing resolved masses, with both scheduled strip edges drawn throughout.
 * This never infers a wall profile or changes an accepted quantity. */
export function connectMassDatums(elements: BuildElement[], footprints: Map<string, MassFootprint>,
  plan: { docId: string; page: number; frame: SheetFrame; texts: DrawingText[]; lines: DrawingLines[string] },
  bands: { a: number; b: number; top: number; source: SourceRef }[],
  stepped: (a: number, b: number, lo: number, hi: number) => boolean,
): BuildElement[] {
  const pens = plan.lines.filter(l => !l.filled && !l.curve && (!l.color || l.color === '#000000') && l.width >= .5);
  const covered = (y: number, lo: number, hi: number) => {
    const spans = pens.filter(l => Math.abs(l.y1-y)<.1 && Math.abs(l.y2-y)<.1)
      .map(l => [Math.max(lo, Math.min(l.x1,l.x2)), Math.min(hi, Math.max(l.x1,l.x2))])
      .filter(([a,b])=>b-a>.1).sort((a,b)=>a[0]-b[0]);
    if (!spans.length || spans[0][0]>lo+.3 || Math.max(...spans.map(s=>s[1]))<hi-.3) return false;
    const lengths=spans.map(s=>s[1]-s[0]).sort((a,b)=>a-b);
    // Ordinary dashed strokes only; never bridge a missing junction/return.
    const gap=Math.min(6,lengths[Math.floor(lengths.length/2)]*.6);
    let end=lo;
    for(const [a,b] of spans) { if(a>end+gap)return false;end=Math.max(end,b); }
    return end>=hi-.3;
  };
  const results=new Map<string, { top: number; sources: SourceRef[] }[]>();
  for(const band of bands) {
    const row=elements.filter(e=>footprints.has(e.id)).filter(e=>{
      const r=footprints.get(e.id)!.box;
      return band.a>=r[1] && band.b<=r[3] && !stepped(band.a,band.b,r[0]-.1,r[2]+.1) &&
        !plan.texts.some(t=>/^S\.?F\.?$/.test(t.str.trim())&&t.cx>=r[0]-20&&t.cx<=r[2]+20&&t.cy>=band.a-20&&t.cy<=band.b+20);
    }).sort((a,b)=>footprints.get(a.id)!.box[0]-footprints.get(b.id)!.box[0]);
    const links=row.slice(1).map((e,i)=>{
      const l=footprints.get(row[i].id)!.box,r=footprints.get(e.id)!.box;
      return r[0]>l[2] && Math.abs(l[1]-r[1])<.1 && Math.abs(l[3]-r[3])<.1 &&
        covered(band.a,l[2],r[0]) && covered(band.b,l[2],r[0]) && !stepped(band.a,band.b,l[2],r[0]) &&
        !plan.texts.some(t=>/^S\.?F\.?$/.test(t.str.trim())&&t.cx>=l[2]-20&&t.cx<=r[0]+20&&t.cy>=band.a-20&&t.cy<=band.b+20);
    });
    const top=(e:BuildElement)=>e.shape?.type==='point' && e.issues.some(i=>i.startsWith('Foundation revision applied:')) ? e.shape.z+e.shape.size[2] : null;
    row.forEach((e,i)=>{
      if(!['drawing','takeoff'].includes(e.origin ?? 'takeoff')||(e.shape&&!['axis','locator'].includes(e.shape.type)))return;
      let left=i-1,right=i+1;
      while(left>=0&&links[left]&&top(row[left])===null)left--;
      while(right<row.length&&links[right-1]&&top(row[right])===null)right++;
      if(left<0||right>=row.length||!links.slice(left,right).every(Boolean))return;
      const a=top(row[left]),b=top(row[right]);
      if(a===null||b===null||Math.abs(a-b)>.002||Math.abs(a-band.top)>.002)return;
      const proof:SourceRef={kind:'spec',id:plan.docId,page:plan.page,label:'Revised bracketed mass-footing datum',
        quote:`Top ${a} m inferred between agreeing source-resolved mass footings across both drawn strip boundaries; no detected step. Local mass thickness comes from its own schedule. Not a buttress-wall top.`,
        box:[footprints.get(row[left].id)!.box[0],band.a,footprints.get(row[right].id)!.box[2],band.b]};
      results.set(e.id,[...(results.get(e.id)??[]),{top:a,sources:[band.source,proof,...row[left].sources,...row[right].sources]}]);
    });
  }
  return elements.map(e=>{
    const choices=results.get(e.id),f=footprints.get(e.id);
    if(!f||!choices?.length||choices.some(c=>Math.abs(c.top-choices[0].top)>.002))return e;
    const top=choices[0].top,r=f.box;
    const own:SourceRef={kind:'spec',id:plan.docId,page:plan.page,label:'Revised mass-footing closed footprint',box:r,
      quote:'Closed source outline and local mass-footing tag match the scheduled plan dimensions. Datum continuity is inferred, not directly labelled here.'};
    return {...e,shape:{type:'point' as const,at:worldPoint([(r[0]+r[2])/2,(r[1]+r[3])/2],plan.frame),z:top-f.size[2],size:f.size,rotation:Math.atan2(plan.frame.b,plan.frame.a)},
      sources:[...new Map([...e.sources,f.schedule,own,...choices.flatMap(c=>c.sources)].map(s=>[JSON.stringify(s),s])).values()],
      issues:[...e.issues.filter(i=>!i.startsWith('Foundation revision unresolved:')),`Foundation revision applied: closed mass footprint; top ${top} m inferred through a source-bounded strip between agreeing mass datums, with own scheduled thickness ${f.size[2]} m. ${e.origin==='drawing'?'No accepted takeoff quantity.':'Accepted quantity unchanged.'} No buttress top inferred.`]};
  });
}
