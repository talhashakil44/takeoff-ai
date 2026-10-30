/**
 * Read-only check that Build It's reduced drawing evidence (only the sheets it uses, lines
 * without colour/layer) builds exactly the same model and plan as reading every sheet whole,
 * and that the stale check no longer stringifies the linework.
 *   BUILD_PROJECTS_ROOT="/path/to/Takeoff AI" npx vitest run -c bench/vitest.config.ts bench/buildSources.test.ts
 */
import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDoc } from './nodeSet';
import { pageTexts } from '../src/pageText';
import { segmentsOf } from '../src/fill/sheetWalls';
import { buildAll } from '../src/build/run';
import { readSpecFacts } from '../src/build/facts';
import { sourceHashOf, titleBlockWords } from '../src/build/extract';
import { doorSheets, needsLines, needsText, slimLines } from '../src/build/sources';
import type { Project } from '../src/model';

const root = process.env.BUILD_PROJECTS_ROOT;
it.skipIf(!root)(
  'reduced drawing evidence builds the same model and plan, and hashes fast',
  async () => {
    for (const key of ['Kelso', '84 Frederick']) {
      const folder = readdirSync(root!).find((n) => n.startsWith(`${key} demo`));
      expect(folder, `Missing ${key} demo`).toBeTruthy();
      const base = join(root!, folder!);
      const project: Project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')).project;
      const docs = new Map<string, Awaited<ReturnType<typeof openDoc>>>();
      const getDoc = async (id: string) => {
        if (!docs.has(id)) docs.set(id, await openDoc(join(base, 'drawings', `${id}.pdf`)));
        return docs.get(id)!;
      };
      type Src = { texts: Record<string, { str: string; cx: number; cy: number }[]>; lines: Record<string, ReturnType<typeof slimLines>>; hints: Record<string, string> };
      const full: Src = { texts: {}, lines: {}, hints: {} };
      const slim: Src = { texts: {}, lines: {}, hints: {} };
      const measured = new Set(project.measurements.map((m) => m.sheetId));
      const doors = doorSheets(project);
      for (const s of project.sheets.filter((s) => !s.superseded)) {
        const page = await (await getDoc(s.docId)).pdf.getPage(s.page);
        const t = await pageTexts(page);
        full.texts[s.id] = t;
        full.hints[s.id] = titleBlockWords(t, s.width, s.height);
        if (needsText(s, measured)) {
          slim.texts[s.id] = t.map((x) => ({ str: x.str, cx: x.cx, cy: x.cy }));
          slim.hints[s.id] = full.hints[s.id];
        }
        if (needsLines(s, doors)) {
          const l = await segmentsOf(page);
          full.lines[s.id] = l;
          slim.lines[s.id] = slimLines(l);
        }
      }
      const sections = project.specs?.flatMap((s) => s.book?.sections ?? []) ?? [];
      const facts = await readSpecFacts(sections, async (id, page) => (await pageTexts(await (await getDoc(id)).pdf.getPage(page))).map((t) => t.str).join(' '));
      const run = (src: Src) => buildAll({ project, sections, facts, drawingTexts: src.texts, drawingLines: src.lines, levelHints: src.hints, today: '2026-11-02' });
      // Level sheet lists may differ by unmeasured notes sheets; nothing reads them.
      const same = (o: ReturnType<typeof run>) =>
        JSON.stringify({ ...o.model, sourceHash: '', levels: o.model.levels.map((l) => ({ ...l, sheets: l.sheets.filter((id) => measured.has(id)) })) }) +
        JSON.stringify(o.schedule.feasibility) +
        JSON.stringify(o.schedule.times);
      expect(same(run(slim))).toBe(same(run(full)));
      const t0 = performance.now();
      sourceHashOf({ project, sections, drawingTexts: full.texts, drawingLines: full.lines, levelHints: full.hints, floorToFloor: 3.6 });
      expect(performance.now() - t0).toBeLessThan(150);
    }
  },
  600000,
);
