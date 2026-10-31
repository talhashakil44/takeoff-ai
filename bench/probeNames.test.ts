/** Probe: sheet names and titles a drawing file reads as (DOC=pdf). */
import { it } from 'vitest';
import { sheetsOf } from '../src/automate/sheets';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC)('sheet names', async () => {
  const d = await openDoc(process.env.DOC!);
  const { sheets } = await sheetsOf(d.pdf, d.id, 'metric');
  process.stdout.write(`${sheets.map((s) => s.name).join(' ')}\n`);
});
