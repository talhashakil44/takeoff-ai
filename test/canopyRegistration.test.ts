import {insetRegistrations} from '../src/build/insetRegistration';
import {retainInsetEvidence} from '../src/build/insetEvidence';
import { connectSourceColumns } from '../src/build/columnGeometry';
import { describe, expect, it } from 'vitest';
import { structuralRevisionContext } from '../src/build/structuralRevisions';
import fs from 'node:fs';
import {
  canopyMemberGeometry,
  centredCanopySpan,
  drawnIProfiles,
} from '../src/build/canopyMemberGeometry';
import {
  canopyRegistrations,
  traceGridStroke,
} from '../src/build/canopyRegistration';
import type { Project, Sheet } from '../src/model';
import type { BuildModel } from '../src/build/types';
import type { DrawingText, DrawingTexts } from '../src/build/building';
import type { DrawingLines } from '../src/build/roof';
import type { Segment } from '../src/fill/vectors';
const line = (x1: number, y1: number, x2: number, y2: number): Segment => ({
  x1,
  y1,
  x2,
  y2,
  width: 0.3,
  filled: false,
  color: '#000000',
});
const tag = (str: string, cx: number, cy: number): DrawingText => ({
  str,
  cx,
  cy,
});
function fixture() {
  const k = (100 * 0.0254) / 72;
  const arch = {
    id: 'a',
    name: 'A1',
    title: 'FLOOR PLAN',
    width: 300,
    height: 300,
    page: 1,
    metersPerPoint: k,
  } as Sheet;
  const canopy = {
    id: 's',
    name: 'S1',
    title: 'ROOF FRAMING',
    width: 600,
    height: 500,
    page: 1,
    metersPerPoint: null,
    views:[{title:'CANOPY FRAMING PLAN',box:[0,30,320,430],scaleLabel:'1:50',metersPerPoint:50*.0254/72},{title:'Main',box:[600,0,1600,1500],scaleLabel:'1:100',metersPerPoint:100*.0254/72}],
  } as Sheet;
  const refs = ['d1', 'd2'].map(
    (id) =>
      ({
        id,
        name: 'S' + id,
        title: 'SECTIONS',
        page: 1,
        width: 600,
        height: 500,
      }) as Sheet,
  );
  const ring: [number, number][] = [
    [30, 40],
    [60, 40],
    [60, 80],
    [30, 80],
  ];
  const project = {
    sheets: [arch, canopy, ...refs],
    measurements: [
      { id: 'wall', sheetId: 'a', points: ring },
      {
        id: 'canopy',
        sheetId: 's',
        points: [
          [150, 160],
          [200, 160],
        ],
      },
      { id: 'outside', sheetId: 's', points: [[500, 160]] },
    ],
  } as unknown as Project;
  const model = {
    elements: [
      {
        measurementId: 'wall',
        shape: { type: 'surface', ring: ring.map(([x, y]) => [x * k, y * k]) },
      },
    ],
  } as unknown as BuildModel;
  const texts: DrawingTexts = {
    a: [
      ...['A', 'B', 'C', 'D', 'E'].map((v, i) => tag(v, 20 + i * 20, 20)),
      tag('Ef', 156, 20),
      ...['1', '2', '3'].map((v, i) => tag(v, 20, 100 + i * 50)),
    ],
    s: [
      tag('CANOPY FRAMING PLAN', 200, 450),
      tag('1 : 50', 200, 470),
      tag('E', 20, 100),
      tag('Ef', 20, 132),
      tag('3', 200, 40),
    ],
  };
  for (const ref of refs)
    texts[ref.id] = [tag('T/O ENTRY CANOPY', 100, 100), tag('6623', 125, 108)];
  const lines: DrawingLines = {
    a: [
      line(100, 35, 100, 80),
      line(100, 90, 100, 280),
      line(156, 35, 156, 50),
      line(156, 50, 116, 70),
      line(116, 70, 116, 280),
      line(35, 200, 80, 200),
      line(90, 200, 280, 200),
    ],
    s: [
      line(35, 100, 80, 100),
      line(90, 100, 300, 100),
      line(35, 132, 80, 132),
      line(90, 132, 300, 132),
      line(200, 55, 200, 90),
      line(200, 100, 200, 350),
    ],
  };
  return { project, model, texts, lines };
}
describe('canopy viewport registration', () => {
  it('traces a dogleg to its grid stroke, never the offset label centre', () => {
    const d = fixture();
    expect(traceGridStroke(tag('Ef', 156, 20), d.lines.a, 'x', 1)).toBe(116);
    expect(
      traceGridStroke(
        tag('Ef', 156, 20),
        d.lines.a.filter((l) => l.x1 !== 156 || l.x2 !== 116),
        'x',
        1,
      ),
    ).toBeNull();
  });
  it('independently corroborates scale, limits placement to the canopy viewport, and retains datum sources', () => {
    const d = fixture(),
      snapshot = JSON.stringify(d),
      r = canopyRegistrations(d.project, d.model, d.texts, d.lines);
    expect(Object.keys(r)).toEqual(['canopy']);
    expect(r.canopy.topDatum).toBe(6.623);
    expect(
      r.canopy.sources.some((s) => s.id === 'a' && s.quote?.includes('grid strokes')),
    ).toBe(true);
    expect(r.canopy.frame.a).toBeCloseTo(0, 10);
    expect(r.canopy.frame.b).toBeCloseTo((-50 * 0.0254) / 72, 10);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
  it('fails closed when the independently traced spacing or datums disagree', () => {
    const d = fixture();
    d.lines.a = d.lines.a.map((l) => ({
      ...l,
      x1: l.x1 === 116 ? 130 : l.x1,
      x2: l.x2 === 116 ? 130 : l.x2,
    }));
    expect(canopyRegistrations(d.project, d.model, d.texts, d.lines)).toEqual(
      {},
    );
    const other = fixture();
    other.texts.d2[1].str = '7000';
    expect(
      canopyRegistrations(other.project, other.model, other.texts, other.lines),
    ).toEqual({});
  });
  it('registers a foundation inset without roof datums and requires its detected view', () => {
    const d=fixture();
    d.texts.s[0].str='CANOPY FOUNDATION PLAN';
    delete d.texts.d1; delete d.texts.d2;
    const sheet=d.project.sheets.find(s=>s.id==='s')!;sheet.metersPerPoint=100*.0254/72;
    sheet.views=[];
    expect(insetRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
    sheet.views=[{title:'CANOPY FOUNDATION PLAN',box:[0,30,320,430],scaleLabel:'1:50',metersPerPoint:50*.0254/72},{title:'Main',box:[600,0,1600,1500],scaleLabel:'1:100',metersPerPoint:100*.0254/72}];
    const result=insetRegistrations(d.project,d.model,d.texts,d.lines);
    expect(Object.keys(result)).toEqual(['canopy']);
    expect(result.canopy).not.toHaveProperty('topDatum');
    expect(result.canopy.sources).toHaveLength(2);
    expect(canopyRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
    sheet.views[0].metersPerPoint*=2;
    expect(insetRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
  });
  it.each(['ENLARGED STAIR PLAN','VESTIBULE FOUNDATION PLAN','ELEVATOR FRAMING PLAN - MAIN FLOOR'])('registers %s by detected scale and traced grids, not title semantics', title=>{
    const d=fixture(),sheet=d.project.sheets.find(s=>s.id==='s')!;
    d.texts.s[0].str=title;sheet.metersPerPoint=100*.0254/72;
    sheet.views=[{title,box:[0,30,320,430],scaleLabel:'1:50',metersPerPoint:50*.0254/72},{title:'Main',box:[600,0,1600,1500],scaleLabel:'1:100',metersPerPoint:100*.0254/72}];
    const r=insetRegistrations(d.project,d.model,d.texts,d.lines).canopy;
    expect(r).toBeDefined();expect(r.frame.b).toBeCloseTo(-50*.0254/72,10);expect(r.grids.sort()).toEqual(['3','E','Ef']);
    d.lines.s=d.lines.s.filter(l=>l.y1!==132);
    expect(insetRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
  });
  it.each([0,1,2,3])('registers a rotated inset at quarter turn %i without moving its world point', turn=>{
    const d=fixture(),sheet=d.project.sheets.find(s=>s.id==='s')!;
    sheet.metersPerPoint=100*.0254/72;
    sheet.views=[{title:'CANOPY FRAMING PLAN',box:[0,0,400,430],scaleLabel:'1:50',metersPerPoint:50*.0254/72},{title:'Main',box:[600,0,1600,1500],scaleLabel:'1:100',metersPerPoint:100*.0254/72}];
    const before=insetRegistrations(d.project,d.model,d.texts,d.lines).canopy;
    const world=(p:number[],f:typeof before.frame)=>[f.a*p[0]-f.b*p[1]+f.tx,f.b*p[0]+f.a*p[1]+f.ty];
    const expected=world([150,160],before.frame);
    const c=Math.round(Math.cos(turn*Math.PI/2)),sn=Math.round(Math.sin(turn*Math.PI/2));
    const rotate=(x:number,y:number):[number,number]=>[200+c*(x-200)-sn*(y-220),220+sn*(x-200)+c*(y-220)];
    d.texts.s=d.texts.s.map(t=>/^(E|Ef|3)$/.test(t.str)?{...t,cx:rotate(t.cx,t.cy)[0],cy:rotate(t.cx,t.cy)[1]}:t);
    d.lines.s=d.lines.s.map(l=>({...l,x1:rotate(l.x1,l.y1)[0],y1:rotate(l.x1,l.y1)[1],x2:rotate(l.x2,l.y2)[0],y2:rotate(l.x2,l.y2)[1]}));
    d.project.measurements.find(m=>m.id==='canopy')!.points=[[150,160],[200,160]].map(([x,y])=>rotate(x,y));
    const after=insetRegistrations(d.project,d.model,d.texts,d.lines).canopy;
    expect(after).toBeDefined();const actual=world(rotate(150,160),after.frame);
    expect(actual[0]).toBeCloseTo(expected[0],8);expect(actual[1]).toBeCloseTo(expected[1],8);
    sheet.views.push({...sheet.views[0]},{...sheet.views[0]});
    expect(insetRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
  });
  it('preserves a saved plate while exposing a source designation conflict, and withdraws stale registration', () => {
    const d=fixture();d.texts.s[0].str='CANOPY FOUNDATION PLAN';
    const sh=d.project.sheets.find(s=>s.id==='s')!;sh.metersPerPoint=100*.0254/72;
    sh.views=[{title:'CANOPY FOUNDATION PLAN',box:[0,30,320,430],scaleLabel:'1:50',metersPerPoint:50*.0254/72},{title:'Main plan',box:[600,0,1600,1500],scaleLabel:'1:100',metersPerPoint:100*.0254/72}];
    d.project.measurements.find(m=>m.id==='canopy')!.points=[[150,160]];
    d.texts.s.push({...tag('BP5',150,160),w:20,h:8});
    d.model.elements=d.model.elements.map(e=>({...e,sources:[],issues:[]}));
    d.model.elements.push({id:'plate',measurementId:'canopy',sheetId:'s',typeName:'BP6 – Base plate',shape:null,quantity:1,unit:'ea',sources:[],issues:[]} as any);
    const before=JSON.stringify(d.project);
    const result=retainInsetEvidence(d.project,d.model,d.texts,d.lines);
    const plate=result.elements.find(e=>e.id==='plate')!;
    expect(plate.issues.some(s=>s.includes('drawing label BP5 conflicts with saved takeoff BP6'))).toBe(true);
    expect(plate.shape).toBeNull();expect(plate.quantity).toBe(1);expect(plate.typeName).toBe('BP6 – Base plate');
    expect(JSON.stringify(d.project)).toBe(before);
    sh.views=[];
    const withdrawn=retainInsetEvidence(d.project,result,d.texts,d.lines).elements.find(e=>e.id==='plate')!;
    expect(withdrawn.issues).toEqual([]);expect(withdrawn.sources).toEqual([]);
  });
  it('qualifies the roof datum separately from generic inset titles',()=>{
    const d=fixture(),sheet=d.project.sheets.find(s=>s.id==='s')!;
    for(const title of ['ENTRY CANOPY PLAN','ENLARGED ENTRY CANOPY ROOF PLAN']){
      d.texts.s[0].str=title;sheet.views![0].title=title;
      expect(canopyRegistrations(d.project,d.model,d.texts,d.lines).canopy?.topDatum).toBe(6.623);
    }
    for(const title of ['CANOPY FOUNDATION PLAN','ELEVATOR FRAMING PLAN','CANOPY FLOOR PLAN']){
      d.texts.s[0].str=title;sheet.views![0].title=title;
      expect(insetRegistrations(d.project,d.model,d.texts,d.lines).canopy).toBeDefined();
      expect(canopyRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
    }
    d.texts.s[0].str='ENTRY CANOPY PLAN';sheet.views![0].title='ENTRY CANOPY PLAN';sheet.title='PLAN';sheet.views![1].title='HIGH ROOF FRAMING PLAN';
    expect(canopyRegistrations(d.project,d.model,d.texts,d.lines).canopy?.topDatum).toBe(6.623);
    sheet.views![1].title='MAIN FLOOR FRAMING PLAN';
    expect(canopyRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
    sheet.title='FOUNDATION PLAN';
    expect(canopyRegistrations(d.project,d.model,d.texts,d.lines)).toEqual({});
  });
  it('retains source ink as a plan-only beam trace and withdraws it with ambiguous or missing evidence',()=>{
    const d=fixture();
    d.model.elements=d.model.elements.map(e=>({...e,sources:[],issues:[]}));
    d.model.elements.push({id:'beam',measurementId:'canopy',sheetId:'s',typeName:'B9 – Beam',shape:null,quantity:7,unit:'m',sources:[],issues:[]} as any);
    d.texts.s.push({...tag('B9',175,160),h:8,w:20});
    d.lines.s.push({...line(100,168,250,168),width:1.2});
    const before=JSON.stringify(d.project);
    const result=retainInsetEvidence(d.project,d.model,d.texts,d.lines);
    const beam=result.elements.find(e=>e.id==='beam')!;
    expect(beam.planTrace?.points).toHaveLength(2);expect(beam.shape).toBeNull();expect(beam.quantity).toBe(7);
    expect(beam.sources.some(s=>s.quote?.includes('Endpoints follow source ink'))).toBe(true);
    expect(JSON.stringify(d.project)).toBe(before);
    d.texts.s.push({...tag('B9',176,160),h:8,w:20});
    expect(retainInsetEvidence(d.project,result,d.texts,d.lines).elements.find(e=>e.id==='beam')!.planTrace).toBeUndefined();
    d.texts.s.pop();d.lines.s.pop();
    expect(retainInsetEvidence(d.project,result,d.texts,d.lines).elements.find(e=>e.id==='beam')!.planTrace).toBeUndefined();
  });
  it('recentres paired beam silhouettes and rejects missing or ambiguous ink', () => {
    const ink = [line(100, 100, 100, 300), line(110, 100, 110, 300)].map(
      (l) => ({ ...l, width: 1.2 }),
    );
    const t = { cx: 99, cy: 200, h: 12, angle: -Math.PI / 2 };
    expect(centredCanopySpan(t, ink, 0.015)).toEqual([
      [105, 100],
      [105, 300],
    ]);
    expect(centredCanopySpan(t, [], 0.015)).toBeNull();
    expect(centredCanopySpan({ ...t, h: undefined }, ink, 0.015)).toBeNull();
  });
  it('retains a closed I profile instead of replacing it with its bounding box', () => {
    const points: [number, number][] = [
      [-8, 0],
      [8, 0],
      [8, 1],
      [1, 1],
      [1, 23],
      [8, 23],
      [8, 24],
      [-8, 24],
      [-8, 23],
      [-1, 23],
      [-1, 1],
      [-8, 1],
    ];
    const ink = points.map((p, i) => ({
      ...line(...p, ...points[(i + 1) % points.length]),
      width: 0.8,
    }));
    const shapes = drawnIProfiles(ink, 0.01);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].points).toEqual(points);
    expect(drawnIProfiles(ink.slice(0, -1), 0.01)).toEqual([]);
  });
  it.runIf(!!process.env.CANOPY_SOURCE_FIXTURE)(
    'validates the supplied local source drawing fixture',
    () => {
      const data = JSON.parse(
        fs.readFileSync(process.env.CANOPY_SOURCE_FIXTURE!, 'utf8'),
      );
      if (Object.keys(data.drawingTexts).some((id) => id.startsWith('spec:'))) {
        const revised = structuralRevisionContext(
          data.project,
          data.drawingTexts,
          data.drawingLines,
        );
        expect(revised.pending).toBe(false);
        data.project = revised.project;
        data.drawingTexts = revised.texts;
        data.drawingLines = revised.lines;
      }
      const result = canopyRegistrations(
        data.project,
        data.model,
        data.drawingTexts,
        data.drawingLines,
      );
      const canopyColumn=data.project.measurements.find((m:any)=>result[m.id] &&
        /^C1\b/.test(data.project.types.find((t:any)=>t.id===m.typeId)?.name??''));
      expect(canopyColumn).toBeTruthy();
      const columns=connectSourceColumns(data.project,data.model,data.drawingTexts,data.drawingLines);
      const c1=columns.elements.find(e=>e.measurementId===canopyColumn.id)!;
      expect(c1.shape).toBeNull(); // entry-canopy datum is not a column height
      expect(c1.sources.some(s=>s.quote?.startsWith('Registered column footprint:') && s.quote.includes('CANOPY FRAMING PLAN'))).toBe(true);
      expect(c1.quantity).toBe(data.model.elements.find((e:any)=>e.id===c1.id).quantity);
      const c2s=columns.elements.filter(e=>/^C2\b/.test(e.typeName) && result[e.measurementId]);
      expect(c2s).toHaveLength(4);
      for(const e of c2s){const ring=e.planFootprint!.ring;expect(ring).toHaveLength(4);expect(Math.hypot(ring[1][0]-ring[0][0],ring[1][1]-ring[0][1])).toBeCloseTo(.127,2);expect(e.planFootprint!.domain).toBe('canopy');}
      const proof=(e:typeof c1)=>e.sources.find(s=>s.quote?.startsWith('Registered column footprint:'));
      for(const e of c2s){expect(proof(e)).toBeTruthy();expect(e.shape).toBeNull();expect(e.quantity).toBe(data.model.elements.find((old:any)=>old.id===e.id).quantity);}
      const source=proof(c2s[0])!,box=source.box!;
      const raw=data.drawingLines[source.id];
      const corner=raw.findIndex((l:any)=>!l.filled && l.color==='#000000' && Math.abs(l.x1-l.x2)>.05 && Math.abs(l.y1-l.y2)>.05 &&
        (Math.abs(l.x1-box[0])<.01 || Math.abs(l.x2-box[0])<.01 || Math.abs(l.y1-box[1])<.01 || Math.abs(l.y2-box[1])<.01) && Math.min(l.x1,l.x2)>=box[0]-.01 && Math.max(l.x1,l.x2)<=box[2]+.01 && Math.min(l.y1,l.y2)>=box[1]-.01 && Math.max(l.y1,l.y2)<=box[3]+.01);
      expect(corner).toBeGreaterThanOrEqual(0);
      const broken=connectSourceColumns(data.project,columns,data.drawingTexts,{...data.drawingLines,[source.id]:raw.filter((_:any,i:number)=>i!==corner)});
      expect(proof(broken.elements.find(e=>e.id===c2s[0].id)!)).toBeUndefined();
      expect(broken.elements.find(e=>e.id===c2s[0].id)!.planFootprint).toBeUndefined();
      for(const e of c2s.slice(1))expect(proof(broken.elements.find(x=>x.id===e.id)!)).toBeTruthy();
      // Withdraw the corroborating grid from the actual source; a printed scale
      // and single intersection alone must not retain this registration.
      const withoutEf={...data.drawingTexts,[canopyColumn.sheetId]:data.drawingTexts[canopyColumn.sheetId].filter((t:any)=>t.str.trim()!=='Ef')};
      const withdrawn=connectSourceColumns(data.project,columns,withoutEf,data.drawingLines).elements.find(e=>e.id===c1.id)!;
      expect(withdrawn.sources.some(s=>s.quote?.startsWith('Registered column footprint:') && s.quote.includes('CANOPY FRAMING PLAN'))).toBe(false);
      expect(withdrawn.shape).toBeNull();
      const members = canopyMemberGeometry(
        data.project,
        data.drawingTexts,
        data.drawingLines,
        result,
      );
      console.log(
        'Canopy source validation',
        JSON.stringify({
          registrations: Object.keys(result).length,
          members: Object.values(members).map((m) => ({
            points: m.shape.points,
            profileVertices: m.shape.profile?.length,
            z0: m.shape.z0,
            depth: m.shape.height,
            width: m.shape.thickness,
          })),
        }),
      );
      expect(Object.keys(members)).toHaveLength(4);
      // Missing section linework must not promote registered plan spans to solids.
      const withoutSections = Object.fromEntries(
        Object.entries(data.drawingLines).filter(
          ([id]) =>
            data.project.sheets.find((s: any) => s.id === id)?.name !== 'S5.0',
        ),
      );
      expect(
        canopyMemberGeometry(
          data.project,
          data.drawingTexts,
          withoutSections as DrawingLines,
          result,
        ),
      ).toEqual({});
      for (const m of Object.values(members)) {
        expect(m.shape.profile).toHaveLength(20);
        expect(m.shape.z0).toBeCloseTo(6.562675, 5);
        expect(m.shape.height).toBeCloseTo(0.206375, 5);
      }
      expect(Object.keys(result).length).toBeGreaterThan(0);
      for (const r of Object.values(result)) expect(r.topDatum).toBe(6.623);
    },
    // This optional integration fixture includes full PDF vectors and can run
    // alongside the unit workers; allow bounded parsing/extraction time.
    30_000,
  );
});
