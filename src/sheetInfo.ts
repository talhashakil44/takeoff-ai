import { findScaleHints } from './units';

/** A text run positioned in sheet space (PDF points from the top-left corner). */
export interface TextRun {
  str: string;
  x: number;
  y: number;
  size: number;
}

const SHEET_NUMBER = /^[A-Z]{1,3}-?\d{1,3}(?:\.\d{1,3})?[A-Z]?$/;

/**
 * Guesses the sheet number from the title block: the largest sheet-number-shaped
 * text in the right-hand or bottom strip of the sheet, where title blocks live.
 */
export function guessSheetNumber(runs: TextRun[], width: number, height: number): string | null {
  // A sheet number is lettered big and written once or twice; a tag (FT-3, WT-1) is small and repeats.
  const sizes = runs.map((r) => r.size).sort((a, b) => a - b);
  const median = sizes[sizes.length >> 1] ?? 0;
  const times = new Map<string, number>();
  for (const r of runs) times.set(r.str.trim(), (times.get(r.str.trim()) ?? 0) + 1);
  let best: TextRun | null = null;
  for (const run of runs) {
    const str = run.str.trim();
    if (!SHEET_NUMBER.test(str)) continue;
    const inTitleBlock = run.x > width * 0.7 || run.y > height * 0.8;
    if (!inTitleBlock) continue;
    if (runs.length >= 40 && (run.size < median * 1.4 || times.get(str)! > 2)) continue;
    if (!best || run.size > best.size) best = { ...run, str };
  }
  return best?.str ?? null;
}

/**
 * Groups text runs into reading lines (top to bottom, left to right), each
 * prefixed with its position so a model can tell which column text belongs to.
 */
export function textLines(runs: TextRun[]): string[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextRun[][] = [];
  for (const run of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - run.y) <= Math.max(1.5, run.size * 0.3)) line.push(run);
    else lines.push([run]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    return `y${Math.round(line[0].y)}: ${line.map((r) => `[x${Math.round(r.x)}] ${r.str.trim()}`).join('  ')}`;
  });
}

export interface SheetInfo {
  name: string | null;
  scaleHints: string[];
}

export function inspectRuns(runs: TextRun[], width: number, height: number): SheetInfo {
  return {
    name: guessSheetNumber(runs, width, height),
    scaleHints: findScaleHints(runs.map((r) => r.str).join(' ')),
  };
}
