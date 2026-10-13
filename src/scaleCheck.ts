import type { Segment } from './fill/vectors';
import type { PageText } from './pageText';
import type { Units } from './model';
import { parseScale, SCALE_PRESETS } from './units';

export interface ScaleCheck {
  /** The standard scale the dimensions agree on. */
  label: string;
  /** Metres per sheet point of that scale. */
  metersPerPoint: number;
  /** Dimension strings that agree with it, and how many were read in all. */
  agree: number;
  read: number;
}

/** A dimension value in metres: millimetres (5300, 18,371) for metric, feet and inches (12'-6") for imperial. */
export function dimensionMeters(str: string, units: Units): number | null {
  const s = str.trim();
  if (units === 'metric') {
    // 5300, or with a thousands separator: 18,371 or 18 371.
    if (!/^(?:\d{3,5}|\d{1,2}[, ]\d{3})$/.test(s)) return null;
    const mm = Number(s.replace(/[, ]/, ''));
    return mm >= 300 ? mm / 1000 : null;
  }
  const m = /^(\d{1,3})'\s*-?\s*(\d{1,2}(?:\s+\d\/\d+)?)?(?:"|'')?$/.exec(s);
  if (!m) return null;
  const inches = m[2] ? m[2].split(/\s+/).reduce((n, part) => n + (part.includes('/') ? Number(part.split('/')[0]) / Number(part.split('/')[1]) : Number(part)), 0) : 0;
  const feet = Number(m[1]) + inches / 12;
  return feet >= 1 ? feet * 0.3048 : null;
}

/**
 * Reads the sheet's scale from its dimension strings: each dimension figure is paired
 * with the line it sits on (a stroke passing just beside the text, longer than the
 * text, running the way the text reads), and the scale most of them agree on wins.
 * Dimensions are read both as millimetres and as feet and inches, since a drawing's
 * units need not be the project's; `units` only breaks a tie.
 */
export function checkScale(texts: PageText[], segs: Segment[], units: Units): ScaleCheck | null {
  const other: Units = units === 'metric' ? 'imperial' : 'metric';
  const [a, b] = [checkScaleAs(texts, segs, units), checkScaleAs(texts, segs, other)];
  return a && b ? (b.agree > a.agree ? b : a) : (a ?? b);
}

function checkScaleAs(texts: PageText[], segs: Segment[], units: Units): ScaleCheck | null {
  const lines = segs.filter((s) => !s.filled && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 8);
  // Lines bucketed by midpoint.
  const cell = 64;
  const grid = new Map<string, Segment[]>();
  for (const s of lines) {
    const k = `${Math.floor((s.x1 + s.x2) / 2 / cell)},${Math.floor((s.y1 + s.y2) / 2 / cell)}`;
    const list = grid.get(k);
    if (list) list.push(s);
    else grid.set(k, [s]);
  }
  const votes: number[] = [];
  let read = 0;
  for (const t of texts) {
    const meters = dimensionMeters(t.str, units);
    if (!meters) continue;
    read++;
    // Text running across the page or up it: a vertical dimension's text is taller than wide.
    // Text running up the page (a vertical dimension, or any text on a turned sheet): its
    // baseline's angle when known, else its shape.
    const vertical = t.angle !== undefined ? Math.abs(Math.sin(t.angle)) > 0.7 : t.h > t.w * 1.2;
    const gap = Math.max(t.h, Math.min(t.w, t.h)) * 1.6 + 2;
    const cx = Math.floor(t.cx / cell);
    const cy = Math.floor(t.cy / cell);
    let best: number | null = null;
    let bestD = Infinity;
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        for (const s of grid.get(`${cx + i},${cy + j}`) ?? []) {
          const dx = s.x2 - s.x1;
          const dy = s.y2 - s.y1;
          const L = Math.hypot(dx, dy);
          const along = vertical ? Math.abs(dy) / L : Math.abs(dx) / L;
          if (along < 0.999) continue;
          // The text sits beside the line, within its length.
          const ux = dx / L;
          const uy = dy / L;
          const t0 = (t.cx - s.x1) * ux + (t.cy - s.y1) * uy;
          const off = Math.abs((t.cx - s.x1) * -uy + (t.cy - s.y1) * ux);
          if (t0 < 0 || t0 > L || off > gap || L < Math.max(t.w, t.h)) continue;
          if (off < bestD) {
            bestD = off;
            best = L;
          }
        }
      }
    }
    if (best) votes.push(meters / best);
  }
  if (votes.length < 3) return null;
  // The scale most votes agree on (within 1.5%).
  let top: ScaleCheck | null = null;
  for (const v of votes) {
    const agree = votes.filter((w) => Math.abs(w / v - 1) < 0.015);
    if (!top || agree.length > top.agree) {
      const mean = agree.reduce((n, w) => n + w, 0) / agree.length;
      top = { label: '', metersPerPoint: mean, agree: agree.length, read };
    }
  }
  if (!top || top.agree < 3) return null;
  // Only a standard scale counts: a cluster that lands between scales is other numbers
  // (levels, sizes) lining up by chance.
  // Millimetre dimensions belong to a metric scale, feet and inches to an imperial one.
  const preset = SCALE_PRESETS[units].find((l) => Math.abs(parseScale(l)! / top!.metersPerPoint - 1) < 0.02);
  return preset ? { ...top, label: preset, metersPerPoint: parseScale(preset)! } : null;
}
