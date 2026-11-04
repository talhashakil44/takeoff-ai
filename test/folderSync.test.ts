import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FolderSync, type FolderApi, type LocalStore } from '../src/folderSync';
import { FolderRouter, type LinkedBridge, type LinkedEntry } from '../src/linkedFolders';
import type { ActivityEvent } from '../src/activity';
import { newProject, type Project } from '../src/model';
import { summarize, type ProjectSummary, type SyncMark } from '../src/storage';

const folder = createRequire(import.meta.url)('../electron/folder.cjs') as {
  dirFor(name: string, id: string): string;
  inside(root: string, ...parts: string[]): string;
  list(root: string): Promise<{ dir: string; id: string; name: string; savedAt: string }[]>;
  readProject(root: string, dir: string): Promise<string | null>;
  writeProject(root: string, dir: string, json: string, meta: { id: string; name: string; savedAt: string }): Promise<void>;
  hasPdf(root: string, dir: string, docId: string): Promise<boolean>;
  readPdf(root: string, dir: string, docId: string): Promise<Buffer | null>;
  writePdf(root: string, dir: string, docId: string, data: ArrayBuffer): Promise<void>;
  rename(root: string, from: string, to: string): Promise<boolean>;
};

/** The shared folder, on disk, as the desktop app's main process serves it. */
function diskApi(root: string): FolderApi {
  return {
    getFolder: async () => root,
    chooseFolder: async () => root,
    revealFolder: async () => undefined,
    list: () => folder.list(root),
    dirFor: async (name, id) => folder.dirFor(name, id),
    read: (dir) => folder.readProject(root, dir),
    write: (dir, json, meta) => folder.writeProject(root, dir, json, meta),
    hasPdf: (dir, id) => folder.hasPdf(root, dir, id),
    readPdf: async (dir, id) => {
      const b = await folder.readPdf(root, dir, id);
      return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null;
    },
    writePdf: (dir, id, data) => folder.writePdf(root, dir, id, data),
    trash: async () => undefined,
    rename: (from, to) => folder.rename(root, from, to),
  };
}

/** One computer's database, in memory, saving the way src/storage.ts does. */
function computer(clock: () => string): LocalStore & { edit(p: Project): Promise<void>; projects: Map<string, Project> } {
  const projects = new Map<string, Project>();
  const index = new Map<string, ProjectSummary>();
  const activity = new Map<string, ActivityEvent[]>();
  const pdfs = new Map<string, ArrayBuffer>();
  const marks = new Map<string, SyncMark>();
  const save = async (p: Project, updatedAt: string) => {
    projects.set(p.id!, structuredClone(p));
    index.set(p.id!, summarize(p, index.get(p.id!)?.createdAt, updatedAt));
  };
  return {
    projects,
    edit: (p) => save(p, clock()),
    listProjects: async () => [...index.values()],
    loadProjectById: async (id) => structuredClone(projects.get(id)),
    saveProject: (p, { fromFolder }) => save(p, fromFolder),
    loadActivity: async (id) => activity.get(id) ?? [],
    saveActivity: async (id, e) => void activity.set(id, e),
    loadPdf: async (id) => pdfs.get(id),
    savePdf: async (id, d) => void pdfs.set(id, d),
    getSyncMark: async (id) => marks.get(id),
    setSyncMark: async (id, m) => void marks.set(id, m),
  };
}

const project = (name: string): Project => ({
  ...newProject('metric'),
  id: `p${Math.random().toString(36).slice(2, 10)}`,
  name,
  docs: [{ id: 'doc1', name: 'set.pdf' }],
});

