import { z } from 'zod/v4';
import { getSample, isSampleError } from '../host';
import { pageTextRuns, renderTiles, type PDFPageProxy } from '../pdf';
import { textLines } from '../sheetInfo';
import { activeProvider, describeError, hasAiKey, readAssemblyLegend } from './claude';
import { openAiJson } from './openai';
import { findAssemblyCodes } from '../assemblyBuilder';
import { LEGEND_INSTRUCTIONS, legendRequest } from './prompt';
import { askService, serviceReady, ServiceError } from './service';
import { ExtractionSchema, type Extraction } from './schema';

export interface LegendResult {
  extraction: Extraction;
  /** Type tags printed on the sheet, for checking coverage. */
  runsText: string[];
  /** Who answered, for display. */
  answeredBy: string;
}

export type AiRoute = 'account' | 'service' | 'api-key' | 'none';

/**
 * Claude artifacts use the viewer's Claude account; the web app uses its own AI service
 * (an access code); local runs use the user's API key.
 */
export async function aiRoute(): Promise<AiRoute> {
  if (await getSample()) return 'account';
  if (serviceReady()) return 'service';
  return hasAiKey() ? 'api-key' : 'none';
}

const schemaInstruction = () =>
  `Reply with only one JSON object matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(ExtractionSchema))}`;

/**
 * Tile grid for the hosted route, which downsizes each image to about
 * 1.2 megapixels: more, smaller tiles keep small print legible.
 */
function hostedGrid(maxCount: number): [number, number] {
  if (maxCount >= 12) return [4, 3];
  if (maxCount >= 6) return [3, 2];
  if (maxCount >= 4) return [2, 2];
  return [1, 1];
}

const SAMPLE_ERRORS: Record<string, string> = {
  not_granted: 'Claude was not allowed for this page. Allow it from the page’s permissions to use AI features.',
  sampling_disabled: 'Claude is not available for this account.',
  rate_limited: 'You have hit a usage limit. Wait a little and try again.',
  session_expired: 'Your Claude session expired. Sign in again and retry.',
  refused: 'Claude declined to read this sheet.',
  prompt_too_large: 'This sheet has too much text to send in one request.',
  invalid_json: 'Claude’s answer could not be read as assembly types. Try again.',
  image_rejected: 'The sheet images could not be sent.',
};

export function describeAiError(e: unknown): string {
  if (e instanceof ServiceError) return e.message;
  if (isSampleError(e)) return SAMPLE_ERRORS[e.code] ?? 'Something went wrong talking to Claude. Try again.';
  return describeError(e);
}

export async function readLegend(page: PDFPageProxy, sheetName: string, signal: AbortSignal): Promise<LegendResult> {
  const runs = await pageTextRuns(page);
  const lines = textLines(runs);
  const runsText = runs.map((r) => r.str);
  const printedTags = findAssemblyCodes(runsText);

  const sample = await getSample();
  if (sample) {
    const limits = await sample.limits().catch(() => null);
    const [cols, rows] = hostedGrid(limits?.images?.maxCount ?? 0);
    const tiles = limits?.images ? await renderTiles(page, cols, rows, 1150) : [];
    const blobs = tiles.map((b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const prompt = [
      LEGEND_INSTRUCTIONS,
      legendRequest(sheetName, lines, printedTags),
      schemaInstruction(),
    ].join('\n\n');
    const raw = await sample.json(prompt, {
      signal,
      modelTier: 'complex',
      ...(blobs.length ? { images: blobs } : {}),
    });
    const parsed = ExtractionSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Claude’s answer did not match the expected assembly format. Try again.');
    return { extraction: parsed.data, runsText, answeredBy: 'your Claude account' };
  }

  if (serviceReady()) {
    // Four tiles about 1600 px each: small print stays legible and the request stays cheap.
    const tiles = await renderTiles(page, 2, 2, 1600);
    const { json, model } = await askService<unknown>(
      {
        task: 'legend',
        system: LEGEND_INSTRUCTIONS,
        prompt: `${legendRequest(sheetName, lines, printedTags)}\n\n${schemaInstruction()}`,
        images: tiles,
        maxTokens: 16000,
      },
      signal,
    );
    const parsed = ExtractionSchema.safeParse(json);
    if (!parsed.success) throw new ServiceError('invalid_json', 'The AI answer did not match the expected assembly format. Try again.');
    return { extraction: parsed.data, runsText, answeredBy: model };
  }

  if (activeProvider() === 'openai') {
    const tiles = await renderTiles(page, 2, 2, 1600);
    const { json, model } = await openAiJson<unknown>(`${legendRequest(sheetName, lines, printedTags)}\n\n${schemaInstruction()}`, tiles, {
      system: LEGEND_INSTRUCTIONS,
      maxTokens: 32000,
      signal,
    });
    const parsed = ExtractionSchema.safeParse(json);
    if (!parsed.success) throw new Error('ChatGPT’s answer did not match the expected assembly format. Try again.');
    return { extraction: parsed.data, runsText, answeredBy: model };
  }

  const tiles = await renderTiles(page, 2, 2, 2576);
  const { extraction, model } = await readAssemblyLegend(tiles, lines, sheetName, signal, printedTags);
  return { extraction, runsText, answeredBy: model };
}
