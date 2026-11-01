import {expect,it} from 'vitest';
import * as THREE from 'three';
import {drawingHit} from '../src/explore/drawingHit';
import {worldPoint} from '../src/explore/spatial';
const frame={a:0,b:.02,tx:20,ty:-9,residual:0};
function tiledPaper(){
 const paper=new THREE.Group();
 for(const [left,right] of [[0,50],[50,100]]){
  const points=[[left,0],[right,0],[right,100],[left,100]] as [number,number][];
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>{const w=worldPoint(p,frame);return [w[0],0,w[1]];}),3));
  // Both pieces use 0..1 crop-local UVs, despite different source extents.
  g.setAttribute('uv',new THREE.Float32BufferAttribute([0,1,1,1,1,0,0,0],2));g.setIndex([0,2,1,0,3,2]);
  paper.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
 }
 paper.updateMatrixWorld(true);return paper;
}
it('picks both coarse and detail children in the same rotated PDF coordinate frame',()=>{
 const paper=tiledPaper();
 for(const point of [[25,30],[75,70]] as [number,number][]){
  const at=worldPoint(point,frame),ray=new THREE.Raycaster(new THREE.Vector3(at[0],10,at[1]),new THREE.Vector3(0,-1,0));
  const hit=drawingHit(ray,paper,frame)!;
  expect(hit[0]).toBeCloseTo(point[0],4);expect(hit[1]).toBeCloseTo(point[1],4);
 }
});
it('does not select rooms through a hidden drawing or outside the paper',()=>{
 const paper=tiledPaper(),ray=new THREE.Raycaster(new THREE.Vector3(19,10,-8),new THREE.Vector3(0,-1,0));
 paper.visible=false;expect(drawingHit(ray,paper,frame)).toBeNull();paper.visible=true;
 ray.ray.origin.x=100;expect(drawingHit(ray,paper,frame)).toBeNull();
});
