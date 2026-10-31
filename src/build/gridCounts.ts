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

/** Explain a withheld symbolic location without relaxing its placement gate. */
export function gridLocationFailure(
 axes: Record<string,{axis:'x'|'y';at:number}>,labels:string[]|undefined,
 tag:[number,number],metresPerPoint:number,
):string {
 if(!(metresPerPoint>0)||!Number.isFinite(metresPerPoint))return 'Structural grid location unresolved: drawing scale is unavailable; count retained without 3D placement.';
 if(!labels)return 'Structural grid location unresolved: this sheet has no verified grid registration; count retained without 3D placement.';
 const nearest=nearestGridIntersection(axes,labels,tag,metresPerPoint,Infinity);
 if(!nearest)return 'Structural grid location unresolved: registered labels do not provide both intersecting axis families; count retained without 3D placement.';
 return `No registered structural grid intersection within 2.5 m of the tag; nearest registered intersection ${nearest.labels.join('/')} is ${nearest.distanceM.toFixed(2)} m away. Count retained without 3D placement; tag association requires source review.`;
}
