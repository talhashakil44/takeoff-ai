import type { Sheet } from '../model';
import { nameOf, type DrawingGraph, type Place } from '../graph/graph';
import { entries, entryName, norm, type Entry } from '../smart/index';
import { addendumNumber, mergeSections, stem, wordsOf, type SpecBook, type SpecSection } from './parse';
import type { SpecRef } from './refs';
export type { SpecRef } from './refs';

/**
 * The project as one graph: the specification's sections on one side, the drawings on the
 * other (sheets, schedules, type legends, finish codes, equipment), and the links between them.
 *
 * Links are of two strengths, and the map shows which:
 * - written: one document names the other. A spec section names a sheet (A6.1) or a schedule
 *   (Door Schedule); a drawing note names a section (REFER TO SPECIFICATIONS 22 02 51); a section
 *   names another section.
 * - matched: nothing names the other, but they are about the same thing, by their own words. The
 *   door schedule and 08100 HOLLOW METAL WORK (door, frame); EF-1 ROOFTOP EXHAUST FAN and
 *   23 34 23 PACKAGED EXHAUSTERS (exhaust, fan, roof). Scored, and only a clear best match is kept.
 */

export type MapSide = 'spec' | 'drawing';
export type MapNodeKind = 'section' | 'sheet' | 'schedule' | 'type' | 'finish' | 'item' | 'addendum';

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  side: MapSide;
  /** Short name on the map (08100, A6.1, P3, EF-1, Door schedule). */
  label: string;
  /** What it is (HOLLOW METAL WORK, Rooftop exhaust fan). */
  sub: string;
  /** Its cluster: the spec's division (08), the drawing's trade (A, M, E). */
  group: string;
  /** In the table of contents but not in the book ("To follow"). */
  missing?: boolean;
  /** Where it is: a spec section's pages, a drawing element's place on its sheet. */
  pages?: { docId: string; page: number }[];
  places?: Place[];
  /** A drawing tag's index key, for its details. */
  entryKey?: string;
}

export type MapEdgeKind = 'written' | 'matched' | 'spec-spec' | 'contains' | 'revises';

export interface MapEdge {
  a: string;
  b: string;
  kind: MapEdgeKind;
  /** Why they are linked, in words: "08100 names the door schedule", "door, frame". */
  why: string;
  /** For a match: how strong (higher is surer). */
  score?: number;
  /** Where the link is written on a drawing, when it is. */
  at?: Place;
  /** Where it is written in a spec or addendum file. */
  page?: { docId: string; page: number };
}

export interface ProjectMap {
  nodes: MapNode[];
  edges: MapEdge[];
  books: SpecBook[];
}


/** Words a drawing uses that a spec says otherwise (VPLK is resilient flooring; EF an exhauster). */
const SYNONYMS: [RegExp, string][] = [
  [/\b(vinyl|vplk|lvt|vct|vsf|linoleum|rubber|resilient|plank)\b/, 'resilient floor'],
  [/\b(act|acoustic|lay-?in|t-?bar)\b/, 'acoustic ceiling'],
  [/\b(gypsum|gwb|gb|drywall|wallboard)\b/, 'gypsum board'],
  [/\b(stud|studs|furring|channel|channels)\b/, 'metal support framing'],
  [/\b(paint|painted|ptd)\b/, 'painting paint'],
  [/\b(frp|fibreglass|fiberglass)\b/, 'fibreglass reinforced plastic panel'],
  [/\b(door|doors|frame|frames|hm|hollow)\b/, 'hollow metal door frame'],
  [/\b(hardware|closer|exit device|lock)\b/, 'door hardware'],
  [/\b(window|windows|alum)\b/, 'window aluminum'],
  [/\b(glazing|glass|laminated|tempered)\b/, 'glass glazing'],
  [/\b(screen)\b/, 'glazing screen frame'],
  [/^(lintel|beam|column)\b/, 'structural steel'],
  [/\b(masonry|cmu|block)\b/, 'concrete unit masonry'],
  [/\b(exhaust fan|ef|exhauster|rooftop exhaust|inline|fan)\b/, 'exhaust fan exhauster'],
  [/\b(erv|energy recovery|heat recovery)\b/, 'heat recovery ventilator'],
  [/\b(mua|make-?up air)\b/, 'make up air unit'],
  [/\b(hood)\b/, 'kitchen hood'],
  [/\b(diffuser|grille|register|return)\b/, 'diffuser register grille'],
  [/\b(damper|dampers)\b/, 'damper'],
  [/\b(water closet|wc|lav|lavatory|sink|urinal|shower|plumbing fixture)\b/, 'plumbing fixture'],
  [/\b(interior finish|room finish|finish schedule)\b/, 'resilient floor gypsum board painting acoustic ceiling'],
  [/\b(interceptor|grease)\b/, 'interceptor grease sanitary'],
  [/\b(radiation|cabinet heater|force flow|convector)\b/, 'radiator convector cabinet heater'],
  [/\b(radiant|ceiling panel)\b/, 'radiant ceiling panel'],
  [/\b(light|luminaire|lighting|troffer|downlight)\b/, 'lighting equipment fixture'],
  [/\b(fire alarm|annunciator|smoke detector|pull station)\b/, 'fire alarm system'],
  [/\b(panel|panelboard)\b/, 'panelboard'],
  [/\b(receptacle|switch)\b/, 'wiring device'],
  [/\b(millwork|casework|countertop|cabinet)\b/, 'casework countertop'],
  [/\b(insulation|safb|batt)\b/, 'insulation'],
  [/\b(vrf|fan ?coil|cassette|condens)/, 'refrigerant'],
];

