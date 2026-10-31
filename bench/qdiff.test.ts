/**
 * Quantity diff of two project.json files through the app's own quantities: per sheet|type, the
 * count and total L and A that changed. For checking an engine change moved only what it should.
 *   A=old/project.json B=new/project.json npx vitest run -c bench/vitest.config.ts bench/qdiff.test.ts
 */
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { measurementVars } from '../src/quantities';
import type { Project } from '../src/model';

it.skipIf(!process.env.A || !process.env.B)('quantity diff', () => {
  const load = (f: string): Project => {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return j.project ?? j;
  };
  const totals = (p: Project) => {
    const out: Record<string, number[]> = {};
    const sheets = new Map(p.sheets.map((s) => [s.id, s]));
    const types = new Map(p.types.map((t) => [t.id, t]));
    for (const m of p.measurements) {
      const t = types.get(m.typeId);
      const s = sheets.get(m.sheetId);
      if (!t || !s) continue;
      const k = `${s.name}|${t.name.slice(0, 50)}`;
      const v = measurementVars(m, t, s, p.units);
      const e = (out[k] ??= [0, 0, 0]);
      e[0]++;
      e[1] += v?.L ?? 0;
      e[2] += v?.A ?? 0;
    }
    return out;
  };
  const a = totals(load(process.env.A!));
  const b = totals(load(process.env.B!));
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? [0, 0, 0];
    const y = b[k] ?? [0, 0, 0];
    if (x[0] !== y[0] || Math.abs(x[1] - y[1]) > 0.05 || Math.abs(x[2] - y[2]) > 0.05)
      process.stdout.write(`DIFF ${k} ${x.map((v) => +v.toFixed(2)).join('/')} -> ${y.map((v) => +v.toFixed(2)).join('/')}\n`);
  }
});
