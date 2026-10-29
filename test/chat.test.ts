import { describe, expect, it, vi } from 'vitest';

const replies = [
  { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'spec_map', input: { section: '08100' } }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: '08100 is on A6.1.' }] },
];
const seen: unknown[] = [];
vi.mock('../src/ai/claude', () => ({
  MODEL: 'm',
  client: () => ({
    beta: {
      messages: {
        stream: (req: { messages: unknown[] }) => {
          seen.push(JSON.parse(JSON.stringify(req.messages)));
          const r = replies.shift()!;
          let cb: (d: string) => void = () => {};
          return {
            on: (_: string, f: (d: string) => void) => (cb = f),
            finalMessage: async () => {
              for (const b of r.content) if (b.type === 'text') cb(b.text as string);
              return r;
            },
          };
        },
      },
    },
  }),
}));

import { chatTurn, CHAT_TOOLS } from '../src/ai/chat';

describe('chat', () => {
  it('runs the tools Claude asks for and hands the results back', async () => {
    let text = '';
    const tools: string[] = [];
    const run = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'section 08100: door schedule A6.1' }] }));
    const out = await chatTurn([{ role: 'user', content: 'doors?' }], 'sys', run, { text: (d) => (text += d), tool: (n, s) => tools.push(`${n}:${s}`) });
    expect(run).toHaveBeenCalledWith('spec_map', { section: '08100' });
    expect(tools).toEqual(['spec_map:run', 'spec_map:done']);
    expect(text).toContain('08100 is on A6.1.');
    expect(out).toHaveLength(4);
    expect((seen[1] as { content: { type: string; tool_use_id: string }[] }[])[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(CHAT_TOOLS.some((t) => t.name === 'add_drawings')).toBe(false);
  });
});
