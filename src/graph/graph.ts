import type { Sheet } from '../model';
import type { PageText } from '../pageText';
import { pause, type SetAccess } from '../automate/set';
import { buildIndex, entries, entryName, norm, tagsOn, type DrawingIndex, type Entry, type TagKind } from '../smart/index';
import { findViews, type View } from './views';

/**
 * The drawing set as a graph: every sheet, every drawing on a sheet (by its title), every
 * schedule and legend, and every tag, joined by what the drawings themselves point at. A detail
 * bubble (5 over A5.0) links to drawing 5 on A5.0; "STEEL BEAM PER STRUCTURAL" to the structural
 * sheets; "SEE DOOR SCHEDULE" to the door schedule; a door tag to its row in the door schedule,
 * and that row back to every place the door is tagged. Each link is a box on its sheet you can
 * click. The same graph will take the specification's sections as nodes (next).
 */

export type Box = [number, number, number, number];
export interface Place {
  sheetId: string;
  box: Box;
  /** What is there (Drawing 5 · PARTITION AT CONCRETE PLAN DETAIL, D013.1 on A1.3). */
  label?: string;
  /** The spot to flash when it is brought into view (a drawing's title), when not the whole box. */
  mark?: Box;
}

export type LinkKind = 'callout' | 'sheet' | 'schedule' | 'tag' | 'definition' | 'view';

export interface Link {
  kind: LinkKind;
  /** Where to click, on its own sheet. */
  box: Box;
  /** What it says (5/A5.0, SEE STRUCTURAL, D013.1). */
  label: string;
  /** The node it stands for (sheet:…, view:…, schedule:…, or a tag's key). */
  node: string;
  /** Where following it goes: one place, or every place (a definition's instances). */
  to: Place[];
  /** For a tag: what kind of thing it is. */
  tagKind?: TagKind;
}

