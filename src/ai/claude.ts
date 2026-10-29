import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { LEGEND_INSTRUCTIONS, legendRequest } from './prompt';
import { ExtractionSchema, type Extraction } from './schema';

export const MODEL = 'claude-opus-5-5';

const KEY_STORAGE = 'takeoff-ai:anthropic-api-key';

/** The user's own API key, kept in this browser only. */
export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable (private window); the key just won't be remembered.
  }
}

export function client(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Add your Anthropic API key in AI settings first.');
  // The app runs on the user's own machine with their own key, so calling the API from the browser is intended.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}



export interface ReadResult {
  extraction: Extraction;
  /** Model that produced the answer; differs from MODEL when a fallback model answered. */
  model: string;
}

/** Sends one legend sheet to Claude and returns the assemblies it found. */
export async function readAssemblyLegend(
  tiles: string[],
  lines: string[],
  sheetName: string,
  signal?: AbortSignal,
  printedTags: string[] = [],
): Promise<ReadResult> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...tiles.map(
      (data): Anthropic.Beta.BetaImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data },
      }),
    ),
    {
      type: 'text',
      text: legendRequest(sheetName, lines, printedTags),
    },
  ];

  const stream = client().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(ExtractionSchema) },
      system: LEGEND_INSTRUCTIONS,
      messages: [{ role: 'user', content }],
    },
    { signal },
  );
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to read this sheet.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The answer was cut off because the sheet has too many types. Try again or split the sheet.');
  }
  if (!message.parsed_output) {
    throw new Error('Claude returned an answer that could not be read as assembly types.');
  }
  return { extraction: message.parsed_output, model: message.model };
}

/** Asks Claude a short question about some images and parses the JSON object it answers with. */
export async function askClaudeJson<T>(prompt: string, images: Blob[], signal?: AbortSignal): Promise<T> {
  const toBase64 = async (b: Blob) => {
    const bytes = new Uint8Array(await b.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const content: Anthropic.MessageParam['content'] = [
    ...(await Promise.all(
      images.map(async (b): Promise<Anthropic.ImageBlockParam> => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: await toBase64(b) } })),
    )),
    { type: 'text', text: prompt },
  ];
  const message = await client().messages.create({ model: MODEL, max_tokens: 1000, messages: [{ role: 'user', content }] }, { signal });
  const text = message.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('');
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) throw new Error('Claude did not answer with the sheet name.');
  return JSON.parse(json) as T;
}

/** Turns an API failure into a message a user can act on. */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in AI settings.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use this model.';
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute and try again.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (error instanceof Anthropic.APIError) return `API error ${error.status ?? ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
