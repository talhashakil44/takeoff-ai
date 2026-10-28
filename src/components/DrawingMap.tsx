import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { linkRows, nameOf, sheetEdges, type DrawingGraph, type LinkKind, type Place } from '../graph/graph';
import { Icon } from './Icons';

/**
 * The drawing set as a map: each sheet a node, grouped by trade, each line the references
 * between two sheets (detail bubbles, SEE notes, schedules, tags and the rows that define them).
 * Beside it, the same links as a table. Click a sheet to open it; click a row to go there.
 */

interface Node extends SimulationNodeDatum {
  id: string;
  name: string;
  title: string;
  trade: string;
  degree: number;
}
interface Edge extends SimulationLinkDatum<Node> {
  n: number;
  kinds: Set<LinkKind>;
}

const TRADES: Record<string, [string, string]> = {
  A: ['Architectural', '#0a84ff'],
  ID: ['Interiors', '#5e5ce6'],
  S: ['Structural', '#ff9f0a'],
  M: ['Mechanical', '#30d158'],
  P: ['Plumbing', '#64d2ff'],
  E: ['Electrical', '#ffd60a'],
  FP: ['Fire protection', '#ff375f'],
  F: ['Fire', '#ff375f'],
  C: ['Civil', '#ac8e68'],
  SP: ['Site', '#a2845e'],
  L: ['Landscape', '#30b0c7'],
};
/** A sheet's trade by its number's letters (SP1 site, S1.0 structural); numbered-only sheets by their series (400s, 800s). */
const tradeOf = (name: string) => {
  const letters = (/^[A-Z]+/i.exec(name)?.[0] ?? '').toUpperCase();
  if (letters) return TRADES[letters] ? letters : letters.charAt(0);
  const d = /^\d/.exec(name)?.[0];
  return d ? `${d}00s` : '#';
};
const colorOf = (t: string) => TRADES[t]?.[1] ?? '#8e8e93';
const tradeName = (t: string) => TRADES[t]?.[0] ?? (t === '#' ? 'Other' : t);
const KIND_LABEL: Record<LinkKind, string> = { callout: 'Detail bubble', sheet: 'Sheet reference', schedule: 'Schedule reference', tag: 'Tag → definition', definition: 'Definition', view: 'Drawing title' };

interface Props {
  graph: DrawingGraph;
  currentSheet: string | null;
  onOpenSheet: (id: string) => void;
  onGo: (to: Place[], label: string) => void;
  onClose: () => void;
}

