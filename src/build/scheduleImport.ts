/**
 * Reading a schedule someone already has: MS Project XML, Primavera P6 (.xer), and CSV or Excel
 * exports from either (or from a spreadsheet). Everything comes out as one plain list of tasks,
 * with dates as ISO days and durations and lags in working days; nothing is guessed here about
 * the model (see userSchedule.ts for that).
 */

export interface ImportedLink {
  /** The predecessor's key in the file (the ID its links use). */
  key: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  /** Working days. */
  lag: number;
}

export interface ImportedTask {
  /** What other tasks' links call it (MS Project UID, P6 task id, the CSV's ID column). */
  key: string;
  /** The ID shown to the user. */
  code: string;
  name: string;
  /** The summary task, WBS or phase it sits under. */
  group?: string;
  start?: string;
  finish?: string;
  /** Working days, when the file gives one. */
  duration?: number;
  milestone?: boolean;
  preds: ImportedLink[];
  /** Words from a trade, discipline or resource column. */
  trade?: string;
  /** Words from a level, floor or area column. */
  level?: string;
  /** Model element ids, from a schedule this app exported. */
  elements?: string[];
}

export interface ImportResult {
  format: 'csv' | 'xlsx' | 'msp-xml' | 'xer';
  tasks: ImportedTask[];
  /** What was read but left out, in plain words. */
  warnings: string[];
}

// ---------- Dates, durations and links ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/**
 * A date as a schedule writes it: 2026-11-04, 11/4/26 (or 4/11/26 with dayFirst), Mon 11/4/26,
 * 04-Nov-26 08:00, November 4, 2026 8:00 AM, or an Excel day number. Undefined when it isn't one.
 */
export function parseDate(v: unknown, dayFirst = false): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') return excelDay(v);
  let s = String(v ?? '').trim();
  if (!s || /^(na|n\/a|-|—)$/i.test(s)) return undefined;
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelDay(Number(s));
  // A weekday in front, P6's actual/constraint marks behind.
  s = s.replace(/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, '').replace(/\s*[A*]$/, '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(s);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return dayFirst || a > 12 ? iso(+m[3], b, a) : iso(+m[3], a, b);
  }
  m = /^(\d{1,2})[-\s]([a-z]{3,})\.?[-\s,]+(\d{2,4})\b/i.exec(s);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  m = /^([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+'?(\d{2,4})\b/i.exec(s);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  return undefined;
}

/** Excel's day number (1900 date system) as an ISO day. */
function excelDay(n: number): string | undefined {
  if (!(n > 20000 && n < 80000)) return undefined;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Working days per unit a duration or lag can be written in (an 8-hour day, a 5-day week, a 20-day month). */
function unitDays(unit: string): number | null {
  const u = unit.toLowerCase().replace(/[?.\s]/g, '');
  if (!u || /^(d|dy|dys|day|days|wd|workingdays?)$/.test(u)) return 1;
  if (/^(ed|edays?|elapseddays?|cd|calendardays?)$/.test(u)) return 5 / 7;
  if (/^(w|wk|wks|week|weeks)$/.test(u)) return 5;
  if (/^(ew|ewks?|eweeks?)$/.test(u)) return 5;
  if (/^(h|hr|hrs|hour|hours)$/.test(u)) return 1 / 8;
  if (/^(m|min|mins|minutes?)$/.test(u)) return 1 / 480;
  if (/^(mo|mon|mons|month|months)$/.test(u)) return 20;
  return null;
}

/** A duration as working days: 5, "5d", "5 days?", "2 wks", "16 hrs", "10 edays". Undefined when blank or not one. */
export function parseDuration(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
  const s = String(v ?? '').trim();
  const m = /^(\d+(?:[.,]\d+)?)\s*([a-z?. ]*)$/i.exec(s);
  if (!m) return undefined;
  const per = unitDays(m[2]);
  return per === null ? undefined : Number(m[1].replace(',', '.')) * per;
}

/**
 * A predecessor list: "3FS+2 days, 5SS, 7", "A1010; A1020: SS -1d", or ids separated by spaces
 * (this app's own CSV). `known` holds the file's IDs, so an ID with a space or colon in it is kept whole.
 */
export function parsePredecessors(text: string, known: Set<string>): ImportedLink[] {
  const out: ImportedLink[] = [];
  const s = text.trim();
  if (!s) return out;
  const one = (tok: string) => {
    tok = tok.trim();
    if (!tok) return;
    if (known.has(tok)) return void out.push({ key: tok, type: 'FS', lag: 0 });
    const m = /^(.+?)\s*:?\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*([a-z?.]*))?$/i.exec(tok);
    if (!m) return;
    const key = m[1].trim();
    const per = m[5] ? unitDays(m[5]) : 1;
    const lag = m[4] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) * (per ?? 0) : 0;
    out.push({ key, type: (m[2]?.toUpperCase() as ImportedLink['type']) ?? 'FS', lag });
  };
  for (const part of s.split(/\s*[,;]\s*/)) {
    const words = part.split(/\s+/);
    if (!known.has(part) && words.length > 1 && words.every((w) => known.has(w))) words.forEach(one);
    else one(part);
  }
  return out;
}

