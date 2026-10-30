import { findDoorTags, findRoomLabels, type DoorTag } from '../fill/rooms';
import { newId, type Project, type Sheet, type TakeoffType } from '../model';
import type { Automation } from './result';
import { classifySheet, tradeOfNumber } from '../sheetKind';
import { perSheet, PALETTE, type SetAccess } from './set';

const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Window, screen, storefront and curtain wall numbers (W101, S114A, SF1): counted as windows, not doors. */
const GLAZING_TAG = /^(W|S|SF|CW|G|GL)\d/;

/**
 * Door tags on `current`, or on every sheet. Elevations and sections carry level markers (4000,
 * 8570) in ovals that look like door tags. Door numbers follow the room numbers (door 113A by
 * room 113), so only tags in the sheet's room-number range count; other sheets than `current`
 * also need a plan's worth of them.
 */
export async function findDoorTagsIn(p: Project, access: SetAccess, current: Sheet, everywhere: boolean): Promise<{ sheetId: string; tags: DoorTag[] }[]> {
  const found: { sheetId: string; tags: DoorTag[] }[] = [];
  const sheetRefs = new Set(p.sheets.map((x) => norm(x.name)).filter((n) => /\d/.test(n)));
  const targets = everywhere ? p.sheets.filter((x) => !x.superseded || x.id === current.id) : [current];
  for (const [i, x] of targets.entries()) {
    if (everywhere) access.progress?.(`Finding door tags… sheet ${i + 1} of ${targets.length}`);
    await perSheet(access, x, async () => {
      const segs = await access.segments(x);
      if (!segs) return;
      const texts = await access.texts(x);
      // A sheet number (A601) is a callout's reference, and a glazing type (S114A, W101) is counted with the windows.
      let tags = findDoorTags(texts, segs).filter((d) => !sheetRefs.has(norm(d.number)) && !GLAZING_TAG.test(d.number));
      const labels = findRoomLabels(texts, segs);
      // A lettered number is a door's when its letter is a door's (D101) or the rooms' own (door B01 by
      // room B01); P101 beside numbered rooms is a partition type.
      const roomLetters = new Set(labels.map((r) => /^[A-Za-z]*/.exec(r.number)![0].toUpperCase()));
      tags = tags.filter((d) => {
        const letters = /^[A-Za-z]*/.exec(d.number)![0].toUpperCase();
        return !letters || letters === 'D' || roomLetters.has(letters);
      });
      // (Lettered rooms, corridor A, have no number to go by.)
      const rooms = labels.map((r) => parseInt(r.number.replace(/^\D/, ''), 10)).filter((n) => !Number.isNaN(n));
      if (rooms.length) {
        const [lo, hi] = [Math.min(...rooms) - 20, Math.max(...rooms) + 20];
        // On the sheet being counted, doors numbered on their own (D001) are kept; only
        // numbers well above the rooms' (level markers) go. Other sheets keep the range.
        tags = tags.filter((d) => {
          const n = parseInt(d.number.replace(/^\D/, ''), 10);
          return x.id === current.id ? n <= hi : n >= lo && n <= hi;
        });
      }
      // Another sheet needs a plan's worth of door numbers, and rooms to go by unless its title says it is a floor plan.
      const plan = classifySheet(x);
      // Doors are the architect's: a trade's plan (E2.2 lighting, M2.1 ductwork) repeats the floor plan under its own marks.
      if (x.id !== current.id && tradeOfNumber(x.name)) return;
      if (x.id !== current.id && ((!rooms.length && !(plan.kind === 'floor plan' && plan.level === 'level')) || tags.length < 4)) return;
      found.push({ sheetId: x.id, tags });
    });
  }
  return found;
}

/**
 * Door tags as count takeoffs, one "Doors" type with each door labelled by its number (D101, 113A
 * and B01 are all door numbers: the letters follow the set's numbering, not a kind of door). A
 * door number counts once in a drawing file (enlarged plans repeat tags), on the first sheet it
 * appears; doors already counted under their number are left alone (on `current`, or anywhere
 * when counting every sheet).
 */
export function doorTakeoff(p: Project, found: { sheetId: string; tags: DoorTag[] }[], current: Sheet, everywhere: boolean): Automation {
  const total = found.reduce((n, f) => n + f.tags.length, 0);
  if (!total) return { message: `No door tags on ${everywhere ? 'any sheet' : 'this sheet'}. A door tag is a door number in an oval, circle or hexagon.` };
  const newTypes: TakeoffType[] = [];
  const typeFor = (): string => {
    const hit = [...p.types, ...newTypes].find((t) => t.kind === 'count' && /^doors?\b/i.test(t.name));
    if (hit) return hit.id;
    const t: TakeoffType = {
      id: newId(),
      name: 'Doors',
      color: PALETTE[(p.types.length + newTypes.length) % PALETTE.length],
      kind: 'count',
      height: p.units === 'metric' ? 3 : 10,
      division: '08 Openings',
      items: [{ id: newId(), name: 'Door, frame & hardware', unit: 'ea', formula: 'N' }],
    };
    newTypes.push(t);
    return t.id;
  };
  // Door numbers repeat between drawing files of different buildings (two sets each with a D101): once per file.
  const docOf = new Map(p.sheets.map((x) => [x.id, x.docId]));
  const counted = new Set(p.measurements.filter((m) => m.label && (everywhere || m.sheetId === current.id)).map((m) => `${m.typeId}|${docOf.get(m.sheetId)}|${m.label}`));
  const added = found.flatMap(({ sheetId, tags }) =>
    tags.flatMap((d) => {
      const typeId = typeFor();
      const key = `${typeId}|${docOf.get(sheetId)}|${d.number}`;
      if (counted.has(key)) return [];
      counted.add(key);
      return [{ id: newId(), sheetId, typeId, points: [d.at], holes: [], source: 'doors' as const, label: d.number }];
    }),
  );
  if (!added.length) return { message: `All ${total} door tags ${everywhere ? 'on the drawings' : 'on this sheet'} are already counted.` };
  const used = new Set(added.map((m) => m.typeId));
  const sheets = new Set(added.map((m) => m.sheetId)).size;
  return {
    message: `Counted ${added.length} door${added.length === 1 ? '' : 's'}${everywhere ? ` on ${sheets} sheet${sheets === 1 ? '' : 's'}` : ''}`,
    apply: (q) => ({ ...q, types: [...q.types, ...newTypes.filter((t) => used.has(t.id))], measurements: [...q.measurements, ...added] }),
  };
}
