/**
 * The held-out benchmark: the whole-set takeoff on drawing sets we never tune on, scored against
 * the estimator's own takeoff. Report-only: it never fails on the numbers, so nobody fits the
 * engine to it. Each job folder holds the drawing PDFs, whole.json (from bench/whole.test.ts) and
 * truth/key.json: { items: [{ code, kind: 'count' | 'length' | 'area', qty }] } in metres.
 *   HOLDOUT=/path/to/holdout npx vitest run -c bench/vitest.config.ts bench/holdout.test.ts
 * Writes HOLDOUT/SCORECARD.md and prints it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { measurementVars } from '../src/quantities';
import type { Project } from '../src/model';

type Key = { items: { code: string; kind: 'count' | 'length' | 'area'; qty: number; note?: string; match?: string }[] };

/** A type's code as estimators write it, for matching: "FW-2 – Foundation wall" → FW2, "S/F-5" → SF5. */
export const codeOf = (name: string) =>
  name
    .split(/\s+[–-]\s+/)[0]
    .trim()
    .toUpperCase()
    .replace(/[\s/.-]/g, '');

/** Engine totals per code: count of points, metres of length, m² of area (metric units). */
export function engineTotals(p: Project): Map<string, { count: number; length: number; area: number; types: Set<string> }> {
  const out = new Map<string, { count: number; length: number; area: number; types: Set<string> }>();
  const sheets = new Map(p.sheets.map((s) => [s.id, s]));
  const types = new Map(p.types.map((t) => [t.id, t]));
  const toM = p.units === 'imperial' ? 0.3048 : 1;
  for (const m of p.measurements) {
    const t = types.get(m.typeId);
    const s = sheets.get(m.sheetId);
    if (!t || !s) continue;
    const name = /slab on grade/i.test(t.name) ? 'SLAB' : codeOf(t.name);
    const e = out.get(name) ?? { count: 0, length: 0, area: 0, types: new Set<string>() };
    e.types.add(t.name);
    if (t.kind === 'count') e.count += 1;
    else {
      const v = measurementVars(m, t, s, p.units);
      if (v) {
        if (t.kind === 'linear') e.length += v.L * toM;
        else e.area += v.A * toM * toM;
      }
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
  for (const job of readdirSync(root!).sort()) {
    const dir = join(root!, job);
    const keyPath = join(dir, 'truth', 'key.json');
    const wholePath = join(dir, 'whole.json');
    if (!existsSync(keyPath)) continue;
    lines.push(`## ${job}`, '');
    if (!existsSync(wholePath)) {
      lines.push('No whole.json: run bench/whole.test.ts first.', '');
      continue;
    }
    const key = JSON.parse(readFileSync(keyPath, 'utf8')) as Key;
    const p = (JSON.parse(readFileSync(wholePath, 'utf8')) as { project: Project }).project;
    const got = engineTotals(p);
    lines.push('| code | kind | estimator | engine | ratio |', '|---|---|---:|---:|---:|');
    for (const k of key.items) {
      // By code, or (types named by description, e.g. ceilings) by a pattern on the type name.
      const e = k.match
        ? [...got.values()].filter((x) => [...x.types].some((n) => new RegExp(k.match!, 'i').test(n))).reduce((a, b) => ({ count: a.count + b.count, length: a.length + b.length, area: a.area + b.area, types: a.types }), { count: 0, length: 0, area: 0, types: new Set<string>() })
        : got.get(k.code.toUpperCase().replace(/[\s/.-]/g, ''));
      const v = !e ? 0 : k.kind === 'count' ? e.count : k.kind === 'length' ? e.length : e.area;
      const ratio = k.qty ? v / k.qty : 0;
      total++;
      if (ratio >= 0.9 && ratio <= 1.1) hit++;
      lines.push(`| ${k.code} | ${k.kind} | ${k.qty} | ${Math.round(v * 100) / 100} | ${v ? ratio.toFixed(2) : 'missed'} |`);
    }
    lines.push('');
  }
  lines.push(`**Within ±10%: ${hit} of ${total}.**`);
  const text = lines.join('\n');
  writeFileSync(join(root!, 'SCORECARD.md'), text);
  process.stdout.write(`${text}\n`);
});
