/** Probe: segments in a box on one sheet (DOC PAGE BOX=x0,y0,x1,y1). */
import { it } from 'vitest';
import { segmentsOf } from '../src/fill/sheetWalls';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.BOX)('segments in a box', async () => {
  const d = await openDoc(process.env.DOC!);
  const segs = await segmentsOf(await d.pdf.getPage(Number(process.env.PAGE)));
  const [x0, y0, x1, y1] = process.env.BOX!.split(',').map(Number);
  for (const s of segs) {
    const inside = (x: number, y: number) => x >= x0! && x <= x1! && y >= y0! && y <= y1!;
    if (inside(s.x1, s.y1) || inside(s.x2, s.y2))
      process.stdout.write(`${[s.x1, s.y1, s.x2, s.y2].map((v) => v.toFixed(1)).join(',')} w${s.width} f${+s.filled} c${+!!s.curve} sub${s.sub} len${Math.hypot(s.x2 - s.x1, s.y2 - s.y1).toFixed(1)}\n`);
  }
});
