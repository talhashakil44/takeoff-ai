/** Probe: the room-fill wall model of one page (DOC PAGE MPP=metres per point): pens chosen, and the pens' pairing stats. */
import { it } from 'vitest';
import { buildWallModel } from '../src/fill/roomFill';
import { segmentsOf } from '../src/fill/sheetWalls';
import { penStats } from '../src/fill/walls';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC || !process.env.PAGE)('wall model', async () => {
  const d = await openDoc(process.env.DOC!);
  const segs = await segmentsOf(await d.pdf.getPage(Number(process.env.PAGE)));
  const mpp = Number(process.env.MPP);
  const m = buildWallModel(segs, mpp);
  const stats = penStats(segs, 0.06 / mpp, 0.7 / mpp).sort((a, b) => b.length - a.length).slice(0, 8);
  process.stdout.write(`segs ${segs.length} filled ${segs.filter((s) => s.filled).length} pens ${JSON.stringify(m.pens)} lines ${m.lines.length}\nstats ${JSON.stringify(stats)}\n`);
});