export interface DrawingGraph {
  index: DrawingIndex;
  views: Record<string, View[]>;
  links: Record<string, Link[]>;
  /** The sheets read, by id, with their names (for edges and the map). */
  sheets: { id: string; name: string; title?: string }[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};
const textBox = (t: PageText, pad = 0): Box => {
  const c = Math.abs(Math.cos(t.angle ?? 0));
  const s = Math.abs(Math.sin(t.angle ?? 0));
  const w = t.w * c + t.h * 1.3 * s;
  const h = t.w * s + t.h * 1.3 * c;
  return [t.cx - w / 2 - pad, t.cy - h / 2 - pad, t.cx + w / 2 + pad, t.cy + h / 2 + pad];
};
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
/** The box round part of a level text run (characters start..end). */
const partBox = (t: PageText, start: number, end: number, pad: number): Box => {
  const x0 = t.cx - t.w / 2;
  const per = t.w / Math.max(1, t.str.length);
  return [x0 + start * per - pad, t.cy - t.h * 0.75 - pad, x0 + end * per + pad, t.cy + t.h * 0.75 + pad];
};
const level = (t: PageText) => !t.angle || Math.abs(Math.sin(t.angle)) < 0.1;
const NUMBER = /^(?:[A-Z]?\d{1,2}[A-Z]?|[A-Z])$/;

/** The trade a discipline word in a note names, as sheet numbers start: SEE STRUCTURAL → S. */
const DISCIPLINE: [RegExp, string][] = [
  [/^STRUCT/i, 'S'],
  [/^MECH/i, 'M'],
  [/^PLUMB/i, 'P'],
  [/^ELEC/i, 'E'],
  [/^ARCH/i, 'A'],
  [/^CIVIL/i, 'C'],
  [/^LANDSCAPE/i, 'L'],
  [/^(FIRE PROTECTION|SPRINKLER)/i, 'FP'],
];
const DISCIPLINE_REF = /\b(?:SEE|REFER\s+TO|REF\.?|PER|BY|AS\s+PER|TO)\s+(?:THE\s+)?(STRUCTURAL|STRUCT\.?|MECHANICAL|MECH\.?|PLUMBING|ELECTRICAL|ELEC\.?|ARCHITECTURAL|ARCH\.?|CIVIL|LANDSCAPE|FIRE PROTECTION|SPRINKLER)\b/gi;
/** A schedule a note points at: SEE DOOR SCHEDULE, PER FLOOR FINISH SCHEDULE, PER SCHEDULE. */
const SCHEDULE_REF = /\b((?:[A-Z][A-Z&/.-]*\s+){0,3})SCHEDULES?\b/gi;

/** Reads the set into its graph (the schedules and legends, the drawings' titles, then every link on every sheet). */
export async function buildGraph(sheets: Sheet[], access: SetAccess): Promise<DrawingGraph> {
  const texts = new Map<string, PageText[]>();
  const index = await buildIndex(sheets, access, texts);
  const live = sheets.filter((s) => !s.superseded);
  const views: Record<string, View[]> = {};
  for (const s of live) {
    const t = texts.get(s.id) ?? (await access.texts(s));
    texts.set(s.id, t);
    views[s.id] = findViews(t, s.width, s.height);
  }
  const graph: DrawingGraph = { index, views, links: {}, sheets: live.map((s) => ({ id: s.id, name: s.name, title: s.title })) };
  const dict = entries(index);
  for (const [i, s] of live.entries()) {
    if (i % 8 === 0) {
      access.progress?.(`Linking the drawings… ${i + 1} of ${live.length}`);
      await pause();
    }
    graph.links[s.id] = linksOn(s, texts.get(s.id) ?? [], graph, live, dict);
  }
  // Each drawing's title links back to every bubble that points at it.
  const back = new Map<string, Place[]>();
  for (const [sid, ls] of Object.entries(graph.links))
    for (const l of ls) if (l.kind === 'callout') back.set(l.node, [...(back.get(l.node) ?? []), { sheetId: sid, box: l.box, label: `${l.label} on ${nameOf(graph, sid)}` }]);
  for (const s of live)
    for (const v of views[s.id] ?? []) {
      const from = back.get(`view:${s.id}:${v.number}`);
      if (from?.length) graph.links[s.id].unshift({ kind: 'view', box: v.titleBox, label: `${v.number} ${v.title}`, node: `view:${s.id}:${v.number}`, to: from });
    }
  return graph;
}

export const nameOf = (g: DrawingGraph, id: string) => g.sheets.find((s) => s.id === id)?.name ?? '?';

/** Every link on one sheet. */
export function linksOn(sheet: Sheet, texts: PageText[], graph: DrawingGraph, sheets: Sheet[], dict: Map<string, Entry> = entries(graph.index)): Link[] {
  const out: Link[] = [];
  const mh = median(texts.map((t) => t.h)) || 5;
  const byName = new Map<string, Sheet>();
  for (const s of sheets) if (/[A-Z]/i.test(s.name) && /\d/.test(s.name)) byName.set(norm(s.name), s);
  const viewOf = (s: Sheet, n: string) => (graph.views[s.id] ?? []).find((v) => v.number.toUpperCase() === n.toUpperCase());
  const sheetPlace = (s: Sheet): Place => ({ sheetId: s.id, box: [0, 0, s.width, s.height], label: `${s.name}${s.title ? ` · ${s.title}` : ''}` });
  const used = new Set<PageText>();
  const flat = texts.filter(level);

  // 1. Detail and section bubbles (5 over A5.0), and sheet numbers written on their own.
  for (const t of texts) {
    const str = t.str.trim();
    const m = /^(?:([A-Z0-9]{1,3})\s*\/\s*)?([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,2})?[A-Z]?)$/i.exec(str);
    if (!m || t.h > mh * 2.5) continue;
    const to = byName.get(norm(m[2]));
    if (!to || to.id === sheet.id) continue;
    // Its drawing's number: in the same text (3/A5.0), or just above it in the bubble.
    const above = m[1]
      ? null
      : flat.find((o) => o !== t && NUMBER.test(o.str.trim()) && Math.abs(o.cx - t.cx) < Math.max(1.2 * t.h, t.w * 0.6) && t.cy - o.cy > 0.3 * t.h && t.cy - o.cy < 2.8 * t.h);
    const num = m[1] ?? above?.str.trim();
    const view = num ? viewOf(to, num) : undefined;
    used.add(t);
    if (above) used.add(above);
    const box = above ? union(textBox(t, 2), textBox(above, 2)) : textBox(t, 2);
    if (view) out.push({ kind: 'callout', box, label: `${num}/${to.name}`, node: `view:${to.id}:${view.number}`, to: [{ sheetId: to.id, box: view.box, mark: view.titleBox, label: `${view.number} · ${view.title} (${to.name})` }] });
    else out.push({ kind: 'sheet', box, label: num ? `${num}/${to.name}` : to.name, node: `sheet:${to.id}`, to: [sheetPlace(to)] });
  }

