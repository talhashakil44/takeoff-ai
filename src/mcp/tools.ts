import type { Automation } from '../automate/result';
import { sheetEdges, type DrawingGraph } from '../graph/graph';
import type { ProjectMap } from '../spec/links';
import { describe, entries, entryName, indexStats, norm, searchEntries, type DrawingIndex } from '../smart/index';
import type { SetAccess } from '../automate/set';
import { PALETTE } from '../automate/set';
import { automateRooms } from '../automate/rooms';
import { automateWalls } from '../automate/walls';
import { doorTakeoff, findDoorTagsIn } from '../automate/doors';
import { automateWindows } from '../automate/windows';
import { automateCeilings } from '../automate/ceilings';
import { automateSprinklers } from '../automate/sprinklers';
import { applyFinishes, ceilingsFromRcps, finishRooms, readFinishes } from '../automate/finishes';
import { automateKeynotes } from '../automate/keynotes';
import { automateRuns } from '../automate/runs';
import { automateTrades } from '../automate/trades';
import { symbolTakeoff, symbolTallies, defaultSymbolChoices } from '../automate/symbols';
import { DIVISIONS, newId, type Kind, type Measurement, type Project, type Pt, type Sheet, type TakeoffType, type Units } from '../model';
import type { PageText } from '../pageText';
import type { PDFDocumentProxy, PDFPageProxy } from '../pdf';
import { measurementVars, primaryOf, primaryUnit, typeTotals } from '../quantities';
import type { ProjectSummary } from '../storage';
import { equivalentScale, parseScale } from '../units';

/**
 * The tools an AI uses to drive Takeoff AI over MCP (the desktop app's server, electron/mcp.cjs,
 * forwards each call here). Every change goes through the app's own `commit`, so it is undoable,
 * logged in the activity history, saved and written to the project's folder like a change made
 * by hand. Coordinates are sheet points: PDF points from the sheet's top-left corner.
 */

export interface ToolContent {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

/** What the tools need from the app (App.tsx supplies it; the tests a stand-in). */
export interface McpContext {
  project(): Project | null;
  commit(fn: (p: Project) => Project, source: string): void;
  undo(): boolean;
  listProjects(): Promise<ProjectSummary[]>;
  openProject(id: string): Promise<boolean>;
  createProject(name: string, units: Units): Promise<Project>;
  /** Reads a PDF on this computer by path. */
  readPdf(path: string): Promise<{ name: string; data: ArrayBuffer }>;
  /** Adds a drawing file to the open project; resolves to its sheets. */
  addDrawing(name: string, data: ArrayBuffer): Promise<Sheet[]>;
  page(sheet: Sheet): Promise<PDFPageProxy | null>;
  doc(docId: string): PDFDocumentProxy | undefined;
  docs(): PDFDocumentProxy[];
  texts(sheet: Sheet): Promise<PageText[]>;
  access(): SetAccess;
  /** A PNG (base64) of part of a sheet, `scale` pixels per sheet point. */
  render(sheet: Sheet, region: [number, number, number, number], scale: number, withTakeoffs: boolean): Promise<string>;
  /** Saves the Excel workbook; resolves to where it went. */
  exportExcel(): Promise<string>;
  /** Shows a sheet in the window, so the estimator follows along. */
  showSheet(id: string): void;
  /** The project's folder on disk, once it has one. */
  projectFolder(): Promise<string | null>;
  maxOpening(): number;
  /** Takes off the whole set; resolves to the review and RFIs. */
  /** `watch`: slower, holding on each sheet as its takeoffs are drawn (to watch or record it). */
  wholeSet?(watch?: boolean): Promise<string>;
  /** The set's schedules, legends and tags, read once (Smart view). */
  smartIndex?(): Promise<DrawingIndex | null>;
  /** Shows a tag's card in the window, on its sheet. */
  showTag?(key: string): void;
  /** The set's link graph (bubbles, sheet references, schedules, tags), read once. */
  drawingGraph?(): Promise<DrawingGraph | null>;
  /** The specification tied to the drawings (sections, and their links to sheets, schedules and tags). */
  projectMap?(): Promise<ProjectMap | null>;
}

const text = (t: string, structured?: Record<string, unknown>): ToolResult => ({ content: [{ type: 'text', text: t }], ...(structured ? { structuredContent: structured } : {}) });
const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true });
const json = (v: unknown) => JSON.stringify(v, null, 1);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

class ToolError extends Error {}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const num = (description: string) => ({ type: 'number', description });
const point = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };

