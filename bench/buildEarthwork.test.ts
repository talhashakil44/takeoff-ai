/** Read-only integration check for the saved Kelso demo plus the three new takeoff passes. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { NodeSet, openDoc } from './nodeSet';
import { automateFoundations } from '../src/automate/foundations';
import { automateStructure } from '../src/automate/structure';
import { automateSite } from '../src/automate/site';
import { buildAll } from '../src/build/run';
import { toIfc } from '../src/build/ifc';
import { titleBlockWords } from '../src/build/extract';
import { readSpecFacts } from '../src/build/facts';
import { segmentsOf } from '../src/fill/sheetWalls';
import { pageTexts } from '../src/pageText';
import type { Project } from '../src/model';
import type { DrawingLines } from '../src/build/roof';
import type { DrawingTexts } from '../src/build/building';

const root = process.env.BUILD_PROJECTS_ROOT;
it.skipIf(!root)('routes Kelso excavation before foundations from an in-memory takeoff', async () => {
  const folder = readdirSync(root!).find((name) => name.startsWith('Kelso demo'))!;
  const base = join(root!, folder);
  const file = join(base, 'project.json');
  const before = readFileSync(file);
  let project: Project = JSON.parse(before.toString()).project;
  const docs = await Promise.all(project.docs.map((d) => openDoc(join(base, 'drawings', `${d.id}.pdf`))));
  const docById = new Map(project.docs.map((d, i) => [d.id, docs[i]]));
  const set = new NodeSet(docById, project.sheets);
  for (const [name, run] of [
    ['foundations', (p: Project) => automateFoundations(p, set, 3)],
    ['structure', (p: Project) => automateStructure(p, set, 3)],
    ['site', (p: Project) => automateSite(p, set)],
  ] as const) {
    const result = await run(project);
    if (result.apply) project = result.apply(project);
    console.log(name, result.message);
  }
  const drawingTexts: DrawingTexts = {};
  const drawingLines: DrawingLines = {};
  const levelHints: Record<string, string> = {};
  for (const sheet of project.sheets.filter((s) => !s.superseded)) {
    const page = await set.page(sheet);
    if (!page) continue;
    const texts = await pageTexts(page);
    drawingTexts[sheet.id] = texts;
    levelHints[sheet.id] = titleBlockWords(texts, sheet.width, sheet.height);
    if (/ELEVATION|BUILDING SECTION/i.test(sheet.title ?? '') && !/INTERIOR|DETAIL/i.test(sheet.title ?? ''))
      drawingLines[sheet.id] = await segmentsOf(page);
  }
  const sections = project.specs?.flatMap((s) => s.book?.sections ?? []) ?? [];
  const facts = await readSpecFacts(sections, async (id, page) => {
    let doc = docById.get(id);
    if (!doc) {
      doc = await openDoc(join(base, 'drawings', `${id}.pdf`));
      docById.set(id, doc);
    }
    return (await pageTexts(await doc.pdf.getPage(page))).map((t) => t.str).join(' ');
  });
  const out = buildAll({ project, sections, facts, drawingTexts, drawingLines, levelHints, today: '2026-11-02' });
  const excavation = out.schedule.activities.find((a) => a.id === 'work:site:earthwork');
  const foundation = out.schedule.activities.find((a) => a.id === 'work:structure:fdn');
  mkdirSync('diag/build-acceptance', { recursive: true });
  writeFileSync('diag/build-acceptance/kelso-earthwork.json', JSON.stringify({
    measurements: project.measurements.length,
    excavation: { quantities: excavation?.quantities, duration: excavation?.duration, deps: excavation?.deps },
    foundation: { quantities: foundation?.quantities, duration: foundation?.duration, deps: foundation?.deps },
    site: out.schedule.activities.find((a) => a.id === 'work:site:site'),
    finish: out.schedule.feasibility.earliestFinish,
    chain: out.schedule.feasibility.chain.map((x) => x.id),
  }, null, 2));
  writeFileSync('diag/build-acceptance/kelso-earthwork.ifc', toIfc({ ...out, project, sections }));
  console.log('takeoffs', project.measurements.length, 'excavation', excavation?.quantities, 'duration', excavation?.duration,
    'foundation', foundation?.quantities, 'duration', foundation?.duration,
    'finish', out.schedule.feasibility.earliestFinish,
    'chain', out.schedule.feasibility.chain.map((x) => x.id).join(' → '));
  expect(excavation?.quantities?.['m³']).toBeGreaterThan(0);
  expect(excavation?.deps.map((d) => d.from)).toEqual(['mobilize']);
  expect(foundation?.deps.map((d) => d.from)).toContain('work:site:earthwork');
  expect(readFileSync(file).equals(before)).toBe(true);
}, 180000);
