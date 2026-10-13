import type { ExtractedAssembly, ExtractedLayer, Extraction } from './ai/schema';
import type { Segment } from './fill/vectors';
import type { PageText } from './pageText';

/**
 * Reads an assembly schedule from the drawing's own text, no AI: the tables architects
 * draw as TYPE | DESIGN | CONSTRUCTION (or TYPE | ASSEMBLY | FIRE RATING | S.T.C. |
 * DESCRIPTION), one row per type. For each TYPE column: its tags, each tag's row
 * (between the drawn row lines), and that row's description cell, read as a title, its
 * bulleted layers and its notes. Other columns (fire rating, STC) become notes. The
 * section heading over the table gives the category.
 */

const TAG = /^[A-Z]{1,4}-?\d{1,3}[A-Z]?$/;
const DESCRIPTION = /^(?:CONSTRUCTION|DESCRIPTION|ASSEMBLY DESCRIPTION|COMPOSITION|MATERIALS?|LAYERS)$/i;
const IGNORED = /^(?:DESIGN|ASSEMBLY|DETAIL|SECTION|GRAPHIC|DIAGRAM|SKETCH)$/i;
const BULLET = /^[•·●▪◦\-–—*]\s*/;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

interface Line {
  text: string;
  x0: number;
  cy: number;
  h: number;
  /** Starts with a bullet drawn as a dot (typed bullets stay in the text). */
  dot?: boolean;
}

/** Text in a box as lines, top to bottom, each with where it starts. */
function lines(texts: PageText[], x0: number, x1: number, y0: number, y1: number): Line[] {
  const inside = texts.filter((t) => t.str.trim() && t.cx >= x0 && t.cx <= x1 && t.cy >= y0 && t.cy <= y1 && Math.abs(Math.sin(t.angle ?? 0)) < 0.5);
  inside.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const out: { items: PageText[]; cy: number; h: number }[] = [];
  for (const t of inside) {
    const l = out[out.length - 1];
    if (l && Math.abs(t.cy - l.cy) < 0.5 * Math.max(l.h, t.h)) {
      l.items.push(t);
      l.h = Math.max(l.h, t.h);
    } else out.push({ items: [t], cy: t.cy, h: t.h });
  }
  return out.map((l) => {
    const items = l.items.sort((a, b) => a.cx - b.cx);
    return { text: norm(items.map((t) => t.str).join(' ')), x0: Math.min(...items.map((t) => t.cx - t.w / 2)), cy: l.cy, h: l.h };
  });
}

/** Horizontal lines drawn across x, sorted by y: the table's row lines. */
function rowLines(segs: Segment[], x: number): number[] {
  const ys = segs
    .filter((s) => Math.abs(s.y1 - s.y2) < 0.5 && Math.min(s.x1, s.x2) <= x && Math.max(s.x1, s.x2) >= x && Math.abs(s.x2 - s.x1) > 20)
    .map((s) => (s.y1 + s.y2) / 2)
    .sort((a, b) => a - b);
  return ys.filter((y, i) => i === 0 || y - ys[i - 1] > 1);
}

/** Vertical lines drawn through height y: the table's column lines, sorted by x. */
function columnLines(segs: Segment[], y: number): number[] {
  const xs = segs
    .filter((s) => Math.abs(s.x1 - s.x2) < 0.5 && Math.min(s.y1, s.y2) <= y && Math.max(s.y1, s.y2) >= y && Math.abs(s.y2 - s.y1) > 10)
    .map((s) => (s.x1 + s.x2) / 2)
    .sort((a, b) => a - b);
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1);
}

/**
 * Bullets drawn as dots rather than typed: a small filled shape just left of where a
 * line's text starts.
 */
function dotBefore(segs: Segment[], x0: number, cy: number, h: number): boolean {
  return segs.some((s) => {
    if (!s.filled) return false;
    const x = (s.x1 + s.x2) / 2;
    const y = (s.y1 + s.y2) / 2;
    return x < x0 - 1 && x > x0 - 6 * h && Math.abs(y - cy) < h * 0.8 && Math.abs(s.x2 - s.x1) < h && Math.abs(s.y2 - s.y1) < h;
  });
}

