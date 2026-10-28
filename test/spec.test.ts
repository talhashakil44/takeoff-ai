import { describe, expect, it } from 'vitest';
import type { PageText } from '../src/pageText';
import { addendumNumber, mergeSections, readSpec } from '../src/spec/parse';
import { buildProjectMap } from '../src/spec/links';
import type { Sheet } from '../src/model';

/** A page of text, one run per line, top to bottom. */
function page(lines: string[]): PageText[] {
  return lines.map((str, i) => ({ str, cx: 72 + str.length * 2.5, cy: 60 + i * 14, w: str.length * 5, h: 9 }));
}

const PAGES: string[][] = [
  ['Project Manual', 'TABLE OF CONTENTS 00 01 10 - 1', 'SECTION 00 01 10 TABLE OF CONTENTS', '08100 Hollow Metal Work 1 thru 5', '09900 Painting To follow'],
  [
    'Homelessness Support Centre 08100 - 1',
    'SECTION 08100 - HOLLOW METAL WORK',
    'PART 1 - GENERAL',
    '1.1 Related Work',
    '.1 Painting Section 09900.',
    '.2 Masonry Sections 04220, 06200 and 07900.',
    'PART 2 - PRODUCTS',
    '2.1 HOLLOW METAL DOORS',
    '.1 Refer to the Door Schedule on A6.1.',
  ],
  ['Homelessness Support Centre 08100 - 2', 'PART 3 - EXECUTION', '3.1 Installation', '.1 Install frames plumb.'],
];

describe('spec reading', () => {
  it('reads sections, parts, articles, references and what is still to follow', async () => {
    const book = await readSpec('doc', 'spec.pdf', PAGES.length, async (p) => page(PAGES[p - 1]));
    const s = book.sections.find((x) => x.key === '08100')!;
    expect(s.title).toBe('HOLLOW METAL WORK');
    expect(s.division).toBe('08');
    expect(s.pages).toEqual([2, 3]);
    expect(s.parts.map((p) => p.name)).toEqual(['General', 'Products', 'Execution']);
    expect(s.articles.map((a) => a.number)).toEqual(['1.1', '2.1', '3.1']);
    expect(s.sections).toEqual(expect.arrayContaining(['09900', '04220', '06200', '07900']));
    expect(s.sheets).toContain('A6.1');
    expect(s.schedules).toContain('door schedule');
    expect(s.words).toEqual(expect.arrayContaining(['door']));
    const painting = book.sections.find((x) => x.key === '09900')!;
    expect(painting.missing).toBe(true);
    expect(book.pageSection).toEqual(['000110', '08100', '08100']);
  });

  it('ties a section to the sheet it names', async () => {
    const book = await readSpec('doc', 'spec.pdf', PAGES.length, async (p) => page(PAGES[p - 1]));
    const sheets = [{ id: 's1', docId: 'd', page: 1, name: 'A6.1', title: 'Door schedule', width: 100, height: 100 } as Sheet];
    const map = buildProjectMap(null, [book], sheets);
    const e = map.edges.find((x) => x.a === 'spec:08100' && x.b === 'sheet:s1');
    expect(e?.kind).toBe('written');
    expect(map.nodes.find((n) => n.id === 'spec:09900')?.missing).toBe(true);
  });
});

describe('addenda', () => {
  const ADD: string[][] = [
    ['ADDENDUM # 4', 'DOCUMENT REVISIONS:', 'R1: Section 08100 Hollow Metal Work is revised and re-issued.', 'R2: Drawing A6.1 is revised.', 'Q1: Can we use another door?', 'A1: Refer to Section 08100.'],
    ['Homelessness Support Centre 08100 - 1', 'SECTION 08100 - HOLLOW METAL WORK', 'PART 1 - GENERAL', '1.1 Related Work'],
  ];
  it('reads what an addendum changes, and the sections it re-issues stand', async () => {
    const base = await readSpec('doc', 'spec.pdf', PAGES.length, async (p) => page(PAGES[p - 1]));
    const add = await readSpec('add', 'Addendum 4.pdf', ADD.length, async (p) => page(ADD[p - 1]), undefined, { addendum: 4 });
    expect(add.addendum).toBe(4);
    const r1 = add.changes!.find((c) => c.label === 'R1')!;
    expect(r1.sections).toEqual(['08100']);
    expect(r1.action).toBe('revised');
    expect(add.changes!.find((c) => c.label === 'R2')!.sheets).toEqual(['A6.1']);
    expect(add.changes!.find((c) => c.label === 'Q1')!.text).toMatch(/A1: Refer/);
    const merged = mergeSections([add, base]);
    const s = merged.find((x) => x.key === '08100')!;
    expect(s.docId).toBe('add');
    expect(s.revisions).toEqual([{ addendum: 4, docId: 'add', page: 2 }]);
    const sheets = [{ id: 's1', docId: 'd', page: 1, name: 'A6.1', title: 'Door schedule', width: 100, height: 100 } as Sheet];
    const map = buildProjectMap(null, [base, add], sheets);
    const kinds = map.edges.filter((e) => e.a === 'add:add').map((e) => `${e.kind}:${e.b}`);
    expect(kinds).toEqual(expect.arrayContaining(['revises:spec:08100', 'revises:sheet:s1']));
  });

  it('knows an addendum by its name', () => {
    expect(addendumNumber('T2025-116 Addendum 4.pdf')).toBe(4);
    expect(addendumNumber('RFT 082026 - KGE - WBL - CH - Addendum 2.pdf')).toBe(2);
    expect(addendumNumber('ADDENDUM # 4')).toBe(4);
    expect(addendumNumber('Addendum No. 07')).toBe(7);
    expect(addendumNumber('Specifications.pdf')).toBeNull();
  });
});
