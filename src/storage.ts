import { del, get, set } from 'idb-keyval';
import type { ActivityEvent } from './activity';
import { filesOf, newId, type Project } from './model';

/**
 * The app's database: IndexedDB in this browser. Each project is stored on its
 * own (with its activity log beside it) and listed in a small index, and every
 * drawing PDF is stored once under its own key. Nothing leaves the machine.
 *
 *   projects          ProjectSummary[]   the list shown in Projects
 *   current           string             the project open last
 *   project:<id>      Project
 *   activity:<id>     ActivityEvent[]
 *   pdf:<docId>       ArrayBuffer
 *   starter-types     { units, types }    the user's own starting set of takeoff types
 *   sync:<id>         SyncMark           the last write to or read from the shared projects
 *                                        folder (desktop app)
 */
export interface ProjectSummary {
  id: string;
  name: string;
  units: Project['units'];
  createdAt: string;
  updatedAt: string;
  sheets: number;
  takeoffs: number;
}

const INDEX = 'projects';
const CURRENT = 'current';
const projectKey = (id: string) => `project:${id}`;
const activityKey = (id: string) => `activity:${id}`;
const pdfKey = (docId: string) => `pdf:${docId}`;
const ACTIVITY_CAP = 20000;

// Storage can be unavailable (private windows, blocked site data, previews). The app then
// works for the current visit and starts fresh next time.
const safely = async <T>(op: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await op();
  } catch {
    return fallback;
  }
};

export const summarize = (p: Project, createdAt?: string, updatedAt?: string): ProjectSummary => ({
  id: p.id!,
  name: p.name,
  units: p.units,
  createdAt: createdAt ?? new Date().toISOString(),
  updatedAt: updatedAt ?? new Date().toISOString(),
  sheets: p.sheets.length,
  takeoffs: p.measurements.length,
});

export const listProjects = () => safely(async () => (await get<ProjectSummary[]>(INDEX)) ?? [], [] as ProjectSummary[]);

/** Moves a project saved by an earlier version (one project under "project") into the index, once. */
let migration: Promise<void> | null = null;
const migrate = () => (migration ??= migrateOnce());
async function migrateOnce(): Promise<void> {
  const legacy = await get<Project>('project');
  if (!legacy) return;
  const id = legacy.id ?? newId();
  const project = { ...legacy, id };
  await set(projectKey(id), project);
  const log = await get<ActivityEvent[]>('activity');
  if (log) await set(activityKey(id), log);
  const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
  await set(INDEX, [...index.filter((s) => s.id !== id), summarize(project)]);
  await set(CURRENT, id);
  await del('project');
  await del('activity');
}

/** The project open last (or the most recent one), or nothing when there are none. */
export const loadCurrentProject = () =>
  safely(async () => {
    await migrate();
    const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
    const current = await get<string>(CURRENT);
    const id = index.some((s) => s.id === current) ? current : [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id;
    return id ? known(await get<Project>(projectKey(id))) : undefined;
  }, undefined as Project | undefined);

/**
 * Project objects known to match what is stored: as loaded, or as last saved. The app never
 * mutates a project (each change makes a new object), so saving one of these again changes
 * nothing and is skipped without reading the stored copy back or comparing the two (both slow
 * on a big project: thousands of takeoffs is megabytes).
 */
const stored = new WeakSet<Project>();
const known = <T extends Project | undefined>(p: T): T => {
  if (p) stored.add(p);
  return p;
};

export const loadProjectById = (id: string) => safely(async () => known(await get<Project>(projectKey(id))), undefined);

/** Told about every project saved with a change, and every project deleted (the desktop app's shared folder). */
export interface StorageHooks {
  saved: (id: string) => void;
  deleted: (id: string) => void;
}
let hooks: StorageHooks | null = null;
export const setStorageHooks = (h: StorageHooks | null) => {
  hooks = h;
};

/**
 * Saves a project and refreshes its entry in the index. A save that changes nothing (the
 * autosave after opening a project) leaves its date alone, so it doesn't count as an edit.
 * `fromFolder`: a copy read from the shared folder, saved with that time (this computer's
 * clock, when it was read) and not sent back.
 */
export const saveProject = (project: Project, opts: { fromFolder?: string } = {}) =>
  safely(async () => {
    if (!project.id) return;
    const unchanged = !opts.fromFolder && stored.has(project);
    if (!unchanged) {
      const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
      const old = index.find((s) => s.id === project.id);
      await set(projectKey(project.id), project);
      await set(INDEX, [...index.filter((s) => s.id !== project.id), summarize(project, old?.createdAt, opts.fromFolder)]);
      stored.add(project);
    }
    if (!opts.fromFolder) await set(CURRENT, project.id);
    if (!unchanged && !opts.fromFolder) hooks?.saved(project.id);
  }, undefined);

/** The folder copy's savedAt (from whichever computer wrote it), and this computer's clock at the time. */
export interface SyncMark {
  savedAt: string;
  at: string;
}
export const getSyncMark = (id: string) => safely(() => get<SyncMark>(`sync:${id}`), undefined);
export const setSyncMark = (id: string, mark: SyncMark) => safely(() => set(`sync:${id}`, mark), undefined);

/** Deletes a project, its activity log and its drawings. */
export const deleteProject = (project: Project) =>
  safely(async () => {
    if (!project.id) return;
    hooks?.deleted(project.id);
    await del(`sync:${project.id}`);
    for (const d of filesOf(project)) await del(pdfKey(d.id));
    await del(projectKey(project.id));
    await del(activityKey(project.id));
    const index = (await get<ProjectSummary[]>(INDEX)) ?? [];
    await set(
      INDEX,
      index.filter((s) => s.id !== project.id),
    );
  }, undefined);

export const loadActivity = (projectId: string) =>
  safely(async () => (await get<ActivityEvent[]>(activityKey(projectId))) ?? [], [] as ActivityEvent[]);
export const saveActivity = (projectId: string, events: ActivityEvent[]) =>
  safely(() => set(activityKey(projectId), events.slice(-ACTIVITY_CAP)), undefined);

export const loadPdf = (docId: string) => safely(() => get<ArrayBuffer>(pdfKey(docId)), undefined);
export const savePdf = (docId: string, data: ArrayBuffer) => safely(() => set(pdfKey(docId), data), undefined);
export const deletePdf = (docId: string) => safely(() => del(pdfKey(docId)), undefined);

/**
 * Asks the browser to keep this app's data even when the disk runs low (otherwise
 * browsers may clear site data they consider unused). Returns whether it will.
 */
export async function persistStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

/** Space used and available for this app's data, in bytes. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** The takeoff types new projects start with, saved by the user, in the units they were made for. */
export interface StarterTypes {
  units: Project['units'];
  types: Project['types'];
  savedAt: string;
}

const STARTER = 'starter-types';
export const loadStarterTypes = () => safely(() => get<StarterTypes>(STARTER), undefined);
export const saveStarterTypes = (units: Project['units'], types: Project['types']) =>
  safely(() => set(STARTER, { units, types, savedAt: new Date().toISOString() } satisfies StarterTypes), undefined);
export const clearStarterTypes = () => safely(() => del(STARTER), undefined);