/** Thickness and spacing printed in a layer, in millimetres (inches converted). */
export function measures(text: string): { thickness_mm: number | null; spacing_mm: number | null } {
  const t = text.toUpperCase();
  let spacing: number | null = null;
  const sp = /(?:@|\bAT\b)\s*(?:MAX\.?\s*)?(\d+(?:\.\d+)?)\s*(MM|"|IN\.?|INCH(?:ES)?)?\s*(?:O\.?\s*C\.?|C\/C|CENTRES?|CENTERS?)/.exec(t);
  if (sp) spacing = sp[2] && !/MM/.test(sp[2]) ? Math.round(Number(sp[1]) * 25.4) : Number(sp[1]);
  let thickness: number | null = null;
  const mm = /(\d+(?:\.\d+)?)\s*MM\b/.exec(t);
  if (mm && (!sp || mm.index !== sp.index + sp[0].indexOf(mm[1]))) thickness = Number(mm[1]);
  if (thickness === null) {
    const inch = /(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(?:"|IN\.?\b)/.exec(t);
    if (inch && (!sp || inch.index < sp.index)) {
      const [whole, frac] = inch[1].includes('/') ? (inch[1].includes(' ') ? inch[1].split(/\s+/) : ['0', inch[1]]) : [inch[1], '0/1'];
      const [n, d] = frac.split('/').map(Number);
      thickness = Math.round((Number(whole) + n / d) * 25.4);
    }
  }
  return { thickness_mm: thickness, spacing_mm: spacing };
}

/** What a layer is, from the words in it. */
export function roleOf(text: string): ExtractedLayer['role'] {
  const t = text.toUpperCase();
  if (/AIR\s*SPACE|CAVITY|AIR\s*GAP/.test(t)) return 'air_space';
  if (/\bSTUDS?\b|JOISTS?|GIRTS?|FURRING|\bTRACK\b|C-H|\bZ-|FRAMING|RUNNERS?|CHANNELS?|PURLINS?/.test(t)) return 'framing';
  if (/INSULATION|\bBATTS?\b|MINERAL WOOL|ROCKWOOL|SPRAY FOAM|\bEPS\b|\bXPS\b|POLYISO|R-?\d/.test(t)) return 'insulation';
  if (/SHEATHING|PLYWOOD|\bOSB\b/.test(t)) return 'sheathing';
  if (/MEMBRANE|VAPOU?R|AIR BARRIER|WATERPROOF|DAMPPROOF|\bPOLY\b|\bWRB\b|BUILDING PAPER/.test(t)) return 'membrane';
  if (/GYPSUM|\bGWB\b|DRYWALL|SHAFT\s*LINER|CEMENT BOARD|\bBOARD\b|ACOUSTIC (?:TILE|PANEL)/.test(t)) return 'board';
  if (/SIDING|CLADDING|\bACM\b|\bPANELS?\b|BRICK|STONE|STUCCO|EIFS|METAL ROOF|SHINGLE/.test(t)) return 'cladding';
  if (/CONCRETE|MASONRY|\bCMU\b|\bBLOCK\b|\bSLAB\b|\bDECK\b|\bCLT\b|TOPPING|\bICF\b/.test(t)) return 'structure';
  if (/GRANULAR|\bFILL\b|GRAVEL|\bSOIL\b/.test(t)) return 'fill';
  if (/PAINT|\bTILE\b|FINISH|CARPET|VINYL|\bLVT\b|WOOD FLOOR|MORTAR/.test(t)) return 'finish';
  return 'other';
}

function categoryOf(heading: string, code: string): ExtractedAssembly['category'] {
  const h = heading.toUpperCase();
  if (/EXTERIOR WALL/.test(h)) return 'exterior_wall';
  if (/ROOF/.test(h)) return 'roof';
  if (/CEILING/.test(h)) return 'ceiling';
  if (/FLOOR/.test(h)) return 'floor';
  if (/WALL|PARTITION|SHAFT/.test(h)) return /^(?:EW|EXT)/.test(code) ? 'exterior_wall' : 'interior_wall';
  if (/^(?:EW|EXT)/.test(code)) return 'exterior_wall';
  if (/^(?:R|RF)\d/.test(code)) return 'roof';
  if (/^(?:F|FL)\d/.test(code)) return 'floor';
  if (/^(?:C|CL)\d/.test(code)) return 'ceiling';
  return /^(?:W|IW|VS|SW|PW|CB|FR)/.test(code) ? 'interior_wall' : 'other';
}

/** A description cell as a title, its layers (the bulleted lines, wrapped lines joined) and its notes. */
export function readCell(cell: Line[]): { title: string; layers: ExtractedLayer[]; notes: string[] } {
  const layers: { text: string; x0: number }[] = [];
  const notes: string[] = [];
  let title = '';
  let inNotes = false;
  for (const l of cell) {
    const bulleted = l.dot || /^[•·●▪◦]/.test(l.text) || (/^[-–—*]\s/.test(l.text) && !/^-?\d/.test(l.text.replace(BULLET, '')));
    const text = norm(l.text.replace(BULLET, ''));
    if (!text) continue;
    const last = layers[layers.length - 1];
    if (bulleted) {
      layers.push({ text, x0: l.x0 });
      inNotes = false;
    } else if (last && !inNotes && l.x0 > last.x0 + 2) {
      // A layer wrapped onto the next line, indented under its text.
      last.text = norm(`${last.text} ${text}`);
    } else if (!title && !layers.length) {
      title = text;
    } else if (inNotes && notes.length && !/[.:]$/.test(notes[notes.length - 1])) {
      notes[notes.length - 1] = norm(`${notes[notes.length - 1]} ${text}`);
    } else {
      notes.push(text);
      inNotes = true;
    }
  }
  return { title, layers: layers.map((l) => ({ material: l.text, role: roleOf(l.text), ...measures(l.text) })), notes };
}

/** Every assembly type in the schedules on a sheet; empty when there are none (or the text is drawn as outlines). */
export function readAssemblyTable(texts: PageText[], segs: Segment[]): Extraction {
  const lineSegs = segs.filter((s) => !s.filled);
  const headers = texts.filter((t) => /^TYPE$/i.test(t.str.trim()));
  const assemblies: ExtractedAssembly[] = [];
  const seen = new Set<string>();
  for (const head of headers) {
    // The headers on the TYPE header's row, left to right from it.
    const row = texts
      .filter((t) => Math.abs(t.cy - head.cy) < head.h && t.cx > head.cx && t.str.trim().length > 1)
      .sort((a, b) => a.cx - b.cx);
    const next = row.findIndex((t) => /^TYPE$/i.test(t.str.trim()));
    const own = next >= 0 ? row.slice(0, next) : row;
    const descIndex = own.findIndex((t) => DESCRIPTION.test(norm(t.str)));
    if (descIndex < 0) continue;
    // Each column runs between the drawn column lines either side of its header (or
    // halfway to its neighbours where the table has none).
    const xs = [head.cx, ...own.map((t) => t.cx)];
    const vlines = columnLines(lineSegs, head.cy);
    const nextType = next >= 0 ? row[next].cx : Infinity;
    const edge = (i: number) => (i < 0 ? head.cx - 40 : i >= xs.length - 1 ? Math.min(xs[xs.length - 1] + (xs[xs.length - 1] - xs[xs.length - 2]), nextType - 20) : (xs[i] + xs[i + 1]) / 2);
    const colOf = (i: number): readonly [number, number] => {
      const left = vlines.filter((x) => x < xs[i]).pop();
      const right = vlines.find((x) => x > xs[i]);
      return [left ?? edge(i - 1), right ?? edge(i)];
    };
    const [tx0, tx1] = colOf(0);
    const [dx0, dx1] = colOf(descIndex + 1);
    const extra = own
      .map((t, i) => ({ t, range: colOf(i + 1) }))
      .filter(({ t }, i) => i !== descIndex && !IGNORED.test(norm(t.str)));
    // The heading over the table: the nearest line above the header row, over its columns.
    const heading =
      texts
        .filter((t) => t.cy < head.cy - head.h && t.cx > tx0 - 50 && t.cx < dx1 + 50 && t.h >= head.h * 0.9 && /[A-Z]{3}/.test(t.str))
        .sort((a, b) => b.cy - a.cy)[0]?.str ?? '';
    const tags = texts
      .filter((t) => TAG.test(t.str.trim()) && t.cx > tx0 && t.cx < tx1 && t.cy > head.cy + head.h)
      .sort((a, b) => a.cy - b.cy);
    const ys = rowLines(lineSegs, (dx0 + dx1) / 2);
    tags.forEach((tag, i) => {
      // The tag's row: between the row lines either side of it, or halfway to its neighbours.
      const top = Math.max(...ys.filter((y) => y < tag.cy), i ? (tags[i - 1].cy + tag.cy) / 2 : head.cy + head.h);
      const below = ys.filter((y) => y > tag.cy);
      const bottom = below.length ? Math.min(...below) : i < tags.length - 1 ? (tag.cy + tags[i + 1].cy) / 2 : tag.cy + (tag.cy - top);
      const cell = lines(texts, dx0, dx1, top, bottom).map((l) => ({ ...l, dot: dotBefore(segs, l.x0, l.cy, l.h) }));
      if (!cell.length) return;
      // The overall thickness: the one dimension under the design drawing (125, 155…).
      const design = own.map((t, k) => ({ t, k })).find(({ t }) => IGNORED.test(norm(t.str)));
      const dims = design
        ? (() => {
            const [a, b] = colOf(design.k + 1);
            return lines(texts, a, b, top, bottom).filter((l) => /^\d{2,3}$/.test(l.text));
          })()
        : [];
      const { title, layers, notes } = readCell(cell);
      const code = tag.str.trim().replace('-', '');
      const extras = extra.flatMap(({ t, range }) => {
        const text = norm(lines(texts, range[0], range[1], top, bottom).map((l) => l.text).join(' '));
        return text && text !== '-' ? [`${norm(t.str)}: ${text}`] : [];
      });
      const key = `${code}|${title}`;
      if (seen.has(key)) return;
      seen.add(key);
      assemblies.push({
        code,
        category: categoryOf(heading, code),
        title: title || code,
        layers,
        total_thickness_mm: dims.length === 1 ? Number(dims[0].text) : null,
        notes: [...extras, ...notes],
      });
    });
  }
  return { assemblies };
}
