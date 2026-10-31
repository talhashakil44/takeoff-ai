import { hssColumnPlanSections } from './hssColumnPlanSections';
import { roundedColumnFootprint } from './roundedColumnFootprint';
import { canopyRegistrations } from './canopyRegistration';
import { retainColumnPlanEvidence, type ColumnPlanWitness } from './columnPlanEvidence';
import { joinCollinearRoofStrokes } from './roofSpanEvidence';
import type { Project, Pt, Sheet } from '../model';
import type { BuildModel, SourceRef } from './types';
import { gridAxes, registerSheets, type DrawingTexts } from './building';
import type { DrawingLines } from './roof';
import { structuralSections } from './structural';
import { roofViewportRegistrations } from './roofRegistration';
import { worldPoint, sheetFrame, type SheetFrame } from './sheetCoordinates';
type Line = DrawingLines[string][number];
const black = (l: Line) => !l.filled && !l.curve && l.color === '#000000';
const horizontal = (l: Line) => Math.abs(l.y1 - l.y2) < 0.05;
const vertical = (l: Line) => Math.abs(l.x1 - l.x2) < 0.05;
/** Trace two column faces and closed ends. One face may be interrupted by a
 * crossing beam; the other must be continuous and the scheduled width agrees. */
export function traceSectionPost(
  lines: Line[],
  x: number,
  floorY: number,
  scale: number,
  width: number,
): { top: number; bottom: number } | null {
  const side = lines.filter(
    (l) =>
      black(l) &&
      vertical(l) &&
      Math.abs(l.x1 - x) * scale < width &&
      Math.min(l.y1, l.y2) < floorY + 1 &&
      Math.max(l.y1, l.y2) <= floorY + 1 &&
      Math.abs(l.y2 - l.y1) * scale > 1,
  );
  const candidates: { top: number; bottom: number }[] = [];
  for (const a of side) {
    const top = Math.min(a.y1, a.y2),
      bottom = Math.max(a.y1, a.y2);
    const otherX = a.x1 < x ? a.x1 + width / scale : a.x1 - width / scale;
    if (Math.abs((a.x1 + otherX) / 2 - x) * scale > 0.015) continue;
    const opposite = lines
      .filter((l) => black(l) && vertical(l) && Math.abs(l.x1 - otherX) < 0.25)
      .map((l) => [
        Math.max(top, Math.min(l.y1, l.y2)),
        Math.min(bottom, Math.max(l.y1, l.y2)),
      ])
      .filter((v) => v[1] > v[0])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const v of opposite) {
      const prev = merged.at(-1);
      if (prev && v[0] <= prev[1] + 0.25) prev[1] = Math.max(prev[1], v[1]);
      else merged.push([...v]);
    }
    if (
      !merged.length ||
      merged[0][0] > top + 0.5 ||
      merged.at(-1)![1] < bottom - 0.5 ||
      merged.reduce((sum, v) => sum + v[1] - v[0], 0) < (bottom - top) * 0.65 ||
      merged.some((v, i) => i > 0 && (v[0] - merged[i - 1][1]) * scale > 0.65)
    )
      continue;
    const closed = (y: number) => {
      const spans = lines
        .filter((l) => black(l) && horizontal(l) && Math.abs(l.y1 - y) < 0.3)
        .map((l) => [
          Math.max(Math.min(a.x1, otherX), Math.min(l.x1, l.x2)),
          Math.min(Math.max(a.x1, otherX), Math.max(l.x1, l.x2)),
        ])
        .filter((v) => v[1] > v[0])
        .sort((a, b) => a[0] - b[0]);
      let end = Math.min(a.x1, otherX);
      for (const v of spans) {
        if (v[0] > end + 0.3) break;
        end = Math.max(end, v[1]);
      }
      return end >= Math.max(a.x1, otherX) - 0.3;
    };
    if (
      closed(top) &&
      closed(bottom) &&
      !candidates.some(
        (c) => Math.abs(c.top - top) < 0.5 && Math.abs(c.bottom - bottom) < 0.5,
      )
    )
      candidates.push({ top, bottom });
  }
  // Multiple nested/crossing column envelopes are not resolved by taking tallest.
  return candidates.length === 1 ? candidates[0] : null;
}
/** Reuse architectural grid registration: structural locators may already be
 * snapped, and corrected beam endpoints no longer match raw takeoff points. */
