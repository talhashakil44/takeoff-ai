import { useEffect, useState } from 'react';
import { desktopApi, type AgentEvent, type AgentFound, type AgentKey } from '../desktop';

/**
 * Build 3D with AI: starts Claude Code or Codex on the user's own Claude or ChatGPT plan to
 * build the project's 3D model through the app's tools, and shows its progress. Without either
 * installed, gives the prompt to paste into Claude Desktop (with Takeoff AI connected).
 */

export const AI_MODEL_PROMPT = (name: string) =>
  `Build the 3D model of the project open in Takeoff AI ("${name}") from its drawings. If it already has a 3D model, call list_3d_model and carry on from it. First call the takeoff tool model_3d_instructions and follow it step by step through the whole set: shell and openings, glazing, floors and roof, structure, interior walls and doors, stairs, fixtures, services and the site. Check your work with view_3d_model and fix what is wrong. Don't change any takeoffs.`;

export interface AgentRun {
  agent: AgentKey | null;
  running: boolean;
  log: AgentEvent[];
}

interface Props {
  projectName: string;
  elements: number;
  run: AgentRun;
  onStart: (agent: AgentKey) => void;
  onStop: () => void;
  onClose: () => void;
  /** Opens the sample project, to see a finished model first. */
  onOpenSample?: () => void;
}

export function AiModelPanel({ projectName, elements, run, onStart, onStop, onClose, onOpenSample }: Props) {
  const [found, setFound] = useState<Record<AgentKey, AgentFound> | null>(null);
  const [copied, setCopied] = useState(false);
  const api = desktopApi?.agent;
  useEffect(() => {
    if (api) void api.detect().then(setFound).catch(() => setFound(null));
  }, [api]);
  const prompt = AI_MODEL_PROMPT(projectName);
  const copy = () =>
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const tools = run.log.filter((e) => e.kind === 'tool').length;
  const last = [...run.log].reverse().find((e) => e.kind === 'text' || e.kind === 'result' || e.kind === 'done');
  const needsLogin = !!run.log.at(-1)?.login;
  // Signed out: one plain line says so; the raw errors would only repeat it.
  const errors = needsLogin ? [] : run.log.filter((e) => e.kind === 'error').slice(-3);

  return (
    <div className="ai3d" role="dialog" aria-label="Build 3D with AI">
      <header>
        <strong>Build 3D with AI</strong>
        <button className="ai3d-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      {run.running || run.log.length ? (
        <section>
          <p className="ai3d-status">
            {run.running ? <span className="ai3d-dot" /> : null}
            {run.running ? 'Building' : run.log.at(-1)?.ok ? 'Done' : needsLogin ? 'Not signed in' : 'Stopped'} · {elements.toLocaleString()} elements · {tools} steps
          </p>
          {last && <p className="ai3d-said">{last.text.slice(0, 600)}</p>}
          {errors.map((e, i) => (
            <p key={i} className="ai3d-err">
              {e.text}
            </p>
          ))}
          <ol className="ai3d-log">
            {run.log
              .filter((e) => e.kind === 'tool')
              .slice(-8)
              .map((e, i) => (
                <li key={i}>
                  {e.text.replace(/_/g, ' ')}
                  {e.detail ? <em> · {e.detail}</em> : null}
                </li>
              ))}
          </ol>
          {run.running ? (
            <button onClick={onStop}>Stop</button>
          ) : needsLogin && run.agent && api?.signIn ? (
            <div className="ai3d-row">
              <button className="primary" onClick={() => void api.signIn!(run.agent!).catch(() => undefined)}>
                Sign in
              </button>
              <button onClick={() => run.agent && onStart(run.agent)}>Build</button>
            </div>
          ) : (
            <button onClick={() => run.agent && onStart(run.agent)} disabled={!run.agent}>
              {elements ? 'Carry on building' : 'Build'}
            </button>
          )}
        </section>
      ) : (
        <section>
          <p>
            An AI reads the drawings and builds the model: walls, openings, roof, structure, interiors, services and the site, each with the sheet it came from. It runs on your own
            Claude or ChatGPT plan, through this app’s tools. The takeoff is never touched. A building takes 20–60 minutes.
          </p>
          {api && found ? (
            <div className="ai3d-agents">
              {(['claude', 'codex'] as AgentKey[]).map((k) => (
                <div key={k} className="ai3d-agent">
                  <div>
                    <b>{k === 'claude' ? 'Claude' : 'ChatGPT'}</b>
                    <span>
                      {found[k].label} · {found[k].plan}
                    </span>
                  </div>
                  {found[k].installed ? (
                    <button className="primary" onClick={() => onStart(k)}>
                      Build
                    </button>
                  ) : (
                    <details>
                      <summary>Set up</summary>
                      <p>Install {found[k].label} in Terminal, then run it once to sign in with your plan:</p>
                      <code>{found[k].install}</code>
                      <code>{k}</code>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {onOpenSample && (
            <p>
              <button className="link" onClick={onOpenSample}>
                See a finished example first
              </button>{' '}
              (a sample project with a model Claude built, and a short tour).
            </p>
          )}
          <details className="ai3d-manual" open={!api}>
            <summary>Or use Claude Desktop</summary>
            <p>With Takeoff AI connected (Connect AI → Add to Claude Desktop), paste this into a new chat:</p>
            <textarea readOnly value={prompt} rows={5} />
            <button onClick={copy}>{copied ? 'Copied' : 'Copy prompt'}</button>
          </details>
        </section>
      )}
    </div>
  );
}
