import type { Segment } from '../fill/vectors';
import { roomLocator } from '../locate';
import type { Pt } from '../model';
import type { PageText } from '../pageText';

/**
 * Works out which room each takeoff is in, off the main thread: finding a sheet's walls to see
 * which room tag a point can see takes seconds on a busy trade plan, and on the main thread it
 * froze the app for a minute or more after opening a big project. Each sheet's locator is kept,
 * so later takeoffs on the sheet are answered at once.
 */
type Req = { id: number; key: string; sheet?: { texts: PageText[]; segs: Segment[]; mpp: number | null }; points: (Pt | null)[] };

const locators = new Map<string, (at: Pt) => string | null>();

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, key, sheet, points } = e.data;
  try {
    let find = locators.get(key);
    if (!find) {
      if (!sheet) {
        (self as unknown as Worker).postMessage({ id, need: true });
        return;
      }
      find = roomLocator(sheet.texts, sheet.segs, sheet.mpp);
      locators.set(key, find);
    }
    (self as unknown as Worker).postMessage({ id, names: points.map((p) => (p ? find!(p) : null)) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
