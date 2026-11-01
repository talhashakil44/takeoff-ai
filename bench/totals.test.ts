/**
 * One whole-set run's totals per type, as the held-out scorer counts them (debugging a category):
 *   W=/path/whole.json RE='ceil|09' npx vitest run -c bench/vitest.config.ts bench/totals.test.ts --silent=false --disableConsoleIntercept
 */
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { engineTotals } from './holdout.test';

it.skipIf(!process.env.W)('totals per type', () => {
  const p = JSON.parse(readFileSync(process.env.W!, 'utf8')).project;
  const re = new RegExp(process.env.RE ?? '.', 'i');
  for (const e of engineTotals(p, true).values()) {
    const n = [...e.types][0]!;
    if (re.test(n) || re.test(e.division)) process.stdout.write(`${n.slice(0, 70)} | ${e.division} | ${[...e.roles].join(',')} | n${e.count} L${e.length.toFixed(1)} A${e.area.toFixed(1)}\n`);
  }
});
