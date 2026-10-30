import { newId, type AssemblyItem, type Measurement, type Project, type Pt, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { titleBlockBox } from '../titleBlock';
import { replaceRun, type Automation } from './result';
import { perSheet, type SetAccess } from './set';

/**
 * Site works off the civil and site drawings, by what the engineer writes on them:
 *
 * - every pipe and culvert run labelled with its length, size and service ("80.2m - 75mmØ HDPE
 *   DR17 SANITARY FORCEMAIN", "120 LF - 8\" PVC SAN"), taken at its written length and grouped by
 *   size, material and service; existing runs ("EX. 8.5m - 450mmØ STM") are left out; a run
 *   labelled on both an overall and an enlarged plan counts once;
 * - each road on a plan and profile, its length from the first to the last chainage
 *   (0+000 to 0+275.15), with its width where a site plan writes one ("6.0m WIDE … ROAD").
 *
 * The lengths are the drawings' own (stated), so they need no scale; the takeoff marks where
 * the label is. Grading, paving and erosion control are not taken off here.
 */

export interface PipeLabel {
  meters: number;
  /** Nominal size in millimetres. */
  size: number;
  /** What the run is: material and service, without its slope ("HDPE DR17 SANITARY FORCEMAIN"). */
  what: string;
  existing: boolean;
}

/** A labelled pipe run: "80.2m - 75mmØ HDPE DR17 SANITARY FORCEMAIN", "5.8m-400mmØ CULVERT", "120 LF - 8\" PVC SAN @ 1.0%". */
export function pipeLabel(text: string): PipeLabel | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const existing = /^(EX\.?|EXIST(ING)?\.?)\s/i.test(t);
  const body = t.replace(/^(EX\.?|EXIST(ING)?\.?)\s*/i, '');
  const metric = /^(\d+(?:\.\d+)?)\s*m\s*[-–]\s*(\d+)\s*mm\s*[Ø⌀ø]?\s*(.*)$/i.exec(body);
  const imperial = /^(\d+(?:\.\d+)?)\s*(?:LF|L\.F\.|')\s*(?:OF\s+)?[-–]?\s*(\d+(?:\.\d+)?)\s*(?:"|″|IN\.?)\s*[Ø⌀ø]?\s*(.*)$/i.exec(body);
  const m = metric ?? imperial;
  if (!m) return null;
  const what = m[3]
    .replace(/@.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!/[A-Z]{2}/.test(what)) return null;
  const meters = metric ? Number(m[1]) : Number(m[1]) * 0.3048;
  const size = metric ? Number(m[2]) : Math.round(Number(m[2]) * 25.4);
  if (!(meters > 0 && meters < 5000 && size >= 10 && size <= 3000)) return null;
  return { meters, size, what, existing };
}

/** The service a pipe is for, by its words. */
export function serviceOf(what: string): string {
  if (/CULVERT/.test(what)) return 'Culvert';
  if (/\bSAN|SANITARY|FORCEMAIN|FORCE MAIN|SEWER/.test(what)) return 'Sanitary';
  if (/\bSTM|STORM|DRAIN|SUBDRAIN/.test(what)) return 'Storm';
  if (/\bWTM|WATER|\bWM\b|FIRE ?MAIN|HYDRANT/.test(what)) return 'Water';
  if (/GAS/.test(what)) return 'Gas';
  if (/DUCT|CONDUIT|ELEC|COMM/.test(what)) return 'Utility duct';
  return 'Pipe';
}

/** A granular layer's depth as a section writes it: "450 MIN. GRANULAR B", "150MM GRANULAR 'A'" → [mm, 'A' | 'B']. */
export function granularLayer(text: string): [number, 'A' | 'B'] | null {
  const m = /^(\d{2,4})\s*(?:MM)?\s*(?:MIN\.?\s*)?(?:OF\s+)?GRANULAR\s*['‘’"]?([AB])\b/i.exec(text.trim());
  return m ? [Number(m[1]), m[2].toUpperCase() as 'A' | 'B'] : null;
}

/**
 * The road's granular layers from its typical section: the depths written in the detail above a
 * title naming a road ("TYPICAL GRAVEL ACCESS ROAD"), within the detail's width.
 */
export function roadSection(texts: PageText[]): { A?: number; B?: number; title: string } | null {
  for (const t of texts) {
    if (!/\bTYPICAL\b.*\b(ROAD|ACCESS|LANE|DRIVE)\b|\b(ROAD|ACCESS)\b.*\b(TYPICAL\s+)?SECTION\b/i.test(t.str) || t.h < 9) continue;
    const out: { A?: number; B?: number; title: string } = { title: t.str.trim() };
    for (const x of texts) {
      if (x.cy > t.cy || t.cy - x.cy > 450 || Math.abs(x.cx - t.cx) > 500) continue;
      const g = granularLayer(x.str);
      if (g) out[g[1]] = Math.max(out[g[1]] ?? 0, g[0]);
    }
    if (out.A || out.B) return out;
  }
  return null;
}

/** A chainage: 0+275.15 → 275.15 m; 1+050 → 1050 m. */
export function chainage(text: string): number | null {
  const m = /^(?:STA\.?\s*)?(\d{1,3})\+(\d{2,3}(?:\.\d+)?)$/.exec(text.trim());
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
}

const item = (name: string, unit: string, formula: string): AssemblyItem => ({ id: newId(), name, unit, formula });

export interface SiteResult extends Automation {
  checks: string[];
}

/** A sheet whose own titles call it existing conditions or removals. */
const isExistingPlan = (texts: PageText[]) => texts.some((t) => t.h >= 8 && /EXISTING\s+CONDITIONS|REMOVALS?\s+PLAN|AND\s+REMOVALS/i.test(t.str));

const isSiteSheet = (title: string) => /SITE|SERVICING|GRADING|ROAD|PROFILE|UTILIT|STORM|SANITARY|WATERMAIN|DRAINAGE|CIVIL/i.test(title);

/** The mark for a stated run: a short line under its label. */
const underline = (t: PageText): Pt[] => [
  [t.cx - Math.max(t.w, 10) / 2, t.cy + t.h * 0.8],
  [t.cx + Math.max(t.w, 10) / 2, t.cy + t.h * 0.8],
];

export async function automateSite(p: Project, access: SetAccess): Promise<SiteResult> {
  const metric = p.units === 'metric';
  const toProject = (m: number) => (metric ? m : m / 0.3048);
  const checks: string[] = [];
  // Existing conditions and removals plans show what is there, not what is built.
  const sheets = p.sheets.filter((s) => !s.superseded && (/^C/i.test(s.name ?? '') || isSiteSheet(s.title ?? '')) && !/EXISTING|REMOVAL|DEMOLITION/i.test(s.title ?? ''));
  if (!sheets.length) return { message: 'No civil or site drawings.', checks };

  type Hit = { sheetId: string; text: PageText; label: PipeLabel };
  const bySheet = new Map<string, Hit[]>();
  const roads = new Map<string, { sheetId: string; at: PageText; values: number[] }[]>();
  let width: { meters: number; says: string } | null = null;
  let section: ReturnType<typeof roadSection> = null;
  let existing = 0;
  for (const s of sheets)
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      const tb = titleBlockBox(texts, s.width, s.height);
      const keep = texts.filter((t) => !(tb && t.cx >= tb[0] && t.cx <= tb[2] && t.cy >= tb[1] && t.cy <= tb[3]));
      section ??= roadSection(keep);
      // A plan titled as existing conditions or removals (in its own big text) shows what is there.
      if (isExistingPlan(keep)) return;
      for (const t of keep) {
        const l = pipeLabel(t.str);
        if (l?.existing) existing++;
        else if (l) bySheet.set(s.id, [...(bySheet.get(s.id) ?? []), { sheetId: s.id, text: t, label: l }]);
        const w = /(\d+(?:\.\d+)?)\s*m\s*WIDE\b.*\b(ROAD|ACCESS|LANE|DRIVE)/i.exec(t.str) ?? /(\d+(?:\.\d+)?)\s*(?:'|FT)\s*WIDE\b.*\b(ROAD|ACCESS|LANE|DRIVE)/i.exec(t.str);
        if (w && !width) width = { meters: /m\s*WIDE/i.test(w[0]) ? Number(w[1]) : Number(w[1]) * 0.3048, says: t.str.trim() };
      }
      if (/PROFILE/i.test(s.title ?? '')) {
        const values = keep.map((t) => ({ t, v: chainage(t.str) })).filter((x): x is { t: PageText; v: number } => x.v !== null);
        if (values.length >= 3) {
          const road = (s.title ?? 'Road').replace(/\bSHEET\s*\d+\b/i, '').replace(/PLAN AND PROFILE|PLAN & PROFILE|PROFILE/i, '').trim() || 'Road';
          const last = values.reduce((a, b) => (b.v > a.v ? b : a));
          roads.set(road, [...(roads.get(road) ?? []), { sheetId: s.id, at: last.t, values: values.map((x) => x.v) }]);
        }
      }
    });

  // A run labelled on an overall plan and again on an enlarged one counts once: each label's
  // runs are taken from the sheet that writes it most often (the more detailed one on a tie).
  const scaleOf = new Map(p.sheets.map((s) => [s.id, s.metersPerPoint ?? Infinity]));
  const key = (l: PipeLabel) => `${l.meters}|${l.size}|${l.what}`;
  const chosen = new Map<string, Hit[]>();
  for (const hits of bySheet.values()) {
    const groups = new Map<string, Hit[]>();
    for (const h of hits) groups.set(key(h.label), [...(groups.get(key(h.label)) ?? []), h]);
    for (const [k, g] of groups) {
      const prev = chosen.get(k);
      if (!prev || g.length > prev.length || (g.length === prev.length && (scaleOf.get(g[0].sheetId) ?? Infinity) < (scaleOf.get(prev[0].sheetId) ?? Infinity))) chosen.set(k, g);
    }
  }
  const repeated = [...bySheet.values()].flat().length - [...chosen.values()].flat().length;

  const types: TakeoffType[] = [];
  const added: Measurement[] = [];
  const typeOf = new Map<string, TakeoffType>();
  const len = metric ? 'm' : 'ft';
  const totals = new Map<string, number>();
  for (const hits of chosen.values())
    for (const h of hits) {
      const service = serviceOf(h.label.what);
      const name = `${service}: ${h.label.size}mm ${h.label.what.replace(/\bCULVERT\b/, '').trim() || 'culvert'}`.replace(/\s+/g, ' ');
      let t = typeOf.get(name);
      if (!t) {
        t = {
          id: newId(),
          name,
          color: { Sanitary: '#8d6e63', Storm: '#2e7d32', Water: '#0288d1', Culvert: '#558b2f', Gas: '#f9a825', 'Utility duct': '#6a1b9a', Pipe: '#607d8b' }[service] ?? '#607d8b',
          kind: 'linear',
          height: 0,
          division: '33 Utilities',
          package: 'Site servicing sub',
          description: 'Lengths as labelled on the civil drawings; trench, bedding and fittings are priced from this length.',
          items: [item('Pipe length', len, 'L'), item('Runs', 'ea', 'N')],
        };
        typeOf.set(name, t);
        types.push(t);
      }
      added.push({ id: newId(), sheetId: h.sheetId, typeId: t.id, points: underline(h.text), holes: [], source: 'site', label: h.text.str.trim(), statedLength: h.label.meters });
      totals.set(name, (totals.get(name) ?? 0) + h.label.meters);
    }

  // Roads: from the first chainage to the last over all their plan and profile sheets.
  const roadNotes: string[] = [];
  for (const [road, parts] of roads) {
    const all = parts.flatMap((x) => x.values);
    const length = Math.max(...all) - Math.min(...all);
    if (!(length > 5)) continue;
    const last = parts.reduce((a, b) => (Math.max(...b.values) > Math.max(...a.values) ? b : a));
    const w = width as { meters: number; says: string } | null;
    const t: TakeoffType = {
      id: newId(),
      name: `${road.replace(/^PROPOSED\s+/i, '').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} (by chainage)`,
      color: '#795548',
      kind: 'linear',
      height: 0,
      width: toProject(w?.meters ?? 6),
      division: '32 Exterior Improvements',
      package: 'Paving / earthworks sub',
      description: `Length from chainage ${Math.min(...all).toFixed(3)} to ${Math.max(...all).toFixed(3)} on the plan and profile.${w ? ` Width from "${w.says}".` : ' Width (W) assumed 6 m: set it from the road section.'}`,
      items: [item('Road length', len, 'L'), item('Road area', metric ? 'm²' : 'SF', 'L * W')],
    };
    const sec = section as ReturnType<typeof roadSection>;
    if (sec) {
      const vol = metric ? 'm³' : 'CY';
      const depth = (mm: number) => (metric ? mm / 1000 : mm / 304.8);
      const per = metric ? '' : ' / 27';
      if (sec.A) t.items.push(item(`Granular A, ${sec.A} mm`, vol, `L * W * ${depth(sec.A).toFixed(4)}${per}`));
      if (sec.B) t.items.push(item(`Granular B, ${sec.B} mm`, vol, `L * W * ${depth(sec.B).toFixed(4)}${per}`));
      t.items.push(item('Excavation for the road structure', vol, `L * W * ${depth((sec.A ?? 0) + (sec.B ?? 0)).toFixed(4)}${per}`));
      t.description += ` Granular depths from "${sec.title}": ${[sec.A ? `${sec.A} mm A` : '', sec.B ? `${sec.B} mm B` : ''].filter(Boolean).join(', ')}.`;
    }
    types.push(t);
    added.push({ id: newId(), sheetId: last.sheetId, typeId: t.id, points: underline(last.at), holes: [], source: 'site', label: `${road}: ${Math.min(...all)} to ${Math.max(...all)}`, statedLength: length });
    roadNotes.push(`${Math.round(length)} m of ${t.name.toLowerCase()}`);
    if (!w) checks.push(`${t.name}: the road width is not written on the site plans; 6 m is assumed. Set W from the road section.`);
  }

  if (!added.length) return { message: 'No labelled pipe runs or road profiles on the civil drawings.', checks };
  if (existing) checks.push(`${existing} existing pipe run${existing === 1 ? ' is' : 's are'} labelled on the civil drawings (EX.) and not taken off.`);
  if (repeated) checks.push(`${repeated} pipe label${repeated === 1 ? '' : 's'} repeated on an overall and an enlarged plan counted once.`);
  checks.push('Site services are taken at the lengths the civil drawings label. Grading, paving, erosion control and unlabelled runs are not taken off: measure them by hand.');
  const pipes = [...totals].map(([n, v]) => `${Math.round(metric ? v : v / 0.3048)} ${len} ${n.split(': ')[1]}`);
  return {
    message: [...roadNotes, ...pipes].join(' · '),
    checks,
    apply: (q) => replaceRun(q, 'site', types, added),
  };
}
