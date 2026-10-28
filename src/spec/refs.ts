import { keyOf } from './parse';

/** A note on a drawing that names spec sections (REFER TO SPECIFICATIONS 21 02 51, 22 02 51 & 23 02 51). */
export interface SpecRef {
  sheetId: string;
  box: [number, number, number, number];
  keys: string[];
  text: string;
}

/** Notes on a sheet naming spec sections, by their numbers (checked against the spec when linking). */
export function specRefsOn(sheetId: string, texts: { str: string; cx: number; cy: number; w: number; h: number }[]): SpecRef[] {
  const out: SpecRef[] = [];
  const NUM = /\b(\d{5}|\d{2}\s\d{2}\s\d{2})\b/g;
  for (const t of texts) {
    if (!/SPEC|SECTION/i.test(t.str)) continue;
    const keys = [...t.str.matchAll(NUM)].map((m) => keyOf(m[1]));
    if (!keys.length) continue;
    out.push({ sheetId, box: [t.cx - t.w / 2 - 2, t.cy - t.h - 2, t.cx + t.w / 2 + 2, t.cy + t.h + 2], keys, text: t.str.trim() });
  }
  return out;
}

