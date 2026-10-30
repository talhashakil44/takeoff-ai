import { newId, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import type { PageText } from '../pageText';
import { tradeOfNumber } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { replaceRun, type Automation } from './result';
import { pause, perSheet, type SetAccess } from './set';

/**
 * Electrical counts by what the plans write, for sets whose devices are drawn in a picture (or
 * otherwise can't be matched as symbols): engineers write each fixture's or device's circuit next
 * to it ("L2G-5", "P2G-21", "M2G-23,25,27"), and text devices by their legend abbreviation ("OS"
 * occupancy sensor). Each circuit tag on a lighting plan is a fixture, on a power plan a device
 * or device group; each legend abbreviation written on a plan is one of that device.
 */

export interface ElectricalResult extends Automation {
  checks: string[];
}

/** A circuit tag: panel and circuit(s), "L2G-5", "P2S-13", "M2G-23,25,27", "K2S-1,3". */
export const isCircuitTag = (s: string) => /^[A-Z]{1,3}\d[A-Z]?-\d{1,3}(?:\s?[,/]\s?\d{1,3})*$/.test(s.trim());

function isElectricalPlan(s: Sheet): boolean {
  if (s.superseded || !s.metersPerPoint || s.metersPerPoint < 0.008) return false;
  const trade = tradeOfNumber(s.name ?? '');
  if (!trade || !/^(E|EL|EP)$/.test(trade)) return false;
  return !/\b(DETAILS?|SCHEDULES?|DIAGRAMS?|RISER|SECTIONS?|ELEVATIONS?|LEGEND|NOTES|SINGLE LINE)\b/i.test(s.title ?? '') || /\bPLANS?\b/i.test(s.title ?? '');
}

/** The abbreviations an electrical legend defines in words: "OS" → "CEILING MOUNTED OCCUPANCY SENSOR". */
export function legendAbbreviations(texts: PageText[], box: [number, number, number, number] | null): Map<string, string> {
  const out = new Map<string, string>();
  const inBox = (t: PageText) => !!box && t.cx >= box[0] && t.cx <= box[2] && t.cy >= box[1] && t.cy <= box[3];
  for (const t of texts) {
    const w = t.str.trim();
    if (inBox(t) || !/^(?=.*[A-Z])[A-Z][A-Z0-9]{1,3}$/.test(w)) continue;
    const desc = texts
      .filter((x) => !inBox(x) && Math.abs(x.cy - t.cy) < Math.max(t.h, 3) && x.cx > t.cx && x.cx - x.w / 2 - (t.cx + t.w / 2) < 120 && /[A-Z]{3,}\s+[A-Z]{3,}/.test(x.str))
      .sort((a, b) => a.cx - b.cx)[0];
    if (desc && !out.has(w)) out.set(w, desc.str.trim().replace(/\s+/g, ' '));
  }
  return out;
}

const SECURITY = /CONTACT|READER|ALARM|DETECTOR|EXIT BUTTON|STRIKE|POWER LOCK|SECURITY|CAMERA/i;

export async function automateElectricalTags(p: Project, access: SetAccess): Promise<ElectricalResult> {
  const checks: string[] = [];
  const plans = p.sheets.filter(isElectricalPlan);
  if (!plans.length) return { message: 'No electrical plans with a scale.', checks };
  const sheetNames = new Set(p.sheets.map((s) => (s.name ?? '').toUpperCase()));

  // The legend's abbreviations, from the electrical sheets that are legends.
  const legends = p.sheets.filter((s) => !s.superseded && /^(E|EL|EP)$/.test(tradeOfNumber(s.name ?? '') ?? '') && (/LEGEND/i.test(s.title ?? '') || /^E\W?0\W?0+$/i.test(s.name ?? '')));
  const abbr = new Map<string, string>();
  for (const s of legends) {
    const texts = await access.texts(s);
    for (const [k, v] of legendAbbreviations(texts, titleBlockBox(texts, s.width, s.height))) if (!abbr.has(k)) abbr.set(k, v);
  }

  const types = new Map<string, TakeoffType>();
  const added: Measurement[] = [];
  const tally = new Map<string, number>();
  const typeFor = (key: string, name: string, division: string, description: string) => {
    let t = types.get(key);
    if (!t) {
      t = { id: newId(), name, color: division.startsWith('28') ? '#8e24aa' : '#f9a825', kind: 'count', height: 0, division, package: division.startsWith('28') ? 'Security sub' : 'Electrical sub', description, items: [{ id: newId(), name, unit: 'ea', formula: 'N' }] };
      types.set(key, t);
    }
    return t;
  };
  for (const [i, s] of plans.entries()) {
    access.progress?.(`Electrical tags… ${s.name} (${i + 1} of ${plans.length})`);
    await pause();
    await perSheet(access, s, async () => {
      const all = await access.texts(s);
      const tb = titleBlockBox(all, s.width, s.height);
      const texts = all.filter((t) => !(tb && t.cx >= tb[0] && t.cx <= tb[2] && t.cy >= tb[1] && t.cy <= tb[3]));
      const tags = texts.filter((t) => isCircuitTag(t.str) && !sheetNames.has(t.str.trim().toUpperCase()));
      // A lighting plan's circuits are lighting circuits (L…); a power plan's are mostly not.
      const lighting = tags.filter((t) => /^L/i.test(t.str.trim())).length > tags.length / 2;
      for (const t of tags) {
        const key = lighting ? 'lights' : 'power';
        const type = lighting
          ? typeFor(key, 'Light fixtures (by circuit tag)', '26 Electrical', 'Each circuit tag written beside a fixture on the lighting plans. Fixtures without a tag are not counted.')
          : typeFor(key, 'Power devices and connections (by circuit tag)', '26 Electrical', 'Each circuit tag written beside a device or device group on the power plans (a group of receptacles on one tag counts once).');
        added.push({ id: newId(), sheetId: s.id, typeId: type.id, points: [[t.cx, t.cy]], holes: [], source: 'etags', label: t.str.trim() });
        tally.set(type.name, (tally.get(type.name) ?? 0) + 1);
      }
      for (const t of texts) {
        const w = t.str.trim();
        const desc = abbr.get(w);
        if (!desc) continue;
        const type = typeFor(`abbr:${w}`, `${w} – ${desc.slice(0, 60)}`, SECURITY.test(desc) ? '28 Electronic Safety & Security' : '26 Electrical', `"${w}" as the electrical legend defines it, counted where the plans write it.`);
        added.push({ id: newId(), sheetId: s.id, typeId: type.id, points: [[t.cx, t.cy]], holes: [], source: 'etags', label: w });
        tally.set(type.name, (tally.get(type.name) ?? 0) + 1);
      }
    });
  }
  if (!added.length) return { message: 'No circuit tags or legend abbreviations on the electrical plans.', checks };
  checks.push('Electrical counts by text: a circuit tag beside a fixture or device counts it, as does a legend abbreviation (OS, HD) written on the plan. Devices drawn without a tag are not counted; check the counts against the plans.');
  return {
    message: [...tally].sort((a, b) => b[1] - a[1]).map(([n, v]) => `${v} ${n.split(' (')[0]}`).join(', '),
    checks,
    apply: (q) => replaceRun(q, 'etags', [...types.values()], added),
  };
}
