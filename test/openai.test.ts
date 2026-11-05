import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeProvider } from '../src/ai/claude';
import { openAiChatTurn, openAiJson, setOpenAiKey, setPreferredProvider } from '../src/ai/openai';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const sse = (chunks: unknown[]) =>
  new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(x)}\n\n`)); c.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); c.close(); } }));

describe('OpenAI key route', () => {
  it('picks the provider whose key is saved, the chosen one when both are', () => {
    expect(activeProvider()).toBe(null);
    setOpenAiKey('sk-test');
    expect(activeProvider()).toBe('openai');
    store.set('takeoff-ai:anthropic-api-key', 'sk-ant-test');
    setPreferredProvider('anthropic');
    expect(activeProvider()).toBe('anthropic');
  });

  it('sends the key only to api.openai.com and parses the JSON answer', async () => {
    setOpenAiKey('sk-test');
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', async (u: string, init: RequestInit) => {
      calls.push([u, init]);
      return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: '{"number":"A1.01","title":"Plan"}' } }] }));
    });
    const r = await openAiJson<{ number: string }>('name?', ['AAAA']);
    expect(r.json.number).toBe('A1.01');
    expect(calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('runs tool calls from a streamed answer, then finishes', async () => {
    setOpenAiKey('sk-test');
    const answers = [
      sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'list_sheets', arguments: '{"li' } }] } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mit":2}' } }] } }] }]),
      sse([{ choices: [{ delta: { content: 'Two ' } }] }, { choices: [{ delta: { content: 'sheets.' } }] }]),
    ];
    vi.stubGlobal('fetch', async () => answers.shift()!);
    const ran: unknown[] = [];
    let text = '';
    const out = await openAiChatTurn([{ role: 'user', content: 'how many?' }], 'sys', async (n, a) => (ran.push([n, a]), { content: [{ type: 'text', text: 'A1, A2' }] }), { text: (d) => (text += d), tool: () => undefined });
    expect(ran).toEqual([['list_sheets', { limit: 2 }]]);
    expect(text).toContain('Two sheets.');
    expect(out.at(-1)).toEqual({ role: 'assistant', content: 'Two sheets.' });
  });

  it('turns a rejected key into a plain message', async () => {
    setOpenAiKey('bad');
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    await expect(openAiJson('x', [])).rejects.toThrow('OpenAI API key was rejected');
  });
});
