import { ceilingLabel, ceilingPlanKind, ceilingTypeFor, mergeDefs, readCeilingDefs, readCeilingSheet, type CeilingDef, type CeilingSheetRead } from '../fill/ceilings';
import { newId, type Project, type Sheet, type TakeoffType } from '../model';
import { hasCeilingPlan } from '../sheetKind';
import { titleBlockBox } from '../titleBlock';
import { formatQty } from '../units';
import { toneMap, toneShare } from '../fill/shaded';
import type { Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';

const title = (x: Sheet) => `${x.name} ${x.title ?? ''}`;

/**
 * A reflected ceiling plan, by its sheet number and title, as the set is sorted (`classifySheet`):
 * "Reflected ceiling plan", "RCP", "Ceiling plan", "Ground floor plan & RCP", an architectural
 * sheet (not an electrical lighting RCP).
 */
export const isCeilingPlan = (x: Sheet) => hasCeilingPlan(x);

/**
 * Ceilings, with nothing marked: on every reflected ceiling plan, each ceiling area by its
 * ceiling type (the type tag in it, else the legend swatch its pattern matches, else what is
 * drawn in it), one takeoff type per code named from the ceiling types table. A plan with no
 * type tags takes the areas its grid covers: a demolition plan's are existing ceiling to take
 * down, an existing plan's existing ceiling to take down and put back, any other's new T-bar.
 * A re-run replaces what the last run made. With no ceiling plan, `current` is read.
 */
export async function automateCeilings(p: Project, access: SetAccess, current: Sheet | null): Promise<Automation> {
  const metric = p.units === 'metric';
  let targets = p.sheets.filter((x) => !x.superseded && isCeilingPlan(x));
  if (!targets.length && current) targets = [current];
  const unscaled = targets.filter((x) => !x.metersPerPoint);
  targets = targets.filter((x) => x.metersPerPoint);
  if (!targets.length) return { message: unscaled.length ? 'Set the ceiling plans’ scale first.' : 'No reflected ceiling plans found.' };
  const found: { sheet: Sheet; read: CeilingSheetRead }[] = [];
  let defs: CeilingDef[] = [];
  // Ceiling types described on an assembly or legend sheet, for naming the codes.
  for (const x of p.sheets.filter((x) => !x.superseded && !targets.includes(x) && /ASSEMBL|CEILING|TYPES/i.test(title(x))))
    await perSheet(access, x, async () => {
      defs = mergeDefs([...defs, ...readCeilingDefs(await access.texts(x)).defs]);
    });
  for (const [i, x] of targets.entries()) {
    access.progress?.(`Ceilings: reading ${x.name} (${i + 1} of ${targets.length})…`);
    await pause();
    await perSheet(access, x, async () => {
      const segs = await access.segments(x);
      if (!segs) return;
      const texts = await access.texts(x);
      const block = titleBlockBox(texts, x.width, x.height);
      const read = readCeilingSheet(segs, texts, x, { defs, avoid: block ? [block] : [] });
      defs = mergeDefs([...defs, ...read.defs]);
      // An untagged ceiling under the grey tone a renovation plan lays over the areas outside the work is existing: left alone.
      const page = read.areas.some((a) => a.source !== 'tag') ? await access.page(x) : null;
      const tone = page ? await toneMap(page) : null;
      if (tone) read.areas = read.areas.filter((a) => a.source === 'tag' || toneShare(a.points, tone) <= 0.6);
      // On a tagged plan, an untagged area with nothing drawn in it (an open stair, a shaft) has no ceiling to take off.
      if (read.tagged) read.areas = read.areas.filter((a) => a.code || a.legend || a.kind !== 'plain');
      if (read.areas.length) found.push({ sheet: x, read });
    });
  }
  if (!found.length) return { message: 'No ceilings found on the ceiling plans.' };
  const types: TakeoffType[] = [...p.types];
  const made: TakeoffType[] = [];
  const typeFor = (spec: ReturnType<typeof ceilingTypeFor>) => {
    const got = types.find((t) => t.name === spec.name && t.kind === 'area');
    if (got) return got.id;
    const t: TakeoffType = { id: newId(), name: spec.name, color: PALETTE[types.length % PALETTE.length], kind: 'area', height: 0, division: spec.division, package: spec.package, description: spec.description, items: spec.items.map((it) => ({ id: newId(), ...it })) };
    types.push(t);
    made.push(t);
    return t.id;
  };
  const added: Project['measurements'] = [];
  let total = 0;
  const codes = new Set<string>();
  for (const { sheet: x, read } of found) {
    const plan = ceilingPlanKind(title(x));
    for (const a of read.areas) {
      const typeId = typeFor(ceilingTypeFor(a, { tagged: read.tagged, defs }, plan, metric));
      codes.add(typeId);
      added.push({ id: newId(), sheetId: x.id, typeId, points: a.points, holes: a.holes, source: 'ceilings', label: ceilingLabel(a) });
      total += a.area * x.metersPerPoint! ** 2;
    }
  }
  const sheets = new Set(found.map((f) => f.sheet.id));
  const tagged = found.reduce((n, f) => n + f.read.areas.filter((a) => a.source === 'tag').length, 0);
  return {
    message: `Ceilings on ${found.length} plan${found.length === 1 ? '' : 's'}: ${added.length} areas in ${codes.size} type${codes.size === 1 ? '' : 's'}${tagged ? ` (${tagged} by type tag)` : ''}, ${formatQty(metric ? total : total * 10.7639)} ${metric ? 'm²' : 'SF'}${unscaled.length ? ` · ${unscaled.length} without a scale skipped` : ''}`,
    apply: (q) => ({ ...q, types: [...q.types, ...made], measurements: [...q.measurements.filter((m) => !(m.source === 'ceilings' && sheets.has(m.sheetId))), ...added] }),
  };
}
