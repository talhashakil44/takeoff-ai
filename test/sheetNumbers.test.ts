import { describe, expect, it } from 'vitest';
import { linesIn, onSheet, readNumber, readTitle, relativeBox } from '../src/sheetNumbers';
import type { PageText } from '../src/pageText';

const t = (str: string, cx: number, cy: number, h = 6, angle?: number): PageText => ({ str, cx, cy, w: str.length * h * 0.6, h, angle });

describe('sheet numbers from a box', () => {
  it('reads the same spot on sheets of another size', () => {
    const rel = relativeBox([1100, 760, 1000, 700], 1224, 792);
    expect(onSheet(rel, 2448, 1584).map(Math.round)).toEqual([2000, 1400, 2200, 1520]);
  });

  it('picks the number out of its caption, and the biggest text', () => {
    const box: [number, number, number, number] = [0, 0, 200, 100];
    const texts = [t('SHEET NO.', 40, 10, 4), t('A2.1', 60, 40, 14), t('Kelso', 400, 40), t('REV 2', 150, 80, 4)];
    expect(readNumber(linesIn(texts, box))).toBe('A2.1');
    expect(readNumber(linesIn([t('DWG NO: A-101', 50, 50, 8)], box))).toBe('A-101');
    expect(readNumber(linesIn([t('SHEET', 40, 50, 8), t('M2.01', 90, 50, 8)], box))).toBe('M2.01');
    expect(readNumber(linesIn([t('E', 40, 50, 8), t('101', 52, 50, 8)], box))).toBe('E101');
    expect(readNumber(linesIn([], box))).toBe('');
  });

  it('reads a title over several lines, captions left out', () => {
    const box: [number, number, number, number] = [0, 0, 300, 100];
    const texts = [t('SHEET TITLE:', 40, 10, 4), t('GROUND FLOOR', 80, 40, 9), t('PLAN', 150, 40, 9), t('AND DETAILS', 80, 60, 9)];
    expect(readTitle(linesIn(texts, box))).toBe('GROUND FLOOR PLAN AND DETAILS');
  });

  it('reads title blocks turned on their side', () => {
    const up = -Math.PI / 2;
    const box: [number, number, number, number] = [0, 0, 100, 300];
    const texts = [t('SHEET NO.', 20, 250, 4, up), t('A3.2', 50, 200, 12, up)];
    expect(readNumber(linesIn(texts, box))).toBe('A3.2');
  });
});
