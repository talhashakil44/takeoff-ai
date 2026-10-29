import type Anthropic from '@anthropic-ai/sdk';
import { client, MODEL } from './claude';
import { TOOL_DEFS, type ToolResult } from '../mcp/tools';

/**
 * The built-in chat: Claude with the app's own MCP tools (the same ones Claude Desktop gets when
 * it connects), run here against the open project, with the user's API key.
 */

export type ChatMessage = Anthropic.Beta.BetaMessageParam;

/** Tools that make no sense from inside the app (reading a file by path on disk). */
const LEFT_OUT = new Set(['add_drawings']);

export const CHAT_TOOLS: Anthropic.Beta.BetaTool[] = TOOL_DEFS.filter((t) => !LEFT_OUT.has(t.name)).map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema as Anthropic.Beta.BetaTool['input_schema'],
}));

export function chatSystem(about: string): string {
  return [
    'You are the estimator’s assistant inside Takeoff AI, a construction takeoff app. You can see the open project through tools: its drawings (sheets, their text and images, schedules, tags, links between sheets), its specification (sections, what they refer to, addenda that change them) and its takeoffs and quantities.',
    'Look things up with the tools before answering; do not guess what a drawing or spec says. Prefer spec_map for the specification, drawing_links and look_up_tag for the drawings, get_sheet_text before get_sheet_image.',
    'Answer short and plain, like a senior estimator: the answer first, then where it comes from. Name sheets by their number (A2.01) and spec sections by number and title (08 11 13 Hollow Metal Doors) so the app can link them.',
    'Takeoff data is the estimator’s work: never delete or change takeoffs or types unless asked in so many words; adding is fine when asked.',
    about,
  ].join('\n\n');
}

export interface ChatEvents {
  text(delta: string): void;
  tool(name: string, state: 'run' | 'done' | 'error'): void;
}

function resultBlocks(r: ToolResult): Anthropic.Beta.BetaToolResultBlockParam['content'] {
  return r.content.map((c) =>
    c.type === 'image' && c.data
      ? { type: 'image' as const, source: { type: 'base64' as const, media_type: (c.mimeType ?? 'image/png') as 'image/png', data: c.data } }
      : { type: 'text' as const, text: c.text ?? '' },
  );
}

/** One turn: Claude answers, calling tools as it needs them; resolves to the conversation with the turn added. */
export async function chatTurn(
  history: ChatMessage[],
  system: string,
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  on: ChatEvents,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const messages = [...history];
  for (let step = 0; step < 16; step++) {
    const stream = client().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        tools: CHAT_TOOLS,
        messages,
      },
      { signal },
    );
    stream.on('text', (d) => on.text(d));
    const msg = await stream.finalMessage();
    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (msg.stop_reason !== 'tool_use') break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of msg.content) {
      if (b.type !== 'tool_use') continue;
      on.tool(b.name, 'run');
      let r: ToolResult;
      try {
        r = await run(b.name, (b.input ?? {}) as Record<string, unknown>);
      } catch (e) {
        r = { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
      }
      on.tool(b.name, r.isError ? 'error' : 'done');
      results.push({ type: 'tool_result', tool_use_id: b.id, content: resultBlocks(r), ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
    on.text('\n\n');
  }
  return messages;
}
