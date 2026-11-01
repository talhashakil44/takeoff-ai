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
  const m901 = tagSheets.find((t) => t.sheet.name === 'M901');
  if (m901) process.stdout.write(`fixture-ish ${m901.texts.filter((t) => /^(U|TH|CS|BF|DWH|FFD|WC|L)-?\d?$/.test(t.str.trim())).map((t) => `${t.str}@${Math.round(t.cx - t.w / 2)},${Math.round(t.cy)}`).join(' | ')}\n`);
  process.stdout.write(`counts ${counts.map((c) => `${c.code}:${c.total}`).join(' ')}\n`);
});
