import { geometryOf } from './sceneGeometry';
import { runSolids } from "./solids";
import { evaluate } from '../formula';
import type { Project } from '../model';
import { formulaVars, measurementVars } from '../quantities';
import type { SpecSection } from '../spec/parse';
import { tradeByKey } from './extract';
import { ifcClassOf, ifcGuid } from './ifcClass';
import type { BuildElement, BuildModel, Schedule } from './types';

/**
 * The model as IFC 4 (the open BIM standard Revit, Archicad, Solibri, Navisworks and Bonsai
 * read): a project, a building and its storeys; each element as its IFC class (walls, slabs,
 * coverings, doors, windows, duct and pipe segments, terminals) with its geometry, its takeoff
 * quantities, its assembly's materials and its spec sections as property sets; and the
 * schedule as a work schedule of tasks assigned to the elements they build (4D).
 */

export { ifcGuid };

function str(s: string | null | undefined): string {
  if (s === null || s === undefined) return '$';
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") o += "''";
    else if (ch === '\\') o += '\\\\';
    else if (c >= 32 && c < 127) o += ch;
    else if (c < 0x10000) o += `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  }
  return `'${o}'`;
}
const num = (v: number) => {
  if (!Number.isFinite(v)) return '0.';
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s.includes('.') || s.includes('e') ? s.toUpperCase() : `${s}.`;
};
const pt3 = (x: number, y: number, z: number) => `IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`;

export interface IfcInput {
  model: BuildModel;
  schedule: Schedule | null;
  project: Project;
  sections: SpecSection[];
  /** For the file's header. */
  now?: Date;
}

export function toIfc({ model, schedule, project, sections, now = new Date() }: IfcInput): string {
  const lines: string[] = [];
  let n = 0;
  const add = (s: string) => {
    lines.push(`#${++n}=${s};`);
    return `#${n}`;
  };
  const iso = now.toISOString().slice(0, 19);
  // Context, owner, units.
  const person = add(`IFCPERSON($,$,'',$,$,$,$,$)`);
  const org = add(`IFCORGANIZATION($,${str('Takeoff AI')},$,$,$)`);
  const po = add(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = add(`IFCAPPLICATION(${org},'1.0',${str('Takeoff AI — Build It')},'TakeoffAI')`);
  const owner = add(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,${Math.floor(now.getTime() / 1000)},$,$,${Math.floor(now.getTime() / 1000)})`);
  const origin = add(pt3(0, 0, 0));
  const zAxis = add(`IFCDIRECTION((0.,0.,1.))`);
  const xAxis = add(`IFCDIRECTION((1.,0.,0.))`);
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},${zAxis},${xAxis})`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = add(
    `IFCUNITASSIGNMENT((${add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`)},${add(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`)},${add(`IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`)},${add(`IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)`)}))`,
  );
  const proj = add(`IFCPROJECT('${ifcGuid(`project:${project.id ?? project.name}`)}',${owner},${str(project.name || 'Project')},${str('Proposed building from the takeoff and specification (Takeoff AI Build It)')},$,$,$,(${ctx}),${units})`);
  const placeAt = (rel: string | null, x: number, y: number, z: number) => add(`IFCLOCALPLACEMENT(${rel ?? '$'},${add(`IFCAXIS2PLACEMENT3D(${add(pt3(x, y, z))},$,$)`)})`);
  const sitePl = placeAt(null, 0, 0, 0);
  const site = add(`IFCSITE('${ifcGuid(`site:${project.id}`)}',${owner},'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = placeAt(sitePl, 0, 0, 0);
  const building = add(`IFCBUILDING('${ifcGuid(`building:${project.id}`)}',${owner},${str(project.name || 'Building')},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES('${ifcGuid(`agg1:${project.id}`)}',${owner},$,$,${proj},(${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid(`agg2:${project.id}`)}',${owner},$,$,${site},(${building}))`);
  const storeys = new Map<string, { ref: string; pl: string; elevation: number; members: string[] }>();
  for (const l of model.levels) {
    const pl = placeAt(bldPl, 0, 0, l.elevation);
    const ref = add(`IFCBUILDINGSTOREY('${ifcGuid(`storey:${project.id}:${l.id}`)}',${owner},${str(l.name)},$,$,${pl},$,$,.ELEMENT.,${num(l.elevation)})`);
    storeys.set(l.id, { ref, pl, elevation: l.elevation, members: [] });
  }
  if (storeys.size) add(`IFCRELAGGREGATES('${ifcGuid(`agg3:${project.id}`)}',${owner},$,$,${building},(${[...storeys.values()].map((s) => s.ref).join(',')}))`);

  // Geometry helpers (plan y runs down the sheet; IFC's y runs north).
  const dirUp = zAxis;
  const rect = (cx: number, cy: number, w: number, d: number) => add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${add(`IFCAXIS2PLACEMENT2D(${add(`IFCCARTESIANPOINT((${num(cx)},${num(cy)}))`)},$)`)},${num(Math.max(0.001, w))},${num(Math.max(0.001, d))})`);
  const solid = (profile: string, x: number, y: number, z: number, dx: number, dy: number, depth: number) => {
    const ref = add(`IFCDIRECTION((${num(dx)},${num(dy)},0.))`);
    return add(`IFCEXTRUDEDAREASOLID(${profile},${add(`IFCAXIS2PLACEMENT3D(${add(pt3(x, y, z))},${zAxis},${ref})`)},${dirUp},${num(Math.max(0.001, depth))})`);
  };
  const polyline = (ring: [number, number][]) => {
    const pts = [...ring, ring[0]].map(([x, y]) => add(`IFCCARTESIANPOINT((${num(x)},${num(-y)}))`));
    return add(`IFCPOLYLINE((${pts.join(',')}))`);
  };
  const shapeOf = (e: BuildElement, zBase: number): string | null => {
    const s = e.shape;
    if (!s || s.type === 'axis' || s.type === 'locator') return null;
    const items: string[] = [];
    if ((s.type==='surface' && s.slope) || (s.type==='run' && s.topPlane)) {
        const geometry = geometryOf(e)!;
        const position = geometry.getAttribute('position');
        const vertices: number[][] = [], indices: number[] = [], unique = new Map<string,number>();
        for (let i=0;i<position.count;i++) {
          const v=[position.getX(i),-position.getZ(i),position.getY(i)-zBase];
          const key=v.map(n=>n.toFixed(6)).join(',');
          let index=unique.get(key);
          if(index===undefined){vertices.push(v);index=vertices.length;unique.set(key,index);}
          indices.push(index);
        }
        const faces=[];
        for(let i=0;i<indices.length;i+=3) { const face=indices.slice(i,i+3); if(new Set(face).size===3)faces.push(`(${face.join(',')})`); }
        const points=add(`IFCCARTESIANPOINTLIST3D((${vertices.map(v=>`(${v.map(num).join(',')})`).join(',')}))`);
        items.push(add(`IFCTRIANGULATEDFACESET(${points},$,.T.,(${faces.join(',')}),$)`));
        geometry.dispose();
    } else if (s.type === 'run') {
      for (const p of runSolids(s)) {
        items.push(solid(rect(p.length / 2, 0, p.length, p.thickness), p.x, -p.y, p.z - zBase, p.dx, -p.dy, p.height));
      }
    } else if (s.type === 'surface') {
      if (s.ring.length < 3) return null;
      const profile = s.holes.length ? add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${polyline(s.ring)},(${s.holes.filter((h) => h.length >= 3).map(polyline).join(',')}))`) : add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${polyline(s.ring)})`);
      items.push(solid(profile, 0, 0, s.z - zBase, 1, 0, s.thickness));
    } else {
      items.push(solid(rect(0, 0, s.size[0], s.size[1]), s.at[0], -s.at[1], s.z - zBase, Math.cos(s.rotation ?? 0), -Math.sin(s.rotation ?? 0), s.size[2]));
    }
    if (!items.length) return null;
    const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','${((s.type === 'surface' && s.slope) || (s.type==='run' && s.topPlane)) ? 'Tessellation' : 'SweptSolid'}',(${items.join(',')}))`);
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };

  const classOf = ifcClassOf;

  const types = new Map(project.types.map((t) => [t.id, t]));
  const ms = new Map(project.measurements.map((m) => [m.id, m]));
  const sheets = new Map(project.sheets.map((s) => [s.id, s]));
  const secs = new Map(sections.map((s) => [s.key, s]));
  const actOf = new Map<string, string>();
  for (const a of schedule?.activities ?? []) for (const id of a.elements) actOf.set(id, a.id);
  const refOf = new Map<string, string>();
  const label = (k: string, v: string) => `IFCPROPERTYSINGLEVALUE(${str(k)},$,IFCLABEL(${str(v)}),$)`;
  const text = (k: string, v: string) => `IFCPROPERTYSINGLEVALUE(${str(k)},$,IFCTEXT(${str(v)}),$)`;
  const real = (k: string, v: number) => `IFCPROPERTYSINGLEVALUE(${str(k)},$,IFCREAL(${num(v)}),$)`;
  const ft = project.units === 'imperial';

  // Elements with no place in the model (level unknown, not a plan) are still exported, with their
  // quantities and properties and no geometry, in the building: no takeoff is lost on the way out.
  const loose: string[] = [];
  for (const e of model.elements) {
    const lv = e.level ? storeys.get(e.level) : undefined;
    const shape = e.shape && lv ? shapeOf(e, lv.elevation) : null;
    const locator = e.shape?.type === 'locator' && lv ? e.shape : null;
    const pl = locator
      ? placeAt(lv!.pl, locator.at[0], -locator.at[1], locator.z - lv!.elevation)
      : add(`IFCLOCALPLACEMENT(${shape && lv ? lv.pl : bldPl},${add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`)})`);
    const { cls, tail } = classOf(e);
    const ref = add(`${cls}('${ifcGuid(e.id)}',${owner},${str(e.name)},${str(e.typeName)},${str(tradeByKey.get(e.trade)?.name ?? e.trade)},${pl},${shape ?? '$'},${str(e.id.slice(0, 8))}${tail})`);
    refOf.set(e.id, ref);
    if ((shape || locator) && lv) lv.members.push(ref);
    else loose.push(ref);
    // Properties: what it is, where it came from, what governs it, when it is built.
    const type = types.get(e.typeId);
    const m = ms.get(e.measurementId);
    const sheet = sheets.get(e.sheetId);
    const t = schedule?.times[actOf.get(e.id) ?? ''];
    const act = schedule?.activities.find((a) => a.id === actOf.get(e.id));
    const props = [
      label('TakeoffType', e.typeName),
      label('System', tradeByKey.get(e.trade)?.name ?? e.trade),
      label('Division', e.division || ''),
      label('Level', e.level ?? ''),
      label('SourceSheet', sheet ? `${sheet.name} ${sheet.title ?? ''}`.trim() : ''),
      label('SourcePage', String(sheet?.page ?? '')),
      ...(locator && m?.points[0] ? [label('TagPointOnSheet', m.points[0].map((n) => n.toFixed(2)).join(', '))] : []),
      label('TakenOffBy', m?.source ?? 'hand'),
      label('Placement', e.placement),
      label('Quantity', `${Math.round(e.quantity * 100) / 100} ${e.unit}`),
      label('SpecSections', e.specs.map((s) => { const sec = secs.get(s.key); return sec ? `${sec.number} ${sec.title}${sec.missing ? ' (not issued)' : ''}` : s.key; }).join('; ')),
      ...(type?.assemblyTitle ? [label('Assembly', type.assemblyTitle)] : []),
      ...(type?.description ? [text('AssemblyBuildUp', type.description.slice(0, 900))] : []),
      ...(act ? [label('BuiltBy', act.name)] : []),
      ...(t ? [label('ScheduledStart', t.start), label('ScheduledFinish', t.finish), label('Critical', t.critical ? 'yes' : 'no')] : []),
      label("Status",
        e.status === "existing"
          ? "EXISTING"
          : e.trade === 'demolition' ? "DEMOLISH"
            : "NEW",
      ),
      label("Origin", e.origin === "building"
          ? "Derived building context - not measured takeoff"
          : "Measured takeoff", ),
      ...(e.issues.length ? [text('OpenIssues', e.issues.join(' | ').slice(0, 900))] : []),
    ].map(add);
    const pset = add(`IFCPROPERTYSET('${ifcGuid(`pset:${e.id}`)}',${owner},'Pset_TakeoffAI',$,(${props.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid(`rpset:${e.id}`)}',${owner},$,$,(${ref}),${pset})`);
    // The assembly's materials for this element.
    if (type && m && sheet && type.items.length) {
      const v = measurementVars(m, type, sheet, project.units);
      if (v) {
        const mats = type.items.flatMap((it) => {
          const r = evaluate(it.formula, formulaVars(v, type));
          return r.ok ? [add(real(`${it.name} (${it.unit})`.slice(0, 120), r.value))] : [];
        });
        if (mats.length) {
          const mp = add(`IFCPROPERTYSET('${ifcGuid(`mats:${e.id}`)}',${owner},'Pset_TakeoffAI_Materials',$,(${mats.join(',')}))`);
          add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid(`rmats:${e.id}`)}',${owner},$,$,(${ref}),${mp})`);
        }
      }
    }
    // Base quantities, in metres.
    const q: string[] = [];
    const s = e.shape;
    if (!s) {
      // Not placed: the takeoff quantity as it is, in metres.
      if (e.unit === 'ft' || e.unit === 'm') q.push(add(`IFCQUANTITYLENGTH('Length',$,$,${num(e.unit === 'ft' ? e.quantity * 0.3048 : e.quantity)},$)`));
      else if (e.unit === 'SF' || e.unit === 'm²') q.push(add(`IFCQUANTITYAREA('NetArea',$,$,${num(e.unit === 'SF' ? e.quantity * 0.09290304 : e.quantity)},$)`));
      else q.push(add(`IFCQUANTITYCOUNT('Count',$,$,${num(e.quantity)},$)`));
    } else if (s.type === 'axis') {
      const len = s.points.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - s.points[i][0], p[1] - s.points[i][1]), 0);
      q.push(add(`IFCQUANTITYLENGTH('Length',$,$,${num(len)},$)`));
    } else if (s.type === 'run') {
      const len = s.points.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - s.points[i][0], p[1] - s.points[i][1]), 0);
      q.push(add(`IFCQUANTITYLENGTH('Length',$,$,${num(len)},$)`), add(`IFCQUANTITYLENGTH('Height',$,$,${num(s.height)},$)`), add(`IFCQUANTITYAREA('GrossSideArea',$,$,${num(len * s.height)},$)`));
    } else if (s.type === 'surface') {
      const area = e.unit === 'SF' ? e.quantity * 0.09290304 : e.unit === 'm²' ? e.quantity : 0;
      q.push(add(`IFCQUANTITYAREA('NetArea',$,$,${num(area)},$)`));
    } else q.push(add(`IFCQUANTITYCOUNT('Count',$,$,1.,$)`));
    if (s && ft && e.unit === 'ft') q.push(add(`IFCQUANTITYLENGTH('TakeoffLength',$,$,${num(e.quantity * 0.3048)},$)`));
    const qto = add(`IFCELEMENTQUANTITY('${ifcGuid(`qto:${e.id}`)}',${owner},'${e.origin === "building" ? "Qto_BuildingAllowance" : "Qto_TakeoffAI"}',$,'${e.origin === "building" ? "Inferred geometry" : "Takeoff"}',(${q.join(',')}))`);
    add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid(`rqto:${e.id}`)}',${owner},$,$,(${ref}),${qto})`);
  }
  if (loose.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid(`cont:${project.id}:building`)}',${owner},'Not placed',$,(${loose.join(',')}),${building})`);
  for (const [id, s] of storeys) if (s.members.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid(`cont:${project.id}:${id}`)}',${owner},$,$,(${s.members.join(',')}),${s.ref})`);

  // 4D: the work schedule, its tasks, their times and links, and what each builds.
  if (schedule && schedule.activities.length) {
    const first = Object.values(schedule.times).reduce((a, t) => (t.start < a ? t.start : a), '9999');
    const last = Object.values(schedule.times).reduce((a, t) => (t.finish > a ? t.finish : a), '0000');
    const ws = add(`IFCWORKSCHEDULE('${ifcGuid(`ws:${project.id}`)}',${owner},${str('Build It schedule')},$,$,$,'${iso}',$,$,$,$,'${first}T08:00:00','${last}T17:00:00',.PLANNED.)`);
    const taskRef = new Map<string, string>();
    for (const a of schedule.activities) {
      const t = schedule.times[a.id];
      if (!t) continue;
      const tt = add(`IFCTASKTIME($,$,$,.WORKTIME.,'P${a.duration}D','${t.start}T08:00:00','${t.finish}T17:00:00','${t.start}T08:00:00','${t.finish}T17:00:00',$,$,$,'P${Math.max(0, t.float)}D',${t.critical ? '.T.' : '.F.'},$,$,$,$,$,$)`);
      const kind = a.kind === 'work' ? '.CONSTRUCTION.' : a.kind === 'procurement' ? '.LOGISTIC.' : a.kind === 'commissioning' || a.kind === 'testing' ? '.ATTENDANCE.' : '.NOTDEFINED.';
      const ref = add(`IFCTASK('${ifcGuid(`task:${project.id}:${a.id}`)}',${owner},${str(a.name)},${str(a.durationWhy.slice(0, 250))},${str(a.kind)},${str(a.id.slice(0, 60))},$,$,$,${a.duration === 0 ? '.T.' : '.F.'},$,${tt},${a.trade === 'demolition' && a.kind === 'work' ? '.DEMOLITION.' : kind})`);
      taskRef.set(a.id, ref);
      const built = a.elements.map((id) => refOf.get(id)).filter((r): r is string => !!r);
      if (built.length) add(`IFCRELASSIGNSTOPROCESS('${ifcGuid(`ap:${project.id}:${a.id}`)}',${owner},$,$,(${built.join(',')}),$,${ref},$)`);
    }
    add(`IFCRELASSIGNSTOCONTROL('${ifcGuid(`ac:${project.id}`)}',${owner},$,$,(${[...taskRef.values()].join(',')}),$,${ws})`);
    for (const a of schedule.activities)
      for (const d of a.deps) {
        const from = taskRef.get(d.from);
        const to = taskRef.get(a.id);
        if (!from || !to) continue;
        const lag = d.lag ? add(`IFCLAGTIME($,$,$,IFCDURATION('P${d.lag}D'),.WORKTIME.)`) : '$';
        add(`IFCRELSEQUENCE('${ifcGuid(`seq:${project.id}:${d.from}>${a.id}`)}',${owner},$,$,${from},${to},${lag},${d.type === 'SS' ? '.START_START.' : '.FINISH_START.'},$)`);
      }
  }

  const head = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${str(`${project.name || 'project'}.ifc`)},'${iso}',(''),(''),'Takeoff AI','Takeoff AI Build It','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ];
  return [...head, ...lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
