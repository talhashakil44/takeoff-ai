import type { Pt } from '../model';

/**
 * Heavy ink on a drawn sheet: the straight runs of thick line a plan draws its pipes (or other
 * heavy work) in, read off the sheet as it prints rather than from its linework. Some engineers'
 * sets paste the trade drawing in as a picture under a few vector notes, so the pipes are not
 * lines in the PDF at all; drawing the sheet and reading the dark pixels finds them either way.
 *
 * The sheet is drawn in tiles at `scale` pixels a point. A pixel is ink when it is dark; ink
 * whose whole 3 x 3 neighbourhood is ink is the core of a line at least ~3 pixels thick, so thin
 * linework (leaders, text, the architect's background) falls away. The core is then scanned in
 * rows and columns for runs at least `minLength` long, and runs on neighbouring rows (columns)
 * become one band: a horizontal (vertical) run with its centreline and thickness. Runs that are
 * not square to the sheet are not found (most piping on plans is drawn square).
 */

export interface InkRun {
  a: Pt;
  b: Pt;
  /** Thickness in sheet points. */
  width: number;
  /**
   * How much of the strip along each side (left/top, right/bottom) is drawn in diagonal hatching,
   * 0–1: an outline round a hatched area is hatched on one side only.
   */
  hatch?: [number, number];
}

export interface PageLike {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  render(o: unknown): { promise: Promise<void> };
}

type Canvas = { getContext(t: '2d'): unknown; width: number; height: number };

async function makeCanvas(w: number, h: number): Promise<Canvas> {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  const mod = (await import(/* @vite-ignore */ '@napi-rs/canvas' as string)) as { createCanvas(w: number, h: number): Canvas };
  return mod.createCanvas(w, h);
}

export interface InkOptions {
  /** Pixels a sheet point (3 = 216 dpi). */
  scale?: number;
  /** Shortest run, in sheet points. */
  minLength: number;
  /** Thickest band kept, in sheet points (thicker is a filled shape, not a line). */
  maxWidth: number;
  /** Parts of the sheet to leave out (the title block), in sheet points. */
  skip?: [number, number, number, number][];
  /**
   * Pipes drawn double, two fine black lines the pipe's width apart with nothing (or a light tone)
   * between: the gap in sheet points, smallest to largest. None: only heavy single lines are read.
   */
  hollow?: [number, number];
  /** Dashed lines: the longest gap between dashes, in sheet points (none: dashes are not joined). */
  dashGap?: number;
  /** Darkest a pixel can be and still be paper (0–255 luminance). */
  dark?: number;
  /** Tile size in pixels (default: the whole sheet when it fits a canvas). */
  tile?: number;
}

type Band = { lo: number; hi: number; a: number; b: number; last: number };

/** Bands from runs on successive lines: rows for horizontal runs, columns for vertical ones. */
function bandsOf(core: Uint8Array, w: number, h: number, horizontal: boolean, minLen: number, maxThick: number, dash: { gap: number; min: number } | null, out: { at: number; from: number; to: number; thick: number }[]) {
  const lines = horizontal ? h : w;
  const along = horizontal ? w : h;
  let open: Band[] = [];
  const close = (b: Band) => {
    const thick = b.hi - b.lo + 1 + 2; // the core is the line less a pixel each side
    if (thick <= maxThick) out.push({ at: (b.lo + b.hi) / 2, from: b.a - 1, to: b.b + 1, thick });
  };
  for (let l = 0; l < lines; l++) {
    const pieces: [number, number][] = [];
    let start = -1;
    for (let k = 0; k <= along; k++) {
      const on = k < along && core[horizontal ? l * w + k : k * w + l] === 1;
      if (on && start < 0) start = k;
      else if (!on && start >= 0) {
        pieces.push([start, k - 1]);
        start = -1;
      }
    }
    const runs: [number, number][] = [];
    for (let i = 0; i < pieces.length; i++) {
      const [a, b0] = pieces[i];
      let b = b0;
      // A dashed line: dashes of a few points with short gaps between, read as one run.
      if (dash && b - a + 1 >= dash.min) {
        let n = 1;
        let inked = b - a + 1;
        let j = i + 1;
        while (j < pieces.length && pieces[j][0] - b - 1 <= dash.gap && pieces[j][1] - pieces[j][0] + 1 >= dash.min) {
          inked += pieces[j][1] - pieces[j][0] + 1;
          b = pieces[j][1];
          n++;
          j++;
        }
        if (n >= 3 && inked >= 0.5 * (b - a + 1) && b - a + 1 >= minLen) {
          runs.push([a, b]);
          i = j - 1;
          continue;
        }
        b = b0;
      }
      if (b - a + 1 >= minLen) runs.push([a, b]);
    }
    const next: Band[] = [];
    for (const [a, b] of runs) {
      // The band this run continues: one from the line before that it mostly overlaps.
      const i = open.findIndex((o) => o.last === l - 1 && Math.min(o.b, b) - Math.max(o.a, a) >= 0.6 * Math.min(o.b - o.a, b - a));
      if (i >= 0) {
        const o = open[i];
        open.splice(i, 1);
        next.push({ lo: o.lo, hi: l, a: Math.min(o.a, a), b: Math.max(o.b, b), last: l });
      } else next.push({ lo: l, hi: l, a, b, last: l });
    }
    for (const o of open) close(o);
    open = next;
  }
  for (const o of open) close(o);
}

