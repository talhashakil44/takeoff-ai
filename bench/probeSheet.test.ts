/** Probe: how one page reads as a sheet (DOC PAGE): its number, title, scale hints, scale. */
import { it } from 'vitest';
import { inspectPage } from '../src/pdf';
import { sheetsOf } from '../src/automate/sheets';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC || !process.env.PAGE)('sheet read', async () => {
  const d = await openDoc(process.env.DOC!);
  const n = Number(process.env.PAGE);
  const info = await inspectPage(await d.pdf.getPage(n));
  process.stdout.write(`${JSON.stringify({ ...info, textRuns: info.textRuns })}\n`);
  const { sheets } = await sheetsOf(d.pdf, d.id, 'metric');
  const s = sheets.find((x) => x.page === n)!;
  process.stdout.write(`${JSON.stringify(s)}\n`);
});
