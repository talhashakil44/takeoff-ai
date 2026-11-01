import { describe, expect, it } from 'vitest';
import { isCircuitTag, legendAbbreviations } from '../src/automate/electrical';
import type { PageText } from '../src/pageText';

const tx = (str: string, cx: number, cy: number, w = 20): PageText => ({ str, cx, cy, w, h: 4 }) as PageText;

describe('electrical by text', () => {
  it('knows circuit tags, not sheet numbers or notes', () => {
    for (const s of ['L2G-5', 'P2S-13', 'M2G-23,25,27', 'K2S-1,3']) expect(isCircuitTag(s)).toBe(true);
    for (const s of ['E3', 'NOTE 5', 'L2G', '2X4']) expect(isCircuitTag(s)).toBe(false);
  });
  it('reads the abbreviations a legend defines in words', () => {
    const m = legendAbbreviations([tx('OS', 100, 50, 8), tx('CEILING MOUNTED OCCUPANCY SENSOR', 180, 50, 120), tx('ROOM', 100, 90, 10)], null);
    expect(m.get('OS')).toBe('CEILING MOUNTED OCCUPANCY SENSOR');
    expect(m.has('ROOM')).toBe(false);
  });
});