/**
 * Double lines: pairs of long fine black lines `minGap`–`maxGap` pixels apart on parallel rows
 * (columns), overlapping along most of their length, with the line halfway between them clear of
 * black ink. Each pair is a band as wide as the gap.
 */
function hollowBands(black: Uint8Array, w: number, h: number, horizontal: boolean, minLen: number, minGap: number, maxGap: number, out: { at: number; from: number; to: number; thick: number }[]) {
  const lines = horizontal ? h : w;
  const along = horizontal ? w : h;
  const at = (l: number, k: number) => black[horizontal ? l * w + k : k * w + l] === 1;
  const runsOn: [number, number][][] = [];
  for (let l = 0; l < lines; l++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let k = 0; k <= along; k++) {
      const on = k < along && at(l, k);
      if (on && start < 0) start = k;
      else if (!on && start >= 0) {
        if (k - start >= minLen) runs.push([start, k - 1]);
        start = -1;
      }
    }
    runsOn.push(runs);
  }
  for (let l = 0; l < lines; l++)
    for (const [a, b] of runsOn[l]) {
      for (let g = minGap; g <= maxGap && l + g < lines; g++) {
        const mate = runsOn[l + g].find(([c, d]) => Math.min(b, d) - Math.max(a, c) >= 0.8 * Math.min(b - a, d - c));
        if (!mate) continue;
        const from = Math.max(a, mate[0]);
        const to = Math.min(b, mate[1]);
        // Clear between: halfway across, at most a fifth of the way along is black.
        const mid = l + Math.round(g / 2);
        let ink = 0;
        for (let k = from; k <= to; k++) if (at(mid, k)) ink++;
        if (ink <= 0.2 * (to - from + 1)) out.push({ at: l + g / 2, from, to, thick: g + 1 });
        break;
      }
    }
}

/**
 * Diagonal hatching beside a band: in the strip from just off its edge to `side` pixels out on
 * each side, the share of pixels on a line at 45° (ink here and 2 and 4 pixels on along the
 * diagonal, not along the square directions).
 */
function hatchBeside(ink: Uint8Array, w: number, h: number, horizontal: boolean, b: { at: number; from: number; to: number; thick: number }, side: number, scale: number): [number, number] {
  const at = Math.round(b.at);
  const half = Math.ceil(b.thick / 2) + Math.round(scale);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1;
  const diag = (x: number, y: number) => {
    if (!on(x, y)) return false;
    const d1 = on(x + 2, y + 2) && on(x + 4, y + 4) && !on(x + 4, y) && !on(x, y + 4);
    const d2 = on(x + 2, y - 2) && on(x + 4, y - 4) && !on(x + 4, y) && !on(x, y - 4);
    return d1 || d2;
  };
  const out: [number, number] = [0, 0];
  for (const [k, sign] of [
    [0, -1],
    [1, 1],
  ] as const) {
    let n = 0;
    let hit = 0;
    for (let t = Math.round(b.from); t <= b.to; t += 2)
      for (let d = half; d <= half + side; d += 2) {
        const x = horizontal ? t : at + sign * d;
        const y = horizontal ? at + sign * d : t;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        n++;
        if (diag(x, y)) hit++;
      }
    out[k] = n ? hit / n : 0;
  }
  return out;
}

