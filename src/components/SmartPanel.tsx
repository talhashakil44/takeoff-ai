import { useMemo, useState } from 'react';
import type { Sheet } from '../model';
import { describe, entryName, indexStats, norm, searchEntries, TAG_KINDS, type DrawingIndex, type Entry, type SmartTag, type TagKind } from '../smart/index';
import { Icon } from './Icons';

export const kindColor = (k: TagKind) => TAG_KINDS.find((x) => x.kind === k)?.color ?? '#8e8e93';
const kindLabel = (k: TagKind) => ({ door: 'Door', window: 'Window', room: 'Room', wall: 'Wall type', finish: 'Finish', item: 'Equipment', sheet: 'Detail' })[k];

interface Props {
  index: DrawingIndex;
  dict: Map<string, Entry>;
  byKey: Map<string, Entry>;
  sheets: Sheet[];
  sheet: Sheet | null;
  /** The open sheet's tags, before the kind filter. */
  tags: SmartTag[];
  kinds: Set<TagKind>;
  onKinds: (k: Set<TagKind>) => void;
  query: string;
  onQuery: (q: string) => void;
  picked: Entry | null;
  onPick: (e: Entry | null) => void;
  onOpenSheet: (id: string, key?: string) => void;
  onRebuild: () => void;
  onClose: () => void;
}

