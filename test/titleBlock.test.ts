import { describe, expect, it } from 'vitest';
import type { PageText } from '../src/pageText';
import { readTitleBlock } from '../src/titleBlock';

/** A run of text starting at (x, y) baseline-left, `h` high (sheet points). */
const t = (str: string, x: number, y: number, h: number): PageText => ({ str, cx: x + (str.length * h * 0.6) / 2, cy: y, w: str.length * h * 0.6, h });

const W = 2835;
const H = 2004;

describe('reading the title block', () => {
  // A DCC title block: captions small, values big, the drawing number with the project code in front.
  const dcc = [
    t('SUBJECT | SUJET', 2443, 1624, 7),
    t('FIRE SUPPRESSION LAYOUT -', 2477, 1660, 17),
    t('LEVEL 1', 2583, 1681, 17),
    t('PRODUCTION', 2443, 1710, 7),
    t('REVIEWED | REVU', 2565, 1710, 7),
    t('DWG. NO. | NO. DESSIN', 2442, 1903, 7),
    t('K-B35-6803/28 -', 2622, 1920, 17),
    t('412', 2738, 1920, 17),
    // Plan text the old guess picked up: a stair tag and a valve tag near the right edge.
    t('ST-1', 2000, 900, 9),
    t('SV-9', 2100, 400, 12),
    // A note that starts like a caption.
    t('SUBJECT TO LOCAL AUTHORITY APPROVAL', 2200, 300, 9),
  ];

  it('reads the sheet number and the title, leaving the project code off', () => {
    expect(readTitleBlock(dcc, W, H)).toEqual({ number: '412', title: 'FIRE SUPPRESSION LAYOUT - LEVEL 1' });
  });

  it('reads a sheet number joined onto the project code', () => {
    const joined = dcc.map((x) => (x.str === 'K-B35-6803/28 -' ? t('K-B35-6803-28-', 2622, 1920, 17) : x.str === '412' ? t('890', 2738, 1920, 17) : x));
    expect(readTitleBlock(joined, W, H).number).toBe('890');
  });

  it('reads captions written with their value beside them', () => {
    const simple = [t('DRAWING TITLE:', 2300, 1800, 8), t('GROUND FLOOR PLAN', 2300, 1830, 16), t('SHEET NO.', 2600, 1900, 8), t('A-101', 2600, 1940, 26)];
    expect(readTitleBlock(simple, W, H)).toEqual({ number: 'A-101', title: 'GROUND FLOOR PLAN' });
  });

  it('falls back to the biggest sheet number in the corner', () => {
    expect(readTitleBlock([t('M2.01', 2600, 1900, 20), t('ST-1', 2000, 900, 9)], W, H)).toEqual({ number: 'M2.01', title: null });
  });

  it('finds nothing on a sheet with no title block', () => {
    expect(readTitleBlock([t('VB07 LIFE SAFETY', 900, 900, 30)], W, H)).toEqual({ number: null, title: null });
  });
});
