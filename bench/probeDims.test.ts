/** Probe: dimension lines found on one sheet, written as JSON (DOC=pdf PAGE=n OUT=file.json). */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { dimensionLines, gridLines } from '../src/fill/dimensions';
import { tagBoxes } from '../src/ocrTags';
import { segmentsOf } from '../src/fill/sheetWalls';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC)('dimension lines', async () => {
  const d = await openDoc(process.env.DOC!);
  const page = await d.pdf.getPage(Number(process.env.PAGE));
  const segs = await segmentsOf(page);
  if (process.env.TAGS) {
    const boxes = tagBoxes(segs);
    writeFileSync(process.env.OUT!, JSON.stringify(boxes.map((b) => [b[0], b[1], b[2], b[1], b[2], b[3], b[0], b[3], b[0], b[1]])));
    process.stdout.write(`segs ${segs.length} boxes ${boxes.length}\n`);
    return;
  }
  const dims = process.env.GRID ? gridLines(segs) : dimensionLines(segs, Number(process.env.TICK ?? 8));
  writeFileSync(process.env.OUT!, JSON.stringify([...dims].map((s) => [s.x1, s.y1, s.x2, s.y2])));
  process.stdout.write(`segs ${segs.length} dims ${dims.size}\n`);
});
