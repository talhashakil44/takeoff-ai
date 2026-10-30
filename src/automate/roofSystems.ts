import { drawSegments, floodFill, makeGrid, simplify, toSheet, traceBoundary } from '../fill/raster';
import type { Segment } from '../fill/vectors';
import { ringArea } from '../geometry';
import { newId, type AssemblyItem, type Measurement, type Project, type Pt, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { viewScaleAt } from '../sheetViews';
import { box } from './foundations';
import { replaceRun, type Automation } from './result';
import { perSheet, type SetAccess } from './set';
import { isFramingPlan } from './structure';

/**
 * A roof (or floor) system the framing plans tag by area (Kelso S2.1: R1 wood deck, R2 glulam
 * purlins at 1200 o.c., R3 2x8 joists at 400 o.c.): its legend entry, and the members it is
 * framed with at their spacing.
 */
export interface FramingSystem {
  mark: string;
  name: string;
  /** What its legend entry says, line by line. */
  says: string[];
  /** The members spanning it ("PURLINS: 175 x 342 GLULAM"), their size and spacing in mm. */
  members?: { what: string; size: string; spacing: number };
}

const HEADING = /^(ROOF|FLOOR)\s+SYSTEM\s+No\.?\s*(\d+)\.?$/i;

/** The roof and floor systems a sheet's assembly schedule lists, each with the tag it is drawn with (R2 beside ROOF SYSTEM No 2). */
export function framingSystems(texts: PageText[]): FramingSystem[] {
  const heads = texts.filter((t) => HEADING.test(t.str.trim()));
  const out: FramingSystem[] = [];
  for (const h of heads) {
    const [, kind, n] = HEADING.exec(h.str.trim())!;
    const mark = `${kind[0].toUpperCase()}${n}`;
    // Its entry: the lines under it in its column, down to the next heading in that column.
    const below = heads.filter((o) => o !== h && Math.abs(o.cx - h.cx) < 60 && o.cy > h.cy).sort((a, b) => a.cy - b.cy)[0];
    const end = below ? below.cy - 1 : h.cy + 80;
    const lines = texts
      .filter((t) => t !== h && t.cy > h.cy && t.cy < end && t.cx > h.cx - h.w / 2 - 20 && t.cx - t.w / 2 < h.cx + h.w / 2 + 80 && !/^[RF]\d$/.test(t.str.trim()))
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
      .map((t) => t.str.trim());
    const all = lines.join(' ');
    const member = /\b(PURLINS|JOISTS|RAFTERS|BEAMS)\s*:\s*([^:]+?)(?=\s+(?:AT|@)\s|\s+[A-Z]+\s*:|$)/i.exec(all);
    const spacing = /\b(?:AT|@)\s*(\d{3,4})\s*O\.?\s*C\.?/i.exec(all);
    out.push({
      mark,
      name: `${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()} system ${n}`,
      says: lines,
      ...(member && spacing ? { members: { what: member[1].toUpperCase(), size: member[2].trim(), spacing: +spacing[1] } } : {}),
    });
  }
  return out;
}

/**
 * The area a system's tag sits in, outlined on the plan the way framing plans outline system
 * areas: a light dashed boundary. Each light style of short strokes is tried: drawn alone (dash
 * gaps closed), the region the tag is in, if closed and of a plausible size. Null when no style
 * closes round the tag.
 */
export function systemZone(at: Pt, segs: Segment[], within: [number, number, number, number], mpp: number): Pt[] | null {
  const light = (c?: string) => !!c && /^#([0-9a-f]{2})\1\1$/i.test(c) && parseInt(c.slice(1, 3), 16) >= 0x80 && parseInt(c.slice(1, 3), 16) < 0xf0;
  const styles = new Map<string, Segment[]>();
  for (const s of segs) {
    if (s.filled || s.curve || !light(s.color)) continue;
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (L < 1 || L > 40) continue;
    const key = `${s.color}/${s.width.toFixed(2)}`;
    styles.set(key, [...(styles.get(key) ?? []), s]);
  }
  const [x0, y0, x1, y1] = within;
  const res = 0.5; // 2 points a pixel
  const minArea = 10 / (mpp * mpp); // 10 m², in points²
  const maxArea = (x1 - x0) * (y1 - y0) * 0.9;
  let best: Pt[] | null = null;
  for (const [, strokes] of [...styles].sort((a, b) => b[1].length - a[1].length)) {
    if (strokes.length < 20) continue;
    const g = makeGrid(x0, y0, x1 - x0, y1 - y0, res);
    drawSegments(g, strokes);
    const close = 3; // dash gaps up to about 12 points
    g.data = box(g.data, g.w, g.h, close, false);
    const f = floodFill(g, Math.round((at[0] - x0) * res), Math.round((at[1] - y0) * res));
    if (!f.pixels || f.touchesEdge) continue;
    const grown = box(f.region, g.w, g.h, close, false);
    const ring = toSheet(g, simplify(traceBoundary(grown, g.w, g.h), 1.5));
    const area = ringArea(ring);
    if (ring.length < 4 || area < minArea || area > maxArea) continue;
    if (!best || area < ringArea(best)) best = ring;
  }
  return best;
}

const inside = (p: Pt, ring: Pt[]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const item = (name: string, unit: string, formula: string): AssemblyItem => ({ id: newId(), name, unit, formula });

/**
 * Roof and floor systems by area: each system tag on a framing plan, the area its dashed boundary
 * outlines, and the members framing it from the plan's assembly schedule (purlins at 1200 o.c.:
 * area / 1.2 m of purlin). Only where the plan (or the drawing the tag is in) has a scale.
 */
export async function automateRoofSystems(p: Project, access: SetAccess): Promise<Automation> {
  const metric = p.units === 'metric';
  const types = new Map<string, TakeoffType>();
  const added: Measurement[] = [];
  const checks: string[] = [];
  for (const s of p.sheets) {
    if (s.superseded) continue;
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      if (!texts.some((t) => HEADING.test(t.str.trim())) || !isFramingPlan(s, texts)) return;
      const systems = framingSystems(texts);
      if (!systems.length) return;
      const segs = (await access.segments(s)) ?? [];
      const legend = texts.filter((t) => HEADING.test(t.str.trim()));
      const lx0 = Math.min(...legend.map((t) => t.cx)) - 150;
      const ly0 = Math.min(...legend.map((t) => t.cy)) - 30;
      const zones: { sys: FramingSystem; ring: Pt[] }[] = [];
      for (const t of texts) {
        const sys = systems.find((x) => x.mark === t.str.trim());
        if (!sys || (t.cx > lx0 && t.cy > ly0)) continue; // the legend's own symbol
        const at: Pt = [t.cx, t.cy];
        const view = viewScaleAt(s.views, [at]);
        const mpp = s.metersPerPoint ?? view?.metersPerPoint;
        if (!mpp) continue;
        const within = (view?.box ?? [0, 0, s.width, s.height]) as [number, number, number, number];
        if (zones.some((z) => z.sys === sys && inside(at, z.ring))) continue;
        const ring = systemZone(at, segs, within, mpp);
        if (!ring || zones.some((z) => z.sys === sys && inside(ring[0], z.ring) && Math.abs(ringArea(z.ring) - ringArea(ring)) < 1)) continue;
        zones.push({ sys, ring });
      }
      for (const { sys, ring } of zones) {
        let t = types.get(sys.mark);
        if (!t) {
          const m = sys.members;
          const per = m ? (metric ? `${m.spacing / 1000}` : `${(m.spacing / 304.8).toFixed(3)}`) : '';
          t = {
            id: newId(),
            name: `${sys.mark} – ${sys.name}${m ? `: ${m.what.toLowerCase()} ${m.size} @ ${m.spacing}` : ''}`,
            color: '#8fa86a',
            kind: 'area',
            height: 0,
            division: '06 Wood, Plastics & Composites',
            package: 'Framing sub',
            description: `${s.name} assembly schedule: ${sys.says.join(' · ')}. The area the plan's dashed boundary outlines round the ${sys.mark} tag.${m ? ` ${m.what.toLowerCase()} by area at ${m.spacing} o.c.: check the layout (curbs, openings, end members).` : ''}`,
            items: [item('Area', metric ? 'm²' : 'SF', 'A'), ...(m ? [item(`${m.what[0]}${m.what.slice(1).toLowerCase()} ${m.size}`, metric ? 'm' : 'ft', `A / ${per}`)] : [])],
          };
          types.set(sys.mark, t);
        }
        added.push({ id: newId(), sheetId: s.id, typeId: t.id, points: ring, holes: [], source: 'roofs', label: sys.mark });
      }
      const missed = systems.filter((x) => !zones.some((z) => z.sys === x)).map((x) => x.mark);
      if (missed.length) checks.push(`${s.name}: no outlined area found for ${missed.join(', ')}. Draw ${missed.length === 1 ? 'it' : 'them'} by hand.`);
    });
  }
  if (!added.length) return { message: ['No roof or floor system areas outlined on the framing plans.', ...checks].join(' ') };
  const list = [...types.values()];
  return {
    message: [list.map((t) => `${added.filter((m) => m.typeId === t.id).length} ${t.name.split(' – ')[0]}`).join(', ') + ' system areas', ...checks].join('. '),
    apply: (q: Project) => replaceRun(q, 'roofs', list, added),
  };
}

