import type { SpecSection } from '../spec/parse';
import type { SpecFact } from './types';

/**
 * Time requirements the specification states: how long the consultant takes to review a
 * submittal, when the work must be substantially complete, whether commissioning is required.
 * Read from the pages of Division 00 and 01 sections (and commissioning sections), each with
 * the page and the words it came from. Nothing found means nothing assumed here: the plan
 * then falls back to a stated default, marked as one.
 */

const WORDS: Record<string, number> = { five: 5, seven: 7, ten: 10, fourteen: 14, fifteen: 15, twenty: 20, 'twenty-one': 21, thirty: 30, sixty: 60, ninety: 90, three: 3, four: 4, six: 6, eight: 8, twelve: 12 };
const num = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : WORDS[s.toLowerCase()]);
const NUMBER = '(\\d{1,3}|five|seven|ten|fourteen|fifteen|twenty(?:-one)?|thirty|sixty|ninety|three|four|six|eight|twelve)';

const RELEVANT = /SUBMITTAL|SHOP DRAWING|PROGRESS|WORK RESTRICTION|SUMMARY OF (THE )?WORK|GENERAL (REQUIREMENTS|INSTRUCTIONS)|SCHEDUL|CLOSE-?OUT|COMMISSION|CONTRACT TIME|TIME OF COMPLETION|INSTRUCTIONS TO (BIDDERS|TENDERERS)|SPECIAL PROVISIONS|SUPPLEMENTARY CONDITIONS|GENERAL CONDITIONS/i;

export function factSections(sections: SpecSection[]): SpecSection[] {
  return sections.filter((s) => !s.missing && s.pages.length && ((/^0[01]/.test(s.key) && RELEVANT.test(s.title)) || /COMMISSION/i.test(s.title)));
}

export async function readSpecFacts(sections: SpecSection[], text: (docId: string, page: number) => Promise<string>): Promise<SpecFact[]> {
  const facts: SpecFact[] = [];
  const have = new Set<string>();
  const add = (f: SpecFact) => {
    if (have.has(f.key)) return;
    have.add(f.key);
    facts.push(f);
  };
  for (const s of factSections(sections)) {
    if (/COMMISSION/i.test(s.title))
      add({ key: 'commissioningRequired', value: true, source: { kind: 'spec', id: s.docId, page: s.pages[0], label: s.number, section: s.key, quote: s.title } });
    for (const page of s.pages.slice(0, 14)) {
      const t = (await text(s.docId, page)).replace(/\s+/g, ' ');
      const at = (i: number, len: number) => t.slice(Math.max(0, i - 60), i + len + 60).trim();
      const src = (quote: string) => ({ kind: 'spec' as const, id: s.docId, page, label: s.number, section: s.key, quote });
      // The review period: "… will review and return submittals within ten (10) working days …"
      const review = new RegExp(`\\b(review|return)\\w*[^.;]{0,120}?\\b${NUMBER}\\b\\s*(?:\\(\\d+\\)\\s*)?(working|business|calendar)?\\s*days?`, 'i').exec(t);
      if (review && /submittal|shop drawing|sample|product data/i.test(at(review.index, review[0].length))) {
        const n = num(review[2]);
        if (n && n <= 90) add({ key: 'reviewDays', value: n, unit: /calendar/i.test(review[3] ?? '') ? 'calendar days' : 'working days', source: src(at(review.index, review[0].length)) });
      }
      // A completion date: "Substantial Performance … by June 30, 2027".
      const date = /substantial(?:ly)?\s+(?:performance|completion|complete)[^.;]{0,160}?(?:by|on or before|no later than|not later than)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+20\d\d)/i.exec(t);
      if (date) {
        const d = new Date(date[1].replace(/\./, ''));
        if (!Number.isNaN(d.getTime())) add({ key: 'substantialDate', value: d.toISOString().slice(0, 10), unit: 'date', source: src(at(date.index, date[0].length)) });
      }
      // A contract time: "complete the Work within 26 weeks of the date of award".
      const dated =
        /\bBy\s+(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d\d),?\s+([^.;]{0,500})/gi;
      for (const match of t.matchAll(dated)) {
        const iso = new Date(match[1]).toISOString().slice(0, 10),
          clause = match[2];
        const key = /Substantial Performance/i.test(clause)
          ? "substantialDate"
          : /mobilization.{0,50}start/i.test(clause)
            ? "startDate"
            : /Occupancy/i.test(clause)
              ? "phaseDate"
              : null;
        if (key) add({ key, value: iso, unit: "date", source: src(match[0]) });
      }
      const close =
        /Completion of the Contract[^.;]{0,120}?within\s+(\d+)\s*(?:\([^)]+\))?\s*days of Substantial/i.exec(
          t,
        );
      if (close)
        add({
          key: "closeoutDays",
          value: Number(close[1]),
          unit: "calendar days",
          source: src(close[0]),
        });
      // A contract time: "complete the Work within 26 weeks of the date of award".
      const time = new RegExp(`(?:complete|completion|perform)[^.;]{0,80}?\\bwithin\\s+${NUMBER}\\s*(?:\\(\\d+\\)\\s*)?(weeks|working days|calendar days|months)\\s+(?:of|from|after)`, 'i').exec(t);
      if (time) {
        const n = num(time[1]);
        const unit = time[2].toLowerCase();
        const weeks = unit === 'weeks' ? n : unit === 'months' ? n * 4.33 : unit === 'working days' ? n / 5 : n / 7;
        if (weeks) add({ key: 'durationWeeks', value: Math.round(weeks * 10) / 10, unit: 'weeks', source: src(at(time.index, time[0].length)) });
      }
    }
  }
  return facts;
}