export function DrawingMap({ graph, currentSheet, onOpenSheet, onGo, onClose }: Props) {
  const [tab, setTab] = useState<'map' | 'table'>('map');
  const [hover, setHover] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [kinds, setKinds] = useState<Set<LinkKind>>(new Set(['callout', 'sheet', 'schedule']));
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const { nodes, edges, trades } = useMemo(() => {
    const raw = sheetEdges(graph).filter((e) => [...e.kinds].some((k) => kinds.has(k)));
    const deg = new Map<string, number>();
    for (const e of raw) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + e.n);
      deg.set(e.to, (deg.get(e.to) ?? 0) + e.n);
    }
    const trades = [...new Set(graph.sheets.map((s) => tradeOf(s.name)))];
    const nodes: Node[] = graph.sheets.map((s) => ({ id: s.id, name: s.name, title: s.title ?? '', trade: tradeOf(s.name), degree: deg.get(s.id) ?? 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: Edge[] = raw.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ source: byId.get(e.from)!, target: byId.get(e.to)!, n: e.n, kinds: e.kinds }));
    // Each trade in its own band, left to right; linked sheets pulled together.
    const W = 1000;
    const H = 640;
    const sim = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(-120))
      .force('link', forceLink<Node, Edge>(edges).distance(90).strength((l) => Math.min(0.3, 0.03 + 0.02 * l.n)))
      .force('x', forceX<Node>((d) => ((trades.indexOf(d.trade) + 0.5) / trades.length) * W).strength(0.7))
      .force('y', forceY(H / 2 + 20).strength(0.08))
      .force('collide', forceCollide<Node>((d) => radius(d) + 6))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    return { nodes, edges, trades };
  }, [graph, kinds]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return linkRows(graph).filter((r) => kinds.has(r.kind) && (!f || `${nameOf(graph, r.from)} ${r.label} ${r.to}`.toLowerCase().includes(f)));
  }, [graph, filter, kinds]);

  const linked = useMemo(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const e of edges) {
      const a = (e.source as Node).id;
      const b = (e.target as Node).id;
      if (a === hover) s.add(b);
      if (b === hover) s.add(a);
    }
    return s;
  }, [hover, edges]);
  const hoverNode = hover ? nodes.find((n) => n.id === hover) : null;
  const toggle = (k: LinkKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  };

  return (
    <div className="map-overlay" role="dialog" aria-label="Drawing map">
      <div className="map-head">
        <strong>
          <Icon name="graph" size={16} /> Drawing map
        </strong>
        <div className="segmented small" role="tablist">
          <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')} role="tab" aria-selected={tab === 'map'}>
            Map
          </button>
          <button className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')} role="tab" aria-selected={tab === 'table'}>
            Table
          </button>
        </div>
        <div className="map-kinds">
          {(['callout', 'sheet', 'schedule', 'tag'] as LinkKind[]).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} /> {KIND_LABEL[k]}
            </label>
          ))}
        </div>
        <button className="icon-button small" onClick={onClose} aria-label="Close the map" title="Close">
          <Icon name="close" size={14} />
        </button>
      </div>
      {tab === 'map' ? (
        <div className="map-body">
          <svg
            viewBox="0 0 1000 640"
            preserveAspectRatio="xMidYMid meet"
            onWheel={(e: WheelEvent<SVGSVGElement>) => {
              const k = Math.min(6, Math.max(0.4, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
              setView({ ...view, k });
            }}
            onPointerDown={(e: PointerEvent<SVGSVGElement>) => {
              drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            }}
            onPointerMove={(e: PointerEvent<SVGSVGElement>) => {
              const d = drag.current;
              if (d) setView({ ...view, x: d.vx + (e.clientX - d.x) / view.k, y: d.vy + (e.clientY - d.y) / view.k });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            <g transform={`translate(500 320) scale(${view.k}) translate(${-500 + view.x} ${-320 + view.y})`}>
              {trades.map((t, i) => (
                <text key={t} x={((i + 0.5) / trades.length) * 1000} y={24} className="map-trade" textAnchor="middle" fill={colorOf(t)}>
                  {tradeName(t)}
                </text>
              ))}
              {edges.map((e, i) => {
                const a = e.source as Node;
                const b = e.target as Node;
                const on = !linked || (linked.has(a.id) && linked.has(b.id) && (a.id === hover || b.id === hover));
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`map-edge ${on ? '' : 'dim'}`} strokeWidth={Math.min(6, 0.8 + Math.log2(1 + e.n))} />;
              })}
              {nodes.map((n) => {
                const on = !linked || linked.has(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x} ${n.y})`}
                    className={`map-node ${on ? '' : 'dim'} ${n.id === currentSheet ? 'here' : ''}`}
                    onPointerEnter={() => setHover(n.id)}
                    onPointerLeave={() => setHover(null)}
                    onClick={() => onOpenSheet(n.id)}
                  >
                    <circle r={radius(n)} fill={colorOf(n.trade)} />
                    <text y={radius(n) + 11} textAnchor="middle">
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          {hoverNode && (
            <div className="map-tip">
              <strong>{hoverNode.name}</strong> {hoverNode.title}
              <div className="muted">
                {hoverNode.degree} link{hoverNode.degree === 1 ? '' : 's'} · {(linked?.size ?? 1) - 1} sheet{(linked?.size ?? 1) - 1 === 1 ? '' : 's'} connected · click to open
              </div>
            </div>
          )}
          <p className="map-help muted">Scroll to zoom, drag to move. Each line is the references between two sheets; thicker is more.</p>
        </div>
      ) : (
        <div className="map-table">
          <div className="smart-search map-filter">
            <Icon name="search" size={14} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: A5.0, schedule, P3" aria-label="Filter the links" />
            <span className="muted">{rows.length} links</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>On sheet</th>
                <th>Says</th>
                <th>Goes to</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 1500).map((r, i) => (
                <tr key={i}>
                  <td>
                    <button className="link-button" onClick={() => onGo([{ sheetId: r.from, box: r.at, label: `${r.label} on ${nameOf(graph, r.from)}` }], r.label)}>
                      {nameOf(graph, r.from)}
                    </button>
                  </td>
                  <td>{r.label}</td>
                  <td>
                    <button className="link-button" onClick={() => onGo([r.place], r.label)}>
                      {r.to}
                    </button>
                  </td>
                  <td className="muted">{KIND_LABEL[r.kind]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 1500 && <p className="muted small">Showing the first 1,500. Filter to narrow it down.</p>}
        </div>
      )}
    </div>
  );
}

const radius = (n: Node) => 5 + Math.min(14, Math.sqrt(n.degree) * 1.6);
