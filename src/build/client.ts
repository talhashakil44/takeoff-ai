import { get, set } from 'idb-keyval';
import { buildAll, type BuildInput, type BuildOutput } from './run';

/** Builds in a worker (inline where workers aren't available); one build at a time, the latest wins. */
let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, { ok: (o: BuildOutput) => void; fail: (e: Error) => void }>();

function start(): Worker | null {
  if (worker) return worker;
  try {
    if (typeof Worker === 'undefined') return null;
    worker = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.fail(new Error(e.data.error));
      else w.ok(e.data.output);
    };
    worker.onerror = () => {
      worker = null;
      for (const w of waiting.values()) w.fail(new Error('The build worker stopped.'));
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function runBuild(input: BuildInput): Promise<BuildOutput> {
  const w = start();
  if (!w) return Promise.resolve(buildAll(input));
  return new Promise<BuildOutput>((ok, fail) => {
    const id = next++;
    waiting.set(id, { ok, fail });
    w.postMessage({ id, input });
  }).catch(() => buildAll(input)); // A worker that can't start or died: build here instead.
}

/** The last build of a project, kept on this computer so the workspace opens with it. */
export interface SavedBuild {
  savedAt: string;
  output: BuildOutput;
}
const key = (projectId: string) => `build:${projectId}`;
export const loadBuild = (projectId: string) => get<SavedBuild>(key(projectId)).catch(() => undefined);
export const saveBuild = (projectId: string, output: BuildOutput) => set(key(projectId), { savedAt: new Date().toISOString(), output } satisfies SavedBuild).catch(() => undefined);
