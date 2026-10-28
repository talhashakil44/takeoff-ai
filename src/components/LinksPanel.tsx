import { useMemo, useState } from 'react';
import type { Sheet } from '../model';
import { nameOf, type DrawingGraph, type Link, type Place } from '../graph/graph';
import { describe, entryName, indexStats, norm, searchEntries, TAG_KINDS, type Entry, type TagKind } from '../smart/index';
import { Icon } from './Icons';

export const kindColor = (k: TagKind) => TAG_KINDS.find((x) => x.kind === k)?.color ?? '#8e8e93';
const kindLabel = (k: TagKind) => ({ door: 'Door', window: 'Window', room: 'Room', wall: 'Wall type', finish: 'Finish', item: 'Equipment', sheet: 'Detail' })[k];

/** Something the search can go to: a sheet, a drawing on a sheet, a schedule, or a tag's definition. */
export interface Hit {
  label: string;
  sub: string;
  kind: 'sheet' | 'view' | 'schedule' | TagKind;
  to: Place[];
  entry?: Entry;
}

export function searchGraph(g: DrawingGraph, byKey: Map<string, Entry>, q: string, defs: (e: Entry) => Place[]): Hit[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out: [number, Hit][] = [];
  const n = norm(q);
  for (const sh of g.sheets) {
    const a = sh.name.toLowerCase();
    const score = a === s ? 0 : a.startsWith(s) ? 1 : s.length >= 3 && (sh.title ?? '').toLowerCase().includes(s) ? 3 : -1;
    if (score >= 0) out.push([score, { label: sh.name, sub: sh.title ?? 'Sheet', kind: 'sheet', to: [{ sheetId: sh.id, box: [0, 0, 1e6, 1e6] }] }]);
  }
  if (s.length >= 3)
    for (const [sid, vs] of Object.entries(g.views))
      for (const v of vs)
        if (v.title.toLowerCase().includes(s)) out.push([3, { label: `${v.number}/${nameOf(g, sid)}`, sub: v.title, kind: 'view', to: [{ sheetId: sid, box: v.box }] }]);
  if (s.length >= 3)
    for (const sc of g.index.schedules)
      if (sc.title.toLowerCase().includes(s)) out.push([2, { label: sc.title, sub: nameOf(g, sc.sheetId), kind: 'schedule', to: [{ sheetId: sc.sheetId, box: sc.box }] }]);
  for (const e of searchEntries(byKey, q, 10)) {
    const to = defs(e);
    if (!to.length && !g.index.places[e.key]?.length) continue;
    out.push([norm(e.code) === n ? 0 : 1.5, { label: e.code, sub: entryName(e) || kindLabel(e.kind), kind: e.kind, to: to.length ? to : g.index.places[e.key], entry: e }]);
  }
  return out
    .sort((a, b) => a[0] - b[0])
    .slice(0, 10)
    .map((x) => x[1]);
}

const hitColor = (k: Hit['kind']) => (k === 'sheet' || k === 'view' ? '#0071e3' : k === 'schedule' ? '#8a3fc6' : kindColor(k));

interface BarProps {
  graph: DrawingGraph;
  byKey: Map<string, Entry>;
  defs: (e: Entry) => Place[];
  onGo: (to: Place[], label: string, entry?: Entry) => void;
  onMap: () => void;
  onRebuild: () => void;
  onClose: () => void;
}

