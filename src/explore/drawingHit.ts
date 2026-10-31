import type { Object3D, Raycaster } from 'three';
import { sheetPoint, type SheetFrame } from './spatial';
/** A tiled drawing has crop-local UVs. Pick its child meshes and recover the
 * original PDF point from the shared registered world frame. */
export function drawingHit(ray: Raycaster, paper: Object3D, frame: SheetFrame) {
  if(!paper.visible)return null;
  const hit=ray.intersectObject(paper,true)[0];
  return hit?sheetPoint([hit.point.x,hit.point.z],frame):null;
}
