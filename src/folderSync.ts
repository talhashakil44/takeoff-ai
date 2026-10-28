import type { ActivityEvent } from './activity';
import { filesOf, newId, type Project } from './model';
import type { ProjectSummary, SyncMark } from './storage';

/**
 * Keeps projects in a shared folder (iCloud Drive, OneDrive…) so the desktop app on two
 * computers works on the same projects. Each computer keeps its own database as before;
 * this copies changes out to the folder and brings in changes made on the other computer.
 *
 * Each project remembers its last sync: the folder copy's savedAt then, and this computer's
 * clock then. A folder copy with any other savedAt changed on the other computer; a project
 * here saved after that moment (by this computer's clock) changed here. The two computers'
 * clocks are never compared. Then, for a project in the folder:
 * - not here yet: brought in;
 * - changed in the folder only: brought in over this copy;
 * - changed here only: sent out;
 * - changed in both: the folder's copy is brought in as a separate project, nothing lost.
 * A project deleted on one computer goes to that computer's Trash and is left alone here.
 */

/** The desktop app's folder access (electron/preload.cjs). */
export interface FolderApi {
  getFolder(): Promise<string | null>;
  chooseFolder(): Promise<string | null>;
  revealFolder(): Promise<void>;
  list(): Promise<{ dir: string; id: string; name: string; savedAt: string }[]>;
  dirFor(name: string, id: string): Promise<string>;
  read(dir: string): Promise<string | null>;
  write(dir: string, json: string, meta: { id: string; name: string; savedAt: string }): Promise<void>;
  hasPdf(dir: string, docId: string): Promise<boolean>;
  readPdf(dir: string, docId: string): Promise<ArrayBuffer | null>;
  writePdf(dir: string, docId: string, data: ArrayBuffer): Promise<void>;
  trash(dir: string): Promise<void>;
  /** Renames a project folder; false when the new name is taken. */
  rename(from: string, to: string): Promise<boolean>;
}

/** This computer's database, as the sync needs it (src/storage.ts). */
export interface LocalStore {
  listProjects(): Promise<ProjectSummary[]>;
  loadProjectById(id: string): Promise<Project | undefined>;
  saveProject(project: Project, opts: { fromFolder: string }): Promise<void>;
  loadActivity(id: string): Promise<ActivityEvent[]>;
  saveActivity(id: string, events: ActivityEvent[]): Promise<void>;
  loadPdf(docId: string): Promise<ArrayBuffer | undefined>;
  savePdf(docId: string, data: ArrayBuffer): Promise<void>;
  getSyncMark(id: string): Promise<SyncMark | undefined>;
  setSyncMark(id: string, mark: SyncMark): Promise<void>;
}

const FORMAT = 'takeoff-ai-project';

const isBlank = (p: Project) => !p.docs.length && !p.measurements.length && (!p.name || p.name === 'Untitled project');

export interface PullResult {
  /** Projects brought in for the first time. */
  added: string[];
  /** Projects here that were replaced by a newer copy from the folder. */
  updated: string[];
  /** Projects changed in both places: the folder's copy came in as a new project (its id). */
  conflicts: { id: string; copyId: string; name: string }[];
}

