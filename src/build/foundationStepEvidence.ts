import type { BuildElement, BuildModel, SourceRef } from './types';
import type { DrawingTexts } from './building';
import { sheetPoint, type SheetFrame } from './sheetCoordinates';

const prefix = 'Foundation revision unresolved: drawn footing step';
const label = 'Revised stepped footing';
/** Explain held axes using their registered plan evidence; never manufacture
 * a transition profile or convert a maximum rise into an actual elevation. */
export function explainFoundationSteps(
  model: BuildModel,
  plan: { docId: string; page: number; sheetId: string; frame: SheetFrame },
  widths: number[],
  crosses: (axis: number, a: number, b: number, lo: number, hi: number) => boolean,
  texts: DrawingTexts,
  pages: { docId: string; page: number }[],
): BuildModel {
  const details: SourceRef[] = pages.filter(p => p.docId === plan.docId).flatMap(p => {
    const titles = (texts[`spec:${p.docId}:${p.page}`] ?? []).filter(t => /^DETAIL\s*-\s*STEPPED FOOTING$/i.test(t.str.trim()));
    return titles.map(t => ({ kind: 'spec' as const, id: p.docId, page: p.page,
      label: `${label} detail`, quote: t.str + '. Reference detail only; local transition placement is not established.' }));
  });
  const scale = Math.hypot(plan.frame.a, plan.frame.b);
  const elements = model.elements.map((e): BuildElement => {
    const issues = e.issues.filter(i => !i.startsWith(prefix));
    const sources = e.sources.filter(s => !s.label.startsWith(label));
    const clean = { ...e, issues, sources };
    if (e.measurementSource !== 'foundations' || e.sheetId !== plan.sheetId ||
      !/^SF-?\d+\b/i.test(e.typeName) || e.shape?.type !== 'axis' || !(scale > 0)) return clean;
    const points = e.shape.points.map(p => sheetPoint(p, plan.frame));
    const boxes: number[][] = [];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i];
      const axis = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]) ? 0 : 1;
      const cross = 1 - axis;
      if (Math.abs(q[cross] - p[cross]) * scale > .03) continue;
      const center = (p[cross] + q[cross]) / 2;
      const lo = Math.min(p[axis], q[axis]), hi = Math.max(p[axis], q[axis]);
      for (const width of widths.filter(w => Number.isFinite(w) && w > 0)) {
        const a = center - width / scale / 2, b = center + width / scale / 2;
        if (crosses(axis, a, b, lo, hi)) boxes.push(axis === 0 ? [lo,a,hi,b] : [a,lo,b,hi]);
      }
    }
    if (!boxes.length) return clean;
    return { ...clean, issues: [...issues,
      `${prefix} interrupts this measured axis. Transition-face placement, local elevations and the sloping underside must be reconciled before a physical solid can be shown. A typical maximum rise is not an actual rise.`],
      sources: [...sources, { kind: 'spec', id: plan.docId, page: plan.page,
        label: `${label} plan evidence`,
        quote: 'Drawn step crossbar matches both local footing-edge pens. This is a step location, not a proven transition start or end.',
        box: [Math.min(...boxes.map(b=>b[0])), Math.min(...boxes.map(b=>b[1])), Math.max(...boxes.map(b=>b[2])), Math.max(...boxes.map(b=>b[3]))],
      }, ...details],
    };
  });
  return { ...model, elements };
}
