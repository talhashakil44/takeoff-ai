import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chatSystem, chatTurn, type ChatMessage } from '../ai/chat';
import { describeError, getApiKey } from '../ai/claude';
import type { ToolResult } from '../mcp/tools';
import { TOOL_DEFS } from '../mcp/tools';
import { Icon } from './Icons';

/**
 * Ask the project: a chat with Claude that reads the drawings, the specification and the takeoff
 * through the app's own tools. Sheet numbers and spec sections in its answers are links.
 */

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  tools: { name: string; state: 'run' | 'done' | 'error' }[];
  error?: string;
}

export interface ChatSection {
  key: string;
  title: string;
  docId: string;
  page: number;
}

interface Props {
  about: string;
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  sheets: { id: string; name: string }[];
  sections: ChatSection[];
  onOpenSheet: (id: string) => void;
  onOpenSection: (s: ChatSection) => void;
  onSettings: () => void;
  onConnect?: () => void;
  onClose: () => void;
}

const SUGGESTIONS = [
  'Which spec sections cover the doors, and what do they say about hardware?',
  'What did the addenda change?',
  'Which spec sections have nothing on the drawings?',
  'Summarize the takeoff so far by type.',
];

const toolTitle = (name: string) => TOOL_DEFS.find((t) => t.name === name)?.title ?? name.replace(/_/g, ' ');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ChatPanel({ about, run, sheets, sections, onOpenSheet, onOpenSection, onSettings, onConnect, onClose }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const hasKey = !!getApiKey();

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  // Links in answers: sheet numbers and spec section numbers this project has.
  const linker = useMemo(() => {
    const byName = new Map(sheets.map((s) => [s.name.toUpperCase(), s.id]));
    const byKey = new Map(sections.map((s) => [s.key.replace(/\D/g, ''), s]));
    const names = [...byName.keys()].filter((n) => n.length >= 2 && /\d/.test(n)).sort((a, b) => b.length - a.length);
    const sheetAlt = names.length ? names.slice(0, 1500).map(esc).join('|') : null;
    const re = new RegExp(`(\\b\\d{2}\\s?\\d{2}\\s?\\d{2}(?:\\.\\d{2})?\\b|\\b\\d{5}\\b)${sheetAlt ? `|(?<![\\w.-])(${sheetAlt})(?![\\w-]|\\.\\d)` : ''}`, 'gi');
    return { re, byName, byKey };
  }, [sheets, sections]);

  const linkify = (text: string, keyBase: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let last = 0;
    let i = 0;
    for (const m of text.matchAll(linker.re)) {
      const at = m.index ?? 0;
      let node: ReactNode = null;
      if (m[1]) {
        const s = linker.byKey.get(m[1].replace(/\D/g, '')) ?? linker.byKey.get(m[1].replace(/\D/g, '').replace(/^(\d{6})\d{2}$/, '$1'));
        if (s)
          node = (
            <button key={`${keyBase}-${i++}`} className="chat-ref spec" onClick={() => onOpenSection(s)} title={`Open ${s.key} ${s.title}`}>
              {m[0]}
            </button>
          );
      } else if (m[2]) {
        const id = linker.byName.get(m[2].toUpperCase());
        if (id)
          node = (
            <button key={`${keyBase}-${i++}`} className="chat-ref sheet" onClick={() => onOpenSheet(id)} title={`Open sheet ${m[2]}`}>
              {m[0]}
            </button>
          );
      }
      if (!node) continue;
      if (at > last) out.push(text.slice(last, at));
      out.push(node);
      last = at + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  // A little Markdown: paragraphs, bullets, headings, **bold**, `code`.
  const inline = (text: string, keyBase: string): ReactNode[] =>
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).flatMap((part, j): ReactNode[] => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return [<strong key={`${keyBase}b${j}`}>{linkify(part.slice(2, -2), `${keyBase}b${j}`)}</strong>];
      if (/^`[^`]+`$/.test(part)) return [<code key={`${keyBase}c${j}`}>{part.slice(1, -1)}</code>];
      return linkify(part, `${keyBase}t${j}`);
    });
  const render = (text: string, keyBase: string) => {
    const blocks: ReactNode[] = [];
    let list: ReactNode[] = [];
    const flush = () => {
      if (list.length) blocks.push(<ul key={`${keyBase}u${blocks.length}`}>{list}</ul>);
      list = [];
    };
    text.split('\n').forEach((line, i) => {
      const k = `${keyBase}-${i}`;
      const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (bullet) {
        list.push(<li key={k}>{inline(bullet[1], k)}</li>);
        return;
      }
      flush();
      if (!line.trim()) return;
      const head = /^#{1,4}\s+(.*)$/.exec(line);
      blocks.push(head ? <h4 key={k}>{inline(head[1], k)}</h4> : <p key={k}>{inline(line, k)}</p>);
    });
    flush();
    return blocks;
  };

  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setDraft('');
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    history.current = [...history.current, { role: 'user', content: q }];
    setTurns((t) => [...t, { role: 'user', text: q, tools: [] }, { role: 'assistant', text: '', tools: [] }]);
    const patch = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])]);
    try {
      history.current = await chatTurn(
        history.current,
        chatSystem(about),
        run,
        {
          text: (d) => patch((t) => ({ ...t, text: t.text + d })),
          tool: (name, state) =>
            patch((t) => {
              const tools = [...t.tools];
              let at = -1;
              tools.forEach((x, k) => {
                if (x.name === name && x.state === 'run') at = k;
              });
              if (state === 'run' || at < 0) tools.push({ name, state });
              else tools[at] = { name, state };
              return { ...t, tools };
            }),
        },
        ctl.signal,
      );
    } catch (e) {
      // The question stays in the conversation only if it was answered.
      history.current = history.current.slice(0, -1);
      if (!ctl.signal.aborted) patch((t) => ({ ...t, error: describeError(e) }));
      else patch((t) => ({ ...t, error: 'Stopped.' }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <aside className="chat-panel" aria-label="Ask the project">
      <header>
        <Icon name="sparkle" size={16} />
        <strong>Ask the project</strong>
        <span className="chat-sub">Claude · reads your drawings, specs and takeoff</span>
        {turns.length > 0 && (
          <button
            className="chat-icon"
            onClick={() => {
              abort.current?.abort();
              history.current = [];
              setTurns([]);
            }}
            title="New conversation"
            aria-label="New conversation"
          >
            <Icon name="plus" size={14} />
          </button>
        )}
        <button className="chat-icon" onClick={onClose} title="Close" aria-label="Close">
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="chat-body" ref={scroller}>
        {!hasKey ? (
          <div className="chat-empty">
            <p>The chat uses your own Anthropic API key, kept on this computer.</p>
            <button className="primary" onClick={onSettings}>
              Add API key
            </button>
            {onConnect && (
              <>
                <p className="dim">Or use Claude Desktop or Claude Code you are already signed in to: connect it to Takeoff AI and talk to this project from there.</p>
                <button className="secondary" onClick={onConnect}>
                  Connect Claude app
                </button>
              </>
            )}
          </div>
        ) : turns.length === 0 ? (
          <div className="chat-empty">
            <p>Ask about the drawings, the specification, the addenda or the takeoff.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chat-suggest" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={`chat-turn ${t.role}`}>
              {t.tools.length > 0 && (
                <div className="chat-tools">
                  {t.tools.map((x, j) => (
                    <span key={j} className={`chat-tool ${x.state}`}>
                      {x.state === 'run' ? '…' : x.state === 'error' ? '!' : '✓'} {toolTitle(x.name)}
                    </span>
                  ))}
                </div>
              )}
              {t.role === 'user' ? <p>{t.text}</p> : render(t.text, `t${i}`)}
              {t.role === 'assistant' && !t.text && !t.error && busy && i === turns.length - 1 && <span className="chat-dots" aria-label="Thinking" />}
              {t.error && <p className="chat-error">{t.error}</p>}
            </div>
          ))
        )}
      </div>

      {hasKey && (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            value={draft}
            placeholder="Ask about this project…"
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
              e.stopPropagation();
            }}
          />
          {busy ? (
            <button type="button" className="secondary" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!draft.trim()}>
              Ask
            </button>
          )}
        </form>
      )}
    </aside>
  );
}
