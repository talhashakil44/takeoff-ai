import { inkRuns, type InkRun } from '../fill/inkRuns';
import { ductSizes, joinRuns, sizeRuns, type PairedRun } from '../fill/runs';
import { newId, type Measurement, type Project, type Pt, type Sheet, type TakeoffType } from '../model';
import { tradeOfNumber } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { toLength } from '../units';
import { replaceRun, type Automation } from './result';
import { pipeTag } from './pipes';
import { tradeGroups } from './runs';
import { pause, perSheet, type SetAccess } from './set';

/**
 * Ductwork on HVAC plans drawn without CAD layers, by its size labels. Engineers draw ducts as
 * bands of light grey tone between their two sides; the sheet is drawn and those bands read off
 * it (fill/inkRuns, tone mode), so this works whether the plan is linework or a pasted picture.
 * Each band takes the size of the nearest label whose width matches its plan width ("300x250
 * S/A" beside a 300 mm wide band); bands no label matches are left out (equipment, hatching,
 * shading are bands too). Risers, drops, fittings and flex runouts are not measured.
 */

export interface DuctsResult extends Automation {
  checks: string[];
}

/** HVAC plans at a plan scale. */
function isDuctPlan(s: Sheet): boolean {
  if (s.superseded || !s.metersPerPoint || s.metersPerPoint < 0.008) return false;
  const trade = tradeOfNumber(s.name ?? '');
  if (!trade || !/^(M|MD|MH)$/.test(trade)) return false;
  return !/\b(DETAILS?|SCHEDULES?|DIAGRAMS?|RISER|SECTIONS?|ELEVATIONS?|LEGEND|NOTES)\b/i.test(s.title ?? '') || /\bPLANS?\b/i.test(s.title ?? '');
}

/**
 * Two bands lying side by side along the same stretch, as one band as wide as both: a duct drawn
 * in two tones (lit and shaded halves). Returned with the indices of the pair.
 */
export function sideBySide(runs: InkRun[]): { run: InkRun; of: [number, number] }[] {
  const horiz = (r: InkRun) => Math.abs(r.b[1] - r.a[1]) < Math.abs(r.b[0] - r.a[0]);
  const band = (r: InkRun) => {
    const h = horiz(r);
    return { h, at: h ? r.a[1] : r.a[0], lo: h ? Math.min(r.a[0], r.b[0]) : Math.min(r.a[1], r.b[1]), hi: h ? Math.max(r.a[0], r.b[0]) : Math.max(r.a[1], r.b[1]), w: r.width };
  };
  const bands = runs.map(band);
  const out: { run: InkRun; of: [number, number] }[] = [];
  for (let i = 0; i < bands.length; i++)
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i];
      const b = bands[j];
      if (a.h !== b.h) continue;
      const lo = Math.max(a.lo, b.lo);
      const hi = Math.min(a.hi, b.hi);
      if (hi - lo < 0.7 * Math.min(a.hi - a.lo, b.hi - b.lo)) continue;
      if (Math.abs(a.at - b.at) > (a.w + b.w) / 2 + 1.5) continue;
      const top = Math.min(a.at - a.w / 2, b.at - b.w / 2);
      const bottom = Math.max(a.at + a.w / 2, b.at + b.w / 2);
      const at = (top + bottom) / 2;
      out.push({ run: { a: a.h ? [lo, at] : [at, lo], b: a.h ? [hi, at] : [at, hi], width: bottom - top }, of: [i, j] });
    }
  return out;
}