function floorColumnFrame(project:Project,model:BuildModel,sheet:Sheet,texts:DrawingTexts):SheetFrame|null {
 const candidates:SheetFrame[]=[];
 for(const base of project.sheets.filter(s=>!s.superseded && /^A/.test(s.name) && /FLOOR PLAN/i.test(s.title??'') && !/CEILING|FIRE|ENLARG|DETAIL/i.test(s.title??'') && s.metersPerPoint)){
  const bf=sheetFrame(project,model,base);if(!bf)continue;
  const regs=registerSheets({...project,sheets:[base,sheet]},texts),br=regs[base.id],sr=regs[sheet.id];if(!br||!sr)continue;
  const ba=Math.cos(br.rotation??0)*base.metersPerPoint!,bb=Math.sin(br.rotation??0)*base.metersPerPoint!,den=ba*ba+bb*bb,ca=(bf.a*ba+bf.b*bb)/den,cb=(bf.b*ba-bf.a*bb)/den;
  const sa=Math.cos(sr.rotation??0)*sheet.metersPerPoint!,sb=Math.sin(sr.rotation??0)*sheet.metersPerPoint!;
  candidates.push({a:ca*sa-cb*sb,b:cb*sa+ca*sb,tx:bf.tx+ca*(-sr.x+br.x)-cb*(-sr.y+br.y),ty:bf.ty+cb*(-sr.x+br.x)+ca*(-sr.y+br.y),residual:bf.residual});
 }
 if(!candidates.length)return null;
 const points:Pt[]=[[0,0],[sheet.width,sheet.height]];
 if(candidates.some(f=>points.some(p=>{const a=worldPoint(p,f),b=worldPoint(p,candidates[0]);return Math.hypot(a[0]-b[0],a[1]-b[1])>.025;})))return null;
 return candidates[0];
}
/** A floor post must be traced below its head-storey datum, so a stacked
 * roof post at the same grid cannot be mistaken for this member. */
