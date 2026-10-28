import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from '../graph/graph';
import type { MapEdge, MapEdgeKind, MapNode, ProjectMap as MapData } from '../spec/links';
import { Icon } from './Icons';

/**
 * The project map: the specification on the left, the drawings on the right, every link between
 * them drawn across the middle. Sections cluster by division, drawing elements by trade; a link
 * the documents write (08100 names the door schedule) is solid, one matched by subject (EF-1 and
 * PACKAGED EXHAUSTERS) dashed. Hover to trace a node's links, click for what it is and where to
 * go: the section in the spec, the schedule row on its sheet.
 */

const DIVISIONS: Record<string, string> = {
  '00': 'Procurement & contracting',
  '01': 'General requirements',
  '02': 'Existing conditions & site',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, plastics & composites',
  '07': 'Thermal & moisture',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special construction',
  '14': 'Conveying',
  '21': 'Fire suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic safety & security',
  '31': 'Earthwork',
  '32': 'Exterior improvements',
  '33': 'Utilities',
};
const TRADES: Record<string, string> = { A: 'Architectural', S: 'Structural', M: 'Mechanical', P: 'Plumbing', E: 'Electrical', FP: 'Fire protection', F: 'Fire', C: 'Civil', SP: 'Site', L: 'Landscape', ID: 'Interiors', '#': 'Other' };

/** A division's colour: the colour of the trade that draws it, so a link reads end to end. */
function specColor(div: string): string {
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
const groupName = (n: MapNode) => (n.side === 'spec' ? `${n.group} · ${DIVISIONS[n.group] ?? 'Division'}` : (TRADES[n.group] ?? n.group));
const KIND_NAME: Record<MapNode['kind'], string> = { section: 'Spec section', sheet: 'Sheet', schedule: 'Schedule', type: 'Type legend', finish: 'Finish', item: 'Equipment' };

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
}