export async function automateDucts(p: Project, access: SetAccess): Promise<DuctsResult> {
  const metric = p.units === 'metric';
  const checks: string[] = [];
  const plans = p.sheets.filter(isDuctPlan);
  if (!plans.length) return { message: 'No HVAC plans with a scale.', checks };
  const fresh: TakeoffType[] = [];
  const added: Measurement[] = [];
  const totals = new Map<string, number>();
  let read = 0;
  for (const [i, s] of plans.entries()) {
    access.progress?.(`Ductwork… ${s.name} (${i + 1} of ${plans.length})`);
    await pause();
    await perSheet(access, s, async () => {
      const layers = (await access.layers?.(s)) ?? new Map<string, string>();
      if (layers.size && tradeGroups((await access.segments(s)) ?? [], layers, null).length) return;
      const texts = await access.texts(s);
      // A pipe label ("75Ø SAN") is not a round duct size.
      const sizes = ductSizes(texts.filter((t) => !pipeTag(t.str)));
      if (sizes.length < 3) return;
      const page = await access.page(s);
      if (!page) return;
      const mpp = s.metersPerPoint!;
      const pt = (m: number) => m / mpp;
      const tb = titleBlockBox(texts, s.width, s.height);
      const bands = await inkRuns(page as never, { minLength: pt(0.4), maxWidth: Math.min(pt(1.3), 60), tone: { lo: 150, hi: 240, minWidth: Math.max(pt(0.08), 2) }, skip: tb ? [tb] : [] });
      if (!bands?.length) return;
      read++;
      const unit = metric ? pt(0.001) : pt(0.0254);
      const asRun = (r: InkRun) => ({ a: r.a, b: r.b, width: r.width }) as PairedRun;
      // Each band by its own width first; then two unsized bands side by side as one duct.
      const first = sizeRuns(bands.map(asRun), sizes, unit, metric);
      const runs: PairedRun[] = [];
      const sized: (typeof first)[number][] = [];
      const used = new Set<number>();
      bands.forEach((b, k) => {
        if (first[k]) {
          runs.push(asRun(b));
          sized.push(first[k]);
          used.add(k);
        }
      });
      const pairs = sideBySide(bands).filter((x) => !used.has(x.of[0]) && !used.has(x.of[1]));
      const second = sizeRuns(pairs.map((x) => asRun(x.run)), sizes, unit, metric);
      pairs.forEach((x, k) => {
        if (!second[k] || used.has(x.of[0]) || used.has(x.of[1])) return;
        runs.push(asRun(x.run));
        sized.push(second[k]);
        used.add(x.of[0]);
        used.add(x.of[1]);
      });
      const bySize = new Map<string, Pt[][]>();
      runs.forEach((r, k) => {
        const z = sized[k];
        if (z) (bySize.get(z.text) ?? bySize.set(z.text, []).get(z.text)!).push([r.a, r.b]);
      });
      for (const [text, list] of bySize) {
        const z = sizes.find((x) => x.text === text)!;
        const name = z.h === null ? `Duct ${z.w}${metric ? ' mm' : '"'} round` : `Duct ${z.w}x${z.h}`;
        const toUnit = (n: number) => toLength(n * (metric ? 0.001 : 0.0254), p.units);
        let t = p.types.find((x) => x.name === name) ?? fresh.find((x) => x.name === name);
        if (!t) {
          t = {
            id: newId(),
            name,
            color: '#7e57c2',
            kind: 'linear',
            height: 0,
            width: toUnit(z.w),
            ...(z.h !== null ? { depth: toUnit(z.h) } : {}),
            division: '23 HVAC',
            package: 'Mechanical sub',
            description: `${text} duct, measured along its centreline on the plans by its size label.`,
            items: [
              z.h === null
                ? { id: newId(), name: 'Sheet metal (round, πD × L)', unit: metric ? 'm²' : 'SF', formula: 'L * 3.1416 * W' }
                : { id: newId(), name: 'Sheet metal (2(W + D) × L)', unit: metric ? 'm²' : 'SF', formula: 'L * 2 * (W + D)' },
              { id: newId(), name: 'Duct length', unit: metric ? 'm' : 'ft', formula: 'L' },
            ],
          };
          fresh.push(t);
        }
        for (const l of joinRuns(list, pt(0.9), pt(0.1))) {
          added.push({ id: newId(), sheetId: s.id, typeId: t.id, points: l, holes: [], source: 'ducts', label: text });
          const len = l.slice(1).reduce((n, q, x) => n + Math.hypot(q[0] - l[x][0], q[1] - l[x][1]), 0) * mpp;
          totals.set(name, (totals.get(name) ?? 0) + len);
        }
      }
    });
  }
  if (!read) return { message: 'No HVAC plans without layers with duct size labels.', checks };
  if (!added.length) return { message: 'No ducts matched their size labels on the HVAC plans.', checks };
  checks.push('Ductwork on the HVAC plans without CAD layers is measured from the ducts drawn in tone, each by the nearest label of its width. Unlabelled ducts, risers, drops, fittings and flex runouts are not in the lengths: check the plans.');
  const top = [...totals].sort((a, b) => b[1] - a[1]);
  const conv = (m: number) => Math.round(metric ? m : m / 0.3048);
  return {
    message: `${conv(top.reduce((n, [, v]) => n + v, 0))} ${metric ? 'm' : 'ft'} of ductwork by size label: ${top.slice(0, 6).map(([n, v]) => `${conv(v)} ${n.replace(/^Duct /, '')}`).join(', ')}${top.length > 6 ? ` and ${top.length - 6} more` : ''}`,
    checks,
    apply: (q) => replaceRun(q, 'ducts', fresh, added),
  };
}
