/// <reference lib="webworker" />
import { buildAll, replan, type BuildInput, type BuildOutput } from './run';
import type { PlanSetup } from './types';
import type { DrawingTexts } from './building';
import type { DrawingLines } from './roof';
type Request =
  | { id: number; kind?: 'build'; input: BuildInput; drawingKey?: string; drawings?: { key: string; texts: DrawingTexts; lines: DrawingLines } }
  | { id: number; kind: 'replan'; output: BuildOutput; setup: PlanSetup; input: Pick<BuildInput, 'sections' | 'facts' | 'edits'> };
// The drawing evidence, kept between builds (the window sends it only when it changes).
let drawings: { key: string; texts: DrawingTexts; lines: DrawingLines } | null = null;
self.onmessage = (e: MessageEvent<Request>) => {
  const request = e.data;
  try {
    if (request.kind !== 'replan') {
      if (request.drawings) drawings = request.drawings;
      if (request.drawingKey !== undefined) {
        if (drawings?.key !== request.drawingKey) throw new Error('The build worker lost its drawing evidence.');
        request.input = { ...request.input, drawingTexts: drawings.texts, drawingLines: drawings.lines };
      }
    }
    const output =
      request.kind === 'replan'
        ? { ...request.output, setup: request.setup, ...replan(request.output.model, request.setup, request.input) }
        : buildAll(request.input);
    (self as unknown as Worker).postMessage({ id: request.id, output });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: request.id, error: err instanceof Error ? err.message : String(err) });
  }
};