/** The thick straight runs on a sheet, in sheet points. Null when the sheet can't be drawn here. */
export async function inkRuns(page: PageLike, o: InkOptions): Promise<InkRun[] | null> {
  const scale = o.scale ?? 3;
  const dark = o.dark ?? 140;
  const vp = page.getViewport({ scale });
  const W = Math.ceil(vp.width);
  const H = Math.ceil(vp.height);
  // Drawing a sheet draws all of it, pictures included, however small the tile: so in one go
  // when the sheet fits a canvas (a D-size sheet at 3 is 40 M pixels), else in big tiles.
  const tile = o.tile ?? (W * H <= 48e6 && Math.max(W, H) <= 8192 ? Math.max(W, H) : 4096);
  const minLen = Math.round(o.minLength * scale);
  const maxThick = Math.round(o.maxWidth * scale);
  const hollow = o.hollow ? ([Math.round(o.hollow[0] * scale), Math.round(o.hollow[1] * scale)] as [number, number]) : null;
  const dash = o.dashGap ? { gap: Math.round(o.dashGap * scale), min: Math.round(1.5 * scale) } : null;
  // Tiles overlap by more than a run's thickness so a band on a seam is read whole in one tile.
  const side = Math.round(8 * scale);
  const pad = Math.max(maxThick + 4, side + 8);
  const found: { horizontal: boolean; at: number; from: number; to: number; thick: number; hatch: [number, number] }[] = [];
  let canvas: Canvas;
  try {
    canvas = await makeCanvas(Math.min(tile + 2 * pad, W), Math.min(tile + 2 * pad, H));
  } catch {
    return null;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  for (let ty = 0; ty < H; ty += tile)
    for (let tx = 0; tx < W; tx += tile) {
      const x0 = Math.max(0, tx - pad);
      const y0 = Math.max(0, ty - pad);
      const w = Math.min(W, tx + tile + pad) - x0;
      const h = Math.min(H, ty + tile + pad) - y0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await page.render({ canvas, canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x0, -y0] }).promise;
      } catch {
        return null;
      }
      const px = ctx.getImageData(0, 0, w, h).data;
      const ink = new Uint8Array(w * h);
      for (let i = 0, j = 0; j < ink.length; i += 4, j++) if (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2] < dark) ink[j] = 1;
      let black: Uint8Array | null = null;
      if (hollow) {
        black = new Uint8Array(w * h);
        for (let i = 0, j = 0; j < black.length; i += 4, j++) if (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2] < 90) black[j] = 1;
      }
      const core = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (ink[i] && ink[i - 1] && ink[i + 1] && ink[i - w] && ink[i + w] && ink[i - w - 1] && ink[i - w + 1] && ink[i + w - 1] && ink[i + w + 1]) core[i] = 1;
        }
      for (const horizontal of [true, false]) {
        const bands: { at: number; from: number; to: number; thick: number }[] = [];
        bandsOf(core, w, h, horizontal, minLen, maxThick, dash, bands);
        if (black) hollowBands(black, w, h, horizontal, minLen, hollow![0], hollow![1], bands);
        for (const b of bands) {
          const at = b.at + (horizontal ? y0 : x0);
          // Each band once: from the tile whose own (unpadded) area holds its centreline.
          const own = horizontal ? at >= ty && at < ty + tile : at >= tx && at < tx + tile;
          if (!own) continue;
          const off = horizontal ? x0 : y0;
          found.push({ horizontal, at, from: b.from + off, to: b.to + off, thick: b.thick, hatch: hatchBeside(ink, w, h, horizontal, b, side, scale) });
        }
      }
    }

  // Runs cut by a tile's edge, joined back up.
  const runs: InkRun[] = [];
  for (const horizontal of [true, false]) {
    const list = found.filter((f) => f.horizontal === horizontal).sort((a, b) => a.at - b.at || a.from - b.from);
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const r = { ...list[i] };
      used[i] = true;
      for (let grew = true; grew; ) {
        grew = false;
        for (let j = i + 1; j < list.length && list[j].at - r.at <= 2; j++) {
          if (used[j] || Math.abs(list[j].at - r.at) > 2) continue;
          if (list[j].from <= r.to + 2 && list[j].to >= r.from - 2) {
            r.from = Math.min(r.from, list[j].from);
            r.to = Math.max(r.to, list[j].to);
            r.thick = Math.max(r.thick, list[j].thick);
            r.hatch = [Math.max(r.hatch[0], list[j].hatch[0]), Math.max(r.hatch[1], list[j].hatch[1])];
            used[j] = grew = true;
          }
        }
      }
      const a: Pt = horizontal ? [r.from / scale, (r.at + 0.5) / scale] : [(r.at + 0.5) / scale, r.from / scale];
      const b: Pt = horizontal ? [(r.to + 1) / scale, (r.at + 0.5) / scale] : [(r.at + 0.5) / scale, (r.to + 1) / scale];
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (o.skip?.some((s) => mid[0] >= s[0] && mid[0] <= s[2] && mid[1] >= s[1] && mid[1] <= s[3])) continue;
      runs.push({ a, b, width: r.thick / scale, hatch: r.hatch });
    }
  }
  return runs;
}
