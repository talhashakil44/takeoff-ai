/// <reference lib="webworker" />
import { buildAll, type BuildInput } from './run';

// Building the model and the plan, off the window's thread.
self.onmessage = (e: MessageEvent<{ id: number; input: BuildInput }>) => {
  try {
    (self as unknown as Worker).postMessage({ id: e.data.id, output: buildAll(e.data.input) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
