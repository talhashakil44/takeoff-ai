import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { runSolids } from './solids';
import type { BuildElement } from './types';

export function geometryOf(e: BuildElement): THREE.BufferGeometry | null {
  const s = e.shape;
  if (!s) return null;
  if (s.type === 'locator') {
    const marker = new THREE.SphereGeometry(0.16, 8, 6);
    marker.translate(s.at[0], s.z + 0.16, s.at[1]);
    return marker;
  }
  if (s.type === 'axis') {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 1; i < s.points.length; i++) {
      const [x0, y0] = s.points[i - 1], [x1, y1] = s.points[i];
      const from = new THREE.Vector3(x0, s.z, y0), to = new THREE.Vector3(x1, s.z, y1);
      const direction = to.clone().sub(from), length = direction.length();
      if (length < 0.001) continue;
      // A thin scene marker keeps the measured span selectable; its radius is not a member size.
      const marker = new THREE.CylinderGeometry(0.025, 0.025, length, 6);
      marker.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
      marker.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
      parts.push(marker);
    }
    if (!parts.length) return null;
    const g = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    if (parts.length > 1) for (const p of parts) p.dispose();
    return g;
  }
  if (s.type === 'run') {
    const parts: THREE.BufferGeometry[] = [];
    for (const p of runSolids(s)) {
      const maxHeight = Math.max(p.height, p.endHeight);
      const g = new THREE.BoxGeometry(p.length, maxHeight, p.thickness);
      const vertices = g.getAttribute('position');
      for (let i = 0; i < vertices.count; i++)
        if (vertices.getY(i) > 0) vertices.setY(i, (vertices.getX(i) < 0 ? p.height : p.endHeight) - maxHeight / 2);
      g.computeVertexNormals();
      g.rotateY(-Math.atan2(p.dy, p.dx));
      g.translate(p.x + (p.dx * p.length) / 2, p.z + maxHeight / 2, p.y + (p.dy * p.length) / 2);
      parts.push(g);
    }
    if (!parts.length) return null;
    const g = parts.length === 1 ? parts[0] : mergeGeometries(parts);
    if (parts.length > 1) for (const p of parts) p.dispose();
    return g;
  }
  if (s.type === 'surface') {
    if (s.ring.length < 3) return null;
    const shape = new THREE.Shape(s.ring.map(([x, y]) => new THREE.Vector2(x, -y)));
    for (const h of s.holes) if (h.length >= 3) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: s.thickness, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const positions = g.getAttribute('position');
    if (s.slope) {
      for (let i = 0; i < positions.count; i++)
        positions.setY(i, positions.getY(i) + s.slope[0] * positions.getX(i) + s.slope[1] * positions.getZ(i));
      g.computeVertexNormals();
    }
    g.translate(0, s.z, 0);
    return g;
  }
  const g = new THREE.BoxGeometry(s.size[0], s.size[2], s.size[1]);
  g.rotateY(-(s.rotation ?? 0));
  g.translate(s.at[0], s.z + s.size[2] / 2, s.at[1]);
  return g;
}
