import type { Sheet } from '../model';
import type { PDFPageProxy } from '../pdf';
import { segmentsOf, wallModelFor } from '../fill/sheetWalls';
import { pageTexts } from '../pageText';
import { TYPE_TAG, WALL_TAG, type TagText } from './tags';
import { wallTakeoff, type WallTakeoffResult } from './wallTakeoff';

/**
 * Wall type tags on the page, with each text's centre and size in sheet points. With the
 * project's wall types known, any other code (W1 for a window on this set) counts only
 * when its leader lands on a wall.
 */
export async function wallTagTexts(page: PDFPageProxy, known: readonly string[] = []): Promise<TagText[]> {
  // W-1 and W1 are the same type. Codes outside the usual prefixes (VS1) count when tagged onto a wall.
  const wall = (code: string) => (known.length ? known.includes(code) : WALL_TAG.test(code));
  return (await pageTexts(page))
    .filter((t) => TYPE_TAG.test(t.str))
    .map((t) => {
      const code = t.str.replace('-', '');
      return { code, cx: t.cx, cy: t.cy, w: t.w, h: t.h, ...(wall(code) ? {} : { generic: true }) };
    });
}

export interface KnownWalls {
  /** Codes of the project's wall types (empty when it has none yet: tags are then read by their prefixes). */
  codes: string[];
  /** Those of them that are exterior walls. */
  exterior: string[];
}

/** Runs the wall takeoff on a sheet with a known scale. */
export async function sheetWallTakeoff(
  page: PDFPageProxy,
  sheet: Sheet,
  maxOpening: number,
  throughDoors: boolean,
  stopAtDoors: string[] = [],
  known: KnownWalls = { codes: [], exterior: [] },
): Promise<WallTakeoffResult> {
  if (!sheet.metersPerPoint) throw new Error('Set the sheet scale first.');
  const [model, segments, texts] = await Promise.all([wallModelFor(page, sheet, maxOpening), segmentsOf(page), wallTagTexts(page, known.codes)]);
  return wallTakeoff(model.lines, segments, texts, sheet.metersPerPoint, { doors: model.openings, throughDoors, stopAtDoors, exterior: known.exterior });
}
