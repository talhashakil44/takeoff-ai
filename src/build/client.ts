import type { PlanSetup } from './types';
import { MODEL_VERSION } from './extract';
import { get, set } from 'idb-keyval';
import { buildAll, replan, type BuildInput, type BuildOutput } from './run';
import { drawingFingerprint } from './sources';

/** Builds in a worker (inline where workers aren't available); one build at a time, the latest wins. */
let worker: Worker | null = null;
let next = 1;
/** The drawing evidence the worker holds (by fingerprint): sent once, not with every build. */
let sentDrawings: string | null = null;
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
      sentDrawings = null;
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
    // Linework runs to tens of MB: copy it to the worker only when it changed.
    const key = drawingFingerprint(input.drawingTexts, input.drawingLines);
    const { drawingTexts, drawingLines, ...rest } = input;
    const drawings = key === sentDrawings ? undefined : { key, texts: drawingTexts ?? {}, lines: drawingLines ?? {} };
    sentDrawings = key;
    w.postMessage({ id, input: rest, drawingKey: key, drawings });
  }).catch(() => {
    // A worker that can't start, died or lost its drawings: build here instead (and resend next time).
    sentDrawings = null;
    return buildAll(input);
  });
}

/** The last build of a project, kept on this computer so the workspace opens with it. */
export interface SavedBuild {
  savedAt: string;
  output: BuildOutput;
}
const key = (projectId: string) => `build:${projectId}`;
export const loadBuild = (projectId: string) => get<SavedBuild>(key(projectId)).then(b => b?.output.model.version === MODEL_VERSION ? b : undefined).catch(() => undefined);
export const saveBuild = (projectId: string, output: BuildOutput) => set(key(projectId), { savedAt: new Date().toISOString(), output } satisfies SavedBuild).catch(() => undefined);

/** Keep target recovery off the UI thread; callers reject superseded responses. */
export function runReplan(output: BuildOutput, setup: PlanSetup, input: Pick<BuildInput,'sections'|'facts'|'edits'>): Promise<BuildOutput> {
  const w=start();
  const inline=()=>({...output,setup,...replan(output.model,setup,input)});
  if(!w)return Promise.resolve().then(inline);
  return new Promise<BuildOutput>((ok,fail)=>{
    const id=next++;
    waiting.set(id,{ok,fail});
    w.postMessage({id,kind:'replan',output,setup,input});
  }).catch(inline);
}
