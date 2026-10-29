import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from '../graph/graph';
import type { MapEdge, MapEdgeKind, MapNode, ProjectMap as MapData } from '../spec/links';
import { DIVISIONS, shortGroupName, TRADES } from '../spec/names';
import { buildMeaning, type Meaning } from '../spec/meaning';
import { embedAll, getEmbeddingsKey, PROVIDER_NAME, providerOf, textOf } from '../ai/embed';
import { Icon } from './Icons';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/500.css';

/** The map's type: a geometric grotesk, set in capitals, spaced. */
const FONT = '"Space Grotesk", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif';
const ADD_COLOR = '#ff5fa2';

/**
 * The project map: the specification on the left, the drawings on the right, every link between
 * them drawn across the middle. Sections cluster by division, drawing elements by trade; a link
 * the documents write (08100 names the door schedule) is solid, one matched by subject (EF-1 and
 * PACKAGED EXHAUSTERS) dashed. Hover to trace a node's links, click for what it is and where to
 * go: the section in the spec, the schedule row on its sheet.
 */

/** A division's colour: the colour of the trade that draws it, so a link reads end to end. */
function specColor(div: string): string {
  if (div === 'AD') return ADD_COLOR;
  const n = parseInt(div, 10);
  if (n <= 1) return '#c7cbd6';
  if (n === 2 || n >= 31) return '#c8a27a';
  if (n >= 3 && n <= 5) return ['#ffb340', '#ff9f43', '#ffc861'][n - 3];
  if (n >= 6 && n <= 14) return ['#6cb6ff', '#4da3ff', '#3d8bff', '#7aa7ff', '#8f9bff', '#9d8cff', '#7f7cff', '#a58bff', '#6f86ff'][n - 6];
  if (n >= 21 && n <= 23) return ['#ff6b6b', '#4fd1ff', '#3ddc84'][n - 21];
  if (n >= 25 && n <= 28) return ['#c0f05a', '#ffd60a', '#ffe066', '#ffcc33'][n - 25];
  return '#c7cbd6';
}
const TRADE_COLORS: Record<string, string> = { A: '#4da3ff', S: '#ffb340', M: '#3ddc84', P: '#4fd1ff', E: '#ffd60a', FP: '#ff6b6b', F: '#ff6b6b', C: '#c8a27a', SP: '#c8a27a', L: '#6fe3c5', ID: '#9d8cff', '#': '#c7cbd6' };
const colorOf = (n: MapNode) => (n.side === 'spec' ? specColor(n.group) : (TRADE_COLORS[n.group] ?? '#c7cbd6'));
const groupName = (n: MapNode) => (n.group === 'AD' ? 'Addenda' : n.side === 'spec' ? `Division ${n.group} · ${DIVISIONS[n.group] ?? ''}` : (TRADES[n.group] ?? n.group));
const KIND_NAME: Record<MapNode['kind'], string> = { section: 'Spec section', sheet: 'Sheet', schedule: 'Schedule', type: 'Type legend', finish: 'Finish', item: 'Equipment', addendum: 'Addendum' };
const EDGE_COLOR: Record<MapEdgeKind, string> = { written: '#7cc4ff', matched: '#c58cff', 'spec-spec': '#8a93b5', contains: '#3a4566', revises: ADD_COLOR };
/** Capitals for every label: one case, whatever case the documents used. */
const up = (s: string) => s.toUpperCase();

interface SimNode extends SimulationNodeDatum, MapNode {
  r: number;
  degree: number;
  color: string;
}
interface SimEdge extends SimulationLinkDatum<SimNode>, Omit<MapEdge, 'a' | 'b'> {
  a: string;
  b: string;
}

interface Props {
  data: MapData;
  /** A node to open on: picked and flown to once the layout settles. */
  focus?: { id: string; n: number } | null;
  onOpenSpec: (docId: string, page: number, sectionKey: string) => void;
  onOpenDrawing: (places: Place[], label: string) => void;
  onClose: () => void;
  /** Opens AI settings (for the embeddings key). */
  onAiSettings?: () => void;
}