describe('shared projects folder', () => {
  it('carries projects, drawings and edits between two computers, both ways', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    // The two computers' clocks disagree by a day; nothing should depend on them agreeing.
    const macClock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const pcClock = () => new Date(Date.UTC(2026, 9, 12, 12, 0, t++)).toISOString();
    const mac = computer(macClock);
    const pc = computer(pcClock);
    const macSync = new FolderSync(diskApi(root), mac, macClock);
    const pcSync = new FolderSync(diskApi(root), pc, pcClock);

    const p = project('Kelso Lodge');
    await mac.savePdf('doc1', new Uint8Array([1, 2, 3]).buffer);
    await mac.edit(p);
    await macSync.push(p.id!);

    // On disk: a readable folder with the project, its meta and its drawing.
    const [dir] = await readdir(root);
    expect(dir).toMatch(/^Kelso Lodge \(p/);
    expect(JSON.parse(await readFile(path.join(root, dir, 'meta.json'), 'utf8')).name).toBe('Kelso Lodge');
    expect([...(await readFile(path.join(root, dir, 'drawings', 'doc1.pdf')))]).toEqual([1, 2, 3]);

    // The PC picks it up, drawing included.
    expect(await pcSync.pull()).toEqual({ added: [p.id], updated: [], conflicts: [] });
    expect(pc.projects.get(p.id!)?.name).toBe('Kelso Lodge');
    expect(new Uint8Array((await pc.loadPdf('doc1'))!)).toEqual(new Uint8Array([1, 2, 3]));
    // Nothing changed since: pulling again on either side does nothing.
    expect(await pcSync.pull()).toEqual({ added: [], updated: [], conflicts: [] });
    expect(await macSync.pull()).toEqual({ added: [], updated: [], conflicts: [] });

    // An edit on the PC comes back to the Mac.
    await pc.edit({ ...pc.projects.get(p.id!)!, name: 'Kelso Lodge rev 2' });
    await pcSync.push(p.id!);
    expect(await macSync.pull()).toEqual({ added: [], updated: [p.id], conflicts: [] });
    expect(mac.projects.get(p.id!)?.name).toBe('Kelso Lodge rev 2');

    // Edited on both before either synced: the Mac keeps its own, and the PC's comes in beside it.
    await mac.edit({ ...mac.projects.get(p.id!)!, name: 'Mac edit' });
    await pc.edit({ ...pc.projects.get(p.id!)!, name: 'PC edit' });
    await pcSync.push(p.id!);
    const clash = await macSync.pull();
    expect(clash.added).toEqual([]);
    expect(clash.conflicts).toHaveLength(1);
    expect(mac.projects.get(p.id!)?.name).toBe('Mac edit');
    expect(mac.projects.get(clash.conflicts[0].copyId)?.name).toBe('PC edit (from the other computer)');
    // The copy has drawings of its own, so deleting it can't take the original's.
    expect(mac.projects.get(clash.conflicts[0].copyId)?.docs[0].id).not.toBe('doc1');
    // And the PC then gets the Mac's version and the copy.
    const after = await pcSync.pull();
    expect(after.added).toEqual([clash.conflicts[0].copyId]);
    expect(pc.projects.get(p.id!)?.name).toBe('Mac edit');
  });

  it('leaves the blank project the app opens with out of the folder', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const mac = computer(clock);
    const blank = { ...newProject('metric'), id: 'blank1234' };
    await mac.edit(blank);
    const sync = new FolderSync(diskApi(root), mac, clock);
    await sync.pull();
    expect(await readdir(root)).toEqual([]);
    await mac.edit({ ...blank, name: 'Kelso Lodge' });
    await sync.push(blank.id);
    expect(await readdir(root)).toEqual([folder.dirFor('Kelso Lodge', blank.id)]);
  });

  it('sends out a project made here that was never sent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const mac = computer(clock);
    const p = { ...project('Offline job'), docs: [] };
    await mac.edit(p);
    await new FolderSync(diskApi(root), mac, clock).pull();
    expect((await folder.list(root)).map((e) => e.name)).toEqual(['Offline job']);
  });

  it('waits for a drawing still on its way from the other computer', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const p = project('Half synced');
    const dir = folder.dirFor(p.name, p.id!);
    await folder.writeProject(root, dir, JSON.stringify({ format: 'takeoff-ai-project', version: 1, savedAt: clock(), project: p, activity: [] }), {
      id: p.id!,
      name: p.name,
      savedAt: clock(),
    });
    const pc = computer(clock);
    expect((await new FolderSync(diskApi(root), pc, clock).pull()).added).toEqual([]);
    expect(pc.projects.size).toBe(0);
  });

  it('renames a project folder with its project, and keeps earlier versions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'takeoff-sync-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 9, 13, 12, 0, t++)).toISOString();
    const mac = computer(clock);
    const sync = new FolderSync(diskApi(root), mac, clock);
    const p = { ...project('Bid draft'), docs: [] };
    await mac.edit(p);
    await sync.push(p.id!);
    await mac.edit({ ...p, name: 'Kelso Lodge' });
    await sync.push(p.id!);
    expect(await readdir(root)).toEqual([folder.dirFor('Kelso Lodge', p.id!)]);
    // One version per 10 minutes: the first overwrite kept the original, the next ones within 10 minutes don't add more.
    const dir = path.join(root, folder.dirFor('Kelso Lodge', p.id!));
    const versions = await readdir(path.join(dir, '.versions'));
    expect(versions).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(dir, '.versions', versions[0]), 'utf8')).project.name).toBe('Bid draft');
    const meta = { id: p.id!, name: 'Kelso Lodge', savedAt: clock() };
    await folder.writeProject(root, folder.dirFor('Kelso Lodge', p.id!), '{}', meta);
    expect(await readdir(path.join(dir, '.versions'))).toHaveLength(1);
    await (folder as unknown as { writeProject(...a: unknown[]): Promise<void> }).writeProject(root, folder.dirFor('Kelso Lodge', p.id!), '{}', meta, Date.now() + 11 * 60 * 1000);
    expect(await readdir(path.join(dir, '.versions'))).toHaveLength(2);
  });

  it('keeps every path inside the projects folder', () => {
    expect(() => folder.inside('/tmp/projects', '../elsewhere')).toThrow();
    expect(() => folder.dirFor('x', '../../etc')).toThrow();
    expect(folder.dirFor('A/B: "plans"', 'abcdefgh123')).toBe('A B plans (abcdefgh)');
  });
});