export class FolderSync {
  private pushing = new Map<string, ReturnType<typeof setTimeout>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private api: FolderApi,
    private store: LocalStore,
    private now: () => string = () => new Date().toISOString(),
  ) {}

  /** Runs one sync step at a time, so a push and a pull never interleave. */
  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Writes a project (and any drawings the folder lacks) to the folder. */
  push(id: string): Promise<void> {
    return this.serial(() => this.pushNow(id));
  }

  /** Sends a project out a moment after its last save, so a burst of edits is written once. */
  pushSoon(id: string, delayMs = 1500) {
    globalThis.clearTimeout(this.pushing.get(id));
    this.pushing.set(
      id,
      globalThis.setTimeout(() => {
        this.pushing.delete(id);
        void this.push(id).catch(() => undefined);
      }, delayMs),
    );
  }

  /** Writes every change still waiting (the window is closing). */
  async flush(): Promise<void> {
    const waiting = [...this.pushing.keys()];
    for (const id of waiting) globalThis.clearTimeout(this.pushing.get(id));
    this.pushing.clear();
    await Promise.all(waiting.map((id) => this.push(id).catch(() => undefined)));
  }

  /** The folder a project is kept in, once it has been written there. */
  async dirOf(id: string): Promise<string | null> {
    return (await this.api.list()).find((e) => e.id === id)?.dir ?? null;
  }

  /** Moves a deleted project's folder to the Trash. */
  remove(id: string): Promise<void> {
    globalThis.clearTimeout(this.pushing.get(id));
    return this.serial(async () => {
      const entry = (await this.api.list()).find((e) => e.id === id);
      if (entry) await this.api.trash(entry.dir);
    });
  }

  private async pushNow(id: string) {
    const project = await this.store.loadProjectById(id);
    if (!project?.id) return;
    const entry = (await this.api.list()).find((e) => e.id === id);
    // The blank project the app opens with gets no folder until it has drawings or takeoffs
    // (a project made with New project does: it was named).
    if (!entry && isBlank(project)) return;
    const named = await this.api.dirFor(project.name, id);
    let dir = entry?.dir ?? named;
    // A renamed project's folder follows its name.
    if (entry && entry.dir !== named && (await this.api.rename(entry.dir, named).catch(() => false))) dir = named;
    for (const d of filesOf(project)) {
      if (await this.api.hasPdf(dir, d.id)) continue;
      const data = await this.store.loadPdf(d.id);
      if (data) await this.api.writePdf(dir, d.id, data);
    }
    const savedAt = this.now();
    const activity = await this.store.loadActivity(id);
    await this.api.write(dir, JSON.stringify({ format: FORMAT, version: 1, savedAt, project, activity }), { id, name: project.name, savedAt });
    await this.store.setSyncMark(id, { savedAt, at: savedAt });
  }

  /** Sends out every project here that the folder doesn't have (a folder just chosen). */
  pushMissing(): Promise<void> {
    return this.serial(async () => {
      const there = new Set((await this.api.list()).map((e) => e.id));
      for (const s of await this.store.listProjects()) if (!there.has(s.id)) await this.pushNow(s.id);
    });
  }

  /** Brings in what changed on the other computer, and sends out what changed here and wasn't sent. */
  pull(): Promise<PullResult> {
    return this.serial(() => this.pullNow());
  }

  private async pullNow(): Promise<PullResult> {
    const result: PullResult = { added: [], updated: [], conflicts: [] };
    const remote = await this.api.list();
    const local = new Map((await this.store.listProjects()).map((s) => [s.id, s]));
    for (const entry of remote) {
      const here = local.get(entry.id);
      const mark = await this.store.getSyncMark(entry.id);
      if (!here) {
        if (await this.bringIn(entry.dir, entry.id)) result.added.push(entry.id);
        continue;
      }
      const changedThere = !mark || entry.savedAt !== mark.savedAt;
      const changedHere = !mark || here.updatedAt > mark.at;
      if (changedThere && !changedHere) {
        if (await this.bringIn(entry.dir, entry.id)) result.updated.push(entry.id);
      } else if (changedThere && changedHere) {
        const copy = await this.bringInAsCopy(entry.dir);
        if (copy) result.conflicts.push({ id: entry.id, copyId: copy.id, name: copy.name });
        await this.pushNow(entry.id);
        if (copy) await this.pushNow(copy.id);
      } else if (changedHere) {
        await this.pushNow(entry.id);
      }
    }
    // Projects made here since the last sync (never sent) go out. Ones already sent but now
    // missing from the folder were deleted on the other computer, or haven't arrived yet:
    // they stay here and are left out of the folder until edited again.
    const there = new Set(remote.map((e) => e.id));
    for (const s of local.values()) {
      if (there.has(s.id)) continue;
      const mark = await this.store.getSyncMark(s.id);
      if (!mark || s.updatedAt > mark.at) await this.pushNow(s.id);
    }
    return result;
  }

  private async readFolderCopy(dir: string) {
    const text = await this.api.read(dir);
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as { format?: string; savedAt?: string; project?: Project; activity?: ActivityEvent[] };
      return parsed.format === FORMAT && parsed.project?.id && parsed.savedAt ? (parsed as { savedAt: string; project: Project; activity?: ActivityEvent[] }) : null;
    } catch {
      return null;
    }
  }

  /** Saves the folder's copy here, under the same ids. False when it couldn't be read whole. */
  private async bringIn(dir: string, id: string): Promise<boolean> {
    const copy = await this.readFolderCopy(dir);
    if (!copy || copy.project.id !== id) return false;
    for (const d of filesOf(copy.project)) {
      if (await this.store.loadPdf(d.id)) continue;
      const data = await this.api.readPdf(dir, d.id);
      // A drawing still on its way from the other computer: try again next time.
      if (!data) return false;
      await this.store.savePdf(d.id, data);
    }
    const at = this.now();
    await this.store.saveProject(copy.project, { fromFolder: at });
    await this.store.saveActivity(id, copy.activity ?? []);
    await this.store.setSyncMark(id, { savedAt: copy.savedAt, at });
    return true;
  }

  /** Saves the folder's copy here as a new project, with its own ids for itself and its drawings. */
  private async bringInAsCopy(dir: string): Promise<{ id: string; name: string } | null> {
    const copy = await this.readFolderCopy(dir);
    if (!copy) return null;
    const docIds = new Map(filesOf(copy.project).map((d) => [d.id, newId()]));
    for (const [oldId, nextId] of docIds) {
      const data = (await this.store.loadPdf(oldId)) ?? (await this.api.readPdf(dir, oldId));
      if (!data) return null;
      await this.store.savePdf(nextId, data);
    }
    const id = newId();
    const name = `${copy.project.name || 'Untitled project'} (from the other computer)`;
    const project: Project = {
      ...copy.project,
      id,
      name,
      docs: copy.project.docs.map((d) => ({ ...d, id: docIds.get(d.id)! })),
      ...(copy.project.specs ? { specs: copy.project.specs.map((d) => ({ ...d, id: docIds.get(d.id)!, ...(d.book ? { book: { ...d.book, docId: docIds.get(d.id)!, sections: d.book.sections.map((x) => ({ ...x, docId: docIds.get(d.id)! })) } } : {}) })) } : {}),
      sheets: copy.project.sheets.map((s) => ({ ...s, docId: docIds.get(s.docId) ?? s.docId })),
    };
    await this.store.saveProject(project, { fromFolder: this.now() });
    await this.store.saveActivity(id, copy.activity ?? []);
    return { id, name };
  }
}
