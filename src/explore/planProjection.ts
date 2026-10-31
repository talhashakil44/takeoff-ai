import * as THREE from 'three';

/** Orthographic projection of existing physical edges; never changes the model.
 * Collapse coincident top/bottom edges and discard vertical edges, so below-grade
 * members remain inspectable against the PDF without inventing a new footprint. */
export function planProjection(source: THREE.BufferGeometry, datum: number) {
  const edges = new THREE.EdgesGeometry(source, 28);
  const positions = edges.getAttribute('position');
  const segments = new Map<string, number[]>();
  for (let i = 0; i < positions.count; i += 2) {
    const a = [positions.getX(i), positions.getZ(i)];
    const b = [positions.getX(i + 1), positions.getZ(i + 1)];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.00001) continue;
    const key = [a.map(v => v.toFixed(5)).join(','), b.map(v => v.toFixed(5)).join(',')].sort().join(':');
    segments.set(key, [a[0], datum, a[1], b[0], datum, b[1]]);
  }
  edges.dispose();
  return new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute([...segments.values()].flat(), 3));
}