/** One computer's opened folders, on disk, as electron/main.cjs serves them. */
function linkedBridge(picks: { open?: string; share?: string }): LinkedBridge & { linked: { root: string; dir: string; id: string }[] } {
  const linked: { root: string; dir: string; id: string }[] = [];
  const ok = (root: string, dir: string) => {
    if (!linked.some((l) => l.root === root && l.dir === dir)) throw new Error('not opened');
    return root;
  };
  return {
    linked,
    open: async () => {
      const r = picks.open!;
      const found = await folder.list(r);
      for (const e of found) if (!linked.some((l) => l.root === r && l.dir === e.dir)) linked.push({ root: r, dir: e.dir, id: e.id });
      return { picked: r, inMain: false, found: found.map((e) => ({ id: e.id, name: e.name })) };
    },
    shareTo: async (id, name) => {
      const dir = folder.dirFor(name, id);
      linked.push({ root: picks.share!, dir, id });
      return { root: picks.share!, dir };
    },
    list: async () => {
      const out: LinkedEntry[] = [];
      for (const l of linked) {
        const m = (await folder.list(l.root)).find((e) => e.dir === l.dir);
        out.push({ root: l.root, dir: l.dir, id: m?.id ?? l.id, name: m?.name ?? l.dir, savedAt: m?.savedAt ?? null, missing: false });
      }
      return out;
    },
    remove: async (id) => void linked.splice(linked.findIndex((l) => l.id === id), 1),
    read: (r, d) => folder.readProject(ok(r, d), d),
    write: (r, d, json, meta) => folder.writeProject(ok(r, d), d, json, meta),
    hasPdf: (r, d, id) => folder.hasPdf(ok(r, d), d, id),
    readPdf: async (r, d, id) => {
      const b = await folder.readPdf(ok(r, d), d, id);
      return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null;
    },
    writePdf: (r, d, id, data) => folder.writePdf(ok(r, d), d, id, data),
    writeExport: async () => '',
    reveal: async () => undefined,
  };
}

describe('projects opened from a shared folder', () => {
  it('moves a project into a shared folder, opens it on a colleague\'s computer, and carries edits both ways', async () => {
    const mine = await mkdtemp(path.join(tmpdir(), 'takeoff-mine-'));
    const theirs = await mkdtemp(path.join(tmpdir(), 'takeoff-theirs-'));
    const shared = await mkdtemp(path.join(tmpdir(), 'takeoff-shared-'));
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 10, 4, 12, 0, t++)).toISOString();
    const a = computer(clock), b = computer(clock);
    const pa = linkedBridge({ share: shared }), pb = linkedBridge({ open: shared });
    const ra = new FolderRouter(diskApi(mine), a, pa), rb = new FolderRouter(diskApi(theirs), b, pb);

    // A bid on my computer, in my own projects folder.
    const bid = project('Kelso lodge');
    await a.edit(bid);
    await a.savePdf('doc1', new Uint8Array([1, 2, 3]).buffer);
    await ra.push(bid.id!);
    expect((await folder.list(mine)).map((e) => e.id)).toEqual([bid.id]);

    // Shared: it now lives in the shared folder, with its drawings, and stays out of mine from now on.
    await ra.shareTo(bid.id!, bid.name);
    expect((await folder.list(shared)).map((e) => e.id)).toEqual([bid.id]);
    expect(await folder.hasPdf(shared, (await folder.list(shared))[0].dir, 'doc1')).toBe(true);

    // A colleague opens the shared folder: the project arrives, drawings and all.
    const opened = await rb.openFromFolder();
    expect(opened?.ids).toEqual([bid.id]);
    expect(b.projects.get(bid.id!)?.name).toBe('Kelso lodge');
    expect(await b.loadPdf('doc1')).toBeTruthy();
    // ...and it is not copied into their own projects folder.
    await rb.pull();
    expect(await folder.list(theirs)).toEqual([]);

    // They add a takeoff; it reaches me through the shared folder.
    const theirsEdit = { ...b.projects.get(bid.id!)!, name: 'Kelso lodge (rev 1)' };
    await b.edit(theirsEdit);
    await rb.push(bid.id!);
    const back = await ra.pull();
    expect(back.updated).toContain(bid.id);
    expect(a.projects.get(bid.id!)?.name).toBe('Kelso lodge (rev 1)');
    // The shared folder keeps its name (it isn't renamed under the others).
    expect((await folder.list(shared))[0].dir).toBe(folder.dirFor('Kelso lodge', bid.id!));

    // Deleting it on their computer lets go of the folder; it stays shared for me.
    await rb.remove(bid.id!);
    expect(pb.linked).toEqual([]);
    expect((await folder.list(shared)).map((e) => e.id)).toEqual([bid.id]);
  });
});