  // 2. References written into notes: SEE A5.0, DETAIL 3/A5.1, PER STRUCTURAL, SEE DOOR SCHEDULE.
  const names = [...byName.keys()];
  const sheetRe = names.length ? new RegExp(`\\b(?:([A-Z0-9]{1,3})\\s*/\\s*)?(${sheets.filter((s) => byName.has(norm(s.name))).map((s) => s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi') : null;
  for (const t of flat) {
    if (used.has(t) || t.str.length < 6 || t.h > mh * 2.5) continue;
    const str = t.str;
    if (sheetRe)
      for (const m of str.matchAll(sheetRe)) {
        if (m[0].length === str.trim().length) continue;
        const to = byName.get(norm(m[2]));
        if (!to || to.id === sheet.id) continue;
        const view = m[1] ? viewOf(to, m[1]) : undefined;
        const box = partBox(t, m.index!, m.index! + m[0].length, 1.5);
        if (view) out.push({ kind: 'callout', box, label: m[0], node: `view:${to.id}:${view.number}`, to: [{ sheetId: to.id, box: view.box, mark: view.titleBox, label: `${view.number} · ${view.title} (${to.name})` }] });
        else out.push({ kind: 'sheet', box, label: m[0], node: `sheet:${to.id}`, to: [sheetPlace(to)] });
      }
    for (const m of str.matchAll(DISCIPLINE_REF)) {
      const letter = DISCIPLINE.find(([re]) => re.test(m[1]))?.[1];
      if (!letter) continue;
      const trade = sheets.filter((s) => !s.superseded && new RegExp(`^${letter}[-.\\d]`, 'i').test(s.name));
      if (!trade.length || trade.some((s) => s.id === sheet.id)) continue;
      const start = m.index! + m[0].length - m[1].length;
      out.push({ kind: 'sheet', box: partBox(t, start, start + m[1].length, 1.5), label: m[0], node: `discipline:${letter}`, to: trade.map(sheetPlace) });
    }
    for (const m of str.matchAll(SCHEDULE_REF)) {
      const words = m[1]
        .trim()
        .split(/\s+/)
        .filter((w) => w && !/^(SEE|PER|REFER|TO|AS|IN|ON|THE|AND|OR|FOR|OF|WITH)$/i.test(w));
      const own = graph.index.schedules.filter((s) => s.sheetId === sheet.id);
      // A schedule's own title is not a reference to another one.
      if (own.some((s) => t.cx > s.box[0] && t.cx < s.box[2] && t.cy > s.box[1] - 40 && t.cy < s.box[1] + 3 * t.h)) continue;
      const has = (title: string, w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title);
      // The longest run of words before SCHEDULE that names one (HARDWARE PER DOOR SCHEDULE: DOOR).
      let hits: typeof graph.index.schedules = [];
      for (let k = words.length; k >= 1 && !hits.length; k--) hits = graph.index.schedules.filter((s) => words.slice(-k).every((w) => has(s.title, w)));
      // PER SCHEDULE alone: the nearest schedule on this sheet.
      if (!words.length && own.length) hits = [own.sort((a, b) => Math.hypot((a.box[0] + a.box[2]) / 2 - t.cx, (a.box[1] + a.box[3]) / 2 - t.cy) - Math.hypot((b.box[0] + b.box[2]) / 2 - t.cx, (b.box[1] + b.box[3]) / 2 - t.cy))[0]];
      // A schedule's own title (or a piece of it) is not a reference to it.
      hits = hits.filter((s) => !(s.sheetId === sheet.id && t.cx > s.box[0] && t.cx < s.box[2] && t.cy > s.box[1] - 40 && t.cy < s.box[3]));
      if (!hits.length) continue;
      // The closest match first: the title it names exactly, then this sheet's, then the shortest.
      const said = `${words.join(' ')} SCHEDULE`.toUpperCase();
      hits.sort((a, b) => Number(b.title.toUpperCase() === said) - Number(a.title.toUpperCase() === said) || Number(b.sheetId === sheet.id) - Number(a.sheetId === sheet.id) || a.title.length - b.title.length);
      const start = m.index! + m[0].length - m[0].trimStart().length;
      out.push({
        kind: 'schedule',
        box: partBox(t, start, m.index! + m[0].length, 1.5),
        label: m[0].trim(),
        node: `schedule:${hits[0].sheetId}:${hits[0].title}`,
        to: hits.map((s) => ({ sheetId: s.sheetId, box: s.box, label: `${s.title} (${nameOf(graph, s.sheetId)})` })),
      });
    }
  }

  // 3. Tags: a door, room, window, wall type, finish or equipment mark goes to what defines it.
  const keyed = new Map<string, Entry>();
  for (const e of dict.values()) keyed.set(e.key, e);
  for (const tag of tagsOn(sheet, texts, graph.index, sheets, dict)) {
    if (tag.kind === 'sheet') continue;
    const e = keyed.get(tag.key);
    if (!e) continue;
    const defs = definitionsOf(e, graph);
    if (!defs.length) continue;
    out.push({ kind: 'tag', box: tag.box, label: tag.code, node: tag.key, to: defs, tagKind: tag.kind });
  }

  // 4. Definitions on this sheet: a schedule's row and a legend's type go to every place they are tagged.
  for (const e of keyed.values()) {
    const places = (graph.index.places[e.key] ?? []).filter((p) => p.sheetId !== sheet.id || !(e.row?.box && inside(p.box, e.row.box)));
    if (!places.length) continue;
    const at: Box[] = [];
    if (e.schedule?.sheetId === sheet.id && e.row?.box) at.push(e.row.box);
    if (e.legend?.sheetId === sheet.id && e.legend.box) at.push(e.legend.box);
    const name = entryName(e);
    for (const box of at)
      out.unshift({
        kind: 'definition',
        box,
        label: `${e.code}${name ? ` · ${name}` : ''}`,
        node: e.key,
        to: places.map((p) => ({ ...p, label: `${e.code} on ${nameOf(graph, p.sheetId)}` })),
        tagKind: e.kind,
      });
  }
  return out;
}

const inside = (a: Box, b: Box) => a[0] >= b[0] - 1 && a[2] <= b[2] + 1 && a[1] >= b[1] - 1 && a[3] <= b[3] + 1;

/** Where a tag is defined: its schedule row, its legend entry. */
export function definitionsOf(e: Entry, graph: DrawingGraph): Place[] {
  const out: Place[] = [];
  if (e.schedule && e.row?.box) out.push({ sheetId: e.schedule.sheetId, box: e.row.box, label: `${e.code} in the ${e.schedule.title.toLowerCase()} (${nameOf(graph, e.schedule.sheetId)})` });
  if (e.legend?.box) out.push({ sheetId: e.legend.sheetId, box: e.legend.box, label: `${e.code} in the ${(e.legend.legend || 'legend').toLowerCase()} (${nameOf(graph, e.legend.sheetId)})` });
  return out;
}

/** The graph's edges between sheets, by kind of link, for the map. */
export function sheetEdges(g: DrawingGraph): { from: string; to: string; n: number; kinds: Set<LinkKind> }[] {
  const m = new Map<string, { from: string; to: string; n: number; kinds: Set<LinkKind> }>();
  for (const [from, ls] of Object.entries(g.links))
    for (const l of ls) {
      if (l.kind === 'definition' || l.kind === 'view') continue;
      // A note naming a trade (SEE MECHANICAL) points at the trade, drawn as its first sheet.
      for (const p of l.node.startsWith('discipline:') ? l.to.slice(0, 1) : l.to) {
        if (p.sheetId === from) continue;
        const k = `${from}>${p.sheetId}`;
        const e = m.get(k) ?? { from, to: p.sheetId, n: 0, kinds: new Set<LinkKind>() };
        e.n++;
        e.kinds.add(l.kind);
        m.set(k, e);
      }
    }
  return [...m.values()];
}

/** Every link in the set as rows, for the table. */
export function linkRows(g: DrawingGraph): { from: string; kind: LinkKind; label: string; to: string; place: Place; at: Box }[] {
  const rows: { from: string; kind: LinkKind; label: string; to: string; place: Place; at: Box }[] = [];
  for (const [from, ls] of Object.entries(g.links))
    for (const l of ls) {
      if (l.kind === 'definition' || l.kind === 'view') continue;
      const p = l.to[0];
      if (p) rows.push({ from, kind: l.kind, label: l.label, to: l.to.length > 1 ? `${p.label ?? nameOf(g, p.sheetId)} +${l.to.length - 1}` : (p.label ?? nameOf(g, p.sheetId)), place: p, at: l.box });
    }
  return rows;
}
