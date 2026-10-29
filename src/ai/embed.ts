import { get, set } from 'idb-keyval';
import { desktopApi } from '../desktop';
import type { MapNode } from '../spec/links';

/**
 * AI embeddings for the project map, with the user's own key: OpenAI (sk-…) or Voyage AI
 * (pa-…, Anthropic's recommended embeddings). Each thing's text is embedded once and kept on
 * this computer; a project is a few hundred short texts, a cent or two.
 */

const KEY_STORAGE = 'takeoff-ai:embeddings-key';

export function getEmbeddingsKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setEmbeddingsKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable; the key just won't be remembered.
  }
}

export type Provider = 'openai' | 'voyage';
export const providerOf = (key: string): Provider => (/^sk-/.test(key) ? 'openai' : 'voyage');
export const PROVIDER_NAME: Record<Provider, string> = { openai: 'OpenAI', voyage: 'Voyage AI' };

const MODELS: Record<Provider, string> = { openai: 'text-embedding-3-small', voyage: 'voyage-4-lite' };
const DIMS = 512;

/** What an AI reads for a node: what it is, its name, and (a spec section) the start of its text. */
export function textOf(n: MapNode, groupName: string): string {
  const kind = { section: 'Specification section', sheet: 'Drawing sheet', schedule: 'Drawing schedule', item: 'Scheduled item', type: 'Assembly type', finish: 'Finish', addendum: 'Addendum' }[n.kind];
  return [`${kind} ${n.label}: ${n.sub}`, groupName && `(${groupName})`, n.text?.slice(0, 900)].filter(Boolean).join(' ').slice(0, 1200);
}

function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

async function post(url: string, key: string, body: unknown): Promise<{ status: number; body: string }> {
  if (desktopApi?.embed) return desktopApi.embed(url, key, body);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.text() };
}

async function embedBatch(provider: Provider, key: string, input: string[]): Promise<number[][]> {
  const tries: [string, unknown][] =
    provider === 'openai'
      ? [['https://api.openai.com/v1/embeddings', { model: MODELS.openai, input, dimensions: DIMS }]]
      : [
          ['https://api.voyageai.com/v1/embeddings', { model: MODELS.voyage, input, input_type: 'document', output_dimension: DIMS }],
          ['https://ai.mongodb.com/v1/embeddings', { model: MODELS.voyage, input, input_type: 'document', output_dimension: DIMS }],
        ];
  let last = '';
  for (const [url, body] of tries) {
    const r = await post(url, key, body);
    if (r.status >= 200 && r.status < 300) {
      const data = JSON.parse(r.body) as { data: { embedding: number[]; index: number }[] };
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
    last = r.status === 401 || r.status === 403 ? `The ${PROVIDER_NAME[provider]} key was rejected.` : `${PROVIDER_NAME[provider]} answered ${r.status}: ${r.body.slice(0, 160)}`;
    if (r.status !== 401 && r.status !== 403 && r.status !== 404) break;
  }
  throw new Error(last);
}

/** Embeddings for these texts (by id): the ones seen before from this computer's store, the rest asked for. */
export async function embedAll(items: { id: string; text: string }[], progress?: (done: number, of: number) => void): Promise<Map<string, Float32Array>> {
  const key = getEmbeddingsKey();
  if (!key) throw new Error('No embeddings key');
  const provider = providerOf(key);
  const store = (t: string) => `emb:${provider}:${MODELS[provider]}:${DIMS}:${hash(t)}`;
  const out = new Map<string, Float32Array>();
  const todo: { id: string; text: string }[] = [];
  await Promise.all(
    items.map(async (it) => {
      const v = await get<Float32Array>(store(it.text)).catch(() => undefined);
      if (v) out.set(it.id, v);
      else todo.push(it);
    }),
  );
  // The same text once (two sheets both called "Door schedule").
  const unique = [...new Map(todo.map((t) => [t.text, t])).values()];
  for (let i = 0; i < unique.length; i += 96) {
    progress?.(i, unique.length);
    const batch = unique.slice(i, i + 96);
    const vecs = await embedBatch(provider, key, batch.map((b) => b.text));
    await Promise.all(
      batch.map((b, k) => {
        const v = Float32Array.from(vecs[k]);
        for (const t of todo) if (t.text === b.text) out.set(t.id, v);
        return set(store(b.text), v).catch(() => undefined);
      }),
    );
  }
  progress?.(unique.length, unique.length);
  return out;
}
