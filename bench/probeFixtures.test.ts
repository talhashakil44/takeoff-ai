/** Probe: plumbing fixtures counted on a drawing file (DOC=pdf), and the schedule rows read. */
import { it } from 'vitest';
import { codeLists } from '../src/fill/typeTags';
import { countPlumbingFixtures, type TagSheet } from '../src/automate/tagCounts';
import { pageTexts } from '../src/pageText';
import { makeSheets, openDoc } from './nodeSet';

it.skipIf(!process.env.DOC)('plumbing fixtures', async () => {
  const d = await openDoc(process.env.DOC!);
  const { sheets } = await makeSheets([d], 'metric');
  const tagSheets: TagSheet[] = [];
  for (const s of sheets) {
    const texts = await pageTexts(await d.pdf.getPage(s.page));
    tagSheets.push({ sheet: s, texts });
    if (/^M901/.test(s.name)) process.stdout.write(`cands ${texts.filter((t) => /^(WC|U|TH|SH|L)-\d$/.test(t.str.trim())).map((t) => `${t.str}@${Math.round(t.cx)},${Math.round(t.cy)} h${t.h.toFixed(1)} a${(t.angle ?? 0).toFixed(2)}`).join(' | ')}\n`);
    if (/^M901/.test(s.name)) process.stdout.write(`${s.name} ${s.title}: rows ${codeLists(texts, undefined, { mixed: true }).map((r) => `${r.code}=${r.description.slice(0, 30)}`).join(' | ')}\n`);
  }
  const counts = countPlumbingFixtures(tagSheets);
  process.stdout.write(`counts ${counts.map((c) => `${c.code}:${c.total}`).join(' ')}\n`);
});
