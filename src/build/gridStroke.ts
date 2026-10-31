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
  const starts = valid.flatMap((l) => {
    const [a, b] = endpoints(l).sort((a, b) => inward * (along(a) - along(b)));
    const offset = Math.abs(at(a) - at(centre)),
      distance = inward * (along(a) - along(centre));
    return Math.abs(at(a) - at(b)) < 0.3 &&
      offset < 1 &&
      distance > 8 &&
      distance < 24 &&
      inward * (along(b) - along(a)) > 8
      ? [{ a, b }]
      : [];
  });
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
  const diagonal = valid.flatMap((l) => {
    const ps = endpoints(l),
      near = ps.findIndex(
        (p) => Math.hypot(p[0] - endpoint[0], p[1] - endpoint[1]) < 0.5,
      );
    if (near < 0) return [];
    const other = ps[1 - near];
    return Math.abs(at(other) - at(endpoint)) > 2 &&
      inward * (along(other) - along(endpoint)) > 2 &&
      Math.hypot(other[0] - endpoint[0], other[1] - endpoint[1]) < 80
      ? [other]
      : [];
  });
  const turns = diagonal.filter(
    (v, i) =>
      !diagonal
        .slice(0, i)
        .some((w) => Math.hypot(v[0] - w[0], v[1] - w[1]) < 0.5),
  );
  if (turns.length > 1) return null;
  if (turns[0]) endpoint = turns[0];
  const support = valid
    .filter((l) => {
      const [a, b] = endpoints(l);
      return (
        Math.abs(at(a) - at(endpoint)) < 0.3 &&
        Math.abs(at(b) - at(endpoint)) < 0.3 &&
        Math.max(
          inward * (along(a) - along(endpoint)),
          inward * (along(b) - along(endpoint)),
        ) > 15
      );
    })
    .reduce((sum, l) => sum + Math.hypot(l.x2 - l.x1, l.y2 - l.y1), 0);
  return support > 60 ? at(endpoint) : null;
}

