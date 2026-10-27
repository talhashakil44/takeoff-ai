import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { centroid, orthoSnap, polylineLength, ringArea, ringToPath } from '../geometry';
import type { Measurement, Pt, Sheet, TakeoffType, Units } from '../model';
import type { PDFPageProxy } from '../pdf';
import type { PageText } from '../pageText';
import { measurementVars, primaryOf, primaryUnit } from '../quantities';
import { areaUnit, equivalentScale, formatQty, lengthUnit, parseLength, toArea, toLength } from '../units';
import { askText, notify } from './Dialogs';
import { Icon } from './Icons';
import { fillRoom, type WallModel } from '../fill/roomFill';
import { boxSelect, isCrossing } from '../boxSelect';
import type { SmartTag } from '../smart/index';

export type Tool = 'select' | 'box' | 'measure' | 'calibrate' | 'cutout' | 'fill' | 'symbol' | 'trace';

const FILL_FAILURES = {
  'on-wall': 'That click landed on a wall. Click inside the room.',
  'not-closed':
    'This space isn’t closed: it leaks out through an opening wider than the “close openings” size, or the sheet has no walls around it. Raise the opening size, or draw the area by hand.',
  'not-connected': 'That space is on the other side of a wall from the last fill. Fill it on its own instead (Shift+click joins spaces split only by a closed opening).',
  'no-walls': 'No wall lines were found on this sheet, so rooms can’t be filled. Draw the area by hand.',
};

interface View {
  zoom: number;
  x: number;
  y: number;
}

interface Props {
  page: PDFPageProxy | null;
  sheet: Sheet | null;
  measurements: Measurement[];
  types: TakeoffType[];
  activeType: TakeoffType | null;
  units: Units;
  tool: Tool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Takeoffs picked together with Box select (or Shift-drag in Select). */
  multiIds: string[];
  /** A new multi-selection; `add` keeps the takeoffs already picked (Shift). */
  onMultiSelect: (ids: string[], add: boolean) => void;
  onDeleteMany: (ids: string[]) => void;
  /** Adds a measurement with the active type; returns its id. */
  /** `openings`: for a filled room, its outline length across doorways (sheet points). */
  onAdd: (points: Pt[], openings?: number) => string | undefined;
  /** Replaces a measurement's outline (used when Shift+click grows a fill). */
  /** New points; `openings` given for a fill, cleared for a hand edit. */
  onReplacePoints: (id: string, points: Pt[], source?: string, openings?: number) => void;
  /** A whole takeoff dragged to a new place: its points and cutouts moved together. */
  onMoveTakeoff: (id: string, points: Pt[], holes: Pt[][]) => void;
  /** The sheet's wall model for Fill, read on first use. */
  getWallModel: () => Promise<WallModel> | null;
  onAddHole: (measurementId: string, ring: Pt[]) => void;
  onDelete: (id: string) => void;
  onCalibrate: (metersPerPoint: number, label: string) => void;
  onToolDone: () => void;
  /** A takeoff to bring into view; a new `n` asks again for the same one. */
  /** Bring a takeoff (by id) or a box on the sheet into view; n changes on every request. */
  focus: { id?: string; box?: [number, number, number, number]; n: number } | null;
  /** Text found by the sheet search, outlined on the sheet. */
  highlights?: PageText[];
  /** Trace line: a click on a drawn line, and how near (sheet points) counts as on it. */
  onTrace: (at: Pt, reach: number) => void;
  /** Count by symbol: the box dragged around one symbol (x0, y0, x1, y1). */
  onFindSymbols: (box: [number, number, number, number]) => void;
  /** Count by symbol with one click on it (no box), and how near (sheet points) counts as on it. */
  onPickSymbol?: (at: Pt, reach: number) => void;
  /** Smart view: the sheet's tags outlined, clickable in Select; `lit` the ones a search found (all when null). */
  smart?: { tags: SmartTag[]; color: (t: SmartTag) => string; lit: Set<string> | null; picked: string | null; onPick: (t: SmartTag) => void };
}

/** Longest edge of the low-resolution page bitmap used for instant pan and zoom. */
const BASE_MAX_PX = 4096;

const sameView = (a: View, b: View) => a.zoom === b.zoom && a.x === b.x && a.y === b.y;

