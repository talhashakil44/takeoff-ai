import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { automateCeilings } from '../src/automate/ceilings';
import { doorTakeoff, findDoorTagsIn } from '../src/automate/doors';
import { applyFinishes, finishRooms, readFinishes } from '../src/automate/finishes';
import type { Automation } from '../src/automate/result';
import { automateRooms } from '../src/automate/rooms';
import { automateSprinklers } from '../src/automate/sprinklers';
import { defaultSymbolChoices, symbolTakeoff, symbolTallies } from '../src/automate/symbols';
import { automateWalls, projectSetTypes } from '../src/automate/walls';
import { automateWindows } from '../src/automate/windows';
import { newProject, type Project, type Sheet, type Units } from '../src/model';
import { classifySet, issueOrder, reissued, viewTitle, type PlanLevel, type SheetClass } from './classify';
import { resultItems, type ResultItem } from './items';
import { makeSheets, NodeSet, openDoc, unitsOf, type OpenDoc } from './nodeSet';

/** Wall openings up to this width (metres) are bridged, as the app's default. */
const MAX_OPENING = 3;

export interface SheetReport {
  file: string;
  page: number;
  name: string;
  title: string | null;
  /** With no title in the title block, the drawing title it was classed by. */
  viewTitle?: string;
  class: SheetClass;
  level?: PlanLevel;
  classWhy: string;
  scale: string | null;
  scaleHints: string[];
  /** Re-issued by a later addendum: not taken off. */
  superseded?: boolean;
  /** ms per tool on this sheet. */
  ms: Record<string, number>;
  notes: string[];
}

export interface ToolReport {
  tool: string;
  ms: number;
  /** What the app would have said (its toast), or the error. */
  message: string;
  error?: string;
  /** Items it produced. */
  items: number;
}

export interface JobResult {
  job: string;
  files: string[];
  units: Units;
  unitsWhy: string;
  ranAt: string;
  ms: number;
  sheets: SheetReport[];
  tools: ToolReport[];
  /** Tools the benchmark does not run, and why. */
  notRun: { tool: string; why: string }[];
  items: ResultItem[];
  errors: { sheet?: string; tool: string; error: string }[];
}

const errText = (e: unknown) => (e instanceof Error ? `${e.message}${e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}` : String(e));

