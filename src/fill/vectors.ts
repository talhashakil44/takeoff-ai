import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** A straight piece of drawn linework in sheet space (PDF points from the top-left corner). */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Stroke width in sheet points (0 for hairlines and fills). */
  width: number;
  /** Outline of a filled shape rather than a stroked line. */
  filled: boolean;
  /** Which subpath (drawn shape) the segment belongs to; segments of one shape share it. */
  sub?: number;
  /** A line the wall model drew to close a door or window opening, not drawn on the sheet. */
  bridge?: boolean;
  /** For a bridge: the opening has glazing along it (a window, where base and walls carry on below). */
  window?: boolean;
  /** A piece of a curve (a door swing, a round column): walls are straight. */
  curve?: boolean;
}

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// pdf.js path data codes (DrawOPS).
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

const STROKES = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const FILLS = new Set<number>([OPS.fill, OPS.eoFill]);

/**
 * Turns a pdf.js operator list into straight segments in sheet space.
 * `base` maps PDF user space to sheet points (the scale-1 viewport transform).
 * Curves become a few chords; text and images are ignored.
 */
export function extractSegments(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, base: Matrix): Segment[] {
  const out: Segment[] = [];
  const counter = { sub: 0 };
  let ctm: Matrix = base;
  let lineWidth = 1;
  const stack: { ctm: Matrix; lineWidth: number }[] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push({ ctm, lineWidth });
        break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ ctm, lineWidth } = s);
        break;
      }
      case OPS.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ctm, lineWidth });
        if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as Matrix);
        break;
      case OPS.paintFormXObjectEnd: {
        const s = stack.pop();
        if (s) ({ ctm, lineWidth } = s);
        break;
      }
      case OPS.setLineWidth:
        lineWidth = args[0] as number;
        break;
      case OPS.setGState:
        for (const [key, value] of (args[0] as [string, unknown][]) ?? []) if (key === 'LW') lineWidth = value as number;
        break;
      case OPS.constructPath: {
        const paint = args[0] as number;
        const stroked = STROKES.has(paint);
        const filled = !stroked && FILLS.has(paint);
        if (!stroked && !filled) break; // clipping paths and endPath draw nothing
        const data = (args[1] as unknown[])?.[0];
        if (!data || typeof (data as ArrayLike<number>).length !== 'number') break;
        const width = stroked ? lineWidth * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) : 0;
        addPath(data as ArrayLike<number>, ctm, width, filled, out, counter);
        break;
      }
    }
  }
  return out;
}

function addPath(d: ArrayLike<number>, m: Matrix, width: number, filled: boolean, out: Segment[], counter: { sub: number }) {
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const push = (x: number, y: number, curve = false) => {
    const [a, b] = apply(m, cx, cy);
    const [c, e] = apply(m, x, y);
    // A zero-length stroke is a dot (round caps): kept as a point so stipple patterns count.
    if (a !== c || b !== e || (!filled && width > 0)) out.push({ x1: a, y1: b, x2: c, y2: e, width, filled, sub: counter.sub, ...(curve ? { curve } : {}) });
    cx = x;
    cy = y;
  };
  for (let i = 0; i < d.length; ) {
    switch (d[i]) {
      case MOVE:
        counter.sub++;
        cx = sx = d[i + 1];
        cy = sy = d[i + 2];
        i += 3;
        break;
      case LINE:
        push(d[i + 1], d[i + 2]);
        i += 3;
        break;
      case CURVE: {
        const [x0, y0] = [cx, cy];
        for (let k = 1; k <= 4; k++) {
          const t = k / 4;
          const u = 1 - t;
          push(
            u * u * u * x0 + 3 * u * u * t * d[i + 1] + 3 * u * t * t * d[i + 3] + t * t * t * d[i + 5],
            u * u * u * y0 + 3 * u * u * t * d[i + 2] + 3 * u * t * t * d[i + 4] + t * t * t * d[i + 6],
            true,
          );
        }
        i += 7;
        break;
      }
      case QUAD: {
        const [x0, y0] = [cx, cy];
        for (let k = 1; k <= 3; k++) {
          const t = k / 3;
          const u = 1 - t;
          push(u * u * x0 + 2 * u * t * d[i + 1] + t * t * d[i + 3], u * u * y0 + 2 * u * t * d[i + 2] + t * t * d[i + 4], true);
        }
        i += 5;
        break;
      }
      case CLOSE:
        push(sx, sy);
        i += 1;
        break;
      default:
        return; // unknown code: stop rather than misread the rest
    }
  }
}