// ---------- CSV and Excel ----------

/** Rows of a CSV (or tab- or semicolon-separated) file, with quoted fields. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const nl = text.search(/\r?\n/);
  const head = nl < 0 ? text : text.slice(0, nl);
  const count = (c: string) => head.split(c).length;
  const sep = [',', '\t', ';'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell.trim()) quoted = true;
    else if (c === sep) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** The first sheet of an Excel workbook that has a table, as rows of text (dates as ISO days). */
export async function readXlsx(data: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const cells: string[] = [];
      r.eachCell({ includeEmpty: true }, (c, col) => {
        cells[col - 1] = cellText(c.value);
      });
      rows.push(Array.from(cells, (x) => x ?? ''));
    });
    if (rows.length > 1) return rows;
  }
  return [];
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return parseDate(v) ?? '';
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('');
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return String(o.text);
    return '';
  }
  return String(v);
}

/** Header names schedules use for each column, compared without case, spaces or punctuation. */
const HEADERS: Record<string, string[]> = {
  id: ['id', 'taskid', 'activityid', 'actid', 'code', 'activitycode', 'taskcode', 'no', 'number', 'taskno', 'uniqueid', 'uid', 'ref'],
  name: ['name', 'taskname', 'activityname', 'task', 'activity', 'description', 'activitydescription', 'taskdescription', 'title', 'item', 'workitem'],
  start: ['start', 'startdate', 'plannedstart', 'earlystart', 'targetstart', 'begin', 'begindate', 'scheduledstart', 'baselinestart', 'from'],
  finish: ['finish', 'finishdate', 'end', 'enddate', 'plannedfinish', 'earlyfinish', 'targetfinish', 'scheduledfinish', 'baselinefinish', 'completion', 'due', 'duedate', 'to'],
  duration: ['duration', 'durationworkingdays', 'durationdays', 'originalduration', 'plannedduration', 'od', 'days', 'workingdays', 'dur', 'remainingduration'],
  preds: ['predecessors', 'predecessor', 'preds', 'pred', 'dependencies', 'dependson', 'predecessorids', 'predecessorid', 'links', 'after'],
  trade: ['trade', 'discipline', 'resourcenames', 'resources', 'resource', 'responsibility', 'subcontractor', 'sub', 'contractor', 'csidivision', 'division', 'crew'],
  level: ['level', 'floor', 'storey', 'story', 'location', 'area', 'zone'],
  group: ['wbsname', 'wbs', 'phase', 'group', 'category', 'section', 'summarytask', 'parent'],
  milestone: ['milestone', 'ismilestone'],
  summary: ['summary', 'issummary'],
  outline: ['outlinelevel', 'indent', 'level#'],
  type: ['type', 'activitytype', 'tasktype', 'kind'],
  elements: ['elements', 'modelelements', 'elementids'],
};
const norm = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, (x) => x.replace(/[()]/g, '')).replace(/[^a-z0-9#]/g, '');

/** Which column holds what, from the header row. */
function columns(header: string[]): Partial<Record<keyof typeof HEADERS, number>> {
  const keys = header.map(norm);
  const out: Partial<Record<keyof typeof HEADERS, number>> = {};
  const taken = new Set<number>();
  // Exact names first, in each field's order of preference; then a header that contains one.
  for (const exact of [true, false])
    for (const [field, names] of Object.entries(HEADERS) as [keyof typeof HEADERS, string[]][]) {
      if (out[field] !== undefined) continue;
      for (const n of names) {
        if (!n) continue;
        const i = keys.findIndex((k, j) => !taken.has(j) && (exact ? k === n : n.length > 3 && k.includes(n)));
        if (i >= 0) {
          out[field] = i;
          taken.add(i);
          break;
        }
      }
    }
  return out;
}

const yes = (v: string | undefined) => /^(yes|y|true|1|x)$/i.test((v ?? '').trim());

/** A table of tasks (CSV or a sheet's rows) with a header row somewhere in its first rows. */
export function tasksFromTable(rows: string[][], format: 'csv' | 'xlsx'): ImportResult {
  const warnings: string[] = [];
  // The header: the first row that names a task column and a date or duration column.
  let h = rows.findIndex((r, i) => i < 15 && (() => {
    const c = columns(r);
    return c.name !== undefined && (c.start !== undefined || c.duration !== undefined || c.finish !== undefined);
  })());
  if (h < 0) {
    h = 0;
    warnings.push('No header row with a task name and a start, finish or duration column was found; read the first row as the header.');
  }
  const col = columns(rows[h] ?? []);
  if (col.name === undefined) return { format, tasks: [], warnings: [...warnings, 'No task name column (Name, Task, Activity or Description).'] };
  const get = (r: string[], f: keyof typeof HEADERS) => (col[f] === undefined ? undefined : (r[col[f]!] ?? '').trim());
  const body = rows.slice(h + 1).filter((r) => get(r, 'name'));
  // Dates written day-first (31/12/2026) anywhere in the file make the whole file day-first.
  const dayFirst = body.some((r) => [get(r, 'start'), get(r, 'finish')].some((d) => {
    const m = /^(?:[a-z]+\.?,?\s+)?(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/i.exec(d ?? '');
    return !!m && +m[1] > 12;
  }));
  const keys = body.map((r, i) => get(r, 'id') || String(i + 1));
  const known = new Set(keys);
  const outline = body.map((r) => Number(get(r, 'outline')) || 0);
  const tasks: ImportedTask[] = [];
  const parents: string[] = [];
  let summaries = 0;
  body.forEach((r, i) => {
    const name = get(r, 'name')!;
    const lvl = outline[i];
    const isSummary = yes(get(r, 'summary')) || (lvl > 0 && (outline[i + 1] ?? 0) > lvl);
    if (lvl > 0) parents.length = Math.max(0, lvl - 1);
    if (isSummary) {
      summaries++;
      if (lvl > 0) parents[lvl - 1] = name;
      else parents.splice(0, parents.length, name);
      return;
    }
    const typeText = get(r, 'type') ?? '';
    const elements = (get(r, 'elements') ?? '').split(/\s+/).filter(Boolean);
    tasks.push({
      key: keys[i],
      code: keys[i],
      name,
      group: get(r, 'group') || parents.filter(Boolean).at(-1),
      start: parseDate(get(r, 'start'), dayFirst),
      finish: parseDate(get(r, 'finish'), dayFirst),
      duration: parseDuration(get(r, 'duration')),
      milestone: yes(get(r, 'milestone')) || /milestone/i.test(typeText) || undefined,
      preds: parsePredecessors(get(r, 'preds') ?? '', known),
      trade: get(r, 'trade') || undefined,
      level: get(r, 'level') || undefined,
      ...(elements.length ? { elements } : {}),
    });
  });
  if (summaries) warnings.push(`${summaries} summary row${summaries === 1 ? '' : 's'} used as group${summaries === 1 ? '' : 's'}, not as activities.`);
  return { format, tasks, warnings };
}

// ---------- MS Project XML ----------

interface XNode {
  tag: string;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? all,
  );

/** A small XML reader: elements and their text (attributes aren't needed for these files). */
export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      const tag = m[2].replace(/^.*:/, '');
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
    } else if (m[3]) {
      const node: XNode = { tag: m[3].replace(/^.*:/, ''), children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decode(m[6]);
  }
  return root;
}

const kid = (n: XNode | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const kids = (n: XNode | undefined, tag: string) => n?.children.filter((c) => c.tag === tag) ?? [];
const val = (n: XNode | undefined, tag: string) => kid(n, tag)?.text.trim() ?? '';
const find = (n: XNode, tag: string): XNode | undefined => (n.tag === tag ? n : n.children.map((c) => find(c, tag)).find(Boolean));

/** An ISO 8601 duration as MS Project writes it ("PT40H0M0S"), in hours. */
function isoHours(s: string): number | undefined {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m || s.trim() === 'P') return undefined;
  return (Number(m[1] ?? 0) * 24) + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
}

/** MS Project's XML (File > Save As > XML): tasks, summary tasks as groups, and their links. */
export function parseMsProjectXml(text: string): ImportResult {
  const warnings: string[] = [];
  const project = find(parseXml(text), 'Project');
  if (!project) return { format: 'msp-xml', tasks: [], warnings: ['This XML file is not an MS Project schedule (no <Project> element).'] };
  const hoursPerDay = (Number(val(project, 'MinutesPerDay')) || 480) / 60;
  const all = kids(kid(project, 'Tasks'), 'Task').filter((t) => val(t, 'UID') !== '' && val(t, 'IsNull') !== '1');
  const TYPES: ImportedLink['type'][] = ['FF', 'FS', 'SF', 'SS'];
  const parents: string[] = [];
  const tasks: ImportedTask[] = [];
  let summaries = 0;
  for (const t of all) {
    const uid = val(t, 'UID');
    const lvl = Number(val(t, 'OutlineLevel')) || 1;
    const name = val(t, 'Name');
    if (uid === '0' || lvl === 0) continue; // the project's own summary row
    parents.length = lvl - 1;
    if (val(t, 'Summary') === '1') {
      summaries++;
      parents[lvl - 1] = name;
      continue;
    }
    if (!name || val(t, 'Active') === '0') continue;
    const hours = isoHours(val(t, 'Duration'));
    tasks.push({
      key: uid,
      code: val(t, 'ID') || uid,
      name,
      group: parents.filter(Boolean).at(-1),
      start: parseDate(val(t, 'Start')),
      finish: parseDate(val(t, 'Finish')),
      duration: hours === undefined ? undefined : hours / hoursPerDay,
      milestone: val(t, 'Milestone') === '1' || undefined,
      preds: kids(t, 'PredecessorLink').map((l) => ({
        key: val(l, 'PredecessorUID'),
        type: TYPES[Number(val(l, 'Type') || 1)] ?? 'FS',
        // LinkLag is in tenths of a minute; a percentage lag (formats 19, 20) isn't a time.
        lag: ['19', '20'].includes(val(l, 'LagFormat')) ? 0 : (Number(val(l, 'LinkLag')) || 0) / 10 / 60 / hoursPerDay,
      })),
    });
  }
  // Links to summary tasks have no activity to wait for.
  const keys = new Set(tasks.map((t) => t.key));
  let dropped = 0;
  for (const t of tasks) {
    const n = t.preds.length;
    t.preds = t.preds.filter((p) => keys.has(p.key));
    dropped += n - t.preds.length;
  }
  if (summaries) warnings.push(`${summaries} summary task${summaries === 1 ? '' : 's'} used as group${summaries === 1 ? '' : 's'}, not as activities.`);
  if (dropped) warnings.push(`${dropped} link${dropped === 1 ? '' : 's'} to summary tasks left out.`);
  return { format: 'msp-xml', tasks, warnings };
}

// ---------- Primavera P6 XER ----------

/** The tables of a P6 export: %T names a table, %F its fields, %R each row. */
export function xerTables(text: string): Record<string, Record<string, string>[]> {
  const out: Record<string, Record<string, string>[]> = {};
  let table = '';
  let fields: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t');
    if (cells[0] === '%T') (table = cells[1]?.trim() ?? ''), (out[table] = []), (fields = []);
    else if (cells[0] === '%F') fields = cells.slice(1).map((f) => f.trim());
    else if (cells[0] === '%R' && table) out[table].push(Object.fromEntries(fields.map((f, i) => [f, cells[i + 1] ?? ''])));
  }
  return out;
}

/** Primavera P6's XER export: activities (not WBS summaries), their WBS as groups, and their relationships. */
export function parseXer(text: string): ImportResult {
  const warnings: string[] = [];
  const t = xerTables(text);
  if (!t.TASK) return { format: 'xer', tasks: [], warnings: ['No TASK table in this file: is it a P6 XER export?'] };
  const projects = new Set((t.PROJECT ?? []).map((p) => p.proj_id));
  if (projects.size > 1) warnings.push(`This file holds ${projects.size} projects; all their activities were read.`);
  const wbs = new Map((t.PROJWBS ?? []).filter((w) => w.proj_node_flag !== 'Y').map((w) => [w.wbs_id, w.wbs_name]));
  const dayHours = new Map((t.CALENDAR ?? []).map((c) => [c.clndr_id, Number(c.day_hr_cnt) || 8]));
  const rows = t.TASK.filter((r) => r.task_type !== 'TT_WBS' && r.task_name);
  const codeOf = new Map(rows.map((r) => [r.task_id, r.task_code || r.task_id]));
  const calendarOf = new Map(rows.map((r) => [r.task_id, r.clndr_id]));
  const TYPES: Record<string, ImportedLink['type']> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
  const preds = new Map<string, ImportedLink[]>();
  let dropped = 0;
  for (const p of t.TASKPRED ?? []) {
    if (!codeOf.has(p.pred_task_id) || !codeOf.has(p.task_id)) {
      dropped++;
      continue;
    }
    const hours = dayHours.get(calendarOf.get(p.task_id) ?? '') ?? 8;
    preds.set(p.task_id, [...(preds.get(p.task_id) ?? []), { key: p.pred_task_id, type: TYPES[p.pred_type] ?? 'FS', lag: (Number(p.lag_hr_cnt) || 0) / hours }]);
  }
  const tasks: ImportedTask[] = rows.map((r) => {
    const hours = dayHours.get(r.clndr_id) ?? 8;
    const dur = Number(r.target_drtn_hr_cnt);
    return {
      key: r.task_id,
      code: codeOf.get(r.task_id)!,
      name: r.task_name,
      group: wbs.get(r.wbs_id),
      start: parseDate(r.act_start_date || r.early_start_date || r.target_start_date || r.restart_date),
      finish: parseDate(r.act_end_date || r.early_end_date || r.target_end_date || r.reend_date),
      duration: Number.isFinite(dur) && r.target_drtn_hr_cnt !== '' ? dur / hours : undefined,
      milestone: r.task_type === 'TT_Mile' || r.task_type === 'TT_FinMile' || undefined,
      preds: preds.get(r.task_id) ?? [],
    };
  });
  if (dropped) warnings.push(`${dropped} relationship${dropped === 1 ? '' : 's'} to activities outside this file left out.`);
  return { format: 'xer', tasks, warnings };
}

// ---------- Any of them ----------

/** A schedule file, by its name and (when the name doesn't say) its first bytes. */
export async function readScheduleFile(name: string, data: ArrayBuffer): Promise<ImportResult> {
  const bytes = new Uint8Array(data);
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (ext === 'xlsx' || ext === 'xlsm' || (zip && !['csv', 'txt', 'xml', 'xer'].includes(ext))) return tasksFromTable(await readXlsx(data), 'xlsx');
  if (ext === 'xls' || ext === 'mpp') throw new Error(ext === 'mpp' ? 'MS Project .mpp files can’t be read directly: in MS Project use File › Save As › XML (or CSV) and import that.' : 'Old Excel .xls files can’t be read: save it as .xlsx or .csv and import that.');
  let text = new TextDecoder('utf-8').decode(bytes);
  // P6 and older exports are often Windows-1252, not UTF-8.
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
  const head = text.slice(0, 400).trimStart();
  if (ext === 'xer' || head.startsWith('ERMHDR')) return parseXer(text);
  if (ext === 'xml' || head.startsWith('<')) return parseMsProjectXml(text);
  return tasksFromTable(parseCsv(text), 'csv');
}
