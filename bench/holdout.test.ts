/**
 * The held-out benchmark: the whole-set takeoff on drawing sets we never tune on, scored against
 * the estimator's own takeoff. Report-only: it never fails on the numbers, so nobody fits the
 * engine to it. Each job folder holds the drawing PDFs, whole.json (from bench/whole.test.ts) and
 * truth/key.json: { items: [{ code, kind: 'count' | 'length' | 'area', qty }] } in metres.
 *   HOLDOUT=/path/to/holdout npx vitest run -c bench/vitest.config.ts bench/holdout.test.ts
 * Writes HOLDOUT/SCORECARD.md and prints it. SEALED=1 (the test set nobody looks into) prints and
 * writes only each set's and the overall score, never the items, so no fix is fitted to it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { contributions, sheetRepeat } from '../src/quantities';
import type { Project } from '../src/model';

type Key = { items: { code: string; kind: 'count' | 'length' | 'area'; qty: number; note?: string; match?: string; division?: string; role?: string; cat?: string }[] };

/** A type's code as estimators write it, for matching: "FW-2 – Foundation wall" → FW2, "S/F-5" → SF5. */
export const codeOf = (name: string) =>
  name
    .split(/\s+[–-]\s+/)[0]
    .trim()
    .toUpperCase()
    .replace(/[\s/.-]/g, '');

/** Engine totals per code: count of points, metres of length, m² of area (metric units). */
type Totals = { count: number; length: number; area: number; types: Set<string>; division: string; roles: Set<string> };
/**
 * Engine totals per code (or per type), as the app reports them: drawn measurements and the rooms finished
 * with a type (role floor, ceiling, base, walls), a repeated sheet counted as often as it repeats.
 */
export function engineTotals(p: Project, byType = false): Map<string, Totals> {
  const out = new Map<string, Totals>();
  const toM = p.units === 'imperial' ? 0.3048 : 1;
  for (const c of contributions(p)) {
    const t = c.type;
    const name = byType ? `${t.id}:${c.role ?? ''}` : /slab on grade/i.test(t.name) ? 'SLAB' : codeOf(t.name);
    const e = out.get(name) ?? { count: 0, length: 0, area: 0, types: new Set<string>(), division: t.division ?? '', roles: new Set<string>() };
    e.types.add(t.name);
    e.roles.add(c.role ?? 'drawn');
    if (t.kind === 'count') e.count += sheetRepeat(c.sheet);
    else if (c.vars) {
      if (t.kind === 'linear') e.length += c.vars.L * toM;
      else e.area += c.vars.A * toM * toM;
    }
    out.set(name, e);
  }
  return out;
}

const root = process.env.HOLDOUT;
it.skipIf(!root)('held-out scorecard (report only)', () => {
  const lines: string[] = ['# Held-out scorecard', '', 'Engine vs the estimator\'s own takeoff. Report only: never tune on these sets.', ''];
  let hit = 0;
  let total = 0;
  const sealed = !!process.env.SEALED;
  const cats = new Map<string, { n: number; hit: number; near: number; sets: Set<string> }>();
  for (const job of readdirSync(root!).sort()) {
    const dir = join(root!, job);
    const keyPath = join(dir, 'truth', 'key.json');
    const wholePath = join(dir, 'whole.json');
    if (!existsSync(keyPath)) continue;
    const setStart = lines.length;
    const [hitBefore, totalBefore] = [hit, total];
    lines.push(`## ${job}`, '');
    if (!existsSync(wholePath)) {
      lines.push('No whole.json: run bench/whole.test.ts first.', '');
      continue;
    }
    const key = JSON.parse(readFileSync(keyPath, 'utf8')) as Key;
    const p = (JSON.parse(readFileSync(wholePath, 'utf8')) as { project: Project }).project;
    const got = engineTotals(p);
    const each = [...engineTotals(p, true).values()];
    lines.push('| code | kind | estimator | engine | ratio |', '|---|---|---:|---:|---:|');
    for (const k of key.items) {
      // By code, or (types named by description, e.g. ceilings) by a pattern on the type name.
      // A division filter (a regex on the type's division, '^$' for none) picks the types by trade.
      const e = k.match
        ? each
            .filter((x) => [...x.types].some((n) => new RegExp(k.match!, 'i').test(n)) && (k.division === undefined || new RegExp(k.division).test(x.division)) && (k.role === undefined || x.roles.has(k.role)))
            .reduce((a, b) => ({ ...a, count: a.count + b.count, length: a.length + b.length, area: a.area + b.area }), { count: 0, length: 0, area: 0, types: new Set<string>(), division: '', roles: new Set<string>() })
        : got.get(k.code.toUpperCase().replace(/[\s/.-]/g, ''));
      const v = !e ? 0 : k.kind === 'count' ? e.count : k.kind === 'length' ? e.length : e.area;
      const ratio = k.qty ? v / k.qty : 0;
      total++;
      if (ratio >= 0.9 && ratio <= 1.1) hit++;
      const c = cats.get(k.cat ?? 'other') ?? { n: 0, hit: 0, near: 0, sets: new Set<string>() };
      c.n++;
      c.sets.add(job);
      if (ratio >= 0.9 && ratio <= 1.1) c.hit++;
      if (ratio >= 0.75 && ratio <= 1.33) c.near++;
      cats.set(k.cat ?? 'other', c);
      lines.push(`| ${k.code} | ${k.kind} | ${k.qty} | ${Math.round(v * 100) / 100} | ${v ? ratio.toFixed(2) : 'missed'} |`);
    }
    lines.push('');
    if (sealed) lines.splice(setStart, lines.length - setStart, `## ${job}`, '', `Within ±10%: ${hit - hitBefore} of ${total - totalBefore}.`, '');
  }
  lines.push(`**Within ±10%: ${hit} of ${total}.**`, '');
  if (!sealed) {
    lines.push('## By category, across sets', '', '| category | sets | items | ±10% | ±25% |', '|---|---:|---:|---:|---:|');
    for (const [c, v] of [...cats].sort((a, b) => b[1].n - b[1].hit - (a[1].n - a[1].hit))) lines.push(`| ${c} | ${v.sets.size} | ${v.n} | ${v.hit} | ${v.near} |`);
  }
  const text = lines.join('\n');
  writeFileSync(join(root!, 'SCORECARD.md'), text);
  process.stdout.write(`${text}\n`);
});