export function Viewer(props: Props) {
  const { page, sheet, measurements, types, activeType, units, tool, selectedId } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 0.3, x: 0, y: 0 });
  const [draft, setDraft] = useState<Pt[]>([]);
  /** A selected takeoff's points while one is being dragged. */
  const [edit, setEdit] = useState<{ id: string; points: Pt[]; holes?: Pt[][] } | null>(null);
  const drag = useRef<{ id: string; index: number; insert: boolean; moved: boolean; points: Pt[] } | null>(null);
  /** A whole takeoff being dragged in Select: where the drag started and its original shape. */
  const move = useRef<{ id: string; from: Pt; points: Pt[]; holes: Pt[][]; moved: boolean; sx: number; sy: number } | null>(null);
  /** The box being dragged with Count symbols. */
  /** A box being dragged: around a symbol to count, or over takeoffs to select (`add` with Shift). */
  const [band, setBand] = useState<{ a: Pt; b: Pt; select?: boolean; add?: boolean } | null>(null);
  const [hover, setHover] = useState<{ pt: Pt; sx: number; sy: number } | null>(null);
  /** While a line or area is being drawn, the cursor near an edge scrolls the drawing that way. */
  const edge = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const base = useRef<{ canvas: HTMLCanvasElement; pageRef: PDFPageProxy } | null>(null);
  const hi = useRef<{ canvas: HTMLCanvasElement; view: View; dpr: number } | null>(null);
  /** A pan under way; `slack` is how far it can wander before it counts as one (a click in a measuring tool can wobble). */
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; slack: number } | null>(null);
  const suppressClick = useRef(false);
  const spaceHeld = useRef(false);
  /** The last fill on this sheet, so Shift+click can grow it into a neighbouring space. */
  const lastFill = useRef<{ id: string; seeds: Pt[] } | null>(null);
  const [filling, setFilling] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const dpr = window.devicePixelRatio || 1;
  const typeById = new Map(types.map((t) => [t.id, t]));

  // Track the viewer's size.
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!sheet || !size.w) return;
    const zoom = Math.min(size.w / sheet.width, size.h / sheet.height) * 0.95;
    setView({ zoom, x: (size.w - sheet.width * zoom) / 2, y: (size.h - sheet.height * zoom) / 2 });
  }, [sheet, size.w, size.h]);

  // Fit the whole sheet when switching sheets.
  useEffect(() => {
    fit();
    setDraft([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.id, size.w > 0]);

  // Bring a takeoff picked from the list into view (after the fit above when the sheet changed).
  const shownFocus = useRef(0);
  useEffect(() => {
    const f = props.focus;
    if (!f || f.n === shownFocus.current || !sheet || !size.w) return;
    const m = f.id ? measurements.find((x) => x.id === f.id) : undefined;
    if (!m && !f.box) return;
    shownFocus.current = f.n;
    const xs = m ? m.points.map((p) => p[0]) : [f.box![0], f.box![2]];
    const ys = m ? m.points.map((p) => p[1]) : [f.box![1], f.box![3]];
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // A count is a point: show the area around it.
    const bw = Math.max(x1 - x0, 80);
    const bh = Math.max(y1 - y0, 80);
    const fitZoom = Math.min(size.w / sheet.width, size.h / sheet.height) * 0.95;
    const zoom = Math.max(fitZoom, Math.min(8, Math.min(size.w / (bw * 1.6), size.h / (bh * 1.6))));
    setView({ zoom, x: size.w / 2 - ((x0 + x1) / 2) * zoom, y: size.h / 2 - ((y0 + y1) / 2) * zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focus?.n, sheet?.id, size.w > 0, measurements]);

  useEffect(() => {
    setDraft([]);
    lastFill.current = null;
  }, [tool, activeType?.id, sheet?.id]);

  async function fillAt(pt: Pt, grow: boolean) {
    if (!sheet || filling) return;
    const pending = props.getWallModel();
    if (!pending) return;
    setFilling(true);
    setStatus('Finding the room…');
    try {
      const model = await pending;
      const previous = grow ? lastFill.current : null;
      const seeds = previous ? [...previous.seeds, pt] : [pt];
      const result = fillRoom(model, seeds, sheet.width, sheet.height);
      if (!result.ok) {
        setStatus(null);
        await notify(FILL_FAILURES[result.reason]);
        return;
      }
      if (previous) {
        props.onReplacePoints(previous.id, result.points, undefined, result.openings);
        lastFill.current = { id: previous.id, seeds };
      } else {
        const id = props.onAdd(result.points, result.openings);
        if (id) {
          lastFill.current = { id, seeds };
          props.onSelect(id);
        }
      }
      setStatus(null);
    } catch (err) {
      setStatus(null);
      await notify(`Couldn’t read this sheet’s linework: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFilling(false);
    }
  }

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w) return;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--desk').trim() || '#d6dcdf';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const v = viewRef.current;
    if (hi.current && sameView(hi.current.view, v) && hi.current.dpr === dpr) {
      ctx.drawImage(hi.current.canvas, 0, 0);
      return;
    }
    if (base.current && base.current.pageRef === page && sheet) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base.current.canvas, v.x * dpr, v.y * dpr, sheet.width * v.zoom * dpr, sheet.height * v.zoom * dpr);
    }
  }, [size.w, size.h, dpr, page, sheet]);

  // Render the low-resolution page bitmap once per page.
  useEffect(() => {
    base.current = null;
    hi.current = null;
    paint();
    if (!page || !sheet) return;
    const scale = Math.min(BASE_MAX_PX / Math.max(sheet.width, sheet.height), 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    setStatus('Rendering sheet…');
    const task = page.render({ canvas, viewport });
    task.promise.then(
      () => {
        base.current = { canvas, pageRef: page };
        setStatus(null);
        paint();
      },
      (err: Error) => {
        if (err?.name !== 'RenderingCancelledException') setStatus(`Could not render sheet: ${err.message}`);
      },
    );
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Repaint immediately on view change, then render a sharp view once it settles.
  useEffect(() => {
    paint();
    if (!page || !sheet || !size.w) return;
    const baseScale = Math.min(BASE_MAX_PX / Math.max(sheet.width, sheet.height), 2);
    if (view.zoom * dpr <= baseScale * 1.05) return;
    let task: ReturnType<PDFPageProxy['render']> | null = null;
    const target = { ...view };
    const timer = window.setTimeout(() => {
      const canvas = document.createElement('canvas');
      canvas.width = size.w * dpr;
      canvas.height = size.h * dpr;
      const viewport = page.getViewport({ scale: target.zoom * dpr });
      task = page.render({ canvas, viewport, transform: [1, 0, 0, 1, target.x * dpr, target.y * dpr] });
      task.promise.then(
        () => {
          hi.current = { canvas, view: target, dpr };
          paint();
        },
        () => undefined,
      );
    }, 180);
    return () => {
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [view, size.w, size.h, dpr, page, sheet, paint]);

  // Edge scrolling while drawing: the point under the cursor moves with the drawing, so the
  // line in progress keeps following it.
  const drawing = draft.length > 0;
  useEffect(() => {
    if (!drawing) {
      edge.current = { dx: 0, dy: 0 };
      return;
    }
    let raf = 0;
    const step = () => {
      const { dx, dy } = edge.current;
      if (dx || dy) {
        const v = viewRef.current;
        const next = { ...v, x: v.x + dx * 10, y: v.y + dy * 10 };
        viewRef.current = next;
        setView(next);
        setHover((h) => (h ? { ...h, pt: [(h.sx - next.x) / next.zoom, (h.sy - next.y) / next.zoom] } : h));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [drawing]);

  // Scrolling (needs a non-passive listener). A notched mouse wheel zooms round the cursor;
  // a touch surface (Magic Mouse, trackpad) pans as it swipes, and zooms with Cmd or Ctrl
  // held, or a pinch (which arrives as Ctrl+scroll).
  useEffect(() => {
    const el = wrapRef.current!;
    let gesture: { at: number; touch: boolean } | null = null;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      // A wheel notch is a big whole step with nothing sideways (Chromium reports it as a
      // multiple of 120); a touch surface sends many small, often sideways, steps. One
      // gesture keeps the reading of its first event.
      if (!gesture || now - gesture.at > 220) {
        const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
        const notched =
          e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && (legacy === undefined ? Number.isInteger(e.deltaY) : legacy !== 0 && legacy % 120 === 0));
        gesture = { at: now, touch: !notched };
      }
      gesture.at = now;
      if (gesture.touch && !e.ctrlKey && !e.metaKey) {
        const k = e.deltaMode === 1 ? 16 : 1;
        setView((v) => ({ ...v, x: v.x - e.deltaX * k, y: v.y - e.deltaY * k }));
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // A pinch steps finely; a wheel notch by about 15%.
      const rate = gesture.touch ? 0.01 : 0.0015;
      setView((v) => {
        const zoom = Math.min(40, Math.max(0.03, v.zoom * Math.exp(-e.deltaY * rate)));
        const k = zoom / v.zoom;
        return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toPt = (e: { clientX: number; clientY: number }): { pt: Pt; sx: number; sy: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { pt: [(sx - view.x) / view.zoom, (sy - view.y) / view.zoom], sx, sy };
  };

  const snap = (pt: Pt, shift: boolean): Pt => (shift && draft.length ? orthoSnap(draft[draft.length - 1], pt) : pt);

  const selected = measurements.find((m) => m.id === selectedId) ?? null;
  const selectedType = selected ? typeById.get(selected.typeId) : undefined;
  const drawKind: 'area' | 'linear' | 'count' | 'calibrate' | null =
    tool === 'calibrate'
      ? 'calibrate'
      : tool === 'cutout'
        ? 'area'
        : tool === 'measure' && activeType
          ? activeType.kind
          : null;

  const finish = useCallback(() => {
    if (tool === 'measure' && activeType) {
      if (activeType.kind === 'linear' && draft.length >= 2) props.onAdd(draft);
      if (activeType.kind === 'area' && draft.length >= 3) props.onAdd(draft);
    } else if (tool === 'cutout' && selected && draft.length >= 3) {
      props.onAddHole(selected.id, draft);
      props.onToolDone();
    }
    setDraft([]);
  }, [tool, activeType, draft, selected, props]);

  const calibrate = async (a: Pt, b: Pt) => {
    const lengthPts = polylineLength([a, b]);
    const example = units === 'metric' ? 'For example 3.5 (metres) or 3500mm' : `For example 12'6" or 12.5 (feet)`;
    const input = await askText('Real length of the line you drew', { hint: example });
    if (input === null) return;
    const meters = parseLength(input, units);
    if (!meters || lengthPts <= 0) {
      await notify(`"${input}" is not a length this tool can read. ${example}.`);
      return;
    }
    props.onCalibrate(meters / lengthPts, equivalentScale(meters / lengthPts, units));
    props.onToolDone();
  };

  /** Starts dragging a point of the selected takeoff, or (Option-click) removes it. */
  const grab = (e: PointerEvent<SVGElement>, m: Measurement, index: number, insert: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const type = typeById.get(m.typeId);
    if (e.altKey && !insert) {
      const min = type?.kind === 'area' ? 3 : 2;
      if (m.points.length > min) props.onReplacePoints(m.id, m.points.filter((_, i) => i !== index), 'Edit points');
      suppressClick.current = true;
      return;
    }
    drag.current = { id: m.id, index, insert, moved: false, points: m.points };
    setEdit({ id: m.id, points: m.points });
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (tool === 'symbol' && e.button === 0 && !spaceHeld.current && sheet) {
      e.preventDefault();
      const { pt } = toPt(e);
      setBand({ a: pt, b: pt });
      svgRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    const background = e.target === svgRef.current || (e.target as Element).classList.contains('bg');
    if (e.button === 0 && !spaceHeld.current && sheet && (tool === 'box' || (tool === 'select' && e.shiftKey && background))) {
      e.preventDefault();
      const { pt } = toPt(e);
      setBand({ a: pt, b: pt, select: true, add: e.shiftKey });
      svgRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    // Pan: the middle button, Space held, the background in Select, or a drag in a tool that
    // places points by clicking (a click still places one: only a drag pans).
    const clickTool = tool === 'measure' || tool === 'calibrate' || tool === 'cutout' || tool === 'trace' || tool === 'fill';
    if (e.button === 1 || spaceHeld.current || (tool === 'select' && e.button === 0 && background) || (clickTool && e.button === 0)) {
      e.preventDefault();
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, slack: clickTool && e.button === 0 && !spaceHeld.current ? 6 : 3 };
      svgRef.current!.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const mv = move.current;
    if (mv) {
      // A few screen pixels of slack, so a click to select doesn't nudge the takeoff.
      if (!mv.moved && Math.abs(e.clientX - mv.sx) + Math.abs(e.clientY - mv.sy) < 4) return;
      mv.moved = true;
      const { pt } = toPt(e);
      const dx = pt[0] - mv.from[0];
      const dy = pt[1] - mv.from[1];
      const shift = (ring: Pt[]) => ring.map(([x, y]): Pt => [x + dx, y + dy]);
      setEdit({ id: mv.id, points: shift(mv.points), holes: mv.holes.map(shift) });
      return;
    }
    const d = drag.current;
    if (d) {
      const { pt } = toPt(e);
      d.moved = true;
      const points = [...d.points];
      if (d.insert) {
        points.splice(d.index, 0, pt);
        d.insert = false;
      } else points[d.index] = pt;
      d.points = points;
      setEdit({ id: d.id, points });
      return;
    }
    if (band) {
      const { pt } = toPt(e);
      setBand((b) => (b ? { ...b, b: pt } : b));
      return;
    }
    const p = pan.current;
    if (p) {
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      if (Math.abs(dx) + Math.abs(dy) > p.slack) p.moved = true;
      if (p.moved) setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
      return;
    }
    const h = toPt(e);
    setHover({ ...h, pt: snap(h.pt, e.shiftKey) });
    const rect = svgRef.current!.getBoundingClientRect();
    const m = 28;
    edge.current = draft.length
      ? { dx: h.sx < m ? 1 : h.sx > rect.width - m ? -1 : 0, dy: h.sy < m ? 1 : h.sy > rect.height - m ? -1 : 0 }
      : { dx: 0, dy: 0 };
  };

  /** A drag the browser took away (touch cancel, window lost focus) is dropped, not saved. */
  const cancelDrag = () => {
    if (move.current) {
      move.current = null;
      setEdit(null);
      return;
    }
    if (!drag.current) return;
    drag.current = null;
    setEdit(null);
  };

  const onPointerUp = () => {
    const mv = move.current;
    if (mv) {
      move.current = null;
      if (mv.moved && edit && edit.id === mv.id) {
        suppressClick.current = true;
        props.onMoveTakeoff(mv.id, edit.points, edit.holes ?? mv.holes);
      }
      setEdit(null);
      return;
    }
    const d = drag.current;
    if (d) {
      drag.current = null;
      suppressClick.current = true;
      if (d.moved) props.onReplacePoints(d.id, d.points, 'Edit points');
      setEdit(null);
      return;
    }
    if (band?.select) {
      const { a, b, add } = band;
      setBand(null);
      // A box a few screen pixels across is a click: on a takeoff it picks that one, below.
      if (Math.abs(b[0] - a[0]) * view.zoom <= 4 && Math.abs(b[1] - a[1]) * view.zoom <= 4) return;
      suppressClick.current = true;
      props.onMultiSelect(
        boxSelect(measurements, [a[0], a[1], b[0], b[1]], (m) => typeById.get(m.typeId)?.kind === 'area'),
        !!add,
      );
      return;
    }
    if (band) {
      const { a, b } = band;
      setBand(null);
      suppressClick.current = true;
      // A box a few screen pixels across is a stray click, not a symbol.
      if (Math.abs(b[0] - a[0]) * view.zoom > 4 && Math.abs(b[1] - a[1]) * view.zoom > 4) props.onFindSymbols([a[0], a[1], b[0], b[1]]);
      // A click, not a drag: the symbol under it.
      else if (Math.abs(b[0] - a[0]) * view.zoom <= 4 && Math.abs(b[1] - a[1]) * view.zoom <= 4) props.onPickSymbol?.(a, 6 / view.zoom);
      return;
    }
    if (pan.current) {
      suppressClick.current = pan.current.moved;
      pan.current = null;
    }
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (e.button !== 0 || spaceHeld.current) return;
    if (tool === 'select') {
      props.onSelect(null);
      return;
    }
    if (tool === 'box') {
      if (!e.shiftKey) props.onMultiSelect([], false);
      return;
    }
    if (!sheet) return;
    const pt = snap(toPt(e).pt, e.shiftKey);
    if (tool === 'measure') {
      if (!activeType) return;
      if (activeType.kind === 'count') {
        props.onAdd([pt]);
        return;
      }
      if (e.detail >= 2) {
        finish();
        return;
      }
      setDraft((d) => [...d, pt]);
    } else if (tool === 'calibrate') {
      const next = [...draft, pt];
      if (next.length === 2) {
        setDraft([]);
        void calibrate(next[0], next[1]);
      } else {
        setDraft(next);
      }
    } else if (tool === 'trace') {
      if (activeType?.kind !== 'linear') return;
      props.onTrace(toPt(e).pt, 8 / view.zoom);
    } else if (tool === 'fill') {
      if (activeType?.kind !== 'area') return;
      void fillAt(toPt(e).pt, e.shiftKey);
    } else if (tool === 'cutout') {
      if (!selected || selectedType?.kind !== 'area') return;
      if (e.detail >= 2) {
        finish();
        return;
      }
      setDraft((d) => [...d, pt]);
    }
  };

  // Keyboard: Enter finishes, Esc cancels, Backspace undoes a point or deletes the selection, Space pans.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === ' ') {
        spaceHeld.current = true;
        e.preventDefault();
      } else if (e.key === 'Enter') {
        finish();
      } else if (e.key === 'Escape') {
        if (draft.length) setDraft([]);
        else if (props.multiIds.length) props.onMultiSelect([], false);
        else props.onSelect(null);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (draft.length && e.key === 'Backspace') setDraft((d) => d.slice(0, -1));
        else if (props.multiIds.length) props.onDeleteMany(props.multiIds);
        else if (selectedId) props.onDelete(selectedId);
        e.preventDefault();
      } else if (e.key === 'f' || e.key === 'F') {
        fit();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [finish, draft.length, selectedId, props, fit]);

  // Live readout for the shape being drawn.
  let readout: string | null = null;
  if (sheet && hover && draft.length && drawKind && drawKind !== 'count') {
    const pts = [...draft, hover.pt];
    if (drawKind === 'calibrate') {
      readout = 'Click the other end of a known dimension';
    } else if (!sheet.metersPerPoint) {
      readout = 'Set the sheet scale first';
    } else if (drawKind === 'linear') {
      readout = `${formatQty(toLength(polylineLength(pts) * sheet.metersPerPoint, units))} ${lengthUnit(units)}`;
    } else if (pts.length >= 3) {
      const mpp = sheet.metersPerPoint;
      readout = `${formatQty(toArea(ringArea(pts) * mpp * mpp, units))} ${areaUnit(units)}`;
    }
  }

  const z = view.zoom;
  const shapesInteractive = tool === 'select' || tool === 'box';
  const multi = new Set(props.multiIds);
  // Named takeoffs (rooms) show their number with the quantity.
  const labelOf = (m: Measurement, type: TakeoffType, sheet: Sheet) => {
    const v = measurementVars(m, type, sheet, units);
    const qty = v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, units)}` : 'no scale';
    return m.label ? `${m.label.split(' ')[0]} · ${qty}` : qty;
  };
  const cursor = pan.current ? 'grabbing' : filling ? 'progress' : tool === 'select' ? 'default' : tool === 'fill' ? 'cell' : 'crosshair';

  return (
    <div className="viewer" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onPointerLeave={() => {
          setHover(null);
          edge.current = { dx: 0, dy: 0 };
        }}
        onClick={onClick}
        onAuxClick={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${z})`}>
          {props.highlights?.map((t, i) => (
            <rect
              key={`hl${i}`}
              className="text-hit"
              x={t.cx - t.w / 2 - 3 / z}
              y={t.cy - t.h / 2 - 3 / z}
              width={t.w + 6 / z}
              height={t.h + 6 / z}
              rx={3 / z}
              strokeWidth={2 / z}
              transform={t.angle ? `rotate(${(t.angle * 180) / Math.PI} ${t.cx} ${t.cy})` : undefined}
            />
          ))}
          {props.smart && (
            <g className={`smart-layer ${tool === 'select' ? 'live' : ''}`}>
              {props.smart.tags.map((t, i) => {
                const lit = !props.smart!.lit || props.smart!.lit.has(t.key);
                const on = props.smart!.picked === t.key;
                return (
                  <rect
                    key={`st${i}`}
                    className={`smart-tag ${lit ? 'lit' : 'dim'} ${on ? 'on' : ''}`}
                    x={t.box[0]}
                    y={t.box[1]}
                    width={t.box[2] - t.box[0]}
                    height={t.box[3] - t.box[1]}
                    rx={2 / z}
                    style={{ ['--tag' as string]: props.smart!.color(t) }}
                    strokeWidth={(on ? 2.5 : 1.25) / z}
                    onPointerDown={(e) => {
                      if (tool === 'select' && e.button === 0) e.stopPropagation();
                    }}
                    onClick={(e) => {
                      if (tool !== 'select') return;
                      e.stopPropagation();
                      props.smart!.onPick(t);
                    }}
                  >
                    <title>{t.kind === 'sheet' ? `Open ${t.code}` : t.code}</title>
                  </rect>
                );
              })}
            </g>
          )}
          {sheet && measurements.map((shown) => {
            const m = edit && edit.id === shown.id ? { ...shown, points: edit.points, holes: edit.holes ?? shown.holes } : shown;
            const type = typeById.get(m.typeId);
            if (!type) return null;
            const isSel = m.id === selectedId || multi.has(m.id);
            const common = {
              className: shapesInteractive ? 'shape interactive' : 'shape',
              // In Select, press on a takeoff and drag to move the whole thing (corners still
              // move one at a time from their handles once it is selected).
              onPointerDown: (e: PointerEvent<SVGElement>) => {
                if (!shapesInteractive || tool !== 'select' || e.button !== 0 || e.shiftKey || e.altKey || spaceHeld.current) return;
                e.stopPropagation();
                const { pt } = toPt(e);
                move.current = { id: m.id, from: pt, points: shown.points, holes: shown.holes, moved: false, sx: e.clientX, sy: e.clientY };
                svgRef.current!.setPointerCapture(e.pointerId);
              },
              onClick: (e: MouseEvent) => {
                if (!shapesInteractive) return;
                e.stopPropagation();
                // Box select: a click adds a takeoff to the picked ones, or takes it out.
                if (tool === 'box') props.onMultiSelect(multi.has(m.id) ? props.multiIds.filter((id) => id !== m.id) : [...props.multiIds, m.id], false);
                else props.onSelect(m.id);
              },
            };
            const label = labelOf(m, type, sheet);
            if (type.kind === 'count') {
              const [x, y] = m.points[0];
              return (
                <circle
                  key={m.id}
                  {...common}
                  cx={x}
                  cy={y}
                  r={(isSel ? 8 : 6) / z}
                  fill={type.color}
                  stroke={isSel ? '#000' : '#fff'}
                  strokeWidth={1.5 / z}
                />
              );
            }
            if (type.kind === 'linear') {
              const mid = m.points[Math.floor((m.points.length - 1) / 2)];
              return (
                <g key={m.id} {...common}>
                  <polyline
                    points={m.points.map((p) => p.join(',')).join(' ')}
                    fill="none"
                    stroke={type.color}
                    strokeWidth={isSel ? 5 : 3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={0.85}
                  />
                  {/* Above the point, clear of its handle. */}
                  {isSel && <Label at={[mid[0], mid[1] - 16 / z]} z={z} text={label} />}
                </g>
              );
            }
            return (
              <g key={m.id} {...common}>
                <path
                  d={[m.points, ...m.holes].map(ringToPath).join('')}
                  fillRule="evenodd"
                  fill={type.color}
                  fillOpacity={isSel ? 0.4 : 0.25}
                  stroke={type.color}
                  strokeWidth={isSel ? 3 : 1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {/* Area labels on top of every takeoff, so count dots don't cover them; only where the
              room is big enough on screen to hold one, or when selected. */}
          {sheet && measurements.map((m) => {
            const type = typeById.get(m.typeId);
            if (!type || type.kind !== 'area') return null;
            const points = edit && edit.id === m.id ? edit.points : m.points;
            const label = labelOf({ ...m, points }, type, sheet);
            if (m.id !== selectedId && bboxWidth(points) * z <= label.length * 7 + 12) return null;
            return <Label key={`l${m.id}`} at={centroid(points)} z={z} text={label} />;
          })}

          {tool === 'select' && selected && sheet && (() => {
            const m = edit && edit.id === selected.id ? { ...selected, points: edit.points } : selected;
            const kind = typeById.get(m.typeId)?.kind;
            const closed = kind === 'area';
            const r = 4 / z;
            const mids = kind === 'count' ? [] : m.points.slice(0, closed ? undefined : -1).map((p, i) => {
              const q = m.points[(i + 1) % m.points.length];
              return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as Pt;
            });
            return (
              <g className="handles">
                {mids.map((p, i) => (
                  <circle key={`m${i}`} className="handle mid" cx={p[0]} cy={p[1]} r={r * 0.75} strokeWidth={1 / z} onPointerDown={(e) => grab(e, m, i + 1, true)}>
                    <title>Drag to add a point</title>
                  </circle>
                ))}
                {m.points.map((p, i) => (
                  <rect key={i} className="handle" x={p[0] - r} y={p[1] - r} width={2 * r} height={2 * r} strokeWidth={1.2 / z} onPointerDown={(e) => grab(e, m, i, false)}>
                    <title>Drag to move · Option-click to remove</title>
                  </rect>
                ))}
              </g>
            );
          })()}
          {band && (
            <rect
              className="band"
              x={Math.min(band.a[0], band.b[0])}
              y={Math.min(band.a[1], band.b[1])}
              width={Math.abs(band.b[0] - band.a[0])}
              height={Math.abs(band.b[1] - band.a[1])}
              fill={band.select ? (isCrossing([band.a[0], 0, band.b[0], 0]) ? '#30d158' : '#0a84ff') : activeType?.color ?? '#0a84ff'}
              fillOpacity={0.12}
              stroke={band.select ? (isCrossing([band.a[0], 0, band.b[0], 0]) ? '#30d158' : '#0a84ff') : activeType?.color ?? '#0a84ff'}
              strokeWidth={1.5}
              // Selecting: a solid box takes what is wholly inside, a dashed one what it touches too.
              strokeDasharray={band.select && !isCrossing([band.a[0], 0, band.b[0], 0]) ? undefined : '5 3'}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft.length > 0 && drawKind && (
            <g className="draft">
              {drawKind === 'area' && hover && draft.length >= 2 && (
                <path d={ringToPath([...draft, hover.pt])} fill={tool === 'cutout' ? '#fff' : activeType?.color ?? '#333'} fillOpacity={0.25} stroke="none" />
              )}
              <polyline
                points={[...draft, ...(hover ? [hover.pt] : [])].map((p) => p.join(',')).join(' ')}
                fill="none"
                stroke={drawKind === 'calibrate' ? '#d00' : tool === 'cutout' ? '#000' : activeType?.color ?? '#333'}
                strokeWidth={2}
                strokeDasharray={drawKind === 'calibrate' || tool === 'cutout' ? '6 4' : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {draft.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={3 / z} fill="#fff" stroke="#000" strokeWidth={1 / z} />
              ))}
            </g>
          )}
        </g>
      </svg>
      {readout && hover && (
        <div className="readout" style={{ left: hover.sx + 14, top: hover.sy + 14 }}>
          {readout}
        </div>
      )}
      {!page && <div className="empty">Upload a drawing set to start.</div>}
      {status && <div className="status">{status}</div>}
      <div className="zoom-controls">
        <button onClick={() => setView((v) => zoomAt(v, size, 0.8))} title="Zoom out" aria-label="Zoom out">
          <Icon name="zoomOut" size={16} />
        </button>
        <button onClick={() => setView((v) => zoomAt(v, size, 1.25))} title="Zoom in" aria-label="Zoom in">
          <Icon name="zoomIn" size={16} />
        </button>
        <button onClick={fit} title="Fit the sheet (F)" aria-label="Fit the sheet">
          <Icon name="fit" size={16} />
        </button>
      </div>
    </div>
  );
}

function bboxWidth(points: Pt[]): number {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return Math.min(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * 3);
}

function zoomAt(v: View, size: { w: number; h: number }, k: number): View {
  const cx = size.w / 2;
  const cy = size.h / 2;
  const zoom = Math.min(40, Math.max(0.03, v.zoom * k));
  const f = zoom / v.zoom;
  return { zoom, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
}

function Label({ at, z, text }: { at: Pt; z: number; text: string }) {
  return (
    <text x={at[0]} y={at[1]} fontSize={12 / z} textAnchor="middle" dominantBaseline="middle" className="label" strokeWidth={3 / z}>
      {text}
    </text>
  );
}