/** Smart view's bar over the drawing (filters, search, what was read) and the card for the tag clicked. */
export function SmartPanel(p: Props) {
  const [showSummary, setShowSummary] = useState(false);
  const [focused, setFocused] = useState(false);
  const counts = useMemo(() => {
    const c = new Map<TagKind, number>();
    for (const t of p.tags) c.set(t.kind, (c.get(t.kind) ?? 0) + 1);
    return c;
  }, [p.tags]);
  const stats = useMemo(() => indexStats(p.index, p.dict), [p.index, p.dict]);
  const results = useMemo(() => searchEntries(p.byKey, p.query), [p.byKey, p.query]);
  const sheetName = (id: string) => p.sheets.find((s) => s.id === id)?.name ?? '?';
  const info = p.picked ? describe(p.picked, p.index, p.sheets, p.dict) : null;
  const where = p.picked ? Object.entries(p.index.where[p.picked.key] ?? {}) : [];
  const found = p.index.schedules.length + p.index.legends.length;

  const toggle = (k: TagKind) => {
    const next = new Set(p.kinds);
    // A click on the only kind shown shows them all again; otherwise it shows that kind alone.
    if (next.size === 1 && next.has(k)) p.onKinds(new Set(TAG_KINDS.map((x) => x.kind)));
    else p.onKinds(new Set([k]));
  };

  return (
    <>
      <div className="smart-bar" role="toolbar" aria-label="Smart view">
        <span className="smart-title">
          <Icon name="tag" size={15} /> Smart view
        </span>
        <div className="smart-chips">
          {TAG_KINDS.map(({ kind, label, color }) => {
            const n = counts.get(kind) ?? 0;
            const on = p.kinds.has(kind);
            return (
              <button key={kind} className={`smart-chip ${on ? 'on' : ''}`} style={{ ['--tag' as string]: color }} onClick={() => toggle(kind)} title={on && p.kinds.size === 1 ? 'Show every kind' : `Show only ${label.toLowerCase()}`} disabled={!n && !on}>
                <span className="dot" />
                {label}
                <span className="n">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="smart-search">
          <Icon name="search" size={14} />
          <input
            value={p.query}
            placeholder="Find a tag: P3, D101, 105, lounge"
            aria-label="Find a tag"
            onChange={(e) => p.onQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                p.onPick(results[0]);
                setFocused(false);
              }
              if (e.key === 'Escape') p.onQuery('');
            }}
          />
          {focused && p.query && (
            <ul className="smart-results">
              {results.length === 0 && <li className="muted">Nothing on the drawings called “{p.query}”</li>}
              {results.map((e) => {
                const on = Object.values(p.index.where[e.key] ?? {}).reduce((a, b) => a + b, 0);
                return (
                  <li key={e.key}>
                    <button
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        p.onPick(e);
                        setFocused(false);
                      }}
                    >
                      <span className="dot" style={{ background: kindColor(e.kind) }} />
                      <strong>{e.code}</strong>
                      <span className="name">{entryName(e)}</span>
                      <span className="muted">{on ? `${on} on plans` : kindLabel(e.kind)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button className="link-button" onClick={() => setShowSummary((v) => !v)} aria-expanded={showSummary} title="What was read from the set">
          {found} schedules &amp; legends
        </button>
        <button className="icon-button small" onClick={p.onClose} aria-label="Close Smart view" title="Close Smart view">
          <Icon name="close" size={14} />
        </button>
      </div>

      {showSummary && (
        <div className="smart-summary">
          <div className="smart-card-head">
            <strong>Read from {p.index.sheets} sheets</strong>
            <button className="icon-button small" onClick={() => setShowSummary(false)} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
          <table>
            <tbody>
              {TAG_KINDS.filter(({ kind }) => stats.has(kind)).map(({ kind, label, color }) => {
                const s = stats.get(kind)!;
                return (
                  <tr key={kind}>
                    <td>
                      <span className="dot" style={{ background: color }} /> {label}
                    </td>
                    <td className="num">{s.listed} listed</td>
                    <td className="num">{s.onPlans} on plans</td>
                    <td className="missing">
                      {s.missing.slice(0, 8).map((c) => (
                        <button key={c} className="code-chip" onClick={() => p.onPick(p.dict.get(norm(c)) ?? null)} title="Listed, but its tag was not found on a plan">
                          {c}
                        </button>
                      ))}
                      {s.missing.length > 8 && <span className="muted"> +{s.missing.length - 8}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h4>Schedules and legends</h4>
          <ul className="smart-sources">
            {p.index.schedules.map((s, i) => (
              <li key={`s${i}`}>
                <button className="link-button" onClick={() => p.onOpenSheet(s.sheetId)}>
                  {sheetName(s.sheetId)}
                </button>{' '}
                {s.title} <span className="muted">· {s.rows.length} rows</span>
              </li>
            ))}
            {[...new Set(p.index.legends.map((l) => l.sheetId))].map((id) => (
              <li key={id}>
                <button className="link-button" onClick={() => p.onOpenSheet(id)}>
                  {sheetName(id)}
                </button>{' '}
                Type legends <span className="muted">· {p.index.legends.filter((l) => l.sheetId === id).map((l) => l.code).join(', ')}</span>
              </li>
            ))}
            {Object.keys(p.index.abbreviations).length > 0 && <li>Abbreviations · {Object.keys(p.index.abbreviations).length}</li>}
          </ul>
          <p className="muted small">Everything here is read from the drawings’ own text. A scanned set has no text to read.</p>
          <button className="secondary small" onClick={p.onRebuild}>
            Read the set again
          </button>
        </div>
      )}

      {info && p.picked && (
        <aside className="smart-card" aria-label={`${kindLabel(info.kind)} ${info.code}`}>
          <div className="smart-card-head">
            <span className="kind-pill" style={{ ['--tag' as string]: kindColor(info.kind) }}>
              {kindLabel(info.kind)}
            </span>
            <button className="icon-button small" onClick={() => p.onPick(null)} aria-label="Close" title="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
          <h3>{info.title}</h3>
          <p className="source">{info.source}</p>
          {info.sections
            .filter((s) => s.title !== 'On the drawings')
            .map((s, i) => (
              <section key={i}>
                {s.title && <h4>{s.title}</h4>}
                <dl>
                  {s.rows.map((r, j) => (
                    <div key={j} className="row">
                      <dt>{r.label}</dt>
                      <dd>
                        {r.value.split('\n').map((line, k) => (
                          <span key={k} className="line">
                            {linkify(line, p.dict, (e) => p.onPick(e), r.link)}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          <section>
            <h4>On the drawings</h4>
            {where.length === 0 ? (
              <p className="muted small">Its tag was not found on a plan.</p>
            ) : (
              <div className="where">
                {where.map(([id, n]) => (
                  <button key={id} className={`code-chip ${id === p.sheet?.id ? 'here' : ''}`} onClick={() => p.onOpenSheet(id, p.picked!.key)}>
                    {sheetName(id)}
                    {n > 1 && <span className="muted"> ×{n}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      )}
    </>
  );
}

/** A value with the codes in it that the drawings explain made clickable (D013.1, ACT 1, SC1). */
function linkify(text: string, dict: Map<string, Entry>, pick: (e: Entry) => void, link?: string) {
  const parts = text.split(/(\b[A-Z]{1,5}[-\s]?\d{1,4}(?:\.\d{1,2})?[A-Z]?\b)/g);
  return parts.map((part, i) => {
    const e = i % 2 === 1 || (link && part === link) ? dict.get(norm(part)) : undefined;
    if (!e || !/[A-Z]/i.test(part)) return <span key={i}>{part}</span>;
    return (
      <button key={i} className="inline-link" style={{ ['--tag' as string]: kindColor(e.kind) }} onClick={() => pick(e)}>
        {part}
      </button>
    );
  });
}