export function traceFloorPost(lines:Line[],x:number,headDatumY:number,baseDatumY:number,scale:number,width:number) {
  if (!(baseDatumY > headDatumY)) return null;
  return traceSectionPost(lines.filter(l=>Math.min(l.y1,l.y2)>headDatumY),x,baseDatumY,scale,width);
}
function planRectangle(
  lines: Line[],
  at: Pt,
  scale: number,
  width: number,
  depth: number,
): {
  at: Pt;
  width: number;
  depth: number;
  box: [number, number, number, number];
} | null {
  const near = lines.filter(
    (l) =>
      !l.filled &&
      !l.curve &&
      Math.hypot(
        Math.max(Math.min(l.x1, l.x2) - at[0], 0, at[0] - Math.max(l.x1, l.x2)),
        Math.max(Math.min(l.y1, l.y2) - at[1], 0, at[1] - Math.max(l.y1, l.y2)),
      ) < 40,
  );
  const candidates: {
    at: Pt;
    width: number;
    depth: number;
    box: [number, number, number, number];
  }[] = [];
  for (const top of near.filter(horizontal))
    for (const [w, d] of [
      [width, depth],
      [depth, width],
    ]) {
      const x0 = Math.min(top.x1, top.x2),
        x1 = Math.max(top.x1, top.x2),
        y0 = top.y1;
      if (Math.abs((x1 - x0) * scale - w) > 0.008) continue;
      const bottom = near.find(
        (l) =>
          horizontal(l) &&
          Math.abs(Math.min(l.x1, l.x2) - x0) < 0.1 &&
          Math.abs(Math.max(l.x1, l.x2) - x1) < 0.1 &&
          Math.abs((l.y1 - y0) * scale - d) < 0.008,
      );
      if (!bottom) continue;
      const y1 = bottom.y1;
      if (
        ![x0, x1].every((x) =>
          near.some(
            (l) =>
              vertical(l) &&
              Math.abs(l.x1 - x) < 0.1 &&
              Math.min(l.y1, l.y2) <= y0 + 0.1 &&
              Math.max(l.y1, l.y2) >= y1 - 0.1,
          ),
        )
      )
        continue;
      const center: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (
        !candidates.some(
          (c) => Math.hypot(c.at[0] - center[0], c.at[1] - center[1]) < 0.3,
        )
      )
        candidates.push({
          at: center,
          width: w,
          depth: d,
          box: [x0, y0, x1, y1],
        });
    }
  return candidates.length === 1 ? candidates[0] : null;
}
export function connectSourceColumns(
  project: Project,
  model: BuildModel,
  texts: DrawingTexts,
  lines: DrawingLines,
  registeredFrames:Record<string,SheetFrame> = {},
): BuildModel {
  const regs = roofViewportRegistrations(project, model, texts),
    sections = structuralSections(project, texts),
    hssPlans = hssColumnPlanSections(project, texts);
  // A separate 1:50 canopy view must use its own independently corroborated
  // grid frame. Its entry-canopy datum is NOT a column base or top.
  for(const [id,r] of Object.entries(canopyRegistrations(project,model,texts,lines))) {
    if(regs[id])continue;
    regs[id]={frame:r.frame,metersPerPoint:r.metersPerPoint,title:r.title,
      bounds:r.bounds,grids:r.grids,source:r.sources[0]};
  }
  // Calibrated single floor plans can share the same source-section tracer.
  // Their frame must already be established by model/source correspondences.
  for (const sheet of project.sheets.filter(s => !s.superseded && /FRAMING/.test(s.title ?? '') && !/ROOF/.test(s.title ?? '') && s.metersPerPoint)) {
    const ts = texts[sheet.id] ?? [], axes = gridAxes(ts, sheet.width, sheet.height);
    const xs = Object.entries(axes).filter(([k,v]) => /^\d+$/.test(k) && v.axis === 'x').map(([,v])=>v.at);
    const ys = Object.entries(axes).filter(([k,v]) => /^[A-Z]$/.test(k) && v.axis === 'y').map(([,v])=>v.at);
    const frame = registeredFrames[sheet.id] ?? floorColumnFrame(project, model, sheet, texts);
    if (!frame || xs.length < 3 || ys.length < 3) continue;
    for (const m of project.measurements.filter(m=>m.sheetId===sheet.id && m.points.length===1)) regs[m.id] = {
      frame, metersPerPoint:sheet.metersPerPoint!, title:'FLOOR FRAMING', bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)], grids:Object.keys(axes),
      source:{kind:'sheet',id:sheet.id,page:sheet.page,label:sheet.name,quote:'Calibrated floor framing plan, existing model coordinate frame and matching grid envelope.'},
    };
  }
  const joinedPlans = new Map<string, Line[]>();
  const located = new Map<
    string,
    ColumnPlanWitness
  >();
  const resolved = new Map<
    string,
    {
      at: Pt;
      z: number;
      height: number;
      width: number;
      depth: number;
      rotation: number;
      domain: string;
      sources: SourceRef[];
    }
  >();
  for (const e of model.elements) {
    const code = e.typeName.match(/^(C\d+)\b/)?.[1],
      r = regs[e.measurementId],
      sec = code ? sections[code] ?? (r?.title === 'CANOPY FRAMING PLAN' && /\bHSS\b/i.test(e.typeName) ? hssPlans[code] : undefined) : undefined,
      m = project.measurements.find((m) => m.id === e.measurementId);
    if (!sec || sec.conflict || !r || !m || m.points.length !== 1) continue;
    if (!joinedPlans.has(m.sheetId)) {
      const raw = lines[m.sheetId] ?? [];
      joinedPlans.set(m.sheetId, [...raw, ...joinCollinearRoofStrokes(raw)]);
    }
    const pt = texts[m.sheetId] ?? [],
      pl = joinedPlans.get(m.sheetId)!,
      rect = r.title === 'CANOPY FRAMING PLAN' && code && hssPlans[code] === sec
        ? roundedColumnFootprint(lines[m.sheetId]??[],m.points[0],r.metersPerPoint,sec.width,sec.depth,hssPlans[code].wall)
        : planRectangle(pl,m.points[0],r.metersPerPoint,sec.width,sec.depth);
    if (!rect) continue;
    located.set(e.id, {
      at: worldPoint(rect.at, r.frame),
      ring: [[rect.box[0],rect.box[1]],[rect.box[2],rect.box[1]],[rect.box[2],rect.box[3]],[rect.box[0],rect.box[3]]].map(p=>worldPoint(p as Pt,r.frame)),
      code: code!,
      schedule: code && hssPlans[code] === sec ? sec.source : undefined,
      domain: r.title === 'CANOPY FRAMING PLAN' ? 'canopy' : r.title === 'FLOOR FRAMING' ? 'floor' : 'roof',
      width: rect.width,
      depth: rect.depth,
      source: {kind:'sheet',id:m.sheetId,page:r.source.page,label:r.source.label,box:rect.box,quote:r.source.quote},
    });
    // Retain the footprint, but do not borrow a roof post or canopy datum as
    // the height of this independently registered detail record.
    if(r.title === 'CANOPY FRAMING PLAN')continue;
    const letter = pt
      .filter(
        (t) =>
          /^[A-Z]$/.test(t.str.trim()) &&
          Math.abs(t.cy - rect.at[1]) < 2 &&
          t.cx < r.bounds[0] &&
          t.cx > r.bounds[0] - 300,
      )
      .sort(
        (a, b) => Math.abs(a.cy - rect.at[1]) - Math.abs(b.cy - rect.at[1]),
      )[0];
    if (!letter) continue;
    const proofs: { z: number; height: number; source: SourceRef }[] = [];
    for (const ref of pt.filter(
      (t) =>
        /^S\d/.test(t.str.trim()) &&
        t.cy < r.bounds[1] &&
        r.bounds[1] - t.cy < 150 &&
        Math.abs(t.cx - rect.at[0]) < 22,
    )) {
      const num = pt.find(
        (t) =>
          /^\d+$/.test(t.str.trim()) &&
          Math.abs(t.cx - ref.cx) < 2 &&
          ref.cy - t.cy > 8 &&
          ref.cy - t.cy < 18,
      );
      if (!num) continue;
      const grid = pt.filter(
        (t) =>
          /^\d+$/.test(t.str.trim()) &&
          Math.abs(t.cx - rect.at[0]) < 1 &&
          t.cy < ref.cy &&
          pt.filter(
            (v) => /^\d+$/.test(v.str.trim()) && Math.abs(v.cy - t.cy) < 1,
          ).length >= 3,
      );
      if (grid.length !== 1) continue;
      const sheet = project.sheets.find(
        (s) => !s.superseded && s.name === ref.str.trim(),
      );
      if (!sheet) continue;
      const st = texts[sheet.id] ?? [],
        sl = lines[sheet.id] ?? [],
        title = st.find((t) =>
          new RegExp(`^BUILDING SECTION\\s*-\\s*${num.str}$`, 'i').test(t.str),
        );
      if (!title) continue;
      const scaleText = st.find(
          (t) =>
            /1\s*:\s*\d+/.test(t.str) &&
            t.cy > title.cy &&
            t.cy - title.cy < 25 &&
            Math.abs(t.cx - title.cx) < 110,
        ),
        match = scaleText?.str.match(/1\s*:\s*(\d+)/);
      if (!match) continue;
      const scale = (+match[1] * 0.0254) / 72;
      const sg = st
        .filter(
          (t) =>
            t.str === letter.str &&
            t.cx > title.cx - 50 &&
            t.cx < title.cx + 850 &&
            t.cy < title.cy - 100 &&
            title.cy - t.cy < 650,
        )
        .sort((a, b) => b.cy - a.cy)[0];
      if (!sg) continue;
      const datum = (label: RegExp) => {
        const t = st.find(
          (t) =>
            label.test(t.str) &&
            t.cx > title.cx &&
            t.cx < title.cx + 850 &&
            t.cy > sg.cy &&
            t.cy < title.cy,
        );
        if (!t) return null;
        const n = st.filter(
          (v) =>
            /^\d{1,5}$/.test(v.str.trim()) &&
            Math.abs(v.cx - t.cx) < 60 &&
            v.cy - t.cy > 5 &&
            v.cy - t.cy < 11,
        );
        if (n.length !== 1) return null;
        const y = (n[0].cy + t.cy) / 2;
        const leaders = sl.filter(
          (l) =>
            horizontal(l) &&
            Math.abs(l.y1 - y) < 0.4 &&
            Math.abs((l.x1 + l.x2) / 2 - t.cx) < 80 &&
            Math.abs(l.x2 - l.x1) > 3,
        );
        const clusters = leaders
          .map((l) => ({
            y: l.y1,
            n: leaders.filter((v) => Math.abs(v.y1 - l.y1) < 0.05).length,
          }))
          .filter((c) => c.n >= 3)
          .sort((a, b) => b.n - a.n || Math.abs(a.y - y) - Math.abs(b.y - y));
        if (!clusters.length) return null;
        return { y: clusters[0].y, z: +n[0].str / 1000 };
      };
      const floor = datum(/^FIN\. SECOND FLOOR$/),
        ground = datum(/^FIN\. GROUND FLOOR$/);
      if (
        !floor ||
        !ground ||
        Math.abs((ground.y - floor.y) * scale - (floor.z - ground.z)) > 0.015
      )
        continue;
      const post = r.title === 'FLOOR FRAMING'
        ? traceFloorPost(sl,sg.cx,floor.y,ground.y,scale,rect.depth)
        : traceSectionPost(sl.filter(l=>Math.min(l.y1,l.y2)>sg.cy),sg.cx,floor.y,scale,rect.depth);
      if (!post) continue;
      const z = floor.z + (floor.y - post.bottom) * scale,
        height = (post.bottom - post.top) * scale;
      if (height < 1 || height > 12) continue;
      proofs.push({
        z,
        height,
        source: {
          kind: 'sheet',
          id: sheet.id,
          page: sheet.page,
          label: sheet.name,
          box: [sg.cx - 20, post.top - 10, sg.cx + 20, post.bottom + 10],
          quote: `${num.str}/${sheet.name}, grids ${grid[0].str}/${letter.str}: column faces and closed top/base traced at ${scaleText!.str}; section scale checked against floor datums ${floor.z}m/${ground.z}m. Base ${z.toFixed(3)}m, top ${(z + height).toFixed(3)}m. Section quantisation tolerance 20mm; height inferred from calibrated section linework, not fabrication dimensions.`,
        },
      });
    }
    if (
      !proofs.length ||
      proofs.some(
        (p) =>
          Math.abs(p.z - proofs[0].z) > 0.02 ||
          Math.abs(p.height - proofs[0].height) > 0.02,
      )
    )
      continue;
    resolved.set(e.id, {
      at: worldPoint(rect.at, r.frame),
      z: proofs[0].z,
      height: proofs[0].height,
      width: rect.width,
      depth: rect.depth,
      rotation: Math.atan2(r.frame.b, r.frame.a),
      domain: r.title === 'FLOOR FRAMING' ? 'floor' : 'roof',
      sources: [
        r.source,
        sec.source,
        {
          kind: 'sheet',
          id: m.sheetId,
          page: r.source.page,
          label: r.source.label,
          box: rect.box,
          quote: `${code}: closed plan column rectangle matches scheduled section within 8mm; centre comes from the rectangle, not the nearby takeoff tag.`,
        },
        ...proofs.map((p) => p.source),
      ],
    });
  }
  // Repeated high/low viewport records can describe the SAME physical post.
  const duplicates = new Map<string, string>();
  for (const [id, p] of [...resolved].sort(([a], [b]) => a.localeCompare(b))) {
    const earlier = [...resolved]
      .filter(
        ([other, q]) =>
          other < id &&
          Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) < 0.01 &&
          Math.abs(q.z - p.z) < 0.02 &&
          Math.abs(q.height - p.height) < 0.02 &&
          q.width === p.width &&
          q.depth === p.depth,
      )
      .sort(([a], [b]) => a.localeCompare(b))[0];
    if (earlier) duplicates.set(id, earlier[0]);
  }
  // A second viewport tag at the same drawn column centre is retained as a
  // coincident candidate; the continuous section-traced post is drawn once.
  for (const [id, p] of located) {
    if (resolved.has(id)) continue;
    const matches = [...resolved].filter(
      ([other, q]) =>
        !duplicates.has(other) &&
        Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) < 0.01 &&
        q.width === p.width &&
        q.depth === p.depth &&
        located.get(other)?.code === p.code &&
        located.get(other)?.domain === p.domain,
    );
    if (matches.length === 1) {
      duplicates.set(id, matches[0][0]);
      resolved.set(id, matches[0][1]);
    }
  }
  return retainColumnPlanEvidence({
    ...model,
    elements: model.elements.map((e) => {
      const p = resolved.get(e.id);
      if (!p)
        return e.issues.some((i) => /^Physical (roof|floor) column:/.test(i))
          ? {
              ...e,
              shape: null,
              placement: 'unknown' as const,
              issues: [
                ...e.issues.filter(
                  (i) => !/^Physical (roof|floor) column:/.test(i),
                ),
                `Physical ${e.issues.some(i=>i.startsWith('Physical floor column:'))?'floor':'roof'} column: current source geometry does not requalify this post; prior solid withheld.`,
              ],
            }
          : e;
      const duplicate = duplicates.get(e.id);
      return {
        ...e,
        shape: duplicate
          ? null
          : {
              type: 'point' as const,
              at: p.at,
              z: p.z,
              size: [p.width, p.depth, p.height] as [number, number, number],
              rotation: p.rotation,
            },
        placement: 'inferred' as const,
        sources: [
          ...new Map(
            [...e.sources, ...p.sources].map((s) => [JSON.stringify(s), s]),
          ).values(),
        ],
        issues: [
          ...e.issues.filter((i) => !/^Physical (roof|floor) column:/.test(i)),
          duplicate
            ? `Physical ${p.domain} column: coincident viewport record; physical post displayed by ${duplicate}. Original quantity retained and unreconciled.`
            : `Physical ${p.domain} column: registered plan rectangle and directly matched section faces determine placement and height. Section quantisation is approximately 10–20mm. Drawn post tops are retained without assuming beam undersides; beam/post joint and bearing fabrication details remain inferred; quantity retained.`,
        ],
      };
    }),
  }, located);
}
