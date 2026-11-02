import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { summarise } = createRequire(import.meta.url)('../electron/agent.cjs');

describe('the coding agent runner', () => {
  it('says what Claude Code is doing, from its stream', () => {
    const tool = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the plans.' }, { type: 'tool_use', name: 'mcp__takeoff__add_3d_elements', input: { elements: [1, 2, 3] } }] } });
    expect(summarise('claude', tool)).toEqual([
      { kind: 'text', text: 'Reading the plans.' },
      { kind: 'tool', text: 'add_3d_elements', detail: '3 elements' },
    ]);
    expect(summarise('claude', JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'No sheet' }] }] } }))[0]).toEqual({ kind: 'error', text: 'No sheet' });
    expect(summarise('claude', JSON.stringify({ type: 'result', result: 'Built 412 elements.' }))[0]).toEqual({ kind: 'result', text: 'Built 412 elements.' });
    expect(summarise('claude', JSON.stringify({ type: 'system', subtype: 'init' }))).toEqual([]);
  });

  it('says what Codex is doing, from its events', () => {
    expect(summarise('codex', JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'takeoff', tool: 'find_walls' } }))[0]).toEqual({ kind: 'tool', text: 'find_walls', detail: '' });
    expect(summarise('codex', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }))[0]).toEqual({ kind: 'text', text: 'Done.' });
    expect(summarise('codex', 'plain log line')[0]).toEqual({ kind: 'text', text: 'plain log line' });
  });
});
