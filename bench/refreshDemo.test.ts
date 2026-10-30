/**
 * Adds the newer whole-set takeoffs (foundations, structure, site, piping and ductwork by label) to a saved
 * project folder and writes the result to another folder; existing measurements are kept.
 *   R=<project folder> O=<out folder> npx vitest run -c bench/vitest.config.ts bench/refreshDemo.test.ts
 */
import { it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, existsSync, readdirSync } from 'fs';
import { openDoc, NodeSet } from './nodeSet';
import { automateFoundations } from '../src/automate/foundations';
import { automateStructure } from '../src/automate/structure';
import { automateSite } from '../src/automate/site';
import { automatePipes } from '../src/automate/pipes';
import { automateDucts } from '../src/automate/ducts';
import { automateRoof } from '../src/automate/envelope';
import { automateElectricalTags } from '../src/automate/electrical';
import { doorTakeoff, findDoorTagsIn } from '../src/automate/doors';
import { classifySheet } from '../src/sheetKind';
it('refresh', async () => {
  const root = process.env.R!, out = process.env.O!;
  const file = JSON.parse(readFileSync(root + '/project.json', 'utf8'));
  let p = file.project;
  const before = p.measurements.length;
  const docs = new Map<string, any>();
  for (const d of p.docs) { const o = await openDoc(`${root}/drawings/${d.id}.pdf`); o.id = d.id; docs.set(d.id, o); }
  const set = new NodeSet(docs, p.sheets);
  const access = { page: (s: any) => set.page(s), texts: (s: any) => set.texts(s), segments: (s: any) => set.segments(s), layers: (s: any) => set.layers(s) };
  for (const [name, fn] of [['foundations', () => automateFoundations(p, access as any, 3)], ['structure', () => automateStructure(p, access as any, 3)], ['site', () => automateSite(p, access as any)], ['pipes', () => automatePipes(p, access as any)], ['ducts', () => automateDucts(p, access as any)], ['envelope', async () => automateRoof(p)], ['etags', () => automateElectricalTags(p, access as any)], ['doors', async () => {
    // Door tags on every sheet, from the first level floor plan (as the whole-set run does); numbers already counted stay as they are.
    const home = p.sheets.find((s: any) => !s.superseded && classifySheet(s).kind === 'floor plan' && classifySheet(s).level === 'level');
    if (!home) return { message: 'no floor plan' };
    const r: any = doorTakeoff(p, await findDoorTagsIn(p, access as any, home, true), home, true);
    return r.apply ? { ...r, apply: (q: any) => { const n = q.measurements.length; const o = r.apply(q); return { ...o, measurements: o.measurements.map((m: any, i: number) => (i >= n ? { ...m, source: 'doors' } : m)) }; } } : r;
  }]] as const) {
    const r: any = await (fn as any)();
    console.log(name, '→', r.message);
    if (r.apply) p = r.apply(p);
  }
  const kept = file.project.measurements.filter((m: any) => !['foundations', 'structure', 'site', 'pipes', 'ducts', 'envelope', 'etags'].includes(m.source));
  const ids = new Set(p.measurements.map((m: any) => m.id));
  const lost = kept.filter((m: any) => !ids.has(m.id)).length;
  if (lost) throw new Error(`${lost} measurements lost`);
  console.log('measurements', before, '→', p.measurements.length, 'types', file.project.types.length, '→', p.types.length);
  mkdirSync(out, { recursive: true });
  writeFileSync(out + '/project.json', JSON.stringify({ ...file, savedAt: new Date().toISOString(), project: p }));
  if (!existsSync(out + '/drawings')) symlinkSync(root + '/drawings', out + '/drawings');
}, 1800000);
