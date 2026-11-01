/** Probe: a reflected ceiling plan read (DOC PAGE MPP): its legend swatches and the areas by type and kind. */
import { it } from 'vitest';
import { readCeilingSheet, ceilingSwatches } from '../src/fill/ceilings';
import { marksOf } from '../src/fill/marks';
import { segmentsOf } from '../src/fill/sheetWalls';
import { pageTexts } from '../src/pageText';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC || !process.env.PAGE)('ceilings', async () => {
  const d = await openDoc(process.env.DOC!);
  const page = await d.pdf.getPage(Number(process.env.PAGE));
  const vp = page.getViewport({ scale: 1 });
  const [segs, texts] = await Promise.all([segmentsOf(page), pageTexts(page)]);
  const sw = ceilingSwatches(texts, segs, marksOf(segs), vp.width, vp.height);
  process.stdout.write(`swatches ${JSON.stringify(sw.map((s) => ({ label: s.label, code: s.code, kind: (s as { kind?: string }).kind })))}\n`);
  const r = readCeilingSheet(segs, texts, { width: vp.width, height: vp.height, metersPerPoint: Number(process.env.MPP) });
  process.stdout.write(`read ${JSON.stringify(r, (k, v) => (k === 'points' || k === 'holes' ? undefined : v)).slice(0, 3000)}\n`);
});
