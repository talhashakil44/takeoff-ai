/** Probe: what OCR reads on one page (DOC PAGE [RE=filter]): runs as the text layer gets them. */
import { it } from 'vitest';
import { pageTexts } from '../src/pageText';
import { openDoc } from './nodeSet';

it.skipIf(!process.env.DOC || !process.env.PAGE)('ocr read', async () => {
  const d = await openDoc(process.env.DOC!);
  const texts = await pageTexts(await d.pdf.getPage(Number(process.env.PAGE)));
  const re = new RegExp(process.env.RE ?? '.');
  const hits = texts.filter((t) => re.test(t.str));
  process.stdout.write(`texts ${texts.length} matching ${hits.length}\n${hits.map((t) => `${t.str}@${Math.round(t.cx)},${Math.round(t.cy)}`).join(' | ')}\n`);
});
