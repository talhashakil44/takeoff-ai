/// <reference lib="webworker" />
import { buildAll, replan, type BuildInput, type BuildOutput } from './run';
import type { PlanSetup } from './types';
type Request =
  | { id: number; kind?: 'build'; input: BuildInput }
  | { id: number; kind: 'replan'; output: BuildOutput; setup: PlanSetup; input: Pick<BuildInput, 'sections' | 'facts' | 'edits'> };
self.onmessage = (e: MessageEvent<Request>) => {
  const request = e.data;
  try {
    const output =
      request.kind === 'replan'
        ? { ...request.output, setup: request.setup, ...replan(request.output.model, request.setup, request.input) }
        : buildAll(request.input);
    (self as unknown as Worker).postMessage({ id: request.id, output });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: request.id, error: err instanceof Error ? err.message : String(err) });
  }
};
