import { FolderSync, type FolderApi, type LocalStore, type PullResult } from './folderSync';

/**
 * Projects opened from another folder than the projects folder: a shared OneDrive, Dropbox,
 * Google Drive or network folder, or anywhere on this computer. Each stays in its own folder
 * and is saved back there, so everyone who can open that folder works on the same project.
 * The projects folder keeps everything else, as before; a project is in one or the other.
 */

export interface LinkedEntry {
  root: string;
  dir: string;
  id: string;
  name: string;
  /** null until the project has been written there. */
  savedAt: string | null;
  missing: boolean;
}

/** The desktop app's access to opened folders (electron/preload.cjs). */
export interface LinkedBridge {
  open(): Promise<{ picked: string; inMain: boolean; found: { id: string; name: string }[] } | null>;
  shareTo(id: string, name: string): Promise<{ root: string; dir: string } | null>;
  list(): Promise<LinkedEntry[]>;
  remove(id: string): Promise<void>;
  read(root: string, dir: string): Promise<string | null>;
  write(root: string, dir: string, json: string, meta: { id: string; name: string; savedAt: string }): Promise<void>;
  hasPdf(root: string, dir: string, docId: string): Promise<boolean>;
  readPdf(root: string, dir: string, docId: string): Promise<ArrayBuffer | null>;
  writePdf(root: string, dir: string, docId: string, data: ArrayBuffer): Promise<void>;
  writeExport(root: string, dir: string, filename: string, data: ArrayBuffer): Promise<string>;
  reveal(root: string, dir: string): Promise<void>;
}

// FolderSync passes a folder name through untouched; here it carries the folder and its parent.
const enc = (root: string, dir: string) => JSON.stringify([root, dir]);
const dec = (d: string) => JSON.parse(d) as [string, string];

/** The opened folders, as one FolderApi for FolderSync. Never renames or trashes someone's folder. */
export function linkedFolderApi(b: LinkedBridge): FolderApi {
  const where = async (id: string) => {
    const e = (await b.list()).find((x) => x.id === id);
    if (!e) throw new Error('That project is no longer opened from a folder');
    return enc(e.root, e.dir);
  };
  return {
    getFolder: async () => null,
    chooseFolder: async () => null,
    revealFolder: async () => undefined,
    list: async () =>
      (await b.list()).filter((e) => !e.missing && e.savedAt).map((e) => ({ dir: enc(e.root, e.dir), id: e.id, name: e.name, savedAt: e.savedAt! })),
    dirFor: (_name, id) => where(id),
    read: (d) => b.read(...dec(d)),
    write: (d, json, meta) => b.write(...dec(d), json, meta),
    hasPdf: (d, docId) => b.hasPdf(...dec(d), docId),
    readPdf: (d, docId) => b.readPdf(...dec(d), docId),
    writePdf: (d, docId, data) => b.writePdf(...dec(d), docId, data),
    trash: async () => undefined,
    rename: async () => false,
  };
}

/** A FolderApi that leaves out the projects opened from other folders. */
function without(api: FolderApi, ids: Set<string>): FolderApi {
  return { ...api, list: async () => (await api.list()).filter((e) => !ids.has(e.id)) };
}
/** This computer's database, seen as only some projects (or all but some). */
function only(store: LocalStore, keep: (id: string) => boolean): LocalStore {
  return { ...store, listProjects: async () => (await store.listProjects()).filter((s) => keep(s.id)) };
}

/** Sends each project to its folder: an opened folder for opened projects, the projects folder for the rest. */
export class FolderRouter {
  readonly main: FolderSync;
  readonly linked: FolderSync | null;
  private ids = new Set<string>();

  constructor(
    mainApi: FolderApi,
    store: LocalStore,
    readonly bridge: LinkedBridge | null,
  ) {
    this.main = new FolderSync(without(mainApi, this.ids), only(store, (id) => !this.ids.has(id)));
    this.linked = bridge ? new FolderSync(linkedFolderApi(bridge), only(store, (id) => this.ids.has(id))) : null;
  }

  /** Reads which projects are opened from folders. */
  async refresh(): Promise<LinkedEntry[]> {
    if (!this.bridge) return [];
    const list = await this.bridge.list();
    this.ids.clear();
    for (const e of list) this.ids.add(e.id);
    return list;
  }

  isLinked(id: string) {
    return this.ids.has(id);
  }
  private of(id: string) {
    return this.linked && this.ids.has(id) ? this.linked : this.main;
  }

  push(id: string) {
    return this.of(id).push(id);
  }
  pushSoon(id: string) {
    this.of(id).pushSoon(id);
  }
  async flush() {
    await Promise.all([this.main.flush(), this.linked?.flush()]);
  }
  pushMissing() {
    return this.main.pushMissing();
  }
  /** A deleted project: trashed from the projects folder; an opened one is only let go (others still use it). */
  async remove(id: string) {
    if (this.ids.has(id) && this.bridge) {
      await this.bridge.remove(id);
      this.ids.delete(id);
      return;
    }
    await this.main.remove(id);
  }

  async pull(): Promise<PullResult> {
    await this.refresh().catch(() => undefined);
    const a = await this.main.pull();
    if (!this.linked) return a;
    const b = await this.linked.pull().catch((): PullResult => ({ added: [], updated: [], conflicts: [] }));
    return { added: [...a.added, ...b.added], updated: [...a.updated, ...b.updated], conflicts: [...a.conflicts, ...b.conflicts] };
  }

  /** Where a project is kept: its folder in the projects folder, or the opened folder and its parent. */
  async whereIs(id: string): Promise<{ dir: string } | { root: string; dir: string } | null> {
    if (this.ids.has(id) && this.bridge) {
      const e = (await this.bridge.list()).find((x) => x.id === id);
      return e ? { root: e.root, dir: e.dir } : null;
    }
    const dir = (await this.main.dirOf(id)) ?? (await this.main.push(id).then(() => this.main.dirOf(id)));
    return dir ? { dir } : null;
  }

  /** Moves a project into a shared folder of the user's choosing; from then on it is saved there. */
  async shareTo(id: string, name: string): Promise<string | null> {
    if (!this.bridge) return null;
    const to = await this.bridge.shareTo(id, name);
    if (!to) return null;
    await this.refresh();
    await this.linked!.push(id);
    return to.root;
  }

  /** Opens projects from a folder the user picks: brings them in and keeps them in sync with it. */
  async openFromFolder(): Promise<{ ids: string[]; names: string[]; inMain: boolean; picked: string } | null> {
    if (!this.bridge) return null;
    const res = await this.bridge.open();
    if (!res) return null;
    if (res.inMain) {
      await this.main.pull();
      return { ids: res.found.map((f) => f.id), names: res.found.map((f) => f.name), inMain: true, picked: res.picked };
    }
    await this.refresh();
    await this.linked!.pull();
    return { ids: res.found.map((f) => f.id), names: res.found.map((f) => f.name), inMain: false, picked: res.picked };
  }
}