function expand(text: string): string[] {
  const t = text.toLowerCase();
  const extra = SYNONYMS.filter(([re]) => re.test(t)).map(([, w]) => w);
  return [...new Set(wordsOf([t, ...extra].join(' ')))];
}

/** What a drawing element is about, its main words (a schedule's title) counting double. */
type Words = { w: string; wt: number }[];
function about(main: string, rest = ''): Words {
  const m = expand(main);
  const r = expand(rest).filter((w) => !m.includes(w));
  return [...m.map((w) => ({ w, wt: 2 })), ...r.map((w) => ({ w, wt: 1 }))];
}

/** Builds the map from the drawings' graph (when read) and the spec books. */
export function buildProjectMap(graph: DrawingGraph | null, books: SpecBook[], sheets: Sheet[], specRefs: SpecRef[] = [], docs: { id: string; name: string }[] = []): ProjectMap {
  const nodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const add = (n: MapNode) => (nodes.has(n.id) ? nodes.get(n.id)! : (nodes.set(n.id, n), n));
  const live = sheets.filter((s) => !s.superseded);
  const tradeOf = (name: string) => {
    if (/^Page \d+$/i.test(name)) return '#';
    const l = (/^[A-Z]+/i.exec(name)?.[0] ?? '').toUpperCase();
    return l ? (l.length > 1 && !['SP', 'FP', 'ID'].includes(l) ? l[0] : l) : '#';
  };
  const sheetById = new Map(live.map((s) => [s.id, s]));
  const sheetByName = new Map(live.filter((s) => /\d/.test(s.name)).map((s) => [norm(s.name), s]));

  // Spec sections.
  const sections = new Map<string, SpecSection>();
  for (const s of mergeSections(books)) {
    sections.set(s.key, s);
    add({ id: `spec:${s.key}`, kind: 'section', side: 'spec', label: s.number, sub: s.title, group: s.division, missing: s.missing, pages: s.pages.map((page) => ({ docId: s.docId, page })) });
  }
  // Sections naming each other.
  for (const s of sections.values())
    for (const k of s.sections) if (sections.has(k)) edges.push({ a: `spec:${s.key}`, b: `spec:${k}`, kind: 'spec-spec', why: `${s.number} refers to Section ${sections.get(k)!.number}` });

  const sheetNode = (s: Sheet) => add({ id: `sheet:${s.id}`, kind: 'sheet', side: 'drawing', label: s.name, sub: s.title ?? '', group: tradeOf(s.name), places: [{ sheetId: s.id, box: [0, 0, s.width, s.height], label: s.name }] });

  // Drawing elements: schedules, type legends, finish codes, equipment.
  const elements: { node: MapNode; words: Words }[] = [];
  if (graph) {
    const idx = graph.index;
    const sheetOfId = (id: string) => sheetById.get(id);
    for (const sc of idx.schedules) {
      const sh = sheetOfId(sc.sheetId);
      if (!sh) continue;
      const id = `schedule:${sc.sheetId}:${sc.title}`;
      const node = add({ id, kind: 'schedule', side: 'drawing', label: title(sc.title.replace(/\s*SCHEDULE.*$/i, '')) + ' schedule', sub: `${sc.rows.length} rows · ${sh.name}`, group: tradeOf(sh.name), places: [{ sheetId: sc.sheetId, box: sc.box, label: `${sc.title} (${sh.name})` }] });
      edges.push({ a: id, b: sheetNode(sh).id, kind: 'contains', why: `on ${sh.name}` });
      elements.push({ node, words: about(sc.title.replace(/SCHEDULE/i, '')) });
    }
    const dict = entries(idx);
    const seen = new Set<string>();
    for (const e of dict.values()) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      const n = elementOf(e, graph);
      if (!n) continue;
      const node = add(n.node);
      elements.push({ node, words: n.words });
      // Its schedule or legend sheet.
      const home = e.schedule?.sheetId ?? e.legend?.sheetId;
      if (home && e.schedule) edges.push({ a: node.id, b: `schedule:${e.schedule.sheetId}:${e.schedule.title}`, kind: 'contains', why: `in the ${e.schedule.title.toLowerCase()}` });
      else if (home && sheetOfId(home)) edges.push({ a: node.id, b: sheetNode(sheetOfId(home)!).id, kind: 'contains', why: `in the legend on ${nameOf(graph, home)}` });
    }
  }

  // Written links: a section names a sheet or a schedule.
  for (const s of sections.values()) {
    // A list of drawings names every sheet: that is an index, not a link.
    const named = s.sheets.filter((tok) => sheetByName.has(norm(tok)));
    if (named.length > 12 || /list of drawings|drawing list/i.test(s.title)) continue;
    for (const tok of named) {
      const sh = sheetByName.get(norm(tok));
      if (sh) edges.push({ a: `spec:${s.key}`, b: sheetNode(sh).id, kind: 'written', why: `${s.number} names ${sh.name}` });
    }
    for (const sch of s.schedules) {
      const want = wordsOf(sch.replace(/schedule/i, ''));
      if (!want.length) continue;
      let hits = elements.filter((el) => el.node.kind === 'schedule' && want.every((w) => new Set(wordsOf(el.node.label.replace(/schedule/i, ''))).has(w)));
      // "Fixture schedule" in the lighting section is the light fixture schedule, not the plumbing one.
      if (hits.length > 1) {
        const own = new Set(s.words);
        const closer = hits.filter((el) => wordsOf(el.node.label).some((w) => own.has(w) && !want.includes(w)));
        if (closer.length) hits = closer;
      }
      for (const el of hits) edges.push({ a: `spec:${s.key}`, b: el.node.id, kind: 'written', why: `${s.number} names the ${sch}` });
    }
  }
  // Written links: a drawing note names a section.
  for (const r of specRefs) {
    const sh = sheetById.get(r.sheetId);
    if (!sh) continue;
    for (const k of r.keys) if (sections.has(k)) edges.push({ a: `spec:${k}`, b: sheetNode(sh).id, kind: 'written', why: `${sh.name}: "${r.text.slice(0, 80)}"`, at: { sheetId: sh.id, box: r.box, label: r.text.slice(0, 60) } });
  }

  // Addenda: what each one changes. Its items name sections and sheets; the sections and sheets
  // it re-issued are its too.
  for (const b of books) {
    if (b.addendum === undefined) continue;
    const id = `add:${b.docId}`;
    add({ id, kind: 'addendum', side: 'spec', label: `Addendum ${b.addendum}`, sub: b.name.replace(/\.pdf$/i, ''), group: 'AD', pages: [{ docId: b.docId, page: 1 }] });
    for (const c of b.changes ?? []) {
      const at = { docId: b.docId, page: c.page };
      for (const k of c.sections) if (sections.has(k)) edges.push({ a: id, b: `spec:${k}`, kind: 'revises', why: `${c.action} · ${c.label} ${c.text.slice(0, 140)}`, page: at });
      for (const tok of c.sheets) {
        const sh = sheetByName.get(norm(tok));
        if (sh) edges.push({ a: id, b: sheetNode(sh).id, kind: 'revises', why: `${c.action} · ${c.label} ${c.text.slice(0, 140)}`, page: at });
      }
    }
    for (const s of sections.values()) if (s.revisions?.some((r) => r.docId === b.docId)) edges.push({ a: id, b: `spec:${s.key}`, kind: 'revises', why: `re-issued in Addendum ${b.addendum}` });
    // Drawings that came with it: a drawing file of the same addendum.
    for (const d of docs) {
      if (addendumNumber(d.name) !== b.addendum) continue;
      for (const sh of live.filter((x) => x.docId === d.id)) edges.push({ a: id, b: sheetNode(sh).id, kind: 'revises', why: `issued with Addendum ${b.addendum}` });
    }
  }

  // Matched links: each drawing element to the section about the same thing.
  const pool = [...sections.values()].filter((s) => !/^0[01]$/.test(s.division));
  // A section's words with the drawings' names for the same things (PACKAGED OUTDOOR ERV: heat recovery ventilator).
  const titleOf = new Map(pool.map((s) => [s.key, new Set([...wordsOf(s.title), ...expand(s.title)])]));
  const wordsIn = new Map(pool.map((s) => [s.key, new Set([...s.words, ...titleOf.get(s.key)!])]));
  // The noun a title is about: FANS in HVAC FANS, PUMPS in HYDRONIC PUMPS.
  const headOf = new Map(pool.map((s) => [s.key, wordsOf(s.title.replace(/\s+[-–(].*$/, '')).slice(-1)[0]]));
  const df = new Map<string, number>();
  for (const s of pool) for (const w of wordsIn.get(s.key)!) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w: string) => Math.log((pool.length + 1) / ((df.get(w) ?? 0) + 0.5));
  for (const el of elements) {
    const scored = pool
      .map((s) => {
        const titleWords = titleOf.get(s.key)!;
        const words = wordsIn.get(s.key)!;
        const hits = el.words.filter((x) => words.has(x.w));
        const score = hits.reduce((n, x) => n + x.wt * idf(x.w) * (titleWords.has(x.w) ? 1 : 0.3), 0);
        // One word alone is a match only when it is what the section is about (WINDOWS; FANS in HVAC FANS).
        // (A schedule's own subject only: a FAN schedule to HVAC FANS, not a lintel's "masonry unit" to AIR TERMINAL UNITS.)
        if (hits.length < 2 && titleWords.size > 1 && !(el.node.kind === 'schedule' && hits[0]?.w === headOf.get(s.key) && hits[0].wt === 2)) return { s, score: 0, hits: [] as string[] };
        return { s, score, hits: hits.map((x) => x.w) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < 4) continue;
    // A clear best, or the few as good (doors: hollow metal work and its hardware).
    for (const x of scored.slice(0, 3)) {
      if (x.score < Math.max(4, best.score * 0.9)) break;
      edges.push({ a: `spec:${x.s.key}`, b: el.node.id, kind: 'matched', why: `both about ${[...new Set(x.hits)].slice(0, 4).join(', ')}`, score: Math.round(x.score * 10) / 10 });
    }
  }

  // Sheets with nothing linked are left off; the rest are kept.
  const linked = new Set(edges.flatMap((e) => [e.a, e.b]));
  for (const n of [...nodes.values()]) if (n.kind === 'sheet' && !linked.has(n.id)) nodes.delete(n.id);
  return { nodes: [...nodes.values()], edges: dedupe(edges), books };
}

function dedupe(edges: MapEdge[]): MapEdge[] {
  const seen = new Map<string, MapEdge>();
  const rank: Record<MapEdgeKind, number> = { revises: 4, written: 3, matched: 2, 'spec-spec': 1, contains: 0 };
  for (const e of edges) {
    const k = [e.a, e.b].sort().join('|');
    const had = seen.get(k);
    if (!had || rank[e.kind] > rank[had.kind]) seen.set(k, e);
  }
  return [...seen.values()];
}

const title = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** A drawing tag as a node on the map: a type legend's entry, a finish code, an equipment row. */
function elementOf(e: Entry, graph: DrawingGraph): { node: MapNode; words: Words } | null {
  const places = definitionPlaces(e, graph);
  const sheetName = (id?: string) => (id ? nameOf(graph, id) : '');
  const tradeFrom = (id?: string) => {
    const n = sheetName(id);
    const l = (/^[A-Z]+/i.exec(n)?.[0] ?? '#').toUpperCase();
    return l.length > 1 && !['SP', 'FP', 'ID'].includes(l) ? l[0] : l;
  };
  if (e.legend) {
    const lines = e.legend.lines.join(' ');
    return {
      node: { id: e.key, kind: 'type', side: 'drawing', label: e.code, sub: entryName(e), group: tradeFrom(e.legend.sheetId), places, entryKey: e.key },
      words: about(`${e.legend.legend} ${e.legend.lines[0] ?? ''}`, lines),
    };
  }
  if (e.kind === 'finish') {
    const word = norm(e.code).replace(/\d.*$/, '');
    const means = graph.index.abbreviations[word] ?? '';
    if (!means) return null;
    return { node: { id: e.key, kind: 'finish', side: 'drawing', label: e.code, sub: title(means), group: 'A', places, entryKey: e.key }, words: about(`${word} ${means}`) };
  }
  if (e.kind === 'item' && e.schedule && e.row) {
    const name = entryName(e);
    // A numbered row (a fire alarm zone, an equipment list's line) is not a thing to specify.
    if (!/[A-Z]/i.test(e.code)) return null;
    return {
      node: { id: e.key, kind: 'item', side: 'drawing', label: e.code, sub: name, group: tradeFrom(e.schedule.sheetId), places, entryKey: e.key },
      words: about(e.schedule.title.replace(/SCHEDULE/i, ''), name),
    };
  }
  return null;
}

function definitionPlaces(e: Entry, graph: DrawingGraph): Place[] {
  const out: Place[] = [];
  if (e.schedule && e.row?.box) out.push({ sheetId: e.schedule.sheetId, box: e.row.box, label: `${e.code} (${nameOf(graph, e.schedule.sheetId)})` });
  if (e.legend?.box) out.push({ sheetId: e.legend.sheetId, box: e.legend.box, label: `${e.code} (${nameOf(graph, e.legend.sheetId)})` });
  return out;
}

export { stem };
