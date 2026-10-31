import { expect, it } from 'vitest';
import * as THREE from 'three';
import { planProjection } from '../src/explore/planProjection';
it('projects a below-grade wall to its exact plan outline without changing its physical geometry', () => {
  const wall = new THREE.BoxGeometry(2.5865667, .95, .3);
  wall.translate(10, -.725, 20);
  const before = Array.from(wall.getAttribute('position').array);
  const plan = planProjection(wall, .025);
  expect(plan.getAttribute('position').count).toBe(8);
  plan.computeBoundingBox();
  expect(plan.boundingBox!.min.y).toBeCloseTo(.025);
  expect(plan.boundingBox!.max.y).toBeCloseTo(.025);
  expect(plan.boundingBox!.getSize(new THREE.Vector3()).x).toBeCloseTo(2.5865667, 4);
  expect(plan.boundingBox!.getSize(new THREE.Vector3()).z).toBeCloseTo(.3, 4);
  expect(Array.from(wall.getAttribute('position').array)).toEqual(before);
  wall.dispose(); plan.dispose();
});
