import { segmentsOf } from '../src/fill/sheetWalls';
import type { DrawingLines } from '../src/build/roof';
/** Read-only integration audit. See docs/build-it-validation.md for the command. */
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDoc } from './nodeSet';
import { pageTexts } from '../src/pageText';
import { buildAll, replan } from '../src/build/run';
import { applySetupEdits } from '../src/build/plan';
import { readSpecFacts } from '../src/build/facts';
import { titleBlockWords } from '../src/build/extract';
import { registerSheets, type DrawingTexts } from '../src/build/building';
import { doorSheets, slimLines } from '../src/build/sources';
import { toIfc } from '../src/build/ifc';
import type { Project } from '../src/model';

const root = process.env.BUILD_PROJECTS_ROOT;
it.skipIf(!root)(
  'audits Kelso and Frederick without writing to their project folders',
  async () => {
    const report = [];
    const output = 'diag/build-acceptance';
    mkdirSync(output, { recursive: true });
    for (const key of ['Kelso', '84 Frederick']) {
      const folder = readdirSync(root!).find((n) => n.startsWith(`${key} demo`));
      expect(folder, `Missing ${key} demo`).toBeTruthy();
      const base = join(root!, folder!);
      const file = join(base, 'project.json');
      const before = readFileSync(file);
      const project: Project = JSON.parse(before.toString()).project;
      const original = JSON.stringify(project);
      const docs = new Map<string, Awaited<ReturnType<typeof openDoc>>>();
      const getDoc = async (id: string) => {
        if (!docs.has(id)) docs.set(id, await openDoc(join(base, 'drawings', `${id}.pdf`)));
        return docs.get(id)!;
      };
      const drawingLines: DrawingLines = {};
      const drawingTexts: DrawingTexts = {},
        levelHints: Record<string, string> = {};
      const planDoorSheets = doorSheets(project);
      for (const s of project.sheets.filter((s) => !s.superseded)) {
        const d = await getDoc(s.docId);
        const texts = await pageTexts(await d.pdf.getPage(s.page));
        drawingTexts[s.id] = texts;
        if (planDoorSheets.has(s.id) || /ELEVATION|BUILDING SECTION/i.test(s.title ?? '') && !/INTERIOR|DETAIL/i.test(s.title ?? ''))
          drawingLines[s.id] = slimLines(await segmentsOf(await d.pdf.getPage(s.page)));
        levelHints[s.id] = titleBlockWords(texts, s.width, s.height);
      }
      const sections = project.specs?.flatMap((s) => s.book?.sections ?? []) ?? [];
      const facts = await readSpecFacts(sections, async (id, page) => {
        const doc = await getDoc(id);
        return (await pageTexts(await doc.pdf.getPage(page))).map((t) => t.str).join(' ');
      });
      const input = { project, sections, facts, drawingTexts, drawingLines, levelHints, today: '2026-11-02' };
      writeFileSync(`${output}/${key === 'Kelso' ? 'kelso' : 'frederick'}-lines.json`, JSON.stringify(drawingLines));
      const out = buildAll(input);
      if (key === 'Kelso') {
        expect(out.model.roofPlan?.areaM2).toBeGreaterThan(950);
        expect(out.model.roofPlan?.areaM2).toBeLessThan(1050);
        expect(out.model.roofPlan?.source.label).toBe('A2.3');
        expect(out.schedule.activities.find((a) => a.id === 'work:envelope:roof-covering')).toMatchObject({ duration: 14, durationBasis: 'inferred' });
        expect(out.scopeSuggestions.some((s) => s.key === 'envelope')).toBe(false);
        const withoutDerivedRoof = replan({ ...out.model, roofPlan: undefined }, out.setup, input).schedule;
        expect(withoutDerivedRoof.feasibility.earliestFinish).toBe('2027-08-04');
        expect(out.schedule.feasibility.earliestFinish).toBe('2027-08-24');
        const slabs = out.model.elements
          .filter((e) => e.origin === 'building' && e.id.endsWith(':slab'))
          .map((e) => e.shape)
          .filter((s) => s?.type === 'surface');
        const mid = (r: [number, number][]) => [0, 1].map((i) => (Math.min(...r.map((p) => p[i])) + Math.max(...r.map((p) => p[i]))) / 2);
        expect(Math.hypot(...mid(slabs[0]!.ring).map((n, i) => n - mid(slabs[1]!.ring)[i]))).toBeLessThan(1);
        const roof = out.model.elements.find((e) => e.id.endsWith(':roof'))!.shape;
        expect(roof?.type === 'surface' && roof.slope).toBeTruthy();
        if (roof?.type === 'surface')
          for (const [x, y] of roof.ring) expect(roof.z + roof.slope![0] * x + roof.slope![1] * y).toBeGreaterThan(8);
      }
      if (key === 'Kelso') {
        const windows = out.model.elements.filter((e) => e.opening);
        expect(windows).toHaveLength(22);
        expect(windows.every((e) => e.shape?.type === 'point' && e.sources.some((s) => s.label === 'A8.3'))).toBe(true);
        expect(
          out.model.elements.some(
            (e) => e.shape?.type === 'run' && e.shape.openings?.some((o) => windows.some((w) => w.id === o.elementId)),
          ),
        ).toBe(true);
      } else {
        const top = out.model.elements.find((e) => e.id === 'building:L3:slab')?.shape;
        expect(top?.type).toBe('surface');
        for (const area of Object.values(out.model.floorAreas ?? {})) expect(area).toBeLessThan(900);
        if (top?.type === 'surface') {
          expect(top.ring.length).toBeGreaterThan(8);
          expect(out.model.floorAreas?.L3).toBeLessThan(600);
        }
      }
      const lean = replan(out.model, applySetupEdits(out.setup, { setup: { target: null } }), input).schedule;
      const earlier = replan(
        out.model,
        applySetupEdits(out.setup, { setup: { target: key === 'Kelso' ? '2027-07-01' : '2025-10-31' } }),
        input,
      ).schedule;
      const later = replan(out.model, applySetupEdits(out.setup, { setup: { target: '2035-01-01' } }), input).schedule;
      expect(JSON.stringify(project)).toBe(original);
      expect(readFileSync(file).equals(before)).toBe(true);
      expect(out.model.elements.filter((e) => e.origin === 'takeoff')).toHaveLength(project.measurements.length);
      expect(out.schedule.activities.some((a) => a.id.startsWith('longlead:') || a.id.startsWith('scope:'))).toBe(false);
      if (key === '84 Frederick') {
        expect(out.schedule.activities.some((a) => a.id === 'ms:phase-one')).toBe(false);
        expect(out.schedule.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['phase-scope-unmapped', 'historical-start']));
      }
      expect(later.activities.map((a) => [a.id, a.duration, a.crews, a.deps])).toEqual(
        lean.activities.map((a) => [a.id, a.duration, a.crews, a.deps]),
      );
      expect(earlier.feasibility.baselineFinish).toBe(lean.feasibility.earliestFinish);
      expect(out.schedule.issues.some((i) => i.id === 'loop')).toBe(false);
      const slug = key === 'Kelso' ? 'kelso' : 'frederick';
      writeFileSync(`${output}/${slug}.ifc`, toIfc({ ...out, project, sections }));
      writeFileSync(`${output}/${slug}.json`, JSON.stringify(out));
      const reg = registerSheets(project, drawingTexts);
      report.push({
        project: key,
        sha256: createHash('sha256').update(before).digest('hex'),
        measurements: project.measurements.length,
        modelTakeoffs: out.model.elements.filter((e) => e.origin === 'takeoff').length,
        placed: out.model.elements.filter((e) => e.shape).length,
        registeredSheets: project.sheets.filter((s) => reg[s.id]).map((s) => s.name),
        levels: out.model.levels,
        floorAreas: out.model.floorAreas,
        facts,
        baseline: lean.feasibility,
        earlier: earlier.feasibility,
        later: later.feasibility,
        issues: out.model.issues,
        scheduleIssues: out.schedule.issues,
      });
    }
    writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  },
  180000,
);
