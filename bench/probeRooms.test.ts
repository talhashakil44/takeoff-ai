/** Probe: room labels found on one page (DOC PAGE), and the room-number-like texts that were not. */
import { it } from 'vitest';
import { findRoomLabels } from '../src/fill/rooms';
import { segmentsOf } from '../src/fill/sheetWalls';
import { pageTexts } from '../src/pageText';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC || !process.env.PAGE)('room labels', async () => {
  const d = await openDoc(process.env.DOC!);
  const page = await d.pdf.getPage(Number(process.env.PAGE));
  const [texts, segs] = await Promise.all([pageTexts(page), segmentsOf(page)]);
  const labels = findRoomLabels(texts, segs);
  process.stdout.write(`labels ${labels.length}: ${labels.map((l) => `${l.number} ${l.name}`).join(' | ')}\n`);
  const nums = texts.filter((t) => /^\d{2,3}[A-Z]?$/.test(t.str));
  process.stdout.write(`numbers ${nums.map((t) => `${t.str}@${Math.round(t.cx)},${Math.round(t.cy)} h${t.h.toFixed(1)} w${t.w.toFixed(1)}`).join(' | ')}\n`);
});
