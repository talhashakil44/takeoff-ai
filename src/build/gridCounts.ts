/** A tag labels a component nearby; it is not the component's centre. */
export interface GridSnap {
  point: [number, number];
  labels: [string, string];
  distanceM: number;
}

/** Use only axes that passed the sheet's cross-sheet grid registration. */
export function nearestGridIntersection(
  axes: Record<string, { axis: 'x' | 'y'; at: number }>,
  registeredLabels: string[],
  tag: [number, number],
  metresPerPoint: number,
  maxDistanceM = 2.5,
): GridSnap | null {
  if (!(metresPerPoint > 0) || !Number.isFinite(metresPerPoint)) return null;
  const allowed = new Set(registeredLabels);
  const xs = Object.entries(axes).filter(([key, value]) => allowed.has(key) && value.axis === 'x');
  const ys = Object.entries(axes).filter(([key, value]) => allowed.has(key) && value.axis === 'y');
  if (!xs.length || !ys.length) return null;
  let best: GridSnap | null = null;
  for (const [xLabel, x] of xs) for (const [yLabel, y] of ys) {
    const distanceM = Math.hypot(x.at - tag[0], y.at - tag[1]) * metresPerPoint;
    if (distanceM <= maxDistanceM && (!best || distanceM < best.distanceM))
      best = { point: [x.at, y.at], labels: [xLabel, yLabel], distanceM };
  }
  return best;
}