export function ProjectMap({ data, focus, onOpenSpec, onOpenDrawing, onClose, onAiSettings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [show, setShow] = useState<Record<MapEdgeKind | 'items', boolean>>({ written: true, matched: true, 'spec-spec': false, contains: true, revises: true, items: true });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [gaps, setGaps] = useState(false);
  const view = useRef({ x: 0, y: 0, k: 0.62 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; node?: SimNode } | null>(null);

  // The graph, as the simulation and the drawing use it.
  const { nodes, edges, byId, neighbours, rankIn } = useMemo(() => {
    const visible = data.nodes.filter((n) => show.items || !(n.kind === 'item' || n.kind === 'finish' || n.kind === 'type'));
    const ids = new Set(visible.map((n) => n.id));
    const es = data.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
    const deg = new Map<string, number>();
    for (const e of es) if (e.kind !== 'contains') for (const id of [e.a, e.b]) deg.set(id, (deg.get(id) ?? 0) + 1);
    const nodes: SimNode[] = visible.map((n) => {
      const d = deg.get(n.id) ?? 0;
      const base = n.kind === 'addendum' ? 6 : n.kind === 'section' ? 4 : n.kind === 'schedule' ? 5 : n.kind === 'sheet' ? 3.5 : 3;
      return { ...n, degree: d, r: base + Math.min(10, Math.sqrt(d) * 1.7), color: colorOf(n) };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: SimEdge[] = es.map((e) => ({ ...e, source: byId.get(e.a)!, target: byId.get(e.b)! }));
    const neighbours = new Map<string, Set<string>>();
    for (const e of es) {
      if (!neighbours.has(e.a)) neighbours.set(e.a, new Set());
      if (!neighbours.has(e.b)) neighbours.set(e.b, new Set());
      neighbours.get(e.a)!.add(e.b);
      neighbours.get(e.b)!.add(e.a);
    }
    // Each node's place in its cluster by how linked it is: the first few are named when zoomed out.
    const rankIn = new Map<string, number>();
    const byGroup = new Map<string, SimNode[]>();
    for (const n of nodes) byGroup.set(`${n.side}:${n.group}`, [...(byGroup.get(`${n.side}:${n.group}`) ?? []), n]);
    for (const list of byGroup.values()) list.sort((a, b) => b.degree - a.degree || (a.kind === 'schedule' ? -1 : 1)).forEach((n, i) => rankIn.set(n.id, i));
    return { nodes, edges, byId, neighbours, rankIn };
  }, [data, show.items]);

  // Where each cluster sits: divisions down an arc on the left, trades down an arc on the right.
  const anchors = useMemo(() => {
    const out = new Map<string, { x: number; y: number; label: string; color: string }>();
    // Clusters down an arc on each side, each given room for its size so none overlaps the next.
    const size = new Map<string, number>();
    for (const n of nodes) size.set(`${n.side === 'spec' ? -1 : 1}:${n.group}`, (size.get(`${n.side === 'spec' ? -1 : 1}:${n.group}`) ?? 0) + 1);
    const place = (keys: string[], side: -1 | 1, label: (k: string) => string, color: (k: string) => string) => {
      const rad = keys.map((k) => 34 + 15 * Math.sqrt(size.get(`${side}:${k}`) ?? 1));
      const gap = 64;
      const total = rad.reduce((a, r) => a + 2 * r, 0) + gap * Math.max(0, keys.length - 1);
      const arc = Math.max(520, total / 2 / Math.sin((68 * Math.PI) / 180));
      let y = -total / 2;
      keys.forEach((k, i) => {
        y += rad[i];
        const th = Math.asin(Math.max(-0.99, Math.min(0.99, y / arc)));
        out.set(`${side}:${k}`, { x: side * (300 + arc * 0.8 * Math.cos(th)), y, label: label(k), color: color(k) });
        y += rad[i] + gap;
      });
    };
    const divs = [...new Set(nodes.filter((n) => n.side === 'spec').map((n) => n.group))].sort((a, b) => (a === 'AD' ? -1 : b === 'AD' ? 1 : a.localeCompare(b)));
    const trades = [...new Set(nodes.filter((n) => n.side === 'drawing').map((n) => n.group))].sort((a, b) => 'SP A ID S M P FP E C L #'.indexOf(a) - 'SP A ID S M P FP E C L #'.indexOf(b));
    place(divs, -1, (k) => (k === 'AD' ? 'Addenda' : `${k} — ${DIVISIONS[k] ?? 'Division'}`), specColor);
    place(trades, 1, (k) => TRADES[k] ?? k, (k) => TRADE_COLORS[k] ?? '#c7cbd6');
    return out;
  }, [nodes]);
  // The whole map in view to start with, arrived at from far out: the documents as a galaxy.
  const fitted = useRef(false);
  const fitView = () => {
    const r = wrapRef.current!.getBoundingClientRect();
    const as = [...anchors.values()];
    const x0 = Math.min(...as.map((a) => a.x)) - 380;
    const x1 = Math.max(...as.map((a) => a.x)) + 300;
    const y0 = Math.min(...as.map((a) => a.y)) - 230;
    const y1 = Math.max(...as.map((a) => a.y)) + 120;
    const k = Math.min(1.2, r.width / (x1 - x0), (r.height - 150) / (y1 - y0));
    return { k, x: -(x0 + x1) / 2, y: -(y0 + y1) / 2 + 5 / k };
  };
  /** Moves the view to `to`, eased. */
  const glide = (to: { x: number; y: number; k: number }, ms = 500) => {
    const from = { ...view.current };
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k * Math.pow(to.k / from.k, e) };
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const zoomBy = (f: number) => {
    const v = view.current;
    glide({ ...v, k: Math.min(5, Math.max(0.12, v.k * f)) }, 260);
  };
  useEffect(() => {
    if (fitted.current || !wrapRef.current || !anchors.size) return;
    const r = wrapRef.current.getBoundingClientRect();
    const as = [...anchors.values()];
    const x0 = Math.min(...as.map((a) => a.x)) - 380;
    const x1 = Math.max(...as.map((a) => a.x)) + 300;
    const y0 = Math.min(...as.map((a) => a.y)) - 230;
    const y1 = Math.max(...as.map((a) => a.y)) + 120;
    const k = Math.min(1.2, r.width / (x1 - x0), (r.height - 150) / (y1 - y0));
    const to = { k, x: -(x0 + x1) / 2, y: -(y0 + y1) / 2 + 5 / k };
    fitted.current = true;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1800);
      const e = 1 - Math.pow(1 - p, 4);
      view.current = { x: to.x, y: to.y, k: to.k * (0.08 + 0.92 * e) };
      if (p < 1) requestAnimationFrame(step);
    };
    view.current = { ...to, k: to.k * 0.08 };
    requestAnimationFrame(step);
  }, [anchors]);
  /** Where each node is drawn this frame (its cluster sways slowly), for the pointer to find it. */
  const shown = useRef(new Map<string, { x: number; y: number }>());
  const born = useRef(performance.now());
  /** The picked node's links as drawn this frame, so a click on one goes to its other end. */
  const edgeHits = useRef<{ other: string; a: { x: number; y: number }; c: { x: number; y: number }; b: { x: number; y: number } }[]>([]);
  const hoverEdge = useRef<{ other: string; x: number; y: number } | null>(null);
  const anchorOf = (n: SimNode) => anchors.get(`${n.side === 'spec' ? -1 : 1}:${n.group}`) ?? { x: 0, y: 0 };

  // The layout, settling live.
  const sim = useRef<Simulation<SimNode, SimEdge> | null>(null);
  useEffect(() => {
    for (const n of nodes) {
      const a = anchorOf(n);
      n.x ??= a.x + (Math.random() - 0.5) * 60;
      n.y ??= a.y + (Math.random() - 0.5) * 60;
    }
    const s = forceSimulation(nodes)
      .force('charge', forceManyBody<SimNode>().strength((n) => -18 - n.r * 3))
      .force('link', forceLink<SimNode, SimEdge>(edges).strength((e) => (e.kind === 'contains' ? 0.25 : e.kind === 'spec-spec' ? 0.01 : 0.012)).distance((e) => (e.kind === 'contains' ? 26 : 200)))
      .force('x', forceX<SimNode>((n) => anchorOf(n).x).strength(0.16))
      .force('y', forceY<SimNode>((n) => anchorOf(n).y).strength(0.16))
      .force('collide', forceCollide<SimNode>((n) => n.r + 4.5))
      .alphaDecay(0.03);
    sim.current = s;
    return () => {
      s.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, anchors]);

  // Drawing: every frame while the layout settles or links flow, else on change.
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const selRef = useRef(selected);
  selRef.current = selected;
  const queryRef = useRef(query);
  queryRef.current = query;
  const showRef = useRef(show);
  showRef.current = show;
  // A sky to set it in: stars at three depths, drifting slower than the map as it pans.
  const stars = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 1100 }, () => ({ x: (rnd() - 0.5) * 6000, y: (rnd() - 0.5) * 4000, z: 0.15 + rnd() * 0.5, r: 0.3 + rnd() * 1.1, p: rnd() * Math.PI * 2, s: 0.4 + rnd() * 1.6, c: rnd() < 0.15 ? '#ffd9b0' : rnd() < 0.3 ? '#b9d4ff' : '#ffffff' }));
  }, []);
  useEffect(() => {
    if (mode !== '2d') return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    const spaced = (px: number) => {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
    };
    const frame = (time: number) => {
      const focus = hoverRef.current ?? selRef.current;
      const near = focus ? (neighbours.get(focus) ?? new Set<string>()) : null;
      const q = queryRef.current.trim().toLowerCase();
      const found = q ? new Set(nodes.filter((n) => `${n.label} ${n.sub}`.toLowerCase().includes(q)).map((n) => n.id)) : null;
      const lit = (id: string) => (!focus || id === focus || near!.has(id)) && (!found || found.has(id) || id === focus);
      const v = view.current;
      const intro = Math.min(1, (time - born.current) / 1400);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      // Deep space.
      const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h / 2, Math.max(w, h) * 0.8);
      g.addColorStop(0, '#0b1226');
      g.addColorStop(0.55, '#050915');
      g.addColorStop(1, '#020309');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Stars, twinkling, each layer moving with the map at its own depth.
      for (const st of stars) {
        const sx = w / 2 + (st.x + v.x * st.z) * Math.min(1, 0.35 + v.k * st.z);
        const sy = h / 2 + (st.y + v.y * st.z) * Math.min(1, 0.35 + v.k * st.z);
        if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) continue;
        const a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time / 1000 * st.s + st.p))) * st.z * 1.6 * intro;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillStyle = st.c;
        ctx.fillRect(sx, sy, st.r, st.r);
      }
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(w / 2 + v.x * v.k, h / 2 + v.y * v.k);
      ctx.scale(v.k, v.k);
      // The band of light down the middle, where the two documents meet.
      ctx.save();
      ctx.scale(0.22, 1);
      const band = ctx.createRadialGradient(0, 0, 0, 0, 0, 1100);
      band.addColorStop(0, 'rgba(150,170,255,0.10)');
      band.addColorStop(0.5, 'rgba(120,140,255,0.04)');
      band.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(-1100, -1100, 2200, 2200);
      ctx.restore();
      // Each cluster a slow-turning nebula: its centre, and a gentle sway of its stars about it.
      const boxes = new Map<string, [number, number, number, number]>();
      const keyOf = (n: SimNode) => `${n.side === 'spec' ? -1 : 1}:${n.group}`;
      for (const n of nodes) {
        const key = keyOf(n);
        const b = boxes.get(key);
        if (!b) boxes.set(key, [n.x!, n.y!, n.x!, n.y!]);
        else boxes.set(key, [Math.min(b[0], n.x!), Math.min(b[1], n.y!), Math.max(b[2], n.x!), Math.max(b[3], n.y!)]);
      }
      const centre = new Map([...boxes].map(([k, b]) => [k, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as const]));
      const pos = shown.current;
      let ci = 0;
      const sway = new Map<string, number>();
      for (const k of boxes.keys()) sway.set(k, 0.035 * Math.sin(time / 7000 + ci++ * 1.7));
      for (const n of nodes) {
        const k = keyOf(n);
        const [cx, cy] = centre.get(k)!;
        const a = sway.get(k)! * (n.fx != null ? 0 : 1);
        const dx = n.x! - cx;
        const dy = n.y! - cy;
        pos.set(n.id, { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) });
      }
      const P = (n: SimNode) => pos.get(n.id)!;
      ctx.globalCompositeOperation = 'lighter';
      for (const [key, a] of anchors) {
        const b = boxes.get(key);
        if (!b) continue;
        const [cx, cy] = centre.get(key)!;
        const rr = Math.max(60, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 50);
        for (const [ox, oy, rs, al] of [
          [0, 0, 1, 0.09],
          [rr * 0.25, -rr * 0.15, 0.7, 0.06],
          [-rr * 0.2, rr * 0.2, 0.6, 0.05],
        ] as const) {
          const neb = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rr * rs);
          neb.addColorStop(0, hexA(a.color, (focus ? al * 0.35 : al) * intro));
          neb.addColorStop(1, hexA(a.color, 0));
          ctx.fillStyle = neb;
          ctx.fillRect(cx + ox - rr * rs, cy + oy - rr * rs, rr * rs * 2, rr * rs * 2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      // Cluster names, spaced capitals above each.
      const placed: [number, number, number, number][] = [];
      // How much to name at this zoom: far out the clusters only, then each cluster's main nodes, close in everything.
      const lod = v.k < 0.42 ? 0 : v.k < 0.85 ? 1 : 2;
      const cfs = (lod === 0 ? 13 : 10) / v.k;
      ctx.font = `600 ${cfs}px ${FONT}`;
      spaced(2.2 / v.k);
      ctx.textAlign = 'center';
      // Biggest clusters named first; a name that would sit on another moves up clear of it.
      const byCount = [...anchors].sort((x, y) => {
        const bx = boxes.get(x[0]);
        const by = boxes.get(y[0]);
        return (by ? by[3] - by[1] : 0) - (bx ? bx[3] - bx[1] : 0);
      });
      for (const [key, a] of byCount) {
        const b = boxes.get(key);
        if (!b) continue;
        const [cx] = centre.get(key)!;
        const lbl = up(a.label);
        const lw = ctx.measureText(lbl).width;
        let ly = b[1] - 16 / v.k;
        for (let t = 0; t < 4; t++) {
          const hit = placed.find((p) => cx - lw / 2 < p[2] && cx + lw / 2 > p[0] && ly - cfs < p[3] && ly + cfs * 0.3 > p[1]);
          if (!hit) break;
          ly = hit[1] - cfs * 0.45;
        }
        placed.push([cx - lw / 2, ly - cfs, cx + lw / 2, ly + cfs * 0.3]);
        ctx.fillStyle = hexA(a.color, (focus ? 0.18 : lod === 2 ? 0.5 : 0.8) * intro);
        ctx.fillText(lbl, cx, ly);
      }
      ctx.font = `700 ${15 / v.k}px ${FONT}`;
      spaced(7 / v.k);
      ctx.fillStyle = `rgba(255,255,255,${0.22 * intro})`;
      const top = Math.min(...[...anchors.values()].map((a) => a.y)) - 200;
      const sideX = (sd: string) => {
        const xs = [...anchors].filter(([k]) => k.startsWith(sd)).map(([, a]) => a.x);
        return xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : sd === '-1' ? -620 : 620;
      };
      ctx.fillText('SPECIFICATION', sideX('-1'), top);
      ctx.fillText('DRAWINGS', sideX('1:'), top);
      spaced(0);
      // Links: faint light arcs; a traced one bright, with light flowing along it.
      const sh = showRef.current;
      ctx.lineCap = 'round';
      const hits: typeof edgeHits.current = [];
      const picked = selRef.current;
      for (const e of edges) {
        if (!sh[e.kind]) continue;
        const sa = e.source as SimNode;
        const sb = e.target as SimNode;
        const a = P(sa);
        const b = P(sb);
        const on = focus ? e.a === focus || e.b === focus : !found || found.has(sa.id) || found.has(sb.id);
        const base = e.kind === 'written' ? 0.4 : e.kind === 'revises' ? 0.38 : e.kind === 'matched' ? 0.26 : e.kind === 'contains' ? 0.1 : 0.08;
        const alpha = (focus ? (on ? 0.95 : 0.02) : found ? (on ? 0.7 : 0.025) : base) * intro;
        if (alpha < 0.015) continue;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const bend = e.kind === 'contains' ? 0 : 0.18;
        const cx = mx - (b.y - a.y) * bend;
        const cy = my + (b.x - a.x) * bend * 0.4;
        if (picked && (e.a === picked || e.b === picked)) hits.push({ other: e.a === picked ? e.b : e.a, a, c: { x: cx, y: cy }, b });
        const hov = hoverEdge.current && picked && (e.a === picked || e.b === picked) && hoverEdge.current.other === (e.a === picked ? e.b : e.a);
        if (hov) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 4 / Math.sqrt(v.k);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(cx, cy, b.x, b.y);
          ctx.stroke();
        }
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        const ca = e.kind === 'revises' ? ADD_COLOR : sa.color;
        grad.addColorStop(0, hexA(ca, alpha));
        grad.addColorStop(1, hexA(sb.color, alpha));
        ctx.strokeStyle = grad;
        ctx.lineWidth = (on && focus ? 1.6 : e.kind === 'written' || e.kind === 'revises' ? 1 : 0.7) / Math.sqrt(v.k);
        ctx.setLineDash(e.kind === 'matched' ? [4 / Math.sqrt(v.k), 4 / Math.sqrt(v.k)] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
        ctx.stroke();
        if (focus && on && e.kind !== 'contains') {
          ctx.setLineDash([]);
          for (let k = 0; k < 3; k++) {
            const t = ((time / 1800 + k / 3 + (sa.index ?? 0) * 0.13) % 1 + 1) % 1;
            const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
            const py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
            const rr = 4 / Math.sqrt(v.k);
            const dot = ctx.createRadialGradient(px, py, 0, px, py, rr);
            dot.addColorStop(0, 'rgba(255,255,255,0.95)');
            dot.addColorStop(1, hexA(EDGE_COLOR[e.kind], 0));
            ctx.fillStyle = dot;
            ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
          }
        }
      }
      ctx.setLineDash([]);
      edgeHits.current = hits;
      // Nodes as stars: a glow in their colour, a bright core; schedules ringed like planets,
      // addenda flaring, sections still to follow dark and dashed.
      for (const n of nodes) {
        const { x, y } = P(n);
        const on = lit(n.id);
        const a = (on ? 1 : 0.14) * intro;
        const isFocus = n.id === focus;
        const r = n.r * (isFocus ? 1.25 : 1);
        if (n.missing) {
          ctx.setLineDash([2.5 / Math.sqrt(v.k), 2.5 / Math.sqrt(v.k)]);
          ctx.strokeStyle = hexA(n.color, 0.8 * a);
          ctx.lineWidth = 1.2 / Math.sqrt(v.k);
          ctx.beginPath();
          ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        ctx.globalCompositeOperation = 'lighter';
        const gr = r * (isFocus ? 4.2 : on && focus ? 3.4 : 2.6);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, gr);
        glow.addColorStop(0, hexA(n.color, 0.55 * a));
        glow.addColorStop(0.35, hexA(n.color, 0.18 * a));
        glow.addColorStop(1, hexA(n.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(x - gr, y - gr, gr * 2, gr * 2);
        if (n.kind === 'addendum') {
          // A four-point flare.
          const f = r * (2.6 + 0.4 * Math.sin(time / 500));
          ctx.strokeStyle = hexA('#ffffff', 0.7 * a);
          ctx.lineWidth = 1 / Math.sqrt(v.k);
          ctx.beginPath();
          ctx.moveTo(x - f, y);
          ctx.lineTo(x + f, y);
          ctx.moveTo(x, y - f);
          ctx.lineTo(x, y + f);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        const core = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r * 0.75);
        core.addColorStop(0, `rgba(255,255,255,${a})`);
        core.addColorStop(1, hexA(n.color, a));
        ctx.fillStyle = core;
        ctx.beginPath();
        if (n.kind === 'sheet') roundRect(ctx, x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2, r * 0.2);
        else if (n.kind === 'type' || n.kind === 'finish') diamond(ctx, x, y, r * 0.85);
        else ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        if (n.kind === 'schedule') {
          ctx.strokeStyle = hexA(n.color, 0.75 * a);
          ctx.lineWidth = 1.1 / Math.sqrt(v.k);
          ctx.beginPath();
          ctx.ellipse(x, y, r * 1.35, r * 0.5, -0.45, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (isFocus) {
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * a})`;
          ctx.lineWidth = 1.2 / Math.sqrt(v.k);
          ctx.beginPath();
          ctx.arc(x, y, r * 1.6 + Math.sin(time / 300) * 1.2 / Math.sqrt(v.k), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Labels in spaced capitals, most important first, none on top of another.
      const want = (n: SimNode) =>
        n.id === focus
          ? 1e9
          : (focus && near!.has(n.id)) || (found && found.has(n.id))
            ? 1e6 + n.degree
            : focus || found || lod === 0 || (lod === 1 && (rankIn.get(n.id) ?? 9) > 1)
              ? -1
              : n.degree + (n.kind === 'schedule' ? 3 : n.kind === 'addendum' ? 6 : 0);
      const order = nodes.map((n) => [want(n), n] as const).filter(([wt]) => wt >= 0).sort((x, y) => y[0] - x[0]);
      const budget = focus || found ? 80 : lod === 2 ? 220 : 60;
      for (const [, n] of order) {
        if (placed.length >= budget + anchors.size || intro < 0.6) break;
        const { x, y } = P(n);
        const isFocus = n.id === focus;
        const fs = (isFocus ? 12.5 : 10.5) / v.k;
        ctx.font = `${isFocus ? 700 : 500} ${fs}px ${FONT}`;
        spaced((isFocus ? 1.2 : 0.9) / v.k);
        const text = up(n.kind === 'section' ? `${n.label}  ${short(n.sub, 34)}` : n.kind === 'sheet' ? n.label : n.kind === 'addendum' ? n.label : `${n.label}${n.sub && n.kind !== 'schedule' ? `  ${short(n.sub, 26)}` : ''}`);
        const tw = ctx.measureText(text).width;
        const left = n.side === 'spec';
        const tx = x + (left ? -(n.r + 6 / v.k) : n.r + 6 / v.k);
        const box: [number, number, number, number] = [left ? tx - tw : tx, y - fs * 0.75, left ? tx : tx + tw, y + fs * (n.missing ? 1.7 : 0.6)];
        if (!isFocus && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        ctx.textAlign = left ? 'right' : 'left';
        ctx.shadowColor = 'rgba(2,3,9,0.95)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = isFocus ? '#ffffff' : `rgba(226,232,255,${(focus || found) && !isFocus ? 0.92 : 0.82})`;
        ctx.fillText(text, tx, y + fs * 0.35);
        ctx.shadowBlur = 0;
        if (n.missing) {
          ctx.fillStyle = 'rgba(255,190,90,1)';
          ctx.font = `600 ${8.5 / v.k}px ${FONT}`;
          spaced(1.4 / v.k);
          ctx.fillText('NOT ISSUED', tx, y + fs * 1.45);
        }
      }
      spaced(0);
      // A hovered link says where it goes.
      const he = hoverEdge.current;
      if (he && picked) {
        const o = byId.get(he.other);
        if (o) {
          const fs = 11 / v.k;
          ctx.font = `600 ${fs}px ${FONT}`;
          spaced(1 / v.k);
          const text = `TAKE ME TO  ${up(o.label)}${o.sub && o.kind !== 'schedule' ? `  ${up(short(o.sub, 30))}` : ''}  →`;
          const tw = ctx.measureText(text).width;
          const px = he.x + 12 / v.k;
          const py = he.y - 12 / v.k;
          ctx.fillStyle = 'rgba(10,14,30,0.92)';
          ctx.strokeStyle = hexA(o.color, 0.8);
          ctx.lineWidth = 1 / v.k;
          ctx.beginPath();
          roundRect(ctx, px - 8 / v.k, py - fs * 1.2, tw + 16 / v.k, fs * 1.9, 6 / v.k);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText(text, px, py);
          spaced(0);
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, nodes, edges, anchors, neighbours, stars, rankIn, byId]);

  // The project by meaning, worked out in the full space (neighbours, clusters, loners) and laid
  // out for the 3D view; with an embeddings key, by an AI's reading of each thing.
  const [meaning, setMeaning] = useState<Meaning | null>(null);
  const [meaningNote, setMeaningNote] = useState<string | null>(null);
  const [meaningBusy, setMeaningBusy] = useState<string | null>(null);
  const [keyTick, setKeyTick] = useState(0);
  useEffect(() => {
    const on = () => setKeyTick((n) => n + 1);
    window.addEventListener('takeoff-embeddings-key', on);
    return () => window.removeEventListener('takeoff-embeddings-key', on);
  }, []);
  useEffect(() => {
    let gone = false;
    void (async () => {
      let embeddings: Map<string, Float32Array> | undefined;
      let note: string | null = null;
      const key = getEmbeddingsKey();
      if (key) {
        const who = PROVIDER_NAME[providerOf(key)];
        try {
          setMeaningBusy(`Reading meaning with ${who}…`);
          embeddings = await embedAll(
            data.nodes.map((n) => ({ id: n.id, text: textOf(n, shortGroupName(n)) })),
            (done, of) => !gone && of > 0 && setMeaningBusy(`Reading meaning with ${who}… ${done} of ${of}`),
          );
        } catch (e) {
          note = `${e instanceof Error ? e.message : String(e)} Placed by shared words instead.`;
        }
      }
      if (gone) return;
      setMeaningBusy('Mapping meaning…');
      const m = await buildMeaning(data.nodes, data.edges, { embeddings, groupName: shortGroupName });
      if (gone) return;
      setMeaning(m);
      setMeaningNote(note);
      setMeaningBusy(null);
    })();
    return () => {
      gone = true;
    };
  }, [data, keyTick]);

  // The 3D map, loaded when asked for. By meaning: clusters as nebulae, each thing beside what it
  // is like; by links: a force layout. Labelled, glowing; links followed by a click.
  type G3 = {
    _destructor?: () => void;
    nodeColor: (f: (n: object) => string) => G3;
    linkColor: (f: (l: object) => string) => G3;
    linkWidth: (f: (l: object) => number) => G3;
    linkDirectionalParticles: (f: (l: object) => number) => G3;
    cameraPosition: (pos?: object, lookAt?: object, ms?: number) => { x: number; y: number; z: number } & G3;
    graphData: () => { nodes: { id: string; x?: number; y?: number; z?: number }[] };
    controls: () => { autoRotate?: boolean; target?: { x: number; y: number; z: number } };
    zoomToFit: (ms?: number, pad?: number) => G3;
    scene: () => { add: (o: unknown) => void; remove: (o: unknown) => void };
  };
  const [layout3d, setLayout3d] = useState<'meaning' | 'links'>('meaning');
  const [colorBy, setColorBy] = useState<'cluster' | 'type'>('cluster');
  const [hover3d, setHover3d] = useState<string | null>(null);
  const [hoverCluster, setHoverCluster] = useState<number | null>(null);
  const [showLoners, setShowLoners] = useState(true);
  const [hudOpen, setHudOpen] = useState<'clusters' | 'loners' | null>('clusters');
  const space = mode === '3d' && layout3d === 'meaning' ? meaning : null;
  const g3 = useRef<G3 | null>(null);
  type Label = { material: { opacity: number }; visible: boolean; big: boolean; scale: { x: number; y: number }; center: { x: number; y: number } };
  const sprites = useRef(new Map<string, Label>());
  /** Each cluster's glow and name, dimmed when another is in focus. */
  const nebulae = useRef<{ i: number; mats: { opacity: number }[]; base: number[]; name?: Label; sub?: Label; at: [number, number, number]; size: number }[]>([]);
  const lonerRings = useRef<{ material: { opacity: number }; visible: boolean }[]>([]);
  const threads = useRef<{ obj: unknown; dispose: () => void } | null>(null);
  const three = useRef<typeof import('three') | null>(null);
  const colorOfNode = (n: SimNode) => (n.missing ? '#6b7080' : space && colorBy === 'cluster' ? (space.clusters[space.clusterOf.get(n.id) ?? -1]?.color ?? '#8a93b5') : n.color);
  useEffect(() => {
    if (mode !== '3d' || !threeRef.current) return;
    if (layout3d === 'meaning' && !meaning) return;
    let gone = false;
    let lod = 0;
    void Promise.all([
      import('3d-force-graph'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three'),
      import('three-spritetext'),
      // The labels are drawn once: their face loaded first.
      document.fonts?.load(`600 16px ${FONT}`).catch(() => undefined),
      document.fonts?.load(`700 16px ${FONT}`).catch(() => undefined),
      document.fonts?.load(`500 16px ${FONT}`).catch(() => undefined),
    ]).then(([{ default: ForceGraph3D }, { UnrealBloomPass }, THREE, { default: SpriteText }]) => {
      if (gone || !threeRef.current) return;
      three.current = THREE;
      const el = threeRef.current;
      const shownEdges = edges.filter((e) => show[e.kind]);
      const used = new Set(shownEdges.flatMap((e) => [e.a, e.b]));
      // By meaning, everything that has a place; by links, only what is linked.
      const keep = nodes.filter((n) => (space ? space.pos.has(n.id) : used.has(n.id)));
      const kept = new Set(keep.map((n) => n.id));
      sprites.current.clear();
      const g = new ForceGraph3D(el, { controlType: 'orbit' })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor('#000002')
        .showNavInfo(false)
        .graphData({
          nodes: keep.map((n) => {
            const p = space?.pos.get(n.id);
            return { id: n.id, label: n.label, sub: n.sub, kind: n.kind, color: colorOfNode(n), val: (n.kind === 'section' ? 2 : n.kind === 'schedule' || n.kind === 'addendum' ? 3 : 1) + Math.min(n.degree, 12) * 0.4, side: n.side, ...(p ? { x: p[0], y: p[1], z: p[2], fx: p[0], fy: p[1], fz: p[2] } : {}) };
          }),
          links: shownEdges.filter((e) => kept.has(e.a) && kept.has(e.b)).map((e) => ({ source: e.a, target: e.b, kind: e.kind, why: e.why })),
        })
        .nodeLabel((n: object) => `<div class="map3d-tip">${escapeHtml(up(`${(n as { label: string }).label}  ${(n as { sub: string }).sub}`))}</div>`)
        .nodeColor((n: object) => (n as { color: string }).color)
        .nodeOpacity(0.9)
        .nodeRelSize(space ? 2.4 : 4)
        .nodeResolution(16)
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: object) => {
          const d = n as { id: string; label: string; sub: string; kind: string; color: string };
          const big = d.kind === 'section' || d.kind === 'schedule' || d.kind === 'sheet' || d.kind === 'addendum';
          const text = up(d.kind === 'section' ? `${d.label} · ${short(d.sub, 26)}` : d.kind === 'item' || d.kind === 'type' || d.kind === 'finish' ? d.label : short(d.label, 28));
          // Labels one small size on screen, near or far; which ones show is decided each frame (no overlaps).
          const th = big ? 0.0112 : 0.0098;
          const sp = new SpriteText(text, th, big ? 'rgba(226,232,250,0.9)' : 'rgba(196,206,232,0.82)');
          sp.fontFace = FONT;
          sp.fontWeight = big ? '600' : '500';
          // Padding and corners are in the text's own units (a share of its height).
          sp.padding = [th * 0.5, th * 0.18];
          sp.backgroundColor = 'rgba(8,11,24,0.6)';
          sp.borderRadius = th * 0.35;
          sp.center.set(0.5, -0.45);
          Object.assign(sp.material, { depthWrite: false, depthTest: false, sizeAttenuation: false });
          sp.renderOrder = 5;
          sp.visible = false;
          sprites.current.set(d.id, Object.assign(sp, { big }) as never);
          return sp;
        })
        .linkColor((l: object) => EDGE_COLOR[(l as { kind: MapEdgeKind }).kind])
        .linkOpacity(space ? 0.35 : 0.6)
        .linkWidth((l: object) => ((l as { kind: string }).kind === 'written' ? 1.4 : (l as { kind: string }).kind === 'matched' ? 0.7 : 0.25))
        .linkCurvature((l: object) => ((l as { kind: string }).kind === 'contains' ? 0 : 0.2))
        .linkDirectionalParticles((l: object) => ((l as { kind: string }).kind === 'written' ? 3 : (l as { kind: string }).kind === 'matched' ? 2 : 0))
        .linkDirectionalParticleWidth(2.2)
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleColor((l: object) => ((l as { kind: string }).kind === 'written' ? '#ffffff' : '#e6ccff'))
        .linkHoverPrecision(10)
        // A link says where it leads, and goes there on a click.
        .linkLabel((l: object) => {
          const d = l as { source: { id: string; label: string }; target: { id: string; label: string }; why: string };
          const sel = selRef.current;
          const to = d.source.id === sel ? d.target : d.target.id === sel ? d.source : d.target;
          return `<div class="map3d-tip"><b>TAKE ME TO ${escapeHtml(up(to.label))} →</b><br/><span>${escapeHtml(up(short(d.why ?? '', 80)))}</span></div>`;
        })
        .onLinkClick((l: object) => {
          const d = l as { source: { id: string }; target: { id: string } };
          const sel = selRef.current;
          pickRef.current(d.source.id === sel ? d.target.id : d.target.id === sel ? d.source.id : d.target.id, false);
        })
        .onNodeHover((n: object | null) => {
          el.style.cursor = n ? 'pointer' : 'grab';
          setHover3d(n ? (n as { id: string }).id : null);
        })
        .onLinkHover((l: object | null) => (el.style.cursor = l ? 'pointer' : 'grab'))
        .onNodeClick((n: object) => pickRef.current((n as { id: string }).id, false))
        .onBackgroundClick(() => setSelected(null))
        .cooldownTicks(space ? 2 : Infinity)
        .cooldownTime(6000);
      if (!space) g.d3Force('x', forceX<SimulationNodeDatum & { side?: string }>((n) => (n.side === 'spec' ? -170 : 170)).strength(0.06) as never);
      // A sky around it: a shell of stars.
      const starGeo = new THREE.BufferGeometry();
      const pts = new Float32Array(5000 * 3);
      for (let i = 0; i < 5000; i++) {
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const rad = 1800 + Math.random() * 2600;
        const sq = Math.sqrt(1 - u * u);
        pts.set([rad * sq * Math.cos(th), rad * u, rad * sq * Math.sin(th)], i * 3);
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      g.scene().add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.75 })));
      nebulae.current = [];
      lonerRings.current = [];
      if (space) {
        // Each cluster a nebula: a soft glow at its heart, wisps through its members, its name above.
        const glow = (() => {
          const c = document.createElement('canvas');
          c.width = c.height = 128;
          const x = c.getContext('2d')!;
          const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
          gr.addColorStop(0, 'rgba(255,255,255,1)');
          gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
          gr.addColorStop(0.6, 'rgba(255,255,255,0.1)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = gr;
          x.fillRect(0, 0, 128, 128);
          return new THREE.CanvasTexture(c);
        })();
        const wisp = (color: string, opacity: number, scale: number, at: [number, number, number]) => {
          const m = new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
          const s = new THREE.Sprite(m);
          s.scale.set(scale, scale, 1);
          s.position.set(...at);
          g.scene().add(s);
          return m;
        };
        for (const c of space.clusters) {
          const mats: { opacity: number }[] = [];
          const base: number[] = [];
          const add = (m: { opacity: number }) => (mats.push(m), base.push(m.opacity));
          add(wisp(c.color, 0.16, c.radius * 2.6, c.center));
          const ps = c.members.map((id) => space.pos.get(id)).filter((p): p is [number, number, number] => !!p);
          for (let k = 0; k < Math.min(10, ps.length); k++) add(wisp(c.color, 0.06, c.radius * (0.7 + ((k * 37) % 10) / 14), ps[Math.floor((k * ps.length) / Math.min(10, ps.length))]));
          // Names one size on screen, near or far; spaced capitals, the subtitle quieter below.
          const name = new SpriteText(up(c.name).split('').join(String.fromCharCode(8202)), 0.0165, c.color);
          name.fontFace = FONT;
          name.fontWeight = '600';
          Object.assign(name.material, { depthWrite: false, depthTest: false, sizeAttenuation: false });
          name.center.set(0.5, -0.1);
          name.position.set(c.center[0], c.center[1] + c.radius * 0.7, c.center[2]);
          name.renderOrder = 10;
          g.scene().add(name);
          add(name.material as { opacity: number });
          const sub = new SpriteText(up(short(c.sub, 38)), 0.0095, 'rgba(190,200,228,0.75)');
          sub.fontFace = FONT;
          sub.fontWeight = '500';
          Object.assign(sub.material, { depthWrite: false, depthTest: false, sizeAttenuation: false });
          sub.center.set(0.5, 1.15);
          sub.position.set(c.center[0], c.center[1] + c.radius * 0.7, c.center[2]);
          sub.renderOrder = 10;
          g.scene().add(sub);
          add(sub.material as { opacity: number });
          nebulae.current.push({ i: c.i, mats, base, name: name as unknown as Label, sub: sub as unknown as Label, at: [c.center[0], c.center[1] + c.radius * 0.7, c.center[2]], size: c.members.length });
        }
        // Loners: a red ring around each spec section nothing on the drawings is about.
        const ring = (() => {
          const c = document.createElement('canvas');
          c.width = c.height = 128;
          const x = c.getContext('2d')!;
          x.strokeStyle = 'rgba(255,255,255,1)';
          x.lineWidth = 7;
          x.beginPath();
          x.arc(64, 64, 52, 0, Math.PI * 2);
          x.stroke();
          return new THREE.CanvasTexture(c);
        })();
        for (const l of space.loners) {
          const p = space.pos.get(l.id);
          if (!p) continue;
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color: '#ff5f57', transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
          s.scale.set(0.03, 0.03, 1);
          s.position.set(...p);
          s.visible = showLonersRef.current;
          g.scene().add(s);
          lonerRings.current.push(s as unknown as { material: { opacity: number }; visible: boolean });
        }
      }
      const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.55, 0.4, 0.55);
      g.postProcessingComposer().addPass(bloom);
      const controls = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; addEventListener?: (t: string, f: () => void) => void };
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.4;
      controls.addEventListener?.('start', () => (controls.autoRotate = false));
      // In from far out.
      g.cameraPosition({ x: 0, y: 0, z: 3600 }, { x: 0, y: 0, z: 0 });
      let fitted3d = !!space;
      g.onEngineStop(() => {
        if (fitted3d) return;
        fitted3d = true;
        if (selRef.current) restyleRef.current(true);
        else g.zoomToFit(2200, 60);
      });
      // Labels: which show is decided on screen, most important first, none over another — the
      // picked node and what it is tied to, then cluster names, then what is near the camera.
      let t = 0;
      const v = new THREE.Vector3();
      lod = window.setInterval(() => {
        t++;
        const camera = (g as unknown as { camera: () => { position: { x: number; y: number; z: number }; fov: number } & import('three').Camera }).camera();
        const W = el.clientWidth;
        const H = el.clientHeight;
        const px = H / 2 / Math.tan((camera.fov * Math.PI) / 360);
        const lit = litRef.current;
        const focus = hoverRef3.current ?? selRef.current;
        const boxes: [number, number, number, number][] = [];
        const place = (sp: Label, at: [number, number, number]) => {
          v.set(at[0], at[1], at[2]).project(camera);
          if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return false;
          const sx = ((v.x + 1) / 2) * W;
          const sy = ((1 - v.y) / 2) * H;
          const w = sp.scale.x * px;
          const h = sp.scale.y * px;
          const b: [number, number, number, number] = [sx - w * sp.center.x - 3, sy - h * (1 - sp.center.y) - 2, sx + w * (1 - sp.center.x) + 3, sy + h * sp.center.y + 2];
          if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false;
          boxes.push(b);
          return true;
        };
        const at = new Map(g.graphData().nodes.map((n) => [n.id, n]));
        const posOf = (id: string): [number, number, number] | null => {
          const n = at.get(id);
          return n && n.x !== undefined ? [n.x, n.y ?? 0, n.z ?? 0] : null;
        };
        for (const sp of sprites.current.values()) sp.visible = false;
        const show = (id: string) => {
          const sp = sprites.current.get(id);
          const p = posOf(id);
          if (sp && p) sp.visible = place(sp, p);
        };
        if (focus && lit) {
          // The focus, its links, then what it is most like (closest first).
          show(focus);
          for (const id of neighbours.get(focus) ?? []) show(id);
          for (const x of space?.near.get(focus) ?? []) show(x.id);
          for (const id of lit) if (!sprites.current.get(id)?.visible) show(id);
        }
        // Cluster names: biggest first; hidden while a node is in focus, the subtitle only for the cluster hovered.
        const hc = hoverClusterRef.current;
        for (const nb of [...nebulae.current].sort((a, b) => b.size - a.size)) {
          if (nb.name) nb.name.visible = !focus && place(nb.name, nb.at);
          if (nb.sub) nb.sub.visible = !focus && hc === nb.i && place(nb.sub, nb.at);
        }
        if (!focus) {
          // What is near the camera, the bigger kinds first, as space allows.
          const cam = camera.position;
          const near = [...sprites.current.entries()]
            .map(([id, sp]) => {
              const p = posOf(id);
              return { id, sp, d: p ? Math.hypot(cam.x - p[0], cam.y - p[1], cam.z - p[2]) : Infinity };
            })
            .filter((x) => (lit ? lit.has(x.id) : true) && x.d < (x.sp.big ? 760 : 300))
            .sort((a, b) => (a.sp.big === b.sp.big ? a.d - b.d : a.sp.big ? -1 : 1))
            .slice(0, 60);
          for (const x of near) show(x.id);
        }
        for (const r of lonerRings.current) {
          r.visible = showLonersRef.current;
          r.material.opacity = 0.45 + 0.4 * Math.sin(t / 2.2);
        }
      }, 120);
      g3.current = g as unknown as G3;
      if (import.meta.env.DEV) Object.assign(window, { __g3: g, __meaning: space });
      restyle3d(false);
      // Laid out already (by meaning): framed once the camera has come in.
      if (space)
        window.setTimeout(() => {
          if (gone) return;
          fitted3d = true;
          if (selRef.current) restyleRef.current(true);
          else fit3dRef.current(1800);
        }, 400);
    });
    return () => {
      gone = true;
      window.clearInterval(lod);
      threads.current?.dispose();
      threads.current = null;
      g3.current?._destructor?.();
      g3.current = null;
      if (threeRef.current) threeRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nodes, edges, show, space, layout3d]);

  const showLonersRef = useRef(showLoners);
  showLonersRef.current = showLoners;
  /** What is lit in 3D: the focus and what it is tied to (links, and what it is most like), or a cluster; null when all is. */
  const litRef = useRef<Set<string> | null>(null);
  const hoverRef3 = useRef(hover3d);
  hoverRef3.current = hover3d;
  const hoverClusterRef = useRef(hoverCluster);
  hoverClusterRef.current = hoverCluster;
  const restyle3d = (fly: boolean) => {
    const g = g3.current;
    if (!g) return;
    const focus = hoverRef3.current ?? selRef.current;
    const hc = hoverClusterRef.current;
    let lit: Set<string> | null = null;
    if (focus) {
      lit = new Set([focus, ...(neighbours.get(focus) ?? [])]);
      for (const x of space?.near.get(focus) ?? []) lit.add(x.id);
    } else if (hc !== null && space?.clusters[hc]) lit = new Set(space.clusters[hc].members);
    litRef.current = lit;
    const on = (id: string) => !lit || lit.has(id);
    const idOf = (x: unknown) => (typeof x === 'object' && x ? (x as { id: string }).id : (x as string));
    g.nodeColor((n: object) => {
      const d = n as { id: string; color: string };
      return on(d.id) ? d.color : '#1a1f2e';
    });
    g.linkColor((l: object) => {
      const d = l as { source: unknown; target: unknown; kind: MapEdgeKind };
      const mine = !focus || idOf(d.source) === focus || idOf(d.target) === focus;
      if (!mine || (hc !== null && !focus)) return '#0c0f18';
      return d.kind === 'contains' ? (focus ? '#6b7aa8' : '#2c3550') : EDGE_COLOR[d.kind];
    });
    g.linkWidth((l: object) => {
      const d = l as { source: unknown; target: unknown; kind: string };
      const mine = focus && (idOf(d.source) === focus || idOf(d.target) === focus);
      return (d.kind === 'written' ? 1.4 : d.kind === 'matched' ? 0.7 : 0.25) * (mine ? 2.6 : 1);
    });
    g.linkDirectionalParticles((l: object) => {
      const d = l as { source: unknown; target: unknown; kind: string };
      const mine = !focus || idOf(d.source) === focus || idOf(d.target) === focus;
      return mine && hc === null ? (d.kind === 'written' ? 3 : d.kind === 'matched' ? 2 : focus ? 1 : 0) : 0;
    });
    for (const [id, sp] of sprites.current) sp.material.opacity = on(id) ? 1 : 0.08;
    // Nebulae: the focused one's (or the hovered cluster) bright, the others faint.
    const fc = focus ? space?.clusterOf.get(focus) : (hc ?? undefined);
    for (const nb of nebulae.current)
      nb.mats.forEach((m, k) => {
        // The last two are its name and its subtitle: the subtitle only for the cluster in focus, names faint while a node is.
        const label = k >= nb.mats.length - 2;
        const sub = k === nb.mats.length - 1;
        const mine = fc === undefined || fc === nb.i;
        m.opacity = nb.base[k] * (label ? (sub ? (fc === nb.i && !focus ? 1 : 0) : focus ? 0.18 : mine ? 1 : 0.2) : mine ? 1 : 0.12);
      });
    // Threads to what the focus is most like (in the full space), brighter the more alike.
    threads.current?.dispose();
    threads.current = null;
    const THREE = three.current;
    const from = focus ? space?.pos.get(focus) : undefined;
    if (THREE && space && focus && from) {
      const group = new THREE.Group();
      const list = space.near.get(focus) ?? [];
      const top = list[0]?.sim || 1;
      const mats: { dispose: () => void }[] = [];
      for (const x of list) {
        const p = space.pos.get(x.id);
        if (!p) continue;
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...p)]);
        const mat = new THREE.LineDashedMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.2 + 0.7 * (x.sim / top), dashSize: 3, gapSize: 2.5, depthWrite: false, blending: THREE.AdditiveBlending });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        group.add(line);
        mats.push(geo, mat);
      }
      g.scene().add(group);
      threads.current = {
        obj: group,
        dispose: () => {
          g.scene().remove(group);
          for (const m of mats) m.dispose();
        },
      };
    }
    const sel = selRef.current;
    if (fly && sel) {
      g.controls().autoRotate = false;
      const n = g.graphData().nodes.find((x) => x.id === sel);
      if (n && n.x !== undefined) {
        // From where the camera is, closer: the node in front, what it links to around it.
        const cam = g.cameraPosition();
        const dx = cam.x - n.x;
        const dy = cam.y - (n.y ?? 0);
        const dz = cam.z - (n.z ?? 0);
        const d = Math.hypot(dx, dy, dz) || 1;
        const k = 220 / d;
        g.cameraPosition({ x: n.x + dx * k, y: (n.y ?? 0) + dy * k, z: (n.z ?? 0) + dz * k }, { x: n.x, y: n.y, z: n.z }, 900);
      }
    }
  };
  const restyleRef = useRef(restyle3d);
  restyleRef.current = restyle3d;
  useEffect(() => {
    if (mode === '3d') restyle3d(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, mode]);
  useEffect(() => {
    if (mode === '3d') restyle3d(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover3d, hoverCluster]);
  // Colour by cluster or by type: the nodes recoloured in place.
  useEffect(() => {
    const g = g3.current as unknown as { graphData: () => { nodes: { id: string; color: string }[] } } | null;
    if (!g || !space) return;
    for (const n of g.graphData().nodes) {
      const sn = byId.get(n.id);
      if (sn) n.color = colorOfNode(sn);
    }
    restyle3d(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorBy]);
  /** The whole 3D map in view: the meaning space is a ball of known size, looked at from straight on. */
  const fit3d = (ms = 800) => {
    const g = g3.current;
    if (!g) return;
    if (space) g.cameraPosition({ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }, ms);
    else g.zoomToFit(ms, 60);
  };
  const fit3dRef = useRef(fit3d);
  fit3dRef.current = fit3d;
  /** Flies to a cluster: in front of it, all of it in view. */
  const flyToCluster = (i: number) => {
    const g = g3.current;
    const c = space?.clusters[i];
    if (!g || !c) return;
    setSelected(null);
    g.controls().autoRotate = false;
    const cam = g.cameraPosition();
    const dx = cam.x - c.center[0];
    const dy = cam.y - c.center[1];
    const dz = cam.z - c.center[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    const k = (c.radius * 3.2 + 140) / d;
    g.cameraPosition({ x: c.center[0] + dx * k, y: c.center[1] + dy * k, z: c.center[2] + dz * k }, { x: c.center[0], y: c.center[1], z: c.center[2] }, 1000);
  };
  const zoom3d = (f: number) => {
    const g = g3.current;
    if (!g) return;
    const cam = g.cameraPosition();
    const t = g.controls().target ?? { x: 0, y: 0, z: 0 };
    g.cameraPosition({ x: t.x + (cam.x - t.x) / f, y: t.y + (cam.y - t.y) / f, z: t.z + (cam.z - t.z) / f }, undefined, 350);
  };

  // Pointer: pan, zoom at the cursor, hover, click, drag a node.
  const toWorld = (cx: number, cy: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = view.current;
    return [(cx - r.left - r.width / 2) / v.k - v.x, (cy - r.top - r.height / 2) / v.k - v.y] as const;
  };
  const nodeAt = (cx: number, cy: number) => {
    const [x, y] = toWorld(cx, cy);
    let best: SimNode | null = null;
    let bd = Infinity;
    for (const n of nodes) {
      const p = shown.current.get(n.id) ?? { x: n.x!, y: n.y! };
      const d = Math.hypot(p.x - x, p.y - y) - n.r;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best && bd < 8 / view.current.k ? best : null;
  };
  /** A link of the picked node under the pointer: the node at its other end, and where along it. */
  if (import.meta.env.DEV)
    (window as unknown as { __edgeProbe: () => unknown }).__edgeProbe = () => {
      const h = edgeHits.current.find((x) => Math.hypot(x.b.x - x.a.x, x.b.y - x.a.y) > 200) ?? edgeHits.current[0];
      if (!h || !wrapRef.current) return null;
      const r = wrapRef.current.getBoundingClientRect();
      const v = view.current;
      const t = 0.5;
      const wx = 0.25 * h.a.x + 0.5 * h.c.x + 0.25 * h.b.x;
      const wy = 0.25 * h.a.y + 0.5 * h.c.y + 0.25 * h.b.y;
      void t;
      return { x: r.left + r.width / 2 + (wx + v.x) * v.k, y: r.top + r.height / 2 + (wy + v.y) * v.k, other: h.other };
    };
  const edgeAt = (cx: number, cy: number) => {
    const [x, y] = toWorld(cx, cy);
    const tol = 12 / view.current.k;
    let best: { other: string; x: number; y: number; d: number } | null = null;
    for (const h of edgeHits.current) {
      for (let i = 1; i < 24; i++) {
        const t = i / 24;
        const px = (1 - t) * (1 - t) * h.a.x + 2 * (1 - t) * t * h.c.x + t * t * h.b.x;
        const py = (1 - t) * (1 - t) * h.a.y + 2 * (1 - t) * t * h.c.y + t * t * h.b.y;
        const d = Math.hypot(px - x, py - y);
        if (d < tol && (!best || d < best.d)) best = { other: h.other, x, y, d };
      }
    }
    return best;
  };
  const flyTo = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    const v = view.current;
    // The node and everything it is tied to, framed between the side panels.
    const group = [n, ...[...(neighbours.get(id) ?? [])].map((x) => byId.get(x)!).filter(Boolean)];
    const x0 = Math.min(...group.map((g) => g.x!)) - 260;
    const x1 = Math.max(...group.map((g) => g.x!)) + 260;
    const y0 = Math.min(...group.map((g) => g.y!)) - 60;
    const y1 = Math.max(...group.map((g) => g.y!)) + 60;
    const r = wrapRef.current!.getBoundingClientRect();
    const k = Math.min(1.6, Math.max(0.3, Math.min((r.width - 720) / (x1 - x0), (r.height - 200) / (y1 - y0))));
    const from = { ...v };
    // Centred a little left of the middle: the panel takes the right.
    const to = { x: -(x0 + x1) / 2 - 170 / k, y: -(y0 + y1) / 2, k };
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const e = 1 - Math.pow(1 - p, 3);
      view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  useEffect(() => {
    if (!focus || !byId.has(focus.id)) return;
    setSelected(focus.id);
    const t = window.setTimeout(() => flyTo(focus.id), 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  // Keys: + and − zoom, 0 shows it all, Escape lets go, Backspace goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      const three = mode === '3d';
      if (e.key === '+' || e.key === '=') (three ? zoom3d(1.5) : zoomBy(1.5));
      else if (e.key === '-' || e.key === '_') (three ? zoom3d(1 / 1.5) : zoomBy(1 / 1.5));
      else if (e.key === '0') (three ? fit3d() : glide(fitView(), 600));
      else if (e.key === 'Escape') setSelected(null);
      else if (e.key === 'Backspace') stepRef.current(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, anchors]);

  const sel = selected ? (byId.get(selected) ?? null) : null;
  // Following the map: where you have been, Back and Forward.
  const [hist, setHist] = useState<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pick = (id: string, fly = true) => {
    if (id === selRef.current) return;
    if (selRef.current) setHist((h) => ({ back: [...h.back.slice(-40), selRef.current!], fwd: [] }));
    setSelected(id);
    setExpanded(new Set());
    if (fly) flyTo(id);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const stepRef = useRef((_d: -1 | 1) => {});
  const stepHistory = (dir: -1 | 1) => {
    const from = dir < 0 ? hist.back : hist.fwd;
    const id = from[from.length - 1];
    if (!id) return;
    const cur = selRef.current;
    setHist((h) =>
      dir < 0 ? { back: h.back.slice(0, -1), fwd: cur ? [...h.fwd, cur] : h.fwd } : { back: cur ? [...h.back, cur] : h.back, fwd: h.fwd.slice(0, -1) },
    );
    setSelected(id);
    flyTo(id);
  };
  stepRef.current = stepHistory;

  /** What a node is tied to, grouped: what it is part of, what it holds, its own links, and links it has through those. */
  const relationsOf = (id: string) => {
    const node = (x: string) => data.nodes.find((n) => n.id === x);
    type Rel = { other: MapNode; badge: string; kind: string; why: string; at?: Place; page?: { docId: string; page: number } };
    const seen = new Set<string>([id]);
    const once = (list: Rel[]) => list.filter((r) => r.other && !seen.has(r.other.id) && (seen.add(r.other.id), true));
    const parentsOf = (x: string) => data.edges.filter((e) => e.kind === 'contains' && e.a === x);
    const down = (x: string) => data.edges.filter((e) => e.kind === 'contains' && e.b === x);
    const direct = (x: string) => data.edges.filter((e) => (e.a === x || e.b === x) && (e.kind === 'written' || e.kind === 'matched'));
    // Up the chain: an equipment tag is in a schedule, the schedule on a sheet.
    const ancestors: Rel[] = [];
    let level = parentsOf(id);
    for (let depth = 0; level.length && depth < 3; depth++) {
      for (const e of level) ancestors.push({ other: node(e.b)!, badge: depth ? 'Grandparent' : 'Parent', kind: 'parent', why: e.why });
      level = level.flatMap((e) => parentsOf(e.b));
    }
    const own = direct(id).map((e) => ({ other: node(e.a === id ? e.b : e.a)!, badge: e.kind === 'written' ? 'Written' : 'Matched', kind: e.kind, why: e.why, at: e.at }));
    const children = down(id).map((e) => ({ other: node(e.a)!, badge: 'Child', kind: 'child', why: e.why }));
    const grand = down(id).flatMap((e) => down(e.a)).map((e) => ({ other: node(e.a)!, badge: 'Grandchild', kind: 'child', why: e.why }));
    // Links it has through what holds it and what it holds.
    const via: Rel[] = [];
    for (const r of [...ancestors, ...children, ...grand])
      for (const e of direct(r.other?.id ?? ''))
        via.push({ other: node(e.a === r.other.id ? e.b : e.a)!, badge: 'Via', kind: 'via', why: `through ${r.other.label}: ${e.why}`, at: e.at });
    // Addenda: what one changes; what changed something.
    const changes = data.edges
      .filter((e) => e.kind === 'revises' && (e.a === id || e.b === id))
      .map((e) => ({ other: node(e.a === id ? e.b : e.a)!, badge: up(e.why.split(' · ')[0] || 'changed'), kind: 'revises', why: e.why.includes(' · ') ? e.why.split(' · ').slice(1).join(' · ') : e.why, page: e.page }));
    const specSpec = data.edges
      .filter((e) => e.kind === 'spec-spec' && (e.a === id || e.b === id))
      .map((e) => ({ other: node(e.a === id ? e.b : e.a)!, badge: e.a === id ? 'Refers to' : 'Referred by', kind: 'spec-spec', why: e.why }));
    // What it is most like, in the full space of meaning (not only what a link says).
    const similar = (meaning?.near.get(id) ?? []).map((x) => ({ other: node(x.id)!, badge: `${Math.round(x.sim * 100)}%`, kind: 'similar', why: meaning?.loners.some((l) => l.id === id) ? 'closest, still far: nothing on the drawings is about it' : 'about the same thing' }));
    const me = node(id);
    const groups = [
      { title: 'Parent', items: once(ancestors) },
      { title: 'Children', items: once([...children, ...grand]) },
      { title: me?.kind === 'addendum' ? 'Changes' : 'Changed by addenda', items: once(changes) },
      { title: me?.side === 'spec' ? 'On the drawings' : 'In the specification', items: once(own.filter((r) => r.other && r.other.side !== me?.side)) },
      { title: 'Linked', items: once(own) },
      { title: 'Related through parent and children', items: once(via) },
      { title: 'Other sections', items: once(specSpec) },
      { title: meaning?.source === 'embeddings' ? 'Most alike (AI meaning)' : 'Most alike (shared words)', items: once(similar) },
    ];
    return groups.filter((g) => g.items.length);
  };

  const stats = useMemo(() => {
    const sections = data.nodes.filter((n) => n.kind === 'section');
    const missing = sections.filter((n) => n.missing);
    const drawn = data.nodes.filter((n) => n.side === 'drawing' && n.kind !== 'sheet');
    const linked = new Set(data.edges.filter((e) => e.kind === 'written' || e.kind === 'matched').flatMap((e) => [e.a, e.b]));
    const orphans = drawn.filter((n) => !linked.has(n.id));
    const missingUsed = missing.filter((n) => linked.has(n.id));
    return {
      sections: sections.length,
      written: data.edges.filter((e) => e.kind === 'written').length,
      matched: data.edges.filter((e) => e.kind === 'matched').length,
      addenda: data.nodes.filter((n) => n.kind === 'addendum').length,
      missing,
      missingUsed,
      orphans,
    };
  }, [data]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const kindRank: Record<MapNode['kind'], number> = { addendum: 0, section: 0, schedule: 1, item: 2, type: 2, finish: 2, sheet: 3 };
    const score = (n: SimNode) => {
      const l = n.label.toLowerCase();
      return (l === q ? 0 : l.startsWith(q) ? 10 : l.includes(q) ? 20 : 30) + kindRank[n.kind] - Math.min(5, n.degree) * 0.1;
    };
    return nodes
      .filter((n) => `${n.label} ${n.sub}`.toLowerCase().includes(q))
      .sort((x, y) => score(x) - score(y))
      .slice(0, 8);
  }, [nodes, query]);

  return (
    <div className="pmap" role="region" aria-label="Project map">
      <div className="pmap-stage" ref={wrapRef}>
        {mode === '2d' ? (
          <canvas
            ref={canvasRef}
            onWheel={(e) => {
              const v = view.current;
              const [wx, wy] = toWorld(e.clientX, e.clientY);
              // Smooth: a trackpad's many small steps and a wheel's few big ones zoom alike; a pinch zooms faster.
              const k = Math.min(5, Math.max(0.12, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016))));
              const r = wrapRef.current!.getBoundingClientRect();
              view.current = { k, x: (e.clientX - r.left - r.width / 2) / k - wx, y: (e.clientY - r.top - r.height / 2) / k - wy };
            }}
            onPointerDown={(e) => {
              const n = nodeAt(e.clientX, e.clientY);
              drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false, node: n ?? undefined };
              (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) {
                if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
                if (d.node && d.moved) {
                  const [x, y] = toWorld(e.clientX, e.clientY);
                  d.node.fx = x;
                  d.node.fy = y;
                  sim.current?.alphaTarget(0.15).restart();
                } else if (d.moved) view.current = { ...view.current, x: d.vx + (e.clientX - d.x) / view.current.k, y: d.vy + (e.clientY - d.y) / view.current.k };
                return;
              }
              const n = nodeAt(e.clientX, e.clientY);
              setHover(n?.id ?? null);
              const le = n ? null : edgeAt(e.clientX, e.clientY);
              hoverEdge.current = le ? { other: le.other, x: le.x, y: le.y } : null;
              (e.target as HTMLCanvasElement).style.cursor = n || le ? 'pointer' : 'grab';
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (d?.node) {
                d.node.fx = null;
                d.node.fy = null;
                sim.current?.alphaTarget(0);
              }
              if (d && !d.moved) {
                const n = nodeAt(e.clientX, e.clientY);
                // A click on one of the picked node's links goes to the node at its other end.
                const le = n ? null : edgeAt(e.clientX, e.clientY);
                if (n) pick(n.id, false);
                else if (le) {
                  hoverEdge.current = null;
                  pick(le.other);
                } else setSelected(null);
              }
            }}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={(e) => {
              // Double-click: into that spot, closer.
              const [wx, wy] = toWorld(e.clientX, e.clientY);
              const k = Math.min(5, view.current.k * 1.8);
              const r = wrapRef.current!.getBoundingClientRect();
              glide({ k, x: (e.clientX - r.left - r.width / 2) / k - wx, y: (e.clientY - r.top - r.height / 2) / k - wy }, 380);
            }}
          />
        ) : (
          <div className="pmap-3d" ref={threeRef} onPointerLeave={() => setHover3d(null)} />
        )}
      </div>

      <div className="pmap-hud">
        <div className="pmap-title">
          <Icon name="graph" size={16} />
          <strong>Project map</strong>
          <span className="pmap-sub">
            {stats.sections} sections · {stats.written} written · {stats.matched} matched{stats.addenda ? ` · ${stats.addenda} addenda` : ''}
          </span>
        </div>
        <div className="pmap-search">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find: 08100, door, EF-1, gypsum"
            aria-label="Find on the map"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                pick(results[0].id);
                setQuery('');
              }
              if (e.key === 'Escape') setQuery('');
            }}
          />
          {results.length > 0 && (
            <ul className="pmap-results">
              {results.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      pick(n.id);
                      setQuery('');
                    }}
                  >
                    <span className="dot" style={{ background: n.color }} />
                    <strong>{n.label}</strong> <span className="muted">{short(n.sub, 40)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="pmap-toggles">
          {(
            [
              ['written', 'Written', 'One names the other: a section names a schedule, a note names a section'],
              ['matched', 'Matched', 'About the same thing, by their own words'],
              ['spec-spec', 'Spec ↔ spec', 'Sections that refer to other sections'],
              ...(stats.addenda ? ([['revises', 'Addenda', 'What each addendum changed']] as const) : []),
              ['items', 'Tags', 'Equipment, types and finishes, not just schedules and sheets'],
            ] as const
          ).map(([k, label, tip]) => (
            <button key={k} className={`pmap-chip ${show[k] ? 'on' : ''} ${k}`} title={tip} onClick={() => setShow({ ...show, [k]: !show[k] })}>
              <span className="swatch" />
              {label}
            </button>
          ))}
          <button className={`pmap-chip gaps ${gaps ? 'on' : ''}`} onClick={() => setGaps((g) => !g)} title="What the spec is missing and what the drawings show without a spec section">
            Gaps <span className="n">{stats.missingUsed.length + stats.orphans.length}</span>
          </button>
        </div>
        <div className="pmap-actions">
          <div className="pmap-seg">
            <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>
              2D
            </button>
            <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>
              3D
            </button>
          </div>
          <button className="pmap-close" onClick={onClose} aria-label="Close the map" title="Back to the drawings">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>

      {gaps && (
        <div className="pmap-panel left">
          <div className="pmap-panel-head">
            <strong>Gaps</strong>
            <button className="pmap-x" onClick={() => setGaps(false)} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
          <h4>In the table of contents, not in the spec ({stats.missing.length})</h4>
          <p className="muted">Listed as “To follow”. {stats.missingUsed.length ? `${stats.missingUsed.length} of them cover work on the drawings.` : ''}</p>
          <ul className="pmap-list">
            {stats.missing.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    pick(n.id);
                  }}
                >
                  <span className="dot ring" style={{ borderColor: colorOf(n) }} />
                  <strong>{n.label}</strong> {n.sub}
                  {stats.missingUsed.includes(n) && <span className="tag warn">on drawings</span>}
                </button>
              </li>
            ))}
          </ul>
          <h4>On the drawings, no spec section found ({stats.orphans.length})</h4>
          <ul className="pmap-list">
            {stats.orphans.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    pick(n.id);
                  }}
                >
                  <span className="dot" style={{ background: colorOf(n) }} />
                  <strong>{n.label}</strong> {short(n.sub, 40)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sel && (
        <div className="pmap-panel right">
          <div className="pmap-panel-head">
            <div className="pmap-hist">
              <button className="pmap-x" onClick={() => stepHistory(-1)} disabled={!hist.back.length} aria-label="Back" title={hist.back.length ? `Back to ${byId.get(hist.back[hist.back.length - 1])?.label ?? ''}` : 'Back'}>
                <Icon name="back" size={13} />
              </button>
              <button className="pmap-x" onClick={() => stepHistory(1)} disabled={!hist.fwd.length} aria-label="Forward" title="Forward">
                <Icon name="forward" size={13} />
              </button>
              <span className="pmap-kind" style={{ ['--c' as string]: sel.color }}>
                {KIND_NAME[sel.kind]}
              </span>
            </div>
            <button className="pmap-x" onClick={() => setSelected(null)} aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          </div>
          <h3>
            {sel.label}
            {sel.kind !== 'schedule' && sel.sub ? <span> {sel.sub}</span> : null}
          </h3>
          <p className="muted">{groupName(sel)}</p>
          {sel.missing && <div className="pmap-warn">In the table of contents as “To follow”: this section is not in the spec book. Worth an RFI if the drawings rely on it.</div>}
          <div className="pmap-buttons">
            {(sel.kind === 'section' || sel.kind === 'addendum') && sel.pages?.length ? (
              <button className="primary small" onClick={() => onOpenSpec(sel.pages![0].docId, sel.pages![0].page, sel.kind === 'section' ? sel.id.slice(5) : '')}>
                {sel.kind === 'addendum' ? 'Read the addendum' : 'Read in the spec'}
              </button>
            ) : null}
            {sel.places?.length ? (
              <button className={`${sel.kind === 'section' ? 'secondary' : 'primary'} small`} onClick={() => onOpenDrawing(sel.places!, sel.label)}>
                Open on the drawings
              </button>
            ) : null}
          </div>
          {(() => {
            const groups = relationsOf(sel.id);
            if (!groups.length) return <p className="muted">Nothing linked to it yet.</p>;
            return groups.map((g) => {
              const all = expanded.has(g.title);
              const shown = all ? g.items : g.items.slice(0, 12);
              return (
                <div key={g.title}>
                  <h4>
                    {g.title} <span className="n">{g.items.length}</span>
                  </h4>
                  <ul className="pmap-links">
                    {shown.map(({ other, badge, kind, why, at, page }, i) => {
                      const to = at && other.side === 'drawing' ? [at] : other.places;
                      return (
                        <li key={`${other.id}${i}`}>
                          <button className="pmap-link" onClick={() => pick(other.id)} title="Go to it on the map">
                            <span className={`pmap-badge ${kind}`}>{badge}</span>
                            <span className="pmap-link-main">
                              <strong>{other.label}</strong> <span>{other.kind === 'schedule' ? '' : short(other.sub, 44)}</span>
                              <small>{why}</small>
                            </span>
                          </button>
                          {page && sel.kind !== 'addendum' ? (
                            <button className="pmap-go" onClick={() => onOpenSpec(page.docId, page.page, '')} title="Read it in the addendum" aria-label="Read it in the addendum">
                              <Icon name="forward" size={13} />
                            </button>
                          ) : other.side === 'drawing' && to?.length ? (
                            <button className="pmap-go" onClick={() => onOpenDrawing(to, other.label)} title="Open on the drawings" aria-label={`Open ${other.label} on the drawings`}>
                              <Icon name="forward" size={13} />
                            </button>
                          ) : other.side === 'spec' && other.pages?.length ? (
                            <button className="pmap-go" onClick={() => onOpenSpec(other.pages![0].docId, other.pages![0].page, other.kind === 'section' ? other.id.slice(5) : '')} title="Read in the spec" aria-label={`Read ${other.label} in the spec`}>
                              <Icon name="forward" size={13} />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {g.items.length > 12 && (
                    <button className="pmap-more" onClick={() => setExpanded((x) => (x.has(g.title) ? (x.delete(g.title), new Set(x)) : new Set(x).add(g.title)))}>
                      {all ? 'Show fewer' : `Show all ${g.items.length}`}
                    </button>
                  )}
                </div>
              );
            });
          })()}
        </div>
      )}

      <div className="pmap-zoom" role="group" aria-label="Zoom">
        <button onClick={() => (mode === '3d' ? zoom3d(1.5) : zoomBy(1.5))} aria-label="Zoom in" title="Zoom in (+)">
          +
        </button>
        <button onClick={() => (mode === '3d' ? zoom3d(1 / 1.5) : zoomBy(1 / 1.5))} aria-label="Zoom out" title="Zoom out (−)">
          −
        </button>
        <button onClick={() => (mode === '3d' ? fit3d() : glide(fitView(), 600))} aria-label="Fit the map" title="Whole map (0)">
          <Icon name="fit" size={14} />
        </button>
      </div>

      {mode === '3d' && (
        <div className="pmap-space">
          <div className="pmap-space-switch" role="group" aria-label="3D layout">
            <button className={layout3d === 'meaning' ? 'on' : ''} onClick={() => setLayout3d('meaning')} title="Placed by what each thing is about">
              By meaning
            </button>
            <button className={layout3d === 'links' ? 'on' : ''} onClick={() => setLayout3d('links')} title="Placed by what links to what">
              By links
            </button>
          </div>
          {layout3d === 'meaning' && (
            <div className="pmap-space-key">
              <div className="mk-head">
                <b>Meaning map</b>
                <span className="mk-color" role="group" aria-label="Colour by">
                  <button className={colorBy === 'cluster' ? 'on' : ''} onClick={() => setColorBy('cluster')}>
                    Cluster
                  </button>
                  <button className={colorBy === 'type' ? 'on' : ''} onClick={() => setColorBy('type')}>
                    Trade
                  </button>
                </span>
                <span className={`mk-src ${meaning?.source ?? ''}`}>{meaning?.source === 'embeddings' ? `AI · ${PROVIDER_NAME[providerOf(getEmbeddingsKey() ?? '')]}` : 'Shared words'}</span>
              </div>
              <span className="dim">Close together = about the same thing. Dashed threads: what the picked one is most like.</span>
              {meaningBusy && <span className="mk-busy">{meaningBusy}</span>}
              {meaningNote && <span className="mk-note">{meaningNote}</span>}
              {meaning && meaning.source === 'words' && !getEmbeddingsKey() && onAiSettings && (
                <button className="mk-link" onClick={onAiSettings}>
                  Read by AI meaning (add an embeddings key) →
                </button>
              )}
              {meaning && (
                <>
                  <div className="mk-tabs" role="tablist">
                    <button role="tab" aria-selected={hudOpen === 'clusters'} className={hudOpen === 'clusters' ? 'on' : ''} onClick={() => setHudOpen(hudOpen === 'clusters' ? null : 'clusters')}>
                      Clusters <i>{meaning.clusters.length}</i>
                    </button>
                    <button role="tab" aria-selected={hudOpen === 'loners'} className={hudOpen === 'loners' ? 'on' : ''} onClick={() => setHudOpen(hudOpen === 'loners' ? null : 'loners')}>
                      Not on drawings? <i className={meaning.loners.length ? 'warn' : ''}>{meaning.loners.length}</i>
                    </button>
                  </div>
                  {hudOpen === 'clusters' && (
                    <ul className="mk-list">
                      {meaning.clusters.map((c) => (
                        <li key={c.i}>
                          <button onMouseEnter={() => setHoverCluster(c.i)} onMouseLeave={() => setHoverCluster(null)} onClick={() => flyToCluster(c.i)} title={`Fly to ${c.name}`}>
                            <i style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
                            <span className="mk-name">{c.name}</span>
                            <span className="mk-sub">{c.sub}</span>
                            <span className="mk-n">{c.members.length}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {hudOpen === 'loners' && (
                    <>
                      <label className="mk-check">
                        <input type="checkbox" checked={showLoners} onChange={(e) => setShowLoners(e.target.checked)} /> Ring them on the map
                      </label>
                      <span className="dim">Spec sections nothing on the drawings is about, and nothing links to. Check they are shown, or priced from the spec alone.</span>
                      <ul className="mk-list">
                        {meaning.loners.map((l) => {
                          const n = byId.get(l.id);
                          return n ? (
                            <li key={l.id}>
                              <button onClick={() => pick(l.id, false)} title={l.best ? `Closest on the drawings: ${byId.get(l.best.id)?.label ?? ''} (${Math.round(l.best.sim * 100)}%)` : 'Nothing on the drawings like it'}>
                                <i className="ring" />
                                <span className="mk-name">{n.label}</span>
                                <span className="mk-sub">{n.sub}</span>
                              </button>
                            </li>
                          ) : null;
                        })}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="pmap-legend">
        <span>
          <i className="l written" /> written
        </span>
        <span>
          <i className="l matched" /> matched by subject
        </span>
        <span>
          <i className="s round" /> spec section
        </span>
        <span>
          <i className="s ring" /> to follow
        </span>
        <span>
          <i className="s square" /> sheet
        </span>
        <span>
          <i className="s planet" /> schedule
        </span>
        <span>
          <i className="s diamond" /> type / finish
        </span>
        {stats.addenda > 0 && (
          <span>
            <i className="s flare" /> addendum
          </span>
        )}
      </div>
    </div>
  );
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
