import { findEnclosedTags } from '../fill/typeTags';
import { newId, type Project, type Sheet, type TakeoffType } from '../model';
import { classifySheet, tradeOfNumber } from '../sheetKind';
import type { Automation } from './result';
import { pause, perSheet, PALETTE, type SetAccess } from './set';
import { countListedItems, countPlumbingFixtures, countWindowTags, isBuildingElevation, setLists, setTypesFrom, type TagCount, type TagSheet } from './tagCounts';

/**
 * Every sheet's text, and on the sheets `withTags` picks its codes in closed symbols, for the
 * counting in `tagCounts.ts`. Superseded sheets are left out.
 */
export async function readTagSheets(p: Project, access: SetAccess, withTags: (s: Sheet) => boolean = () => false): Promise<TagSheet[]> {
  const live = p.sheets.filter((x) => !x.superseded);
  const out: TagSheet[] = [];
  for (const [i, s] of live.entries()) {
    access.progress?.(`Reading tags… sheet ${i + 1} of ${live.length}`);
    if (i % 5 === 0) await pause();
    await perSheet(access, s, async () => {
      const texts = await access.texts(s);
      let tags;
      if (withTags(s) && texts.length) {
        const segs = await access.segments(s);
        if (segs) tags = findEnclosedTags(texts, segs);
      }
      out.push({ sheet: s, texts, ...(tags ? { tags } : {}) });
    });
  }
  return out;
}

/** Sheets windows are counted on: the floor plans of the building's levels, and its elevations. */
export const windowSheet = (s: Sheet) => {
  const k = classifySheet(s);
  return (k.kind === 'floor plan' && k.level === 'level') || isBuildingElevation(s);
};

/** Window types counted across the set (see `countWindowTags`). */
export async function windowCounts(p: Project, access: SetAccess): Promise<TagCount[]> {
  const sheets = await readTagSheets(p, access, windowSheet);
  return countWindowTags(sheets, setTypesFrom(sheets), setLists(sheets));
}

/** Listed items (equipment, accessories, fixtures) counted across the set (see `countListedItems`). */
export async function itemCounts(p: Project, access: SetAccess): Promise<TagCount[]> {
  const sheets = await readTagSheets(p, access);
  return countListedItems(sheets, setTypesFrom(sheets), setLists(sheets));
}

/** A count type's name for a tag: its code, and what the set's schedule calls it. */
export const tagTypeName = (c: TagCount, what: string) => (c.code === 'Windows' ? 'Windows' : `${c.code} – ${c.description || what}`);

/**
 * Counts as count takeoffs, one type per code (a type of that name already there gets its count
 * replaced, not doubled). `source` marks the counts so a re-run replaces them.
 */
export function tagTakeoff(p: Project, counts: TagCount[], what: string, division: string | undefined, source: 'symbols' | 'windows'): Automation & { typeIds: string[] } {
  const types: TakeoffType[] = [];
  const ids = counts.map((c) => {
    const name = tagTypeName(c, what);
    const got = p.types.find((t) => t.kind === 'count' && (t.name === name || t.name.split(' – ')[0] === c.code)) ?? types.find((t) => t.name === name);
    if (got) return got.id;
    const t: TakeoffType = {
      id: newId(),
      name,
      color: PALETTE[(p.types.length + types.length) % PALETTE.length],
      kind: 'count',
      height: 0,
      ...(division ? { division } : {}),
      items: [{ id: newId(), name, unit: 'ea', formula: 'N' }],
    };
    types.push(t);
    return t.id;
  });
  const added: Project['measurements'] = counts.flatMap((c, i) =>
    c.places.flatMap((pl) => pl.at.map((at, k) => ({ id: newId(), sheetId: pl.sheetId, typeId: ids[i], points: [at], holes: [], label: pl.labels?.[k] ?? c.code, source }))),
  );
  const typeIds = new Set(ids);
  const total = added.length;
  return {
    typeIds: ids,
    message: `Counted ${total} ${what.toLowerCase()}${total === 1 ? '' : 's'} as ${counts.length} type${counts.length === 1 ? '' : 's'}`,
    apply: (q) => ({ ...q, types: [...q.types, ...types], measurements: [...q.measurements.filter((m) => !(m.source === source && typeIds.has(m.typeId))), ...added] }),
  };
}

/**
 * Automate › Window tags: every window, curtain wall, storefront and glazed screen type tag on
 * the floor plans (or, for a type no plan tags, the building elevations), one count type per type.
 */
export async function automateWindows(p: Project, access: SetAccess): Promise<Automation> {
  access.progress?.('Finding window tags…');
  await pause(30);
  const counts = await windowCounts(p, access);
  if (!counts.length) return { message: 'No window tags found. A window tag is a window type (W1, W2A, CW1, SF1) in a hexagon or other symbol on the floor plans or elevations.' };
  return tagTakeoff(p, numberedWindows(counts) ?? counts, 'Window', '08 Openings', 'windows');
}

/**
 * A set that numbers every window (W1 to W144, each tag once, more of them than a set has
 * types) gets one Windows count, each window labelled by its number.
 */
export function numberedWindows(counts: TagCount[]): TagCount[] | null {
  const once = counts.filter((c) => c.total === 1).length;
  if (counts.length < 60 || once < 0.9 * counts.length) return null;
  const all: TagCount = { code: 'Windows', description: '', places: [], total: 0 };
  for (const c of counts)
    for (const pl of c.places) {
      let place = all.places.find((x) => x.sheetId === pl.sheetId);
      if (!place) all.places.push((place = { sheetId: pl.sheetId, at: [], labels: [] }));
      place.at.push(...pl.at);
      place.labels!.push(...pl.at.map(() => c.code));
      all.total += pl.at.length;
    }
  return [all];
}

/**
 * Plumbing fixtures counted by their tags on the plumbing plans, from the fixture schedule on the
 * mechanical or plumbing drawings (see `countPlumbingFixtures`). A code an architectural list
 * already counts (a type already named for it) is left to that count.
 */
export async function automatePlumbingFixtures(p: Project, access: SetAccess): Promise<Automation> {
  access.progress?.('Counting plumbing fixtures…');
  await pause(30);
  const sheets = await readTagSheets({ ...p, sheets: p.sheets.filter((s) => /^(M|MD|MH|MP|ME|P|PD|PL)$/.test(tradeOfNumber(s.name ?? '') ?? '')) }, access);
  const have = new Set(p.types.filter((t) => t.kind === 'count').map((t) => t.name.split(' – ')[0].toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const counts = countPlumbingFixtures(sheets).filter((c) => !have.has(c.code.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  if (!counts.length) return { message: 'No plumbing fixture tags found on the plumbing plans.' };
  return tagTakeoff(p, counts, 'Plumbing fixture', '22 Plumbing', 'symbols');
}