export const AUTOMATIONS = ['rooms', 'walls', 'doors', 'windows', 'ceilings', 'sprinklers', 'symbols', 'finishes', 'ductwork_piping', 'trade_counts', 'keynotes_demolition'] as const;
type AutomationKind = (typeof AUTOMATIONS)[number];

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'Every project in Takeoff AI, newest first, with which one is open and where projects are kept on disk.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'open_project',
    title: 'Open project',
    description: 'Opens a project by id (from list_projects). The other tools work on the open project.',
    inputSchema: obj({ project_id: str('Project id') }, ['project_id']),
  },
  {
    name: 'create_project',
    title: 'Create project',
    description: 'Creates a new, empty project and opens it. It gets its own folder in the projects folder once it has drawings.',
    inputSchema: obj({ name: str('Project name, e.g. "Kelso Chalet - Halton Parks"'), units: str('metric (m, m²) or imperial (ft, SF)', { enum: ['metric', 'imperial'] }) }, ['name']),
  },
  {
    name: 'project_summary',
    title: 'Project summary',
    description: 'The open project: name, units, folder on disk, drawing files, sheet and takeoff counts, sheets still missing a scale.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_drawings',
    title: 'Add drawings',
    description:
      'Adds drawing PDFs from this computer to the open project. Each page becomes a sheet, named from its title block, with its scale read where printed. Paths are absolute (~ allowed). Large sets take a while.',
    inputSchema: obj({ paths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'PDF file paths' } }, ['paths']),
  },
  {
    name: 'list_sheets',
    title: 'List sheets',
    description: 'Sheets in the open project: id, number/name, title, size in sheet points, scale and where it came from, takeoffs on it. Superseded sheets (replaced by a re-issue) are left out unless asked.',
    inputSchema: obj({ filter: str('Only sheets whose name or title contains this (case-insensitive), e.g. "A2" or "ceiling"'), include_superseded: { type: 'boolean' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_sheet_text',
    title: 'Sheet text',
    description: 'Text printed on a sheet, each run with its centre (x, y) and height in sheet points. Use it to read schedules, legends, notes and tags and to find where things are. With query, only runs containing it; with sheet_id omitted and a query, searches every sheet.',
    inputSchema: obj({ sheet_id: str('Sheet id'), query: str('Only text containing this (case-insensitive)'), limit: num('Most runs to return (default 400)') }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_sheet_image',
    title: 'Sheet image',
    description:
      'A PNG of a sheet, or of a region of it, with the takeoffs drawn over it (coloured by type). Use a region to read small print. The result says how pixels map to sheet points: sheet = region origin + pixel / scale.',
    inputSchema: obj(
      {
        sheet_id: str('Sheet id'),
        region: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[x0, y0, x1, y1] in sheet points (default: the whole sheet)' },
        max_px: num('Longest side of the image in pixels (default 1600, at most 2400)'),
        show_takeoffs: { type: 'boolean', description: 'Draw the takeoffs over it (default true)' },
      },
      ['sheet_id'],
    ),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'set_sheet_scale',
    title: 'Set sheet scale',
    description: 'Sets a sheet\'s drawing scale, e.g. "1:100", "1:50", "1/8\\" = 1\'-0\\"", "1\\" = 20\'". Check the scale the drawing prints for the main view before measuring.',
    inputSchema: obj({ sheet_ids: { type: 'array', items: { type: 'string' }, minItems: 1 }, scale: str('Scale notation') }, ['sheet_ids', 'scale']),
  },
  {
    name: 'set_units',
    title: 'Set units',
    description: 'Switches the open project between metric (m, m²) and imperial (ft, SF). Takeoffs are kept on the sheet, so every quantity converts; type heights and sizes are converted too. Match the drawings: imperial scales (1/8" = 1\'-0") mean imperial.',
    inputSchema: obj({ units: str('metric or imperial', { enum: ['metric', 'imperial'] }) }, ['units']),
  },
  {
    name: 'list_types',
    title: 'List takeoff types',
    description: 'Takeoff types (what each takeoff is priced as): id, name, kind (area, linear, count), height, division, assembly items with formulas.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_type',
    title: 'Create takeoff type',
    description:
      'Adds a takeoff type. kind: area (m²/SF), linear (m/ft; walls use height for A = L × H), count (ea). items are the materials priced from it, each a formula over L (length), H (height), A (area), P (perimeter), N (count), W, D, T (the type\'s width, depth, thickness).',
    inputSchema: obj(
      {
        name: str('e.g. "W1 – 92mm steel stud partition"'),
        kind: str('area, linear or count', { enum: ['area', 'linear', 'count'] }),
        height: num('Height in project units (walls, rooms)'),
        division: str('Estimate division', { enum: DIVISIONS }),
        color: str('#rrggbb'),
        description: str('Assembly build-up'),
        items: { type: 'array', items: obj({ name: str('Item'), unit: str('Unit, e.g. m², m, ea, sheets'), formula: str('e.g. "A * 2 / 2.97"') }, ['name', 'unit', 'formula']) },
      },
      ['name', 'kind'],
    ),
  },
  {
    name: 'update_type',
    title: 'Update takeoff type',
    description: 'Changes a takeoff type\'s name, height, division, colour, description or items (items replace the old list).',
    inputSchema: obj(
      {
        type_id: str('Type id'),
        name: str('New name'),
        height: num('Height'),
        division: str('Division', { enum: DIVISIONS }),
        color: str('#rrggbb'),
        description: str('Assembly build-up'),
        items: { type: 'array', items: obj({ name: str('Item'), unit: str('Unit'), formula: str('Formula') }, ['name', 'unit', 'formula']) },
      },
      ['type_id'],
    ),
  },
  {
    name: 'list_takeoffs',
    title: 'List takeoffs',
    description: 'Takeoffs (measurements) in the open project, optionally on one sheet or of one type: id, sheet, type, label, quantity, where it came from, point count.',
    inputSchema: obj({ sheet_id: str('Only this sheet'), type_id: str('Only this type'), with_points: { type: 'boolean', description: 'Include the points' }, limit: num('Most to return (default 300)') }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'add_takeoff',
    title: 'Add takeoff',
    description:
      'Adds a takeoff on a sheet under a type, from points in sheet points. Area types: a closed outline (3+ points, not repeating the first). Linear types: a polyline (2+ points). Count types: each point counts one. Marked as added by AI until reviewed. For a room, label it with its number and name ("032 EXIT CORRIDOR") so the finish schedule matches it.',
    inputSchema: obj(
      {
        sheet_id: str('Sheet id'),
        type_id: str('Type id'),
        points: { type: 'array', items: point, minItems: 1, description: '[[x, y], …] in sheet points' },
        holes: { type: 'array', items: { type: 'array', items: point }, description: 'Cutouts of an area takeoff' },
        label: str('e.g. the room number and name'),
      },
      ['sheet_id', 'type_id', 'points'],
    ),
  },
  {
    name: 'delete_takeoffs',
    title: 'Delete takeoffs',
    description: 'Deletes takeoffs by id. The estimator can undo it.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' }, minItems: 1 } }, ['ids']),
    annotations: { destructiveHint: true },
  },
  {
    name: 'run_automation',
    title: 'Run automation',
    description: [
      'Runs one of the app\'s automatic takeoffs and adds what it finds (one undoable change):',
      'rooms: fills every tagged room on a floor plan (sheet_id) as an area takeoff, replacing that sheet\'s earlier rooms.',
      'walls: centreline lengths of every tagged wall type on a floor plan (sheet_id), replacing that sheet\'s earlier walls.',
      'doors: counts door tags (sheet_id, or every sheet with all_sheets).',
      'windows: window, curtain wall and storefront tags on the plans or elevations (whole set).',
      'ceilings: ceiling areas by type on every reflected ceiling plan.',
      'sprinklers: sprinkler heads on every sprinkler plan.',
      'symbols: every symbol in the set\'s legends, counted on the sheets each legend is for.',
      'finishes: reads the room finish schedules (or finish tags) onto every room takeoff labelled with its number (run it again after adding rooms by hand).',
      'ductwork_piping: ductwork (by size) and piping and conduit (by service) on the mechanical, plumbing and electrical plans, read off the drawing\'s CAD layers; demolition layers as removals.',
      'trade_counts: devices, light fixtures by type, plumbing fixtures, equipment and grilles on the trade plans, from their legends and schedules.',
      'keynotes_demolition: the architect\'s keynotes counted where tagged; on demolition plans, removals by keynote (flooring and ceilings as room areas) and walls drawn dashed.',
      'Set scales first. Then check the result with get_sheet_image.',
    ].join(' '),
    inputSchema: obj({ kind: str('Which automation', { enum: [...AUTOMATIONS] }), sheet_id: str('Sheet, for rooms, walls, doors'), all_sheets: { type: 'boolean', description: 'doors: every sheet' } }, ['kind']),
  },
  {
    name: 'take_off_whole_set',
    title: 'Take off the whole set',
    description:
      'Runs every automatic takeoff over the whole drawing set in one go, as an estimator works a set: walls and rooms on each new-work floor plan, door tags on every sheet, window tags, room finishes from the schedules, ceilings on the RCPs, legend symbols and sprinklers, ductwork and piping off the trade plans layers, mechanical and electrical devices, fixtures and equipment, and keynotes and demolition. Added as one undoable change. Returns what each tool did, the RFIs to send (numbered) and what to check before pricing. Set scales on the floor plans first. Takes minutes on a big set.',
    inputSchema: obj({ watch: { type: 'boolean', description: 'Slower: shows each sheet as its takeoffs are drawn, for watching or recording the run' } }),
  },
  {
    name: 'get_quantities',
    title: 'Quantities',
    description: 'Totals for every takeoff type: length, area, perimeter, count, and each assembly item\'s value from its formula. Takeoffs on sheets without a scale are counted as unscaled.',
    inputSchema: obj({ include_empty: { type: 'boolean', description: 'Include types with nothing taken off' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'export_excel',
    title: 'Export to Excel',
    description: 'Saves the takeoff as an Excel workbook (bid workbook layout) in the project\'s Exports folder and returns its path.',
    inputSchema: obj({}),
  },
  {
    name: 'look_up_tag',
    title: 'Look up a tag',
    description:
      'What the drawings say about a tag: a door (size, frame, hardware, fire rating), a room (floor, base, each wall and ceiling finish), a window, a wall type (studs, boards, width, fire and sound rating), a finish code, or an equipment mark (EF-1, FC-3, WC-1), read from the set\'s own schedules, legends and abbreviations, with the sheets its tag is on. Also searches: give part of a code or a room name to list matches. Shows the tag\'s card in the app (Smart view).',
    inputSchema: obj({ code: str('The tag as drawn (D013.1, 105, P3, ACT 1, EF-1) or part of a code or name'), show: { type: 'boolean', description: 'Show it in the app window too (default true)' } }, ['code']),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'drawing_index',
    title: 'Schedules and legends read',
    description:
      'Every schedule (door, window, room finish, equipment, structural…), type legend and abbreviation list read from the set\'s text, with counts by kind of how many listed tags were found on the plans and which were not (a door in the schedule with no tag on any plan is worth an RFI).',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'drawing_links',
    title: 'Links between the drawings',
    description:
      'The drawing set as a graph of what points at what: detail and section bubbles (5/A5.0 → drawing 5 on A5.0), sheet references in notes (SEE A5.0, PER STRUCTURAL), schedule references (SEE DOOR SCHEDULE), tags (D101, P3, EF-1) and the schedule row or legend that defines them. With sheet_id: every link on that sheet and where it goes. Without: the references between sheets (from, to, how many) and each sheet\'s drawings by number and title.',
    inputSchema: obj({ sheet_id: str('A sheet id from list_sheets (optional)'), include_tags: { type: 'boolean', description: 'Include tag and definition links (many on a busy plan). Default false.' } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'spec_map',
    title: 'Specification tied to the drawings',
    description:
      'The project specification read into its sections and tied to the drawings. Links are "written" (one names the other: a section names a sheet or a schedule, a drawing note names a section) or "matched" (about the same thing by their own words: 08100 HOLLOW METAL WORK and the door schedule). Without section: every section (number, title, pages, how many drawing links) plus the gaps: sections listed "To follow" in the table of contents, and drawing items with no spec section. With section (08100 or 22 11 16): its articles, the sections it refers to, and everything on the drawings tied to it with why and where.',
    inputSchema: obj({ section: str('A section number, e.g. 08100 or 22 11 16 (optional)') }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'undo',
    title: 'Undo',
    description: 'Undoes the last change in the open project (yours or the estimator\'s).',
    inputSchema: obj({}),
  },
];

const need = (ctx: McpContext): Project => {
  const p = ctx.project();
  if (!p) throw new ToolError('No project is open. Use list_projects and open_project, or create_project.');
  return p;
};

const sheetOf = (p: Project, id: unknown): Sheet => {
  const s = p.sheets.find((x) => x.id === id);
  if (!s) throw new ToolError(`No sheet with id ${String(id)}. Use list_sheets.`);
  return s;
};

const typeOf = (p: Project, id: unknown): TakeoffType => {
  const t = p.types.find((x) => x.id === id);
  if (!t) throw new ToolError(`No takeoff type with id ${String(id)}. Use list_types.`);
  return t;
};

const isPoint = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const toPoints = (v: unknown, what: string): Pt[] => {
  if (!Array.isArray(v) || !v.every(isPoint)) throw new ToolError(`${what} must be a list of [x, y] numbers.`);
  return v.map((p) => [p[0], p[1]] as Pt);
};

const scaleText = (s: Sheet) => (s.metersPerPoint ? `${s.scaleLabel ?? 'custom'} (${s.scaleSource ?? 'set'})` : 'not set');

function measurementQty(p: Project, m: Measurement): { qty: number | null; unit: string } {
  const t = p.types.find((x) => x.id === m.typeId);
  const s = p.sheets.find((x) => x.id === m.sheetId);
  if (!t || !s) return { qty: null, unit: '' };
  const v = measurementVars(m, t, s, p.units);
  return { qty: v ? round(primaryOf(t.kind, v), 3) : null, unit: primaryUnit(t.kind, p.units) };
}

const cleanItems = (items: unknown): TakeoffType['items'] | undefined =>
  Array.isArray(items)
    ? items.map((i) => {
        const it = i as { name?: unknown; unit?: unknown; formula?: unknown };
        if (typeof it.name !== 'string' || typeof it.unit !== 'string' || typeof it.formula !== 'string') throw new ToolError('Each item needs name, unit and formula.');
        return { id: newId(), name: it.name, unit: it.unit, formula: it.formula };
      })
    : undefined;

const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** Runs a tool. Errors a model can act on come back as error results, not exceptions. */
export async function runTool(ctx: McpContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return await dispatch(ctx, name, args ?? {});
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message);
    return fail(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function dispatch(ctx: McpContext, name: string, a: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'list_projects': {
      const open = ctx.project()?.id;
      const list = [...(await ctx.listProjects())].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
      const projects = list.map((s) => ({ id: s.id, name: s.name, units: s.units, sheets: s.sheets, takeoffs: s.takeoffs, updated: s.updatedAt, open: s.id === open }));
      return text(json({ projects }), { projects });
    }

    case 'open_project': {
      if (typeof a.project_id !== 'string') throw new ToolError('project_id is required.');
      if (!(await ctx.openProject(a.project_id))) throw new ToolError(`No project with id ${a.project_id}.`);
      const p = need(ctx);
      return text(`Opened "${p.name}": ${p.sheets.length} sheets, ${p.types.length} types, ${p.measurements.length} takeoffs.`);
    }

    case 'create_project': {
      const nm = typeof a.name === 'string' ? a.name.trim() : '';
      if (!nm) throw new ToolError('name is required.');
      const units: Units = a.units === 'imperial' ? 'imperial' : 'metric';
      const p = await ctx.createProject(nm, units);
      return text(`Created and opened "${p.name}" (${units}). Add drawings with add_drawings.`, { project_id: p.id });
    }

    case 'project_summary': {
      const p = need(ctx);
      const live = p.sheets.filter((s) => !s.superseded);
      const unscaled = live.filter((s) => !s.metersPerPoint).map((s) => s.name);
      const summary = {
        id: p.id,
        name: p.name,
        units: p.units,
        folder: await ctx.projectFolder(),
        drawings: p.docs.map((d) => ({ id: d.id, file: d.name, sheets: p.sheets.filter((s) => s.docId === d.id).length })),
        sheets: live.length,
        superseded_sheets: p.sheets.length - live.length,
        sheets_without_scale: unscaled,
        types: p.types.length,
        takeoffs: p.measurements.length,
        ai_takeoffs_to_review: p.measurements.filter((m) => m.source === 'ai').length,
      };
      return text(json(summary), summary);
    }

    case 'add_drawings': {
      need(ctx);
      const paths = Array.isArray(a.paths) ? a.paths.filter((x): x is string => typeof x === 'string') : [];
      if (!paths.length) throw new ToolError('paths is required: PDF file paths on this computer.');
      const lines: string[] = [];
      for (const path of paths) {
        const file = await ctx.readPdf(path);
        const sheets = await ctx.addDrawing(file.name, file.data);
        const scaled = sheets.filter((s) => s.metersPerPoint).length;
        lines.push(`${file.name}: ${sheets.length} sheets, ${scaled} with a scale read, ${sheets.length - scaled} to set.`);
      }
      return text(`${lines.join('\n')}\nUse list_sheets to see them.`);
    }

    case 'list_sheets': {
      const p = need(ctx);
      const q = typeof a.filter === 'string' ? a.filter.toLowerCase() : '';
      const counts = new Map<string, number>();
      for (const m of p.measurements) counts.set(m.sheetId, (counts.get(m.sheetId) ?? 0) + 1);
      const docName = new Map(p.docs.map((d) => [d.id, d.name]));
      const sheets = p.sheets
        .filter((s) => a.include_superseded || !s.superseded)
        .filter((s) => !q || `${s.name} ${s.title ?? ''}`.toLowerCase().includes(q))
        .map((s) => ({
          id: s.id,
          name: s.name,
          title: s.title ?? null,
          file: docName.get(s.docId) ?? null,
          page: s.page,
          size: [round(s.width, 1), round(s.height, 1)],
          scale: scaleText(s),
          scale_hints: s.scaleHints,
          takeoffs: counts.get(s.id) ?? 0,
          ...(s.repeat && s.repeat > 1 ? { repeat: s.repeat } : {}),
          ...(s.superseded ? { superseded: true } : {}),
          ...(s.done ? { done: true } : {}),
        }));
      return text(json({ sheets }), { sheets });
    }

    case 'get_sheet_text': {
      const p = need(ctx);
      const q = typeof a.query === 'string' ? a.query.toLowerCase() : '';
      const limit = typeof a.limit === 'number' && a.limit > 0 ? Math.min(5000, a.limit) : 400;
      const targets = typeof a.sheet_id === 'string' ? [sheetOf(p, a.sheet_id)] : q ? p.sheets.filter((s) => !s.superseded) : null;
      if (!targets) throw new ToolError('Give a sheet_id, or a query to search every sheet.');
      const out: { sheet_id: string; sheet: string; text: string; x: number; y: number; h: number }[] = [];
      let total = 0;
      for (const s of targets) {
        const runs = (await ctx.texts(s)).filter((t) => !q || t.str.toLowerCase().includes(q));
        total += runs.length;
        for (const t of runs) {
          if (out.length >= limit) break;
          out.push({ sheet_id: s.id, sheet: s.name, text: t.str, x: round(t.cx, 1), y: round(t.cy, 1), h: round(t.h, 1) });
        }
      }
      const more = total > out.length ? `\n(${total - out.length} more not shown: narrow with query or raise limit.)` : '';
      if (typeof a.sheet_id === 'string') {
        const runs = out.map(({ text: t, x, y, h }) => ({ text: t, x, y, h }));
        return text(`${json(runs)}${more}`);
      }
      return text(`${json(out)}${more}`);
    }

    case 'get_sheet_image': {
      const p = need(ctx);
      const s = sheetOf(p, a.sheet_id);
      const r = Array.isArray(a.region) && a.region.length === 4 && a.region.every((n) => typeof n === 'number') ? (a.region as number[]) : [0, 0, s.width, s.height];
      const region: [number, number, number, number] = [
        Math.max(0, Math.min(r[0], r[2])),
        Math.max(0, Math.min(r[1], r[3])),
        Math.min(s.width, Math.max(r[0], r[2])),
        Math.min(s.height, Math.max(r[1], r[3])),
      ];
      const w = region[2] - region[0];
      const h = region[3] - region[1];
      if (w < 1 || h < 1) throw new ToolError('That region is empty or off the sheet.');
      const maxPx = typeof a.max_px === 'number' ? Math.max(200, Math.min(2400, a.max_px)) : 1600;
      const scale = maxPx / Math.max(w, h);
      ctx.showSheet(s.id);
      const data = await ctx.render(s, region, scale, a.show_takeoffs !== false);
      return {
        content: [
          { type: 'image', data, mimeType: 'image/png' },
          {
            type: 'text',
            text: `${s.name}${s.title ? ` – ${s.title}` : ''}, region [${region.map((n) => round(n, 1)).join(', ')}] of ${round(s.width, 1)} × ${round(s.height, 1)} pt, ${round(scale, 4)} px per pt: sheet x = ${round(region[0], 1)} + px / ${round(scale, 4)}, sheet y = ${round(region[1], 1)} + py / ${round(scale, 4)}. Scale ${scaleText(s)}.`,
          },
        ],
      };
    }

    case 'set_sheet_scale': {
      const p = need(ctx);
      const label = typeof a.scale === 'string' ? a.scale.trim() : '';
      const mpp = parseScale(label);
      if (!mpp) throw new ToolError(`Could not read the scale "${label}". Use "1:100" or "1/8\\" = 1'-0\\"" style.`);
      const ids = Array.isArray(a.sheet_ids) ? a.sheet_ids : [];
      const sheets = ids.map((id) => sheetOf(p, id));
      const set = new Set(sheets.map((s) => s.id));
      ctx.commit((q) => ({ ...q, sheets: q.sheets.map((s) => (set.has(s.id) ? { ...s, metersPerPoint: mpp, scaleLabel: label, scaleSource: 'preset' as const } : s)) }), 'Scale (AI)');
      return text(`Set ${label} on ${sheets.map((s) => s.name).join(', ')} (${equivalentScale(mpp, p.units)}).`);
    }

    case 'set_units': {
      const p = need(ctx);
      const units: Units = a.units === 'imperial' ? 'imperial' : a.units === 'metric' ? 'metric' : (() => { throw new ToolError('units must be metric or imperial.'); })();
      if (p.units === units) return text(`The project is already ${units}.`);
      const f = units === 'imperial' ? 1 / 0.3048 : 0.3048;
      const conv = (v: number | undefined) => (v === undefined ? v : Math.round(v * f * 1000) / 1000);
      ctx.commit((q) => ({ ...q, units, types: q.types.map((t) => ({ ...t, height: conv(t.height) ?? 0, width: conv(t.width), depth: conv(t.depth), thickness: conv(t.thickness) })) }), 'Units (AI)');
      return text(`Project now in ${units}.${p.types.some((t) => t.items.some((i) => /\d*\.\d+|\b\d{2,}\b/.test(i.formula))) ? ' Numbers typed into material formulas were left as they are: check them.' : ''}`);
    }

    case 'list_types': {
      const p = need(ctx);
      const types = p.types.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        height: t.height,
        division: t.division ?? null,
        color: t.color,
        items: t.items.map((i) => ({ name: i.name, unit: i.unit, formula: i.formula })),
      }));
      return text(json({ types }), { types });
    }

    case 'create_type': {
      const p = need(ctx);
      const nm = typeof a.name === 'string' ? a.name.trim() : '';
      if (!nm) throw new ToolError('name is required.');
      if (a.kind !== 'area' && a.kind !== 'linear' && a.kind !== 'count') throw new ToolError('kind must be area, linear or count.');
      if (p.types.some((t) => t.name.toLowerCase() === nm.toLowerCase())) throw new ToolError(`A type named "${nm}" already exists. Use list_types.`);
      const kind = a.kind as Kind;
      const t: TakeoffType = {
        id: newId(),
        name: nm,
        kind,
        color: isColor(a.color) ? a.color : PALETTE[p.types.length % PALETTE.length],
        height: typeof a.height === 'number' && a.height > 0 ? a.height : p.units === 'metric' ? 3 : 10,
        items: cleanItems(a.items) ?? [],
        ...(typeof a.division === 'string' && (DIVISIONS as readonly string[]).includes(a.division) ? { division: a.division } : {}),
        ...(typeof a.description === 'string' && a.description.trim() ? { description: a.description.trim() } : {}),
      };
      ctx.commit((q) => ({ ...q, types: [...q.types, t] }), 'New type (AI)');
      return text(`Created ${kind} type "${t.name}" (id ${t.id}).`, { type_id: t.id });
    }

    case 'update_type': {
      const p = need(ctx);
      const t = typeOf(p, a.type_id);
      const patch: Partial<TakeoffType> = {};
      if (typeof a.name === 'string' && a.name.trim()) patch.name = a.name.trim();
      if (typeof a.height === 'number' && a.height > 0) patch.height = a.height;
      if (typeof a.division === 'string' && (DIVISIONS as readonly string[]).includes(a.division)) patch.division = a.division;
      if (isColor(a.color)) patch.color = a.color;
      if (typeof a.description === 'string') patch.description = a.description;
      const items = cleanItems(a.items);
      if (items) patch.items = items;
      if (!Object.keys(patch).length) throw new ToolError('Nothing to change.');
      ctx.commit((q) => ({ ...q, types: q.types.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }), 'Edit type (AI)');
      return text(`Updated "${patch.name ?? t.name}": ${Object.keys(patch).join(', ')}.`);
    }

    case 'list_takeoffs': {
      const p = need(ctx);
      const limit = typeof a.limit === 'number' && a.limit > 0 ? Math.min(5000, a.limit) : 300;
      const typeName = new Map(p.types.map((t) => [t.id, t.name]));
      const sheetName = new Map(p.sheets.map((s) => [s.id, s.name]));
      const all = p.measurements.filter((m) => (!a.sheet_id || m.sheetId === a.sheet_id) && (!a.type_id || m.typeId === a.type_id));
      const takeoffs = all.slice(0, limit).map((m) => {
        const { qty, unit } = measurementQty(p, m);
        return {
          id: m.id,
          sheet_id: m.sheetId,
          sheet: sheetName.get(m.sheetId) ?? null,
          type_id: m.typeId,
          type: typeName.get(m.typeId) ?? null,
          label: m.label ?? null,
          quantity: qty,
          unit,
          source: m.source ?? 'manual',
          points: a.with_points ? m.points.map(([x, y]) => [round(x, 1), round(y, 1)]) : m.points.length,
        };
      });
      const more = all.length > takeoffs.length ? `\n(${all.length - takeoffs.length} more not shown.)` : '';
      return text(`${json(takeoffs)}${more}`);
    }

    case 'add_takeoff': {
      const p = need(ctx);
      const s = sheetOf(p, a.sheet_id);
      const t = typeOf(p, a.type_id);
      const pts = toPoints(a.points, 'points');
      const off = pts.find(([x, y]) => x < -1 || y < -1 || x > s.width + 1 || y > s.height + 1);
      if (off) throw new ToolError(`Point [${off.join(', ')}] is off the sheet (${round(s.width, 1)} × ${round(s.height, 1)} pt).`);
      // Marked as the AI's by its source (shown as "added by AI, to check"); the label stays the
      // room's own ("032 EXIT CORRIDOR") so finish schedules and room lookups still match it.
      const label = typeof a.label === 'string' && a.label.trim() ? a.label.trim() : undefined;
      let added: Measurement[];
      if (t.kind === 'count') {
        added = pts.map((pt) => ({ id: newId(), sheetId: s.id, typeId: t.id, points: [pt], holes: [], source: 'ai' as const, ...(label ? { label } : {}) }));
      } else {
        if (t.kind === 'area' && pts.length < 3) throw new ToolError('An area takeoff needs at least 3 points.');
        if (t.kind === 'linear' && pts.length < 2) throw new ToolError('A linear takeoff needs at least 2 points.');
        const holes = Array.isArray(a.holes) && t.kind === 'area' ? a.holes.map((h, i) => toPoints(h, `holes[${i}]`)) : [];
        added = [{ id: newId(), sheetId: s.id, typeId: t.id, points: pts, holes, source: 'ai' as const, ...(label ? { label } : {}) }];
      }
      ctx.commit((q) => ({ ...q, measurements: [...q.measurements, ...added] }), 'Takeoff (AI)');
      ctx.showSheet(s.id);
      const after = ctx.project() ?? p;
      const qtys = added.map((m) => measurementQty(after, m));
      const total = qtys.reduce((n, x) => n + (x.qty ?? 0), 0);
      const scaled = !!s.metersPerPoint || t.kind === 'count';
      return text(
        `Added ${added.length} ${t.name} takeoff${added.length === 1 ? '' : 's'} on ${s.name}: ${scaled ? `${round(total, 3)} ${qtys[0]?.unit}` : 'no quantity yet (the sheet has no scale)'}.`,
        { ids: added.map((m) => m.id) },
      );
    }

    case 'delete_takeoffs': {
      const p = need(ctx);
      const ids = new Set(Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === 'string') : []);
      const found = p.measurements.filter((m) => ids.has(m.id)).length;
      if (!found) throw new ToolError('None of those ids are takeoffs in this project.');
      ctx.commit((q) => ({ ...q, measurements: q.measurements.filter((m) => !ids.has(m.id)) }), 'Delete takeoffs (AI)');
      return text(`Deleted ${found} takeoff${found === 1 ? '' : 's'}${found < ids.size ? ` (${ids.size - found} ids not found)` : ''}.`);
    }

    case 'run_automation':
      return automation(ctx, a);

    case 'take_off_whole_set': {
      need(ctx);
      if (!ctx.wholeSet) throw new ToolError('This version of the app cannot take off the whole set.');
      return text(await ctx.wholeSet(a.watch === true));
    }

    case 'get_quantities': {
      const p = need(ctx);
      const rows = typeTotals(p)
        .filter((r) => a.include_empty || r.vars.N > 0 || r.unscaled > 0)
        .map((r) => ({
          type_id: r.type.id,
          type: r.type.name,
          kind: r.type.kind,
          division: r.type.division ?? null,
          total: round(r.primary, 3),
          unit: r.unit,
          length: round(r.vars.L, 3),
          area: round(r.vars.A, 3),
          perimeter: round(r.vars.P, 3),
          count: r.vars.N,
          ...(r.unscaled ? { unscaled_takeoffs: r.unscaled } : {}),
          items: r.items.map((i) => ({ name: i.name, unit: i.unit, value: i.value === null ? null : round(i.value, 3), ...(i.error ? { error: i.error } : {}) })),
        }));
      return text(json({ units: p.units, quantities: rows }), { units: p.units, quantities: rows });
    }

    case 'export_excel': {
      need(ctx);
      const where = await ctx.exportExcel();
      return text(`Saved ${where}`, { path: where });
    }

    case 'look_up_tag': {
      const p = need(ctx);
      if (!ctx.smartIndex) throw new ToolError('This version of the app cannot read tags.');
      const index = await ctx.smartIndex();
      if (!index) throw new ToolError('The set could not be read.');
      const dict = entries(index);
      const q = String(a.code ?? '').trim();
      const exact = dict.get(norm(q));
      const matches = exact ? [exact] : searchEntries(new Map([...dict.values()].map((e) => [e.key, e] as const)), q, 12);
      if (!matches.length) return fail(`Nothing on the drawings called "${q}".`);
      if (matches.length > 1 && !exact) return text(json({ matches: matches.map((e) => ({ code: e.code, kind: e.kind, name: entryName(e) })) }));
      const e = matches[0];
      const info = describe(e, index, p.sheets, dict);
      if (a.show !== false) ctx.showTag?.(e.key);
      const out = { code: info.code, kind: info.kind, title: info.title, source: info.source, sections: info.sections.map((s) => ({ title: s.title ?? null, rows: s.rows.map((r) => ({ [r.label]: r.value })) })) };
      return text(json(out), out);
    }

    case 'drawing_links': {
      const p = need(ctx);
      if (!ctx.drawingGraph) throw new ToolError('This version of the app cannot link the drawings.');
      const g = await ctx.drawingGraph();
      if (!g) throw new ToolError('The set could not be read.');
      const nm = (id: string) => p.sheets.find((x) => x.id === id)?.name ?? id;
      const tags = a.include_tags === true;
      if (a.sheet_id) {
        const s = sheetOf(p, a.sheet_id);
        const links = (g.links[s.id] ?? [])
          .filter((l) => tags || (l.kind !== 'tag' && l.kind !== 'definition'))
          .map((l) => ({ kind: l.kind, says: l.label, at: l.box.map((v) => Math.round(v)), goes_to: l.to.slice(0, 20).map((t) => ({ sheet: nm(t.sheetId), sheet_id: t.sheetId, what: t.label ?? null })), ...(l.to.length > 20 ? { more: l.to.length - 20 } : {}) }));
        const out = { sheet: s.name, drawings: (g.views[s.id] ?? []).map((v) => ({ number: v.number, title: v.title })), links };
        return text(json(out), out);
      }
      const edges = sheetEdges(g)
        .filter((e) => tags || [...e.kinds].some((k) => k !== 'tag'))
        .map((e) => ({ from: nm(e.from), to: nm(e.to), references: e.n, kinds: [...e.kinds] }))
        .sort((x, y) => y.references - x.references);
      const out = { sheets: g.sheets.length, drawings: Object.fromEntries(Object.entries(g.views).filter(([, v]) => v.length).map(([id, v]) => [nm(id), v.map((x) => `${x.number} ${x.title}`)])), references: edges };
      return text(json(out), out);
    }

    case 'drawing_index': {
      const p = need(ctx);
      if (!ctx.smartIndex) throw new ToolError('This version of the app cannot read tags.');
      const index = await ctx.smartIndex();
      if (!index) throw new ToolError('The set could not be read.');
      const name = (id: string) => p.sheets.find((s) => s.id === id)?.name ?? id;
      const stats = [...indexStats(index)].map(([kind, s]) => ({ kind, listed: s.listed, on_plans: s.onPlans, not_found_on_plans: s.missing }));
      const out = {
        sheets_read: index.sheets,
        schedules: index.schedules.map((s) => ({ sheet: name(s.sheetId), title: s.title, kind: s.kind, rows: s.rows.length, columns: s.columns.map((c) => c.join(' · ')) })),
        legends: index.legends.map((l) => ({ sheet: name(l.sheetId), code: l.code, kind: l.kind, heading: l.lines[0] })),
        abbreviations: Object.keys(index.abbreviations).length,
        tags: stats,
      };
      return text(json(out), out);
    }

    case 'spec_map': {
      const p = need(ctx);
      if (!ctx.projectMap) throw new ToolError('This version of the app cannot read specifications.');
      if (!(p.specs ?? []).some((d) => d.book)) throw new ToolError('No specification in this project yet. Add the spec PDF on the Specs tab.');
      const m = await ctx.projectMap();
      if (!m) throw new ToolError('The specification could not be tied to the drawings.');
      const byId = new Map(m.nodes.map((n) => [n.id, n]));
      const sections = m.books.flatMap((b) => b.sections);
      const nm = (id: string) => p.sheets.find((x) => x.id === id)?.name ?? id;
      const tied = (id: string) => m.edges.filter((e) => (e.a === id || e.b === id) && (e.kind === 'written' || e.kind === 'matched'));
      if (a.section) {
        const key = String(a.section).replace(/\s+/g, '');
        const s = sections.find((x) => x.key === key) ?? sections.find((x) => x.key.startsWith(key));
        if (!s) throw new ToolError(`No section ${a.section} in the specification.`);
        const id = `spec:${s.key}`;
        const out = {
          section: s.number,
          title: s.title,
          missing: !!s.missing,
          pages: s.pages.length ? [s.pages[0], s.pages[s.pages.length - 1]] : [],
          articles: s.articles.map((x) => `${x.number} ${x.title}`),
          refers_to: s.sections.map((k) => {
            const o = sections.find((x) => x.key === k);
            return o ? `${o.number} ${o.title}${o.missing ? ' (to follow)' : ''}` : `${k} (not in this spec)`;
          }),
          on_drawings: tied(id).map((e) => {
            const o = byId.get(e.a === id ? e.b : e.a)!;
            return { kind: e.kind, item: o.label, what: o.sub, why: e.why, sheets: [...new Set((e.at ? [e.at] : (o.places ?? [])).map((pl) => nm(pl.sheetId)))].slice(0, 12) };
          }),
        };
        return text(json(out), out);
      }
      const linked = new Set(m.edges.filter((e) => e.kind === 'written' || e.kind === 'matched').flatMap((e) => [e.a, e.b]));
      const out = {
        sections: sections.map((s) => ({ number: s.number, title: s.title, ...(s.missing ? { to_follow: true } : { pages: s.pages.length }), drawing_links: tied(`spec:${s.key}`).length })),
        gaps: {
          to_follow: sections.filter((s) => s.missing).map((s) => `${s.number} ${s.title}${linked.has(`spec:${s.key}`) ? ' (the drawings show its work)' : ''}`),
          on_drawings_without_a_section: m.nodes.filter((n) => n.side === 'drawing' && n.kind !== 'sheet' && !linked.has(n.id)).map((n) => `${n.label} ${n.sub}`.trim()),
        },
      };
      return text(json(out), out);
    }

    case 'undo':
      need(ctx);
      return ctx.undo() ? text('Undone.') : fail('Nothing to undo.');

    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

async function automation(ctx: McpContext, a: Record<string, unknown>): Promise<ToolResult> {
  const p = need(ctx);
  const kind = a.kind as AutomationKind;
  if (!AUTOMATIONS.includes(kind)) throw new ToolError(`kind must be one of ${AUTOMATIONS.join(', ')}.`);
  const access = ctx.access();
  const perSheet = kind === 'rooms' || kind === 'walls' || (kind === 'doors' && !a.all_sheets);
  const sheet = typeof a.sheet_id === 'string' ? sheetOf(p, a.sheet_id) : null;
  if (perSheet && !sheet) throw new ToolError(`${kind} runs on one sheet: give sheet_id (a floor plan).`);
  const page = sheet ? await ctx.page(sheet) : null;
  if (sheet && !page) throw new ToolError(`${sheet.name}'s drawing file is not open (its PDF is missing on this computer).`);
  if (sheet) ctx.showSheet(sheet.id);
  let r: Automation;
  switch (kind) {
    case 'rooms':
      r = await automateRooms(p, page!, sheet!, ctx.maxOpening());
      break;
    case 'walls': {
      const doc = ctx.doc(sheet!.docId);
      r = await automateWalls(p, page!, doc, sheet!, ctx.maxOpening(), ctx.docs().filter((d) => d !== doc));
      break;
    }
    case 'doors': {
      const current = sheet ?? p.sheets.find((s) => !s.superseded) ?? null;
      if (!current) throw new ToolError('The project has no sheets yet.');
      const everywhere = !!a.all_sheets;
      r = doorTakeoff(p, await findDoorTagsIn(p, access, current, everywhere), current, everywhere);
      break;
    }
    case 'windows':
      r = await automateWindows(p, access);
      break;
    case 'ceilings':
      r = await automateCeilings(p, access, sheet);
      break;
    case 'sprinklers':
      r = await automateSprinklers(p, access, sheet);
      break;
    case 'finishes': {
      const rooms = finishRooms(p);
      if (!rooms.length) throw new ToolError('No room takeoffs to give finishes to. Run rooms first, or add rooms labelled with their numbers.');
      const f = await readFinishes(p, rooms, access, p.types);
      r = { message: `${f.note}${f.unmatched ? ` Schedule lines with no room: ${f.unmatched.rows.length}; rooms with no line: ${f.unmatched.rooms.length}.` : ''}`, apply: applyFinishes(f) };
      break;
    }
    case 'ductwork_piping':
      r = await automateRuns(p, access);
      break;
    case 'trade_counts':
      r = await automateTrades(p, access);
      break;
    case 'keynotes_demolition':
      r = await automateKeynotes(p, access, ctx.maxOpening());
      break;
    case 'symbols': {
      const t = await symbolTallies(p, access);
      if (!t.tallies.length) return fail(t.message ?? 'No legend symbols found.');
      const choices = defaultSymbolChoices(t.tallies);
      if (!choices.length) return fail('The legends were found, but none of their symbols appear on the plans.');
      r = symbolTakeoff(p, choices);
      break;
    }
  }
  if (!r.apply) return fail(r.message);
  // Ceilings measured on the RCPs replace the finish schedule's ceilings, so none counts twice.
  const made = r.apply;
  let moved = 0;
  const apply = kind === 'ceilings' || kind === 'finishes' ? (q: Project) => { const c = ceilingsFromRcps(made(q)); moved = c.moved; return c.project; } : made;
  const before = ctx.project()!.measurements.length;
  ctx.commit(apply, `${kind[0].toUpperCase()}${kind.slice(1)} (AI)`);
  const after = ctx.project()!.measurements.length;
  return text(`${r.message}.${moved ? ` ${moved} rooms take their ceiling from the ceiling plans instead of the finish schedule.` : ''} Takeoffs in the project: ${before} → ${after}. Check with get_sheet_image${sheet ? ` on ${sheet.name}` : ''}; the estimator can undo it.`);
}

/** The tool list as MCP's tools/list gives it. */
export const toolList = () => TOOL_DEFS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) }));