/** The drawing PDFs of a job folder (or the one PDF given). */
export function jobPdfs(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir)
    .filter((f) => /\.pdf$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Runs every automatic takeoff tool on a job's drawings, as the app would: sheets made as on
 * upload, then per new-work floor plan Wall takeoff and Rooms (every closed room taken, every
 * wall code to its default type), Door tags counted on every sheet, Room finishes read from the
 * schedules (or tags) onto the rooms, and the whole-set Ceilings, Count symbols (every symbol
 * found) and Fire sprinklers. A failing tool or sheet is recorded and the rest goes on.
 */
export async function runJob(dir: string, log: (s: string) => void = () => {}, only?: string[]): Promise<JobResult> {
  const started = Date.now();
  const keyPath = join(statSync(dir).isFile() ? '' : dir, 'key.json');
  const keyJson = existsSync(keyPath)
    ? (JSON.parse(readFileSync(keyPath, 'utf8')) as {
        units?: Units;
        drawings?: string[];
      })
    : {};
  // In the order they were issued, so addenda come after the sheets they re-issue.
  const files = issueOrder(jobPdfs(dir), keyJson.drawings);
  const errors: JobResult['errors'] = [];
  const docs: OpenDoc[] = [];
  for (const f of files) {
    try {
      docs.push(await openDoc(f));
    } catch (e) {
      errors.push({ tool: 'open', error: `${basename(f)}: ${errText(e)}` });
    }
  }
  const keyUnits = keyJson.units;
  const counted = await unitsOf(docs);
  const units: Units = keyUnits === 'metric' || keyUnits === 'imperial' ? keyUnits : counted.units;
  const unitsWhy = keyUnits ? 'key.json units' : `scale notes: ${counted.imperial} imperial, ${counted.metric} metric`;
  log(`${basename(dir)}: ${docs.length} files, ${units}`);

  const tools: ToolReport[] = [];
  const t0 = Date.now();
  // SHEET_CACHE=1: the sheets as made last time (names, titles, scales), for iterating on one tool.
  // Delete <job>/sheets.cache.json after changing how sheets are read.
  const cachePath = statSync(dir).isFile() ? null : join(dir, 'sheets.cache.json');
  const cacheKey = docs.map((d) => d.file).join('|') + `|${units}`;
  let sheets: Sheet[];
  const cached =
    process.env.SHEET_CACHE && cachePath && existsSync(cachePath)
      ? (JSON.parse(readFileSync(cachePath, 'utf8')) as {
          key: string;
          sheets: (Sheet & { doc: number })[];
        })
      : null;
  if (cached && cached.key === cacheKey)
    sheets = cached.sheets.map(({ doc, ...s }) => ({
      ...s,
      docId: docs[doc].id,
    }));
  else {
    sheets = (await makeSheets(docs, units, log)).sheets;
    if (process.env.SHEET_CACHE && cachePath)
      writeFileSync(
        cachePath,
        JSON.stringify({
          key: cacheKey,
          sheets: sheets.map((s) => ({
            ...s,
            doc: docs.findIndex((d) => d.id === s.docId),
          })),
        }),
      );
  }
  // Sheets an addendum re-issued are superseded, as the app marks them when takeoffs move onto the re-issue.
  const newer = reissued(sheets, docs);
  for (const s of sheets) if (newer.has(s.id)) s.superseded = true;
  tools.push({
    tool: 'sheets',
    ms: Date.now() - t0,
    message: `${sheets.length} sheets, ${sheets.filter((s) => s.metersPerPoint).length} scales read`,
    items: 0,
  });
  let project: Project = {
    ...newProject(units),
    name: basename(dir),
    docs: docs.map((d) => ({ id: d.id, name: d.file })),
    sheets,
  };
  const set = new NodeSet(new Map(docs.map((d) => [d.id, d])), sheets);
  const fileOf = new Map(docs.map((d) => [d.id, d.file]));
  const reports = new Map<string, SheetReport>();
  // No title in the title block: the sheet's biggest drawing title instead.
  const views = new Map<string, string | null>();
  for (const s of sheets) views.set(s.id, s.title ? null : viewTitle(await set.texts(s).catch(() => [])));
  const kinds = classifySet(sheets.map((s) => ({ name: s.name, title: s.title ?? views.get(s.id) ?? undefined, ocr: s.ocr })));
  for (const [i, s] of sheets.entries()) {
    const view = views.get(s.id);
    const c = kinds[i]!;
    reports.set(s.id, {
      file: fileOf.get(s.docId)!,
      page: s.page,
      name: s.name,
      title: s.title ?? null,
      ...(view ? { viewTitle: view } : {}),
      class: c.kind,
      ...(c.level ? { level: c.level } : {}),
      classWhy: c.why,
      scale: s.scaleLabel,
      scaleHints: s.scaleHints,
      ms: {},
      notes: [],
    });
  }
  const note = (s: Sheet, text: string) => reports.get(s.id)!.notes.push(text);
  for (const s of sheets) {
    const by = newer.get(s.id);
    if (by) note(s, `superseded by ${by.name} in ${fileOf.get(by.docId)}: not taken off`);
    if (!s.metersPerPoint)
      note(
        s,
        s.scaleHints.length > 1
          ? `no scale: several noted (${s.scaleHints.join(', ')}), left unscaled`
          : s.scaleHints.length
            ? 'no scale: noted scale not read'
            : 'no scale noted or read from dimensions',
      );
  }
  const toolOfType = new Map<string, string>();
  const apply = (tool: string, r: Automation) => {
    if (!r.apply) return;
    const before = new Set(project.types.map((t) => t.id));
    project = r.apply(project);
    for (const t of project.types) if (!before.has(t.id)) toolOfType.set(t.id, tool);
  };
  /** Runs one tool, timed, its error recorded. */
  const run = async (tool: string, body: () => Promise<string>) => {
    if (only?.length && !only.includes(tool)) {
      tools.push({ tool, ms: 0, message: 'skipped (TOOLS)', items: 0 });
      return;
    }
    set.tool = tool;
    const t = Date.now();
    let message = '';
    let error: string | undefined;
    try {
      message = await body();
    } catch (e) {
      error = errText(e);
      errors.push({ tool, error });
    }
    set.endNaming();
    const ms = Date.now() - t;
    log(`  ${tool}: ${ms} ms · ${error ? `ERROR ${error.split('\n')[0]}` : message}`);
    // The slowest sheets of a whole-set tool (walls and rooms log each sheet as they go).
    if (tool !== 'walls' && tool !== 'rooms') {
      const per = sheets
        .map((s) => ({ s, ms: set.times.get(s.id)?.get(tool) ?? 0 }))
        .filter((x) => x.ms >= 1)
        .sort((a, b) => b.ms - a.ms);
      if (per.length)
        log(
          `    ${per.length} sheets, slowest: ${per
            .slice(0, 6)
            .map((x) => `${x.s.name} ${(x.ms / 1000).toFixed(1)} s`)
            .join(', ')}`,
        );
    }
    tools.push({
      tool,
      ms,
      message: error ? 'failed' : message,
      ...(error ? { error } : {}),
      items: 0,
    });
  };
  // Enlarged plans last: they give only the wall types the overall plans did not.
  const plans = sheets
    .filter((s) => !s.superseded && reports.get(s.id)!.class === 'floor plan')
    .sort((a, b) => +(reports.get(a.id)!.level === 'enlarged') - +(reports.get(b.id)!.level === 'enlarged'));
  // Rooms are on the plans of the building's levels, not its foundation or roof.
  const levels = plans.filter((s) => reports.get(s.id)!.level === 'level');

  // Per plan: walls, then rooms (each sheet on its own: one failing does not stop the others).
  for (const kind of ['walls', 'rooms'] as const) {
    await run(kind, async () => {
      const done: string[] = [];
      for (const s of kind === 'walls' ? plans : levels) {
        if (!s.metersPerPoint) {
          note(s, `${kind}: not run (no scale)`);
          continue;
        }
        const t = Date.now();
        try {
          const page = await set.page(s);
          if (!page) throw new Error('page not open');
          const enlarged = reports.get(s.id)!.level === 'enlarged';
          const taken = new Set(
            project.types
              .filter((t) => toolOfType.get(t.id) === 'walls' && project.measurements.some((m) => m.typeId === t.id))
              .map((t) => t.name.split(' – ')[0].trim()),
          );
          const r =
            kind === 'walls'
              ? await automateWalls(
                  project,
                  page,
                  set.doc(s),
                  s,
                  MAX_OPENING,
                  docs.map((d) => d.pdf),
                  enlarged ? taken : undefined,
                )
              : await automateRooms(
                  project,
                  page,
                  s,
                  MAX_OPENING,
                  await projectSetTypes(
                    set.doc(s),
                    docs.map((d) => d.pdf),
                  ),
                );
          apply(kind, r);
          note(s, `${kind}: ${r.message}`);
          if (kind === 'walls' && 'read' in r && r.read?.result.unmatched.length)
            note(
              s,
              `walls: ${r.read.result.unmatched.length} tags pointing at no wall (${[...new Set(r.read.result.unmatched.map((u) => u.code))].join(', ')})`,
            );
          if (kind === 'rooms' && 'rooms' in r) {
            const open = r.rooms.filter((x) => !x.points);
            if (open.length) note(s, `rooms: ${open.length} not closed (${open.map((x) => x.labels.map((l) => l.number).join('/')).join(', ')})`);
          }
          if (r.apply) done.push(s.name);
          page.cleanup();
        } catch (e) {
          errors.push({ sheet: s.name, tool: kind, error: errText(e) });
          note(s, `${kind}: ERROR ${e instanceof Error ? e.message : String(e)}`);
        }
        set.addTime(s.id, kind, Date.now() - t);
        log(`    ${kind} ${s.name}: ${Date.now() - t} ms`);
      }
      const of = kind === 'walls' ? plans : levels;
      return of.length ? `${done.length} of ${of.length} plans` : 'no floor plans in the set';
    });
  }

  // Door tags: from the first floor plan, then "Count on all sheets".
  await run('doors', async () => {
    const home = levels[0] ?? plans[0];
    if (!home) return 'not run: no floor plan to start from';
    const found = await findDoorTagsIn(project, set, home, true);
    for (const f of found)
      note(
        sheets.find((s) => s.id === f.sheetId)!,
        `doors: ${f.tags.length} tags`,
      );
    const r = doorTakeoff(project, found, home, true);
    apply('doors', r);
    return r.message;
  });

  // Window tags: every window type tag on the floor plans (or elevations), counted across the set.
  await run('windows', async () => {
    const r = await automateWindows(project, set);
    apply('windows', r);
    return r.message;
  });

  // Room finishes: the schedules (or finish tags) onto the rooms found.
  await run('finishes', async () => {
    const rooms = finishRooms(project);
    if (!rooms.length) return 'not run: no rooms';
    const r = await readFinishes(project, rooms, set, project.types);
    apply('finishes', { message: r.note, apply: applyFinishes(r) });
    return `${r.note}${r.unmatched ? ` Unmatched: ${r.unmatched.rows.length} schedule lines, ${r.unmatched.rooms.length} rooms.` : ''}`;
  });

  await run('ceilings', async () => {
    const r = await automateCeilings(project, set, null);
    apply('ceilings', r);
    return r.message;
  });

  await run('symbols', async () => {
    const { tallies, message } = await symbolTallies(project, set);
    if (!tallies.length) return message ?? 'no symbols';
    const choices = defaultSymbolChoices(tallies);
    if (!choices.length) return `${tallies.length} legend symbols, none found on the plans`;
    const r = symbolTakeoff(project, choices);
    apply('symbols', r);
    return `${r.message} (${tallies.length - choices.length} legend symbols not found)`;
  });

  await run('sprinklers', async () => {
    const r = await automateSprinklers(project, set, null);
    apply('sprinklers', r);
    return r.message;
  });

  const items = resultItems(project, toolOfType);
  for (const t of tools) t.items = items.filter((i) => i.tool === t.tool).length;
  for (const e of set.errors) {
    const s = sheets.find((x) => x.id === e.sheetId)!;
    errors.push({ sheet: s.name, tool: e.tool, error: e.error });
    note(s, `${e.tool}: ERROR ${e.error}`);
  }
  for (const [id, m] of set.times) {
    const r = reports.get(id)!;
    for (const [tool, ms] of m) r.ms[tool] = (r.ms[tool] ?? 0) + Math.round(ms);
  }
  const result: JobResult = {
    job: basename(dir).replace(/\.pdf$/i, ''),
    files: files.map((f) => basename(f)),
    units,
    unitsWhy,
    ranAt: new Date().toISOString(),
    ms: Date.now() - started,
    sheets: sheets.map((s) => ({
      ...reports.get(s.id)!,
      ...(s.superseded ? { superseded: true } : {}),
    })),
    tools,
    notRun: [
      {
        tool: 'Read assembly types',
        why: "needs Claude (AI); wall types are taken from the tags and the set's type sheets instead",
      },
      {
        tool: 'Read a legend',
        why: 'needs a legend boxed by hand (Count symbols reads legends without boxing)',
      },
    ],
    items,
    errors,
  };
  for (const d of docs) await d.pdf.destroy().catch(() => undefined);
  return result;
}

/** Runs a job and writes its result.json into `outDir` (the job folder by default). */
export async function runJobTo(dir: string, outDir: string, log?: (s: string) => void, only?: string[]): Promise<JobResult> {
  const result = await runJob(dir, log, only);
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 1));
  return result;
}