export function ProjectMap({ data, focus, onOpenSpec, onOpenDrawing, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [show, setShow] = useState<Record<MapEdgeKind | 'items', boolean>>({ written: true, matched: true, 'spec-spec': false, contains: true, items: true });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [gaps, setGaps] = useState(false);
  const view = useRef({ x: 0, y: 0, k: 0.62 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; node?: SimNode } | null>(null);

  // The graph, as the simulation and the drawing use it.
  const { nodes, edges, byId, neighbours } = useMemo(() => {
    const visible = data.nodes.filter((n) => show.items || !(n.kind === 'item' || n.kind === 'finish' || n.kind === 'type'));
    const ids = new Set(visible.map((n) => n.id));
    const es = data.edges.filter((e) => ids.has(e.a) && ids.has(e.b));
    const deg = new Map<string, number>();
    for (const e of es) if (e.kind !== 'contains') for (const id of [e.a, e.b]) deg.set(id, (deg.get(id) ?? 0) + 1);
    const nodes: SimNode[] = visible.map((n) => {
      const d = deg.get(n.id) ?? 0;
      const base = n.kind === 'section' ? 4 : n.kind === 'schedule' ? 5 : n.kind === 'sheet' ? 3.5 : 3;
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
    return { nodes, edges, byId, neighbours };
  }, [data, show.items]);

  // Where each cluster sits: divisions down an arc on the left, trades down an arc on the right.
  const anchors = useMemo(() => {
    const out = new Map<string, { x: number; y: number; label: string; color: string }>();
    const place = (keys: string[], side: -1 | 1, label: (k: string) => string, color: (k: string) => string) => {
      keys.forEach((k, i) => {
        const t = keys.length === 1 ? 0.5 : i / (keys.length - 1);
        const spread = Math.min(70, 30 + keys.length * 3);
        const a = (-spread + 2 * spread * t) * (Math.PI / 180);
        const R = 480 + keys.length * 14;
        out.set(`${side}:${k}`, { x: side * (200 + R * 0.8 * Math.cos(a)), y: R * Math.sin(a), label: label(k), color: color(k) });
      });
    };
    const divs = [...new Set(nodes.filter((n) => n.side === 'spec').map((n) => n.group))].sort();
    const trades = [...new Set(nodes.filter((n) => n.side === 'drawing').map((n) => n.group))].sort((a, b) => 'SP A ID S M P FP E C L #'.indexOf(a) - 'SP A ID S M P FP E C L #'.indexOf(b));
    place(divs, -1, (k) => `${k} ${DIVISIONS[k] ?? ''}`, specColor);
    place(trades, 1, (k) => TRADES[k] ?? k, (k) => TRADE_COLORS[k] ?? '#c7cbd6');
    return out;
  }, [nodes]);
  // The whole map in view to start with.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !wrapRef.current || !anchors.size) return;
    const r = wrapRef.current.getBoundingClientRect();
    const as = [...anchors.values()];
    const x0 = Math.min(...as.map((a) => a.x)) - 380;
    const x1 = Math.max(...as.map((a) => a.x)) + 300;
    const y0 = Math.min(...as.map((a) => a.y)) - 150;
    const y1 = Math.max(...as.map((a) => a.y)) + 120;
    const k = Math.min(1.2, r.width / (x1 - x0), (r.height - 150) / (y1 - y0));
    view.current = { k, x: -(x0 + x1) / 2, y: -(y0 + y1) / 2 + 5 / k };
    fitted.current = true;
  }, [anchors]);
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
      .force('collide', forceCollide<SimNode>((n) => n.r + 2.5))
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
    const frame = (time: number) => {
      const focus = hoverRef.current ?? selRef.current;
      const near = focus ? (neighbours.get(focus) ?? new Set<string>()) : null;
      const q = queryRef.current.trim().toLowerCase();
      const found = q ? new Set(nodes.filter((n) => `${n.label} ${n.sub}`.toLowerCase().includes(q)).map((n) => n.id)) : null;
      const lit = (id: string) => (!focus || id === focus || near!.has(id)) && (!found || found.has(id) || id === focus);
      const v = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The ground: deep blue, a faint grid.
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, '#111a2e');
      g.addColorStop(1, '#05070d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + v.x * v.k, h / 2 + v.y * v.k);
      ctx.scale(v.k, v.k);
      // The seam down the middle, where the two documents meet.
      const seam = ctx.createLinearGradient(-60, 0, 60, 0);
      seam.addColorStop(0, 'rgba(120,160,255,0)');
      seam.addColorStop(0.5, 'rgba(120,160,255,0.07)');
      seam.addColorStop(1, 'rgba(120,160,255,0)');
      ctx.fillStyle = seam;
      ctx.fillRect(-60, -900, 120, 1800);
      // Cluster names, on the outside edge of each cluster, level with its middle.
      const boxes = new Map<string, [number, number, number, number]>();
      for (const n of nodes) {
        const key = `${n.side === 'spec' ? -1 : 1}:${n.group}`;
        const b = boxes.get(key);
        if (!b) boxes.set(key, [n.x!, n.y!, n.x!, n.y!]);
        else boxes.set(key, [Math.min(b[0], n.x!), Math.min(b[1], n.y!), Math.max(b[2], n.x!), Math.max(b[3], n.y!)]);
      }
      const placed: [number, number, number, number][] = [];
      const cfs = 10.5 / v.k;
      ctx.font = `700 ${cfs}px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif`;
      for (const [key, a] of anchors) {
        const b = boxes.get(key);
        if (!b) continue;
        // A soft halo behind the cluster, in its colour.
        const cx = (b[0] + b[2]) / 2;
        const cy = (b[1] + b[3]) / 2;
        const rr = Math.max(40, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 30);
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        halo.addColorStop(0, hexA(a.color, focus ? 0.02 : 0.07));
        halo.addColorStop(1, hexA(a.color, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = hexA(a.color, focus ? 0.15 : 0.55);
        const lbl = a.label.toUpperCase();
        const lw = ctx.measureText(lbl).width;
        placed.push([cx - lw / 2, b[1] - 12 / v.k - cfs, cx + lw / 2, b[1] - 12 / v.k + cfs * 0.3]);
        ctx.fillText(lbl, cx, b[1] - 12 / v.k);
      }
      ctx.font = `700 ${18 / v.k}px -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      const top = Math.min(...[...anchors.values()].map((a) => a.y)) - 110;
      ctx.fillText('SPECIFICATION', -620, top);
      ctx.fillText('DRAWINGS', 620, top);
      // Links.
      const sh = showRef.current;
      for (const e of edges) {
        if (!sh[e.kind]) continue;
        const a = e.source as SimNode;
        const b = e.target as SimNode;
        const on = focus ? (e.a === focus || e.b === focus) : !found || found.has(a.id) || found.has(b.id);
        const base = e.kind === 'written' ? 0.42 : e.kind === 'matched' ? 0.3 : e.kind === 'contains' ? 0.08 : 0.09;
        const alpha = focus ? (on ? 0.95 : 0.025) : found ? (on ? 0.7 : 0.03) : base;
        if (alpha < 0.02) continue;
        const mx = (a.x! + b.x!) / 2;
        const my = (a.y! + b.y!) / 2;
        const bend = e.kind === 'contains' ? 0 : 0.18;
        const cx = mx - (b.y! - a.y!) * bend;
        const cy = my + (b.x! - a.x!) * bend * 0.4;
        const grad = ctx.createLinearGradient(a.x!, a.y!, b.x!, b.y!);
        grad.addColorStop(0, hexA(a.color, alpha));
        grad.addColorStop(1, hexA(b.color, alpha));
        ctx.strokeStyle = grad;
        ctx.lineWidth = (on && focus ? 1.8 : e.kind === 'written' ? 1.1 : 0.8) / Math.sqrt(v.k);
        ctx.setLineDash(e.kind === 'matched' ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(a.x!, a.y!);
        ctx.quadraticCurveTo(cx, cy, b.x!, b.y!);
        ctx.stroke();
        // What flows along a traced link: dots from the spec to the drawing.
        if (focus && on && (e.kind === 'written' || e.kind === 'matched')) {
          ctx.setLineDash([]);
          for (let k = 0; k < 2; k++) {
            const t = ((time / 1600 + k * 0.5 + (a.index ?? 0) * 0.13) % 1 + 1) % 1;
            const px = (1 - t) * (1 - t) * a.x! + 2 * (1 - t) * t * cx + t * t * b.x!;
            const py = (1 - t) * (1 - t) * a.y! + 2 * (1 - t) * t * cy + t * t * b.y!;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(px, py, 2.1 / Math.sqrt(v.k), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.setLineDash([]);
      // Nodes.
      for (const n of nodes) {
        const on = lit(n.id);
        const a = on ? 1 : 0.12;
        const isFocus = n.id === focus;
        if (n.missing) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = hexA(n.color, 0.85 * a);
          ctx.lineWidth = 1.4 / Math.sqrt(v.k);
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          continue;
        }
        if ((isFocus || (focus && on) || (found && on)) && a === 1) {
          ctx.shadowColor = n.color;
          ctx.shadowBlur = isFocus ? 28 : 14;
        }
        ctx.fillStyle = hexA(n.color, a * (n.kind === 'sheet' ? 0.75 : 0.95));
        ctx.beginPath();
        if (n.kind === 'schedule' || n.kind === 'sheet') roundRect(ctx, n.x! - n.r, n.y! - n.r, n.r * 2, n.r * 2, n.r * 0.35);
        else if (n.kind === 'type' || n.kind === 'finish') diamond(ctx, n.x!, n.y!, n.r * 1.15);
        else ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * a})`;
        ctx.lineWidth = (isFocus ? 2 : 0.8) / Math.sqrt(v.k);
        ctx.stroke();
      }
      // Labels, most important first, none on top of another.
      const want = (n: SimNode) => (n.id === focus ? 1e9 : (focus && near!.has(n.id)) || (found && found.has(n.id)) ? 1e6 + n.degree : focus || found ? -1 : n.degree + (n.kind === 'schedule' ? 3 : 0));
      const order = nodes.map((n) => [want(n), n] as const).filter(([w]) => w >= 0).sort((x, y) => y[0] - x[0]);
      const budget = focus || found ? 80 : v.k > 1.4 ? 120 : 34;
      for (const [, n] of order) {
        if (placed.length >= budget + anchors.size) break;
        const isFocus = n.id === focus;
        const fs = (isFocus ? 13 : 11) / v.k;
        ctx.font = `${isFocus ? 700 : 500} ${fs}px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif`;
        const text = n.kind === 'section' ? `${n.label}  ${short(n.sub, 34)}` : n.kind === 'sheet' ? n.label : `${n.label}${n.sub && n.kind !== 'schedule' ? `  ${short(n.sub, 26)}` : ''}`;
        const tw = ctx.measureText(text).width;
        const left = n.side === 'spec';
        const tx = n.x! + (left ? -(n.r + 5) : n.r + 5);
        const box: [number, number, number, number] = [left ? tx - tw : tx, n.y! - fs * 0.7, left ? tx : tx + tw, n.y! + fs * (n.missing ? 1.7 : 0.6)];
        if (!isFocus && placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        placed.push(box);
        ctx.textAlign = left ? 'right' : 'left';
        ctx.lineWidth = 3 / v.k;
        ctx.strokeStyle = 'rgba(5,7,13,0.85)';
        ctx.strokeText(text, tx, n.y! + fs * 0.35);
        ctx.fillStyle = 'rgba(235,240,255,1)';
        ctx.fillText(text, tx, n.y! + fs * 0.35);
        if (n.missing) {
          ctx.fillStyle = 'rgba(255,190,90,1)';
          ctx.font = `600 ${9 / v.k}px -apple-system, Inter, sans-serif`;
          ctx.fillText('TO FOLLOW', tx, n.y! + fs * 1.45);
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
  }, [mode, nodes, edges, anchors, neighbours]);

  // The 3D map, loaded when asked for: the same graph in space, glowing, turning slowly.
  useEffect(() => {
    if (mode !== '3d' || !threeRef.current) return;
    let graph: { _destructor?: () => void } | null = null;
    let gone = false;
    void Promise.all([import('3d-force-graph'), import('three/examples/jsm/postprocessing/UnrealBloomPass.js'), import('three')]).then(([{ default: ForceGraph3D }, { UnrealBloomPass }, THREE]) => {
      if (gone || !threeRef.current) return;
      const el = threeRef.current;
      const shownEdges = edges.filter((e) => show[e.kind]);
      const used = new Set(shownEdges.flatMap((e) => [e.a, e.b]));
      const g = new ForceGraph3D(el, { controlType: 'orbit' })
        .width(el.clientWidth)
        .height(el.clientHeight)
        .backgroundColor('#000002')
        .showNavInfo(false)
        .graphData({
          nodes: nodes.filter((n) => used.has(n.id)).map((n) => ({ id: n.id, name: `${n.label}  ${n.sub}`, color: n.missing ? '#6b7080' : n.color, val: (n.kind === 'section' ? 2.5 : n.kind === 'schedule' ? 3 : 1) + n.degree * 0.9, side: n.side })),
          links: shownEdges.map((e) => ({ source: e.a, target: e.b, kind: e.kind })),
        })
        .nodeLabel((n: object) => `<div class="map3d-tip">${escapeHtml((n as { name: string }).name)}</div>`)
        .nodeColor((n: object) => (n as { color: string }).color)
        .nodeOpacity(0.92)
        .nodeResolution(16)
        .linkColor((l: object) => ({ written: '#7cc4ff', matched: '#c58cff', 'spec-spec': '#5a6280', contains: '#2c3550' })[(l as { kind: MapEdgeKind }).kind])
        .linkOpacity(0.6)
        .linkWidth((l: object) => ((l as { kind: string }).kind === 'written' ? 1.4 : (l as { kind: string }).kind === 'matched' ? 0.7 : 0.25))
        .linkCurvature((l: object) => ((l as { kind: string }).kind === 'contains' ? 0 : 0.2))
        .linkDirectionalParticles((l: object) => ((l as { kind: string }).kind === 'written' ? 3 : (l as { kind: string }).kind === 'matched' ? 2 : 0))
        .linkDirectionalParticleWidth(2.2)
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleColor((l: object) => ((l as { kind: string }).kind === 'written' ? '#ffffff' : '#e6ccff'))
        .onNodeClick((n: object) => setSelected((n as { id: string }).id))
        .cooldownTime(6000);
      g.d3Force('x', forceX<SimulationNodeDatum & { side?: string }>((n) => (n.side === 'spec' ? -170 : 170)).strength(0.06) as never);
      // Glow.
      const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 1.25, 0.55, 0.12);
      g.postProcessingComposer().addPass(bloom);
      // A slow turn until it is touched.
      const controls = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; addEventListener?: (t: string, f: () => void) => void };
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.5;
      controls.addEventListener?.('start', () => (controls.autoRotate = false));
      let fitted3d = false;
      g.onEngineStop(() => {
        if (fitted3d) return;
        fitted3d = true;
        g.zoomToFit(900, 60);
      });
      graph = g as unknown as typeof graph;
    });
    return () => {
      gone = true;
      graph?._destructor?.();
      if (threeRef.current) threeRef.current.innerHTML = '';
    };
  }, [mode, nodes, edges, show]);

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
      const d = Math.hypot(n.x! - x, n.y! - y) - n.r;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best && bd < 8 / view.current.k ? best : null;
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

  const sel = selected ? (byId.get(selected) ?? null) : null;
  const linksOf = (id: string) =>
    data.edges
      .filter((e) => (e.a === id || e.b === id) && e.kind !== 'contains')
      .map((e) => ({ e, other: data.nodes.find((n) => n.id === (e.a === id ? e.b : e.a))! }))
      .filter((x) => x.other)
      .sort((p, q) => rank(q.e.kind) - rank(p.e.kind) || (q.e.score ?? 0) - (p.e.score ?? 0));
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
      missing,
      missingUsed,
      orphans,
    };
  }, [data]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const kindRank: Record<MapNode['kind'], number> = { section: 0, schedule: 1, item: 2, type: 2, finish: 2, sheet: 3 };
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
              const k = Math.min(5, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
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
              (e.target as HTMLCanvasElement).style.cursor = n ? 'pointer' : 'grab';
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
                setSelected(n?.id ?? null);
              }
            }}
            onPointerLeave={() => setHover(null)}
          />
        ) : (
          <div className="pmap-3d" ref={threeRef} />
        )}
      </div>

      <div className="pmap-hud">
        <div className="pmap-title">
          <Icon name="graph" size={16} />
          <strong>Project map</strong>
          <span className="pmap-sub">
            {stats.sections} spec sections · {stats.written} written links · {stats.matched} matched
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
                setSelected(results[0].id);
                flyTo(results[0].id);
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
                      setSelected(n.id);
                      flyTo(n.id);
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
                    setSelected(n.id);
                    flyTo(n.id);
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
                    setSelected(n.id);
                    flyTo(n.id);
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
            <span className="pmap-kind" style={{ ['--c' as string]: sel.color }}>
              {KIND_NAME[sel.kind]}
            </span>
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
            {sel.kind === 'section' && sel.pages?.length ? (
              <button className="primary small" onClick={() => onOpenSpec(sel.pages![0].docId, sel.pages![0].page, sel.id.slice(5))}>
                Read in the spec
              </button>
            ) : null}
            {sel.places?.length ? (
              <button className={`${sel.kind === 'section' ? 'secondary' : 'primary'} small`} onClick={() => onOpenDrawing(sel.places!, sel.label)}>
                Open on the drawings
              </button>
            ) : null}
          </div>
          {(() => {
            const ls = linksOf(sel.id);
            if (!ls.length) return <p className="muted">Nothing linked to it yet.</p>;
            const groups = [
              { title: 'On the drawings', items: ls.filter((x) => x.other.side === 'drawing') },
              { title: sel.side === 'spec' ? 'Other sections' : 'In the specification', items: ls.filter((x) => x.other.side === 'spec') },
            ];
            return groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.title}>
                  <h4>
                    {g.title} <span className="n">{g.items.length}</span>
                  </h4>
                  <ul className="pmap-links">
                    {g.items.map(({ e, other }, i) => {
                      const to = e.at && other.side === 'drawing' ? [e.at] : other.places;
                      return (
                        <li key={i}>
                          <button
                            className="pmap-link"
                            onClick={() => {
                              setSelected(other.id);
                              flyTo(other.id);
                            }}
                            title="Show it on the map"
                          >
                            <span className={`pmap-badge ${e.kind}`}>{e.kind === 'written' ? 'Written' : e.kind === 'matched' ? 'Matched' : 'Refers'}</span>
                            <span className="pmap-link-main">
                              <strong>{other.label}</strong> <span>{short(other.sub, 44)}</span>
                              <small>{e.why}</small>
                            </span>
                          </button>
                          {other.side === 'drawing' && to?.length ? (
                            <button className="pmap-go" onClick={() => onOpenDrawing(to, other.label)} title="Open on the drawings" aria-label={`Open ${other.label} on the drawings`}>
                              <Icon name="forward" size={13} />
                            </button>
                          ) : other.side === 'spec' && other.pages?.length ? (
                            <button className="pmap-go" onClick={() => onOpenSpec(other.pages![0].docId, other.pages![0].page, other.id.slice(5))} title="Read in the spec" aria-label={`Read ${other.label} in the spec`}>
                              <Icon name="forward" size={13} />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ));
          })()}
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
          <i className="s square" /> sheet / schedule
        </span>
        <span>
          <i className="s diamond" /> type / finish
        </span>
      </div>
    </div>
  );
}

const rank = (k: MapEdgeKind) => ({ written: 3, matched: 2, 'spec-spec': 1, contains: 0 })[k];
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
