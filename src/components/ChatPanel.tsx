import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { chatSystem, chatTurn, type ChatMessage } from '../ai/chat';
import { activeProvider, describeError, hasAiKey, setApiKey } from '../ai/claude';
import { setOpenAiKey, setPreferredProvider, type Provider } from '../ai/openai';
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
  const [hasKey, setHasKey] = useState(() => hasAiKey());
  const provider = activeProvider();
  const startedOn = useRef(provider);

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
    // A conversation stays with the AI it started on; switching AI starts a fresh one.
    if (startedOn.current !== provider) history.current = [];
    startedOn.current = provider;
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
        <Icon name="chat" size={16} />
        <strong>{hasKey ? 'Ask the project' : 'AI'}</strong>
        <span className="chat-sub">{hasKey ? `${provider === 'openai' ? 'ChatGPT' : 'Claude'} · reads your drawings, specs and takeoff` : 'Bring your own Claude or ChatGPT'}</span>
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
          <ByoAi desktop={!!onConnect} onConnect={onConnect} onSettings={onSettings} onKey={() => setHasKey(true)} />
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

const DOWNLOAD = 'https://github.com/talhashakil44/takeoff-ai/releases/latest';

const FAQ: [string, ReactNode][] = [
  ['Do I need AI to use Takeoff AI?', 'No. Scale, measuring, counts, the spec reader and the built-in Automate tools all work without any AI.'],
  [
    'Does Takeoff AI come with an AI?',
    'No. It has no AI account of its own and never uses anyone else\'s. You bring yours: your Claude or ChatGPT app on the desktop, or your own API key.',
  ],
  [
    'Can I sign in with my Claude or ChatGPT plan on the web?',
    'Not yet. Signing in with a Claude or ChatGPT plan works in the desktop app, which connects to the Claude or ChatGPT/Codex app on your computer. In the browser, use your own Anthropic or OpenAI API key.',
  ],
  ['What does the desktop app do better?', 'Your Claude or ChatGPT can drive the whole takeoff there: open sheets, read legends, run the takeoffs and export. Everything it does shows on screen and can be undone.'],
  ['Where is my API key kept? Who pays?', 'Only in this browser on this computer, sent straight to Anthropic or OpenAI when you ask something. They bill your key; Takeoff AI has no server and never sees it.'],
];

/** The "connect your AI" view: there is no shared AI, so the user brings their own. */
function ByoAi({ desktop, onConnect, onSettings, onKey }: { desktop: boolean; onConnect?: () => void; onSettings: () => void; onKey: () => void }) {
  const [key, setKey] = useState('');
  const [which, setWhich] = useState<Provider>('anthropic');
  return (
    <div className="chat-empty byo">
      <p className="byo-lead">
        <strong>Bring your own AI.</strong> Takeoff AI has no AI of its own. Connect yours to ask about the drawings and specs and to run AI takeoffs.
      </p>

      <div className="byo-card">
        <h4>Sign in with Claude or ChatGPT</h4>
        {desktop ? (
          <>
            <p>Use the Claude Desktop, Claude Code or ChatGPT Codex app you already pay for. It works with Takeoff AI on this computer.</p>
            <button className="primary" onClick={onConnect}>
              Connect Claude or ChatGPT
            </button>
          </>
        ) : (
          <>
            <p>Plan sign-in works in the desktop app, which connects to the Claude or ChatGPT app on your computer. That is the best way to run a full AI takeoff.</p>
            <a className="button primary" href={DOWNLOAD} target="_blank" rel="noreferrer">
              Download the desktop app
            </a>
          </>
        )}
      </div>

      <div className="byo-card">
        <h4>{desktop ? 'Or paste' : 'Or use'} your own API key</h4>
        <div className="byo-pick" role="radiogroup" aria-label="Which AI">
          {(['anthropic', 'openai'] as Provider[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={which === p} className={which === p ? 'on' : ''} onClick={() => setWhich(p)}>
              {p === 'anthropic' ? 'Claude' : 'ChatGPT'}
            </button>
          ))}
        </div>
        <form
          className="byo-key"
          onSubmit={(e) => {
            e.preventDefault();
            if (!key.trim()) return;
            (which === 'openai' ? setOpenAiKey : setApiKey)(key.trim());
            setPreferredProvider(which);
            setKey('');
            onKey();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            placeholder={which === 'openai' ? 'OpenAI key, sk-…' : 'Anthropic key, sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-label={which === 'openai' ? 'OpenAI API key' : 'Anthropic API key'}
          />
          <button className="primary" disabled={!key.trim()}>
            Save
          </button>
        </form>
        <p className="dim">
          Kept only in this browser. Get one at{' '}
          {which === 'openai' ? (
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              platform.openai.com
            </a>
          ) : (
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
          )}
          .{' '}
          <button className="link-button" onClick={onSettings}>
            More AI settings
          </button>
        </p>
      </div>

      <div className="byo-faq">
        <h4>FAQ</h4>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
