import { it, expect } from "vitest";
import * as THREE from "three";
import { perspectiveBoundsDistance, lensDistance } from "../src/explore/camera";
const corners = (box: THREE.Box3) => {
  const out: [number, number, number][] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push([x, y, z]);
  return out;
};
function project(box: THREE.Box3, aspect: number) {
  const target = box.getCenter(new THREE.Vector3()),
    direction = new THREE.Vector3(0.65, 0.9, 0.8).normalize(),
    points = corners(box);
  const distance = perspectiveBoundsDistance(
    points,
    target.toArray(),
    direction.toArray(),
    38,
    aspect,
  );
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.05, 10000);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return points.map((p) => new THREE.Vector3(...p).project(camera));
}
it("fits every perspective corner of a long building on the narrow live canvas", () => {
  const b = new THREE.Box3(
    new THREE.Vector3(-7, -2, -28),
    new THREE.Vector3(7, 11, 28),
  );
  for (const aspect of [616 / 936, 0.4, 1, 2.4])
    for (const p of project(b, aspect)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / 1.15);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / 1.15);
      expect(p.z).toBeLessThan(1);
      expect(p.z).toBeGreaterThan(-1);
    }
});
it("accounts for assembly offsets and elevated drawing geometry", () => {
  const b = new THREE.Box3(
    new THREE.Vector3(100, -1, -40),
    new THREE.Vector3(115, 26, 15),
  );
  for (const p of project(b, 0.65)) {
    expect(Math.abs(p.x)).toBeLessThan(1);
    expect(Math.abs(p.y)).toBeLessThan(1);
  }
});
it("preserves the existing sheet lens framing calculation", () => {
  expect(lensDistance(20, 1.5)).toBeCloseTo(763.900879);
});
it("fits a selected member even when its focus point is offset from the bounds centre", () => {
  const b = new THREE.Box3(
    new THREE.Vector3(-3, 8, -12),
    new THREE.Vector3(3, 10, 12),
  );
  const target = new THREE.Vector3(1, 9, -4),
    direction = new THREE.Vector3(0.65, 0.9, 0.8).normalize();
  const points = corners(b),
    distance = perspectiveBoundsDistance(
      points,
      target.toArray(),
      direction.toArray(),
      38,
      616 / 936,
      1.2,
    );
  const camera = new THREE.PerspectiveCamera(38, 616 / 936, 0.05, 10000);
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  for (const p of points) {
    const q = new THREE.Vector3(...p).project(camera);
    expect(Math.abs(q.x)).toBeLessThan(1 / 1.2);
    expect(Math.abs(q.y)).toBeLessThan(1 / 1.2);
  }
});
