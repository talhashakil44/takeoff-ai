import type { Segment } from '../fill/vectors';
import { roomLocator } from '../locate';
import type { Pt } from '../model';
import type { PageText } from '../pageText';

type SheetData = { texts: PageText[]; segs: Segment[]; mpp: number | null };

/**
 * Asks the rooms worker which room each point of a sheet is in. The sheet's text and
 * linework are sent the first time the worker sees the sheet (`load`), not after. Where
 * workers are unavailable (tests), it works it out here instead.
 */
export class RoomFinder {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { ok: (v: { names?: (string | null)[]; need?: boolean }) => void; fail: (e: Error) => void }>();
  private inline = new Map<string, (at: Pt) => string | null>();

  constructor() {
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./rooms.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
          const w = this.waiting.get(e.data.id);
          if (!w) return;
          this.waiting.delete(e.data.id);
          if (e.data.error) w.fail(new Error(e.data.error));
          else w.ok(e.data);
        };
        this.worker.onerror = () => {
          // A worker that cannot start (or died): answer here from now on.
          this.worker = null;
          for (const w of this.waiting.values()) w.fail(new Error('rooms worker stopped'));
          this.waiting.clear();
        };
      }
    } catch {
      this.worker = null;
    }
  }

  private ask(key: string, points: (Pt | null)[], sheet?: SheetData) {
    return new Promise<{ names?: (string | null)[]; need?: boolean }>((ok, fail) => {
      const id = this.next++;
      this.waiting.set(id, { ok, fail });
      this.worker!.postMessage({ id, key, points, ...(sheet ? { sheet } : {}) });
    });
  }

  async locate(key: string, load: () => Promise<SheetData>, points: (Pt | null)[]): Promise<(string | null)[]> {
    if (this.worker) {
      try {
        const first = await this.ask(key, points);
        if (first.names) return first.names;
        const again = await this.ask(key, points, await load());
        if (again.names) return again.names;
      } catch {
        // Fall through and work it out here.
      }
    }
    let find = this.inline.get(key);
    if (!find) {
      const d = await load();
      find = roomLocator(d.texts, d.segs, d.mpp);
      this.inline.set(key, find);
    }
    return points.map((p) => (p ? find!(p) : null));
  }
}
