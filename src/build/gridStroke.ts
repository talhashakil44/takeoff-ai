import type {Pt} from '../model';
import type {Segment} from '../fill/vectors';
import type {DrawingText} from './building';
/** Follow a grid bubble's straight leader and optional dogleg to the actual axis.
 * Bubble text is not an axis: offset labels must not become building coordinates.
 * Require a continuation on the final axis, and reject branching/ambiguous leaders. */
export function traceGridStroke(
  tag: DrawingText,
  lines: Segment[],
  axis: 'x' | 'y',
  inward: 1 | -1,
): number | null {
  const valid = lines.filter(
    (l) => !l.filled && !l.curve && l.width > 0 && l.width <= 0.6,
  );
  const at = (p: Pt) => (axis === 'x' ? p[0] : p[1]);
  const along = (p: Pt) => (axis === 'x' ? p[1] : p[0]);
  const centre: Pt = [tag.cx, tag.cy];
  const endpoints = (l: Segment): [Pt, Pt] => [
    [l.x1, l.y1],
    [l.x2, l.y2],
  ];
  // Most source segments cannot be leaders. Test scalar coordinates before
  // allocating/sorting endpoint arrays for every segment and every grid label.
  const starts: {a: Pt; b: Pt}[] = [];
  for (const l of valid) {
    const aAt = axis === 'x' ? l.x1 : l.y1;
    const bAt = axis === 'x' ? l.x2 : l.y2;
    const aAlong = axis === 'x' ? l.y1 : l.x1;
    const bAlong = axis === 'x' ? l.y2 : l.x2;
    const reversed = inward * (aAlong - bAlong) > 0;
    const startAt = reversed ? bAt : aAt;
    const startAlong = reversed ? bAlong : aAlong;
    const endAlong = reversed ? aAlong : bAlong;
    const distance = inward * (startAlong - along(centre));
    if (Math.abs(aAt - bAt) < 0.3 &&
        Math.abs(startAt - at(centre)) < 1 &&
        distance > 8 && distance < 24 &&
        inward * (endAlong - startAlong) > 8) {
      const [a, b] = endpoints(l);
      starts.push(reversed ? {a:b, b:a} : {a, b});
    }
  }
  const unique = starts.filter(
    (v, i) =>
      !starts
        .slice(0, i)
        .some(
          (w) =>
            Math.hypot(v.a[0] - w.a[0], v.a[1] - w.a[1]) < 0.5 &&
            Math.hypot(v.b[0] - w.b[0], v.b[1] - w.b[1]) < 0.5,
        ),
  );
  if (unique.length !== 1) return null;
  let endpoint = unique[0].b;
  const diagonal: Pt[] = [];
  for (const l of valid) {
    const firstNear = Math.hypot(l.x1 - endpoint[0], l.y1 - endpoint[1]) < 0.5;
    if (!firstNear && Math.hypot(l.x2 - endpoint[0], l.y2 - endpoint[1]) >= 0.5) continue;
    const x = firstNear ? l.x2 : l.x1, y = firstNear ? l.y2 : l.y1;
    const otherAt = axis === 'x' ? x : y, otherAlong = axis === 'x' ? y : x;
    if (Math.abs(otherAt - at(endpoint)) > 2 &&
        inward * (otherAlong - along(endpoint)) > 2 &&
        Math.hypot(x - endpoint[0], y - endpoint[1]) < 80) diagonal.push([x,y]);
  }
  const turns = diagonal.filter(
    (v, i) =>
      !diagonal
        .slice(0, i)
        .some((w) => Math.hypot(v[0] - w[0], v[1] - w[1]) < 0.5),
  );
  if (turns.length > 1) return null;
  if (turns[0]) endpoint = turns[0];
  let support = 0;
  for (const l of valid) {
    const aAt = axis === 'x' ? l.x1 : l.y1, bAt = axis === 'x' ? l.x2 : l.y2;
    const aAlong = axis === 'x' ? l.y1 : l.x1, bAlong = axis === 'x' ? l.y2 : l.x2;
    if (Math.abs(aAt - at(endpoint)) < 0.3 &&
        Math.abs(bAt - at(endpoint)) < 0.3 &&
        Math.max(inward * (aAlong - along(endpoint)), inward * (bAlong - along(endpoint))) > 15)
      support += Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  }
  return support > 60 ? at(endpoint) : null;
}

