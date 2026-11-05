import { TOOL_DEFS, type ToolResult } from '../mcp/tools';

/**
 * ChatGPT through the user's own OpenAI API key, kept in this browser only. Plain fetch to the
 * Chat Completions API (no SDK): the same jobs as the Claude route, so either key works.
 */

const KEY_STORAGE = 'takeoff-ai:openai-api-key';
const MODEL_STORAGE = 'takeoff-ai:openai-model';
const PROVIDER_STORAGE = 'takeoff-ai:ai-provider';
export const OPENAI_DEFAULT_MODEL = 'gpt-6-sol';
const URL = 'https://api.openai.com/v1/chat/completions';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // Storage unavailable (private window); the setting just won't be remembered.
  }
};

export const getOpenAiKey = () => read(KEY_STORAGE);
export const setOpenAiKey = (key: string | null) => write(KEY_STORAGE, key);
export const getOpenAiModel = () => read(MODEL_STORAGE) || OPENAI_DEFAULT_MODEL;
export const setOpenAiModel = (m: string | null) => write(MODEL_STORAGE, m && m !== OPENAI_DEFAULT_MODEL ? m : null);

export type Provider = 'anthropic' | 'openai';
/** Which key to use when both are saved; the last one saved wins. */
export const getPreferredProvider = (): Provider | null => {
  const p = read(PROVIDER_STORAGE);
  return p === 'anthropic' || p === 'openai' ? p : null;
};
export const setPreferredProvider = (p: Provider | null) => write(PROVIDER_STORAGE, p);

export class OpenAiError extends Error {}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type OpenAiMessage =
  | { role: 'system' | 'user'; content: string | Part[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

const png = (b64: string): Part => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const key = getOpenAiKey();
  if (!key) throw new OpenAiError('Add your OpenAI API key first.');
  let res: Response;
  try {
    res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new OpenAiError('Could not reach the OpenAI API. Check your internet connection.');
  }
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { error?: { message?: string } }) => j?.error?.message)
      .catch(() => null);
    if (res.status === 401) throw new OpenAiError('The OpenAI API key was rejected. Check it in AI settings.');
    if (res.status === 429) throw new OpenAiError(msg?.includes('quota') ? 'Your OpenAI account is out of credit.' : 'Rate limited by OpenAI. Wait a minute and try again.');
    if (res.status === 404) throw new OpenAiError(`OpenAI does not know the model "${getOpenAiModel()}". Change it in AI settings.`);
    throw new OpenAiError(`OpenAI error ${res.status}${msg ? `: ${msg}` : ''}`);
  }
  return res;
}

/** Asks for one JSON object about some images (base64 PNG) and returns it parsed. */
export async function openAiJson<T>(prompt: string, images: string[], opts: { system?: string; maxTokens?: number; signal?: AbortSignal } = {}): Promise<{ json: T; model: string }> {
  const messages: OpenAiMessage[] = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    { role: 'user', content: [...images.map(png), { type: 'text', text: `${prompt}\n\nReply with only one JSON object.` }] },
  ];
  const res = await post({ model: getOpenAiModel(), messages, response_format: { type: 'json_object' }, max_completion_tokens: opts.maxTokens ?? 2000 }, opts.signal);
  const data = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[] };
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new OpenAiError('ChatGPT declined to read this sheet.');
  if (choice?.finish_reason === 'length') throw new OpenAiError('The answer was cut off. Try again or split the sheet.');
  const text = choice?.message?.content ?? '';
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) throw new OpenAiError('ChatGPT did not answer with JSON.');
  return { json: JSON.parse(json) as T, model: data.model ?? getOpenAiModel() };
}

const LEFT_OUT = new Set(['add_drawings']);
const TOOLS = TOOL_DEFS.filter((t) => !LEFT_OUT.has(t.name)).map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.inputSchema },
}));

/** Reads a streamed Chat Completions answer: text as it comes, tool calls assembled at the end. */
async function streamTurn(res: Response, onText: (d: string) => void): Promise<{ text: string; calls: ToolCall[] }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const calls: ToolCall[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let chunk: { choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const d = chunk.choices?.[0]?.delta;
      if (d?.content) {
        text += d.content;
        onText(d.content);
      }
      for (const tc of d?.tool_calls ?? []) {
        const c = (calls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.function.name += tc.function.name;
        if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
      }
    }
  }
  return { text, calls: calls.filter(Boolean) };
}

/** One chat turn with ChatGPT and the app's tools; resolves to the conversation with the turn added. */
export async function openAiChatTurn(
  history: OpenAiMessage[],
  system: string,
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  on: { text(delta: string): void; tool(name: string, state: 'run' | 'done' | 'error'): void },
  signal?: AbortSignal,
): Promise<OpenAiMessage[]> {
  const messages = [...history];
  for (let step = 0; step < 16; step++) {
    const res = await post({ model: getOpenAiModel(), stream: true, messages: [{ role: 'system', content: system }, ...messages], tools: TOOLS, max_completion_tokens: 16000 }, signal);
    const { text, calls } = await streamTurn(res, on.text);
    messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) break;
    const pictures: Part[] = [];
    for (const c of calls) {
      on.tool(c.function.name, 'run');
      let r: ToolResult;
      try {
        r = await run(c.function.name, c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {});
      } catch (e) {
        r = { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
      on.tool(c.function.name, r.isError ? 'error' : 'done');
      const texts = r.content.filter((x) => x.type !== 'image').map((x) => x.text ?? '');
      const imgs = r.content.filter((x) => x.type === 'image' && x.data);
      imgs.forEach((x) => pictures.push(png(x.data!)));
      messages.push({ role: 'tool', tool_call_id: c.id, content: (r.isError ? 'Error: ' : '') + (texts.join('\n') || (imgs.length ? `${imgs.length} image(s), attached below.` : 'Done.')) });
    }
    // Tool messages carry text only, so images from tools follow as a user message.
    if (pictures.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tools above:' }, ...pictures] });
    on.text('\n\n');
  }
  return messages;
}