/** The links bar over the drawing: go to anything in the set, the map, what was read. */
export function LinksBar(p: BarProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(false);
  const hits = useMemo(() => searchGraph(p.graph, p.byKey, q, p.defs), [p.graph, p.byKey, q, p.defs]);
  const nLinks = useMemo(() => Object.values(p.graph.links).reduce((n, ls) => n + ls.filter((l) => l.kind !== 'definition').length, 0), [p.graph]);
  const stats = useMemo(() => indexStats(p.graph.index), [p.graph]);
  const go = (h: Hit) => {
    p.onGo(h.to, h.label, h.entry);
    setOpen(false);
    setQ('');
  };
  return (
    <>
      <div className="links-bar" role="toolbar" aria-label="Linked drawings">
        <span className="links-title">
          <Icon name="link" size={15} /> Links
        </span>
        <div className="smart-search">
          <Icon name="search" size={14} />
          <input
            value={q}
            placeholder="Go to a sheet, detail, schedule or tag: A5.0, P3, D101, door schedule"
            aria-label="Go to"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) go(hits[0]);
              if (e.key === 'Escape') setQ('');
            }}
          />
          {open && q && (
            <ul className="smart-results">
              {hits.length === 0 && <li className="muted">Nothing in the set called “{q}”</li>}
              {hits.map((h, i) => (
                <li key={i}>
                  <button onMouseDown={(ev) => ev.preventDefault()} onClick={() => go(h)}>
                    <span className="dot" style={{ background: hitColor(h.kind) }} />
                    <strong>{h.label}</strong>
                    <span className="name">{h.sub}</span>
                    {h.to.length > 1 && <span className="muted">{h.to.length} places</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="secondary small" onClick={p.onMap} title="The whole set as a map of what points to what">
          <Icon name="graph" size={14} /> Map
        </button>
        <button className="link-button" onClick={() => setSummary((v) => !v)} aria-expanded={summary}>
          {nLinks} links
        </button>
        <button className="icon-button small" onClick={p.onClose} aria-label="Turn links off" title="Turn links off">
          <Icon name="close" size={14} />
        </button>
      </div>
      {summary && (
        <div className="smart-summary">
          <div className="smart-card-head">
            <strong>Read from {p.graph.sheets.length} sheets</strong>
            <button className="icon-button small" onClick={() => setSummary(false)} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
          <table>
            <tbody>
              {TAG_KINDS.filter(({ kind }) => stats.has(kind)).map(({ kind, label, color }) => {
                const st = stats.get(kind)!;
                return (
                  <tr key={kind}>
                    <td>
                      <span className="dot" style={{ background: color }} /> {label}
                    </td>
                    <td className="num">{st.listed} listed</td>
                    <td className="num">{st.onPlans} tagged on plans</td>
                    <td className="missing">
                      {st.missing.slice(0, 8).map((c) => {
                        const e = p.byKey.get([...p.byKey.values()].find((x) => x.code === c)?.key ?? '');
                        return (
                          <button key={c} className="code-chip" title="Listed, but its tag is on no plan" onClick={() => e && p.onGo(p.defs(e), c, e)}>
                            {c}
                          </button>
                        );
                      })}
                      {st.missing.length > 8 && <span className="muted"> +{st.missing.length - 8}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h4>Schedules and legends</h4>
          <ul className="smart-sources">
            {p.graph.index.schedules.map((s, i) => (
              <li key={i}>
                <button className="link-button" onClick={() => p.onGo([{ sheetId: s.sheetId, box: s.box }], s.title)}>
                  {nameOf(p.graph, s.sheetId)}
                </button>{' '}
                {s.title} <span className="muted">· {s.rows.length} rows</span>
              </li>
            ))}
            {[...new Set(p.graph.index.legends.map((l) => l.sheetId))].map((id) => (
              <li key={id}>
                <button className="link-button" onClick={() => p.onGo([{ sheetId: id, box: [0, 0, 1e6, 1e6] }], nameOf(p.graph, id))}>
                  {nameOf(p.graph, id)}
                </button>{' '}
                Type legends <span className="muted">· {p.graph.index.legends.filter((l) => l.sheetId === id).map((l) => l.code).join(', ')}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Everything is read from the drawings’ own text. A scanned set has no text to read.</p>
          <button className="secondary small" onClick={p.onRebuild}>
            Read the set again
          </button>
        </div>
      )}
    </>
  );
}

interface FollowProps {
  graph: DrawingGraph;
  /** Where the last link went: its places and which one is shown. */
  trail: { label: string; to: Place[]; i: number; entry?: Entry };
  onStep: (i: number) => void;
  onDetails?: () => void;
  onClose: () => void;
}

/** Where a link went, at the foot of the drawing: one place, or each of many in turn. */
export function FollowBar({ graph, trail, onStep, onDetails, onClose }: FollowProps) {
  const here = trail.to[trail.i];
  return (
    <div className="follow-bar" role="status">
      <span className="follow-label">
        <strong>{trail.label}</strong>
        <span className="muted"> → {here?.label ?? nameOf(graph, here?.sheetId ?? '')}</span>
      </span>
      {trail.to.length > 1 && (
        <span className="follow-steps">
          <button className="icon-button small" onClick={() => onStep((trail.i - 1 + trail.to.length) % trail.to.length)} aria-label="Previous" title="Previous">
            <Icon name="chevron" size={14} className="flip" />
          </button>
          <span className="num">
            {trail.i + 1} of {trail.to.length}
          </span>
          <button className="icon-button small" onClick={() => onStep((trail.i + 1) % trail.to.length)} aria-label="Next" title="Next">
            <Icon name="chevron" size={14} />
          </button>
        </span>
      )}
      {onDetails && (
        <button className="secondary small" onClick={onDetails}>
          Details
        </button>
      )}
      <button className="icon-button small" onClick={onClose} aria-label="Close" title="Close">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

interface CardProps {
  graph: DrawingGraph;
  dict: Map<string, Entry>;
  sheets: Sheet[];
  entry: Entry;
  onPick: (e: Entry) => void;
  onGo: (to: Place[], label: string, entry?: Entry) => void;
  onClose: () => void;
}

/** What the drawings say about a tag: its schedule row and legend in plain words, and where it is. */
export function TagCard({ graph, dict, sheets, entry, onPick, onGo, onClose }: CardProps) {
  const info = describe(entry, graph.index, sheets, dict);
  const where = Object.entries(graph.index.where[entry.key] ?? {});
  return (
    <aside className="smart-card" aria-label={`${kindLabel(info.kind)} ${info.code}`}>
      <div className="smart-card-head">
        <span className="kind-pill" style={{ ['--tag' as string]: kindColor(info.kind) }}>
          {kindLabel(info.kind)}
        </span>
        <button className="icon-button small" onClick={onClose} aria-label="Close" title="Close">
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
                        {linkify(line, dict, onPick)}
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
          <p className="muted small">Its tag is on no plan.</p>
        ) : (
          <div className="where">
            {where.map(([id, n]) => (
              <button
                key={id}
                className="code-chip"
                onClick={() => {
                  const places = (graph.index.places[entry.key] ?? []).filter((p) => p.sheetId === id).map((p) => ({ ...p, label: `${entry.code} on ${nameOf(graph, id)}` }));
                  onGo(places, entry.code, entry);
                }}
              >
                {nameOf(graph, id)}
                {n > 1 && <span className="muted"> ×{n}</span>}
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

/** A value with the codes in it that the drawings explain made clickable (D013.1, ACT 1, SC1). */
function linkify(text: string, dict: Map<string, Entry>, pick: (e: Entry) => void) {
  const parts = text.split(/(\b[A-Z]{1,5}[-\s]?\d{1,4}(?:\.\d{1,2})?[A-Z]?\b)/g);
  return parts.map((part, i) => {
    const e = i % 2 === 1 ? dict.get(norm(part)) : undefined;
    if (!e) return <span key={i}>{part}</span>;
    return (
      <button key={i} className="inline-link" style={{ ['--tag' as string]: kindColor(e.kind) }} onClick={() => pick(e)}>
        {part}
      </button>
    );
  });
}

/** How a link is drawn on the sheet and named on hover. */
export function linkTitle(l: Link, g: DrawingGraph): string {
  const p = l.to[0];
  const where = p?.label ?? (p ? nameOf(g, p.sheetId) : '');
  switch (l.kind) {
    case 'definition':
      return `${l.label}: tagged in ${l.to.length} place${l.to.length === 1 ? '' : 's'}`;
    case 'view':
      return `${l.label}: called out from ${l.to.length} place${l.to.length === 1 ? '' : 's'}`;
    default:
      return l.to.length > 1 ? `${l.label} → ${l.to.length} places` : `${l.label} → ${where}`;
  }
}
