import * as THREE from 'three';
import type { Pt3 } from './scene';
import { fitCamera, type ModelRenderer } from './render';
import { EYE, PASSABLE, type WalkPlan } from './walkplan';

/**
 * Walking and touring the model at a person's eye height. Walk: first person, the keys or the
 * on-screen arrows to move, a drag to look, walls in the way, doors not. Tour: a fly-through of
 * stops the plan picked, eased from one to the next, each with a caption.
 */

/** Model metres (Z up) to three's Y-up. */
export const toThree = (p: Pt3) => new THREE.Vector3(p[0], p[2], -p[1]);

/** What the frame loop drives while walking or touring; true when the picture changed. */
export interface Nav {
  update(now: number, dt: number): boolean;
  look?(dx: number, dy: number): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const RADIUS = 0.3;
const STEP = 0.5;
const WALK = 2.2;
const RUN = 5.5;
/** What you can stand on. */
const GROUND = new Set(['floor', 'stairs', 'site', 'paving', 'roof', 'foundation', 'civil']);

export class Walker implements Nav {
  readonly feet = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  /** Keys held (KeyboardEvent.code), from the keyboard or the on-screen arrows. */
  readonly keys = new Set<string>();
  run = false;
  level = 0;
  onLevel?: (i: number) => void;
  private fall = 0;
  private ray = new THREE.Raycaster();
  private lists: { version: number; walls: THREE.Mesh[]; floors: THREE.Object3D[]; decks: THREE.Object3D[]; doors: THREE.Box3[] } | null = null;
  private moved = true;

  constructor(private m: ModelRenderer, readonly plan: WalkPlan) {}

  /** Stands at a stop (eye height included), facing what it looks at. */
  begin(at: Pt3 = this.plan.start.at, look: Pt3 = this.plan.start.look) {
    const eye = toThree(at);
    this.feet.copy(eye).addScaledVector(UP, -EYE);
    this.face(toThree(look), eye);
    const g = this.groundBelow(this.feet, 2);
    if (g !== null) this.feet.y = g;
    this.level = this.levelAt(this.feet.y);
    this.onLevel?.(this.level);
    this.moved = true;
    this.place();
  }

  face(target: THREE.Vector3, from = this.m.camera.position) {
    const d = target.clone().sub(from);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0042;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * 0.0042));
    this.moved = true;
  }

  /** Up or down a level, landing where there is floor. */
  changeLevel(by: number) {
    const i = Math.max(0, Math.min(this.plan.levels.length - 1, this.level + by));
    if (i === this.level) return;
    const z = this.plan.levels[i].z;
    const probe = new THREE.Vector3(this.feet.x, z, this.feet.z);
    // Only a floor counts here, not a canopy or a roof you happen to be under.
    const g = this.groundBelow(probe, 0.5, this.meshes.decks);
    if (g !== null && Math.abs(g - z) < 0.45 && this.roomy(probe.setY(g))) this.feet.copy(probe);
    else {
      // No floor (or no room) here on that level: go to its nearest open spot and look the open way.
      let best: THREE.Vector3 | null = null;
      for (const s of this.plan.spots[i] ?? []) {
        const p = toThree([s[0], s[1], z]);
        if (!best || p.distanceToSquared(this.feet) < best.distanceToSquared(this.feet)) best = p;
      }
      if (!best) return;
      this.feet.copy(best);
      const g2 = this.groundBelow(this.feet, 0.5);
      if (g2 !== null) this.feet.y = g2;
      this.faceOpen();
    }
    this.fall = 0;
    this.level = i;
    this.onLevel?.(i);
    this.moved = true;
  }

  update(_now: number, dt: number) {
    // Slow frames still cover the ground, in small steps so walls stay solid.
    dt = Math.min(dt, 0.25);
    for (; dt > 0.05; dt -= 0.05) this.step(0.05);
    this.step(dt);
    const lv = this.levelAt(this.feet.y);
    if (lv !== this.level) {
      this.level = lv;
      this.onLevel?.(lv);
    }
    if (!this.moved) return false;
    this.moved = false;
    this.place();
    return true;
  }

  private step(dt: number) {
    const k = this.keys;
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    if (turn) {
      this.yaw -= turn * 1.9 * dt;
      this.moved = true;
    }
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (fwd || side) {
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const d = f.multiplyScalar(fwd).add(r.multiplyScalar(side)).normalize().multiplyScalar((this.run ? RUN : WALK) * dt);
      this.move(d);
      this.moved = true;
    }
    // Stay on the floor: step up onto stairs, drop off edges.
    const g = this.groundBelow(this.feet, STEP);
    if (g !== null) {
      if (g >= this.feet.y - 0.02) {
        if (Math.abs(g - this.feet.y) > 1e-3) this.moved = true;
        this.feet.y += (g - this.feet.y) * Math.min(1, dt * 14);
        this.fall = 0;
      } else {
        this.fall -= 12 * dt;
        this.feet.y = Math.max(g, this.feet.y + this.fall * dt);
        if (this.feet.y === g) this.fall = 0;
        this.moved = true;
      }
    }
  }

  private place() {
    const c = this.m.camera;
    c.position.copy(this.feet).addScaledVector(UP, EYE);
    c.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    c.updateMatrixWorld();
  }

  private levelAt(y: number) {
    let i = 0;
    this.plan.levels.forEach((l, k) => {
      if (l.z <= y + 0.4) i = k;
    });
    return i;
  }

  /** The meshes that stop you, the ones you stand on, and the doorways, rebuilt when the model changes. */
  private get meshes() {
    const m = this.m;
    if (this.lists?.version === m.version) return this.lists;
    const walls: THREE.Mesh[] = [], floors: THREE.Object3D[] = [], decks: THREE.Object3D[] = [], doors: THREE.Box3[] = [];
    for (const it of m.items) {
      if (!it.mesh.visible) continue;
      const c = it.el.category;
      if (!PASSABLE.has(c)) walls.push(it.mesh);
      if (GROUND.has(c)) floors.push(it.mesh);
      if (c === 'floor') decks.push(it.mesh);
      if (c === 'doors') {
        const b = it.mesh.geometry.boundingBox?.clone();
        if (!b || b.max.y - b.min.y < 1.6) continue;
        // Reach through the wall either side of the door.
        const s = b.getSize(new THREE.Vector3());
        if (s.x < s.z) b.expandByVector(new THREE.Vector3(0.45, 0, -0.05));
        else b.expandByVector(new THREE.Vector3(-0.05, 0, 0.45));
        b.min.y -= 0.3;
        doors.push(b);
      }
    }
    if (m.groundMesh) floors.push(m.groundMesh);
    this.lists = { version: m.version, walls, floors, decks, doors };
    return this.lists;
  }

  /** Room to stand: nothing within an arm's length all round. */
  private roomy(feet: THREE.Vector3) {
    for (let k = 0; k < 8; k++) if (this.blocked(new THREE.Vector3(Math.cos((k * Math.PI) / 4), 0, Math.sin((k * Math.PI) / 4)), 0.6, feet)) return false;
    return true;
  }

  /** Turns to look down the longest clear view. */
  private faceOpen() {
    let best = { yaw: this.yaw, run: -1 };
    for (let k = 0; k < 24; k++) {
      const yaw = (k / 24) * Math.PI * 2;
      const run = this.blocked(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 30)?.distance ?? 30;
      if (run > best.run) best = { yaw, run };
    }
    this.yaw = best.yaw;
    this.pitch = -0.06;
  }

  /** The first wall hit along a direction within `far`, from knee, chest and eye height. */
  private blocked(dir: THREE.Vector3, far: number, feet = this.feet) {
    const { walls, doors } = this.meshes;
    const across = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(RADIUS * 0.7);
    const from: THREE.Vector3[] = [0.45, 1.05, EYE - 0.05].map((h) => feet.clone().addScaledVector(UP, h));
    from.push(from[1].clone().add(across), from[1].clone().sub(across));
    let best: THREE.Intersection | null = null;
    for (const o of from) {
      this.ray.set(o, dir);
      this.ray.far = far;
      for (const h of this.ray.intersectObjects(walls, false)) {
        if (doors.some((b) => b.containsPoint(h.point))) continue;
        if (!best || h.distance < best.distance) best = h;
        break;
      }
    }
    return best;
  }

  /** Moves by d, sliding along whatever is in the way. */
  private move(d: THREE.Vector3) {
    for (let tries = 0; tries < 3; tries++) {
      const len = d.length();
      if (len < 1e-5) return;
      const dir = d.clone().divideScalar(len);
      const hit = this.blocked(dir, len + RADIUS);
      if (!hit) {
        this.feet.add(d);
        return;
      }
      const go = Math.max(0, hit.distance - RADIUS);
      this.feet.addScaledVector(dir, Math.min(go, len));
      const n = (hit.face?.normal.clone() ?? dir.clone().negate()).setY(0);
      if (n.lengthSq() < 1e-6) return;
      n.normalize();
      if (n.dot(dir) > 0) n.negate();
      const rest = dir.multiplyScalar(len - Math.min(go, len));
      d = rest.sub(n.multiplyScalar(rest.dot(n)));
    }
  }

  /** The floor under a point: the first thing below `above` metres over it. */
  private groundBelow(p: THREE.Vector3, above: number, of = this.meshes.floors): number | null {
    this.ray.set(p.clone().addScaledVector(UP, above), new THREE.Vector3(0, -1, 0));
    this.ray.far = 80;
    const hit = this.ray.intersectObjects(of, false)[0];
    return hit ? hit.point.y : null;
  }
}

// ---------------------------------------------------------------------------- the tour

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Route from the shot before (three coords), walked along instead of flown straight. */
  route?: THREE.Vector3[];
  title: string;
  text: string;
  /** Section cut while at this shot. */
  cut: number | null;
}

/** The tour: the street-side approach, the front door, the rooms level by level, then a cutaway. */
export function tourShots(m: ModelRenderer, plan: WalkPlan): Shot[] {
  const shots: Shot[] = [];
  const [sx, sy] = plan.street;
  // The building alone, so a service line running off to the road doesn't shrink it in the frame.
  const e = plan.extent;
  const box = e ? new THREE.Box3(toThree([e[0], e[4], e[2]]), toThree([e[3], e[1], e[5]])) : m.box.clone();
  const app = fitCamera(m.camera, box, new THREE.Vector3(sx, 0.22, -sy));
  const size = box.getSize(new THREE.Vector3());
  app.target.y = box.min.y + size.y * 0.35;
  const [w, d] = e ? [e[3] - e[0], e[4] - e[1]] : [size.x, size.z];
  shots.push({ pos: app.position, look: app.target, title: 'Approach', text: `From the street side: about ${Math.round(w)} × ${Math.round(d)} m, ${plan.levels.length === 1 ? 'one level' : `${plan.levels.length} levels`}.`, cut: null });
  for (const s of plan.stops)
    shots.push({ pos: toThree(s.at), look: toThree(s.look), route: s.route?.map(toThree), title: s.title, text: s.text, cut: null });
  // The ground floor cut open, seen from high on the street side; framed a little high, clear of the caption.
  const floor = plan.levels[0].z;
  const low = box.clone();
  low.max.y = Math.max(low.min.y + 0.5, floor + 1.8);
  const cut = fitCamera(m.camera, low, new THREE.Vector3(sx * 0.6, 1.1, -sy * 0.6 + 0.25));
  cut.target.y -= cut.position.distanceTo(cut.target) * 0.08;
  shots.push({ pos: cut.position, look: cut.target, title: 'Cutaway', text: `The ${plan.levels[0].name.toLowerCase()} from above, cut 1.8 m over the floor.`, cut: floor + 1.8 });
  return shots;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const facing = (eye: THREE.Vector3, target: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, UP));

export class TourPlayer implements Nav {
  i = -1;
  playing = true;
  /** How long to stay at each stop once there (ms). */
  stay = 3400;
  onShot?: (i: number) => void;
  onEnd?: () => void;
  private move: { t0: number; ms: number; from: THREE.Vector3; q0: THREE.Quaternion; q1: THREE.Quaternion; path: THREE.Curve<THREE.Vector3> | null } | null = null;
  private arrived = 0;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private m: ModelRenderer, readonly shots: Shot[]) {}

  go(i: number) {
    if (i < 0 || i >= this.shots.length) return;
    const s = this.shots[i];
    const c = this.m.camera;
    const from = c.position.clone();
    let path: THREE.Curve<THREE.Vector3> | null = null;
    // Walk the route if we are where it starts; otherwise fly straight.
    if (s.route && s.route.length > 1 && s.route[0].distanceTo(from) < 0.5) {
      // No two points on top of each other: the curve can't measure a zero-length piece.
      const pts = [from, ...s.route.slice(1, -1), s.pos].filter((p, k, a) => k === 0 || p.distanceTo(a[k - 1]) > 0.05);
      path = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3) : new THREE.LineCurve3(from, s.pos);
    }
    const len = path ? path.getLength() : from.distanceTo(s.pos);
    const ms = this.still ? 1 : Math.max(1300, Math.min(i === 0 ? 2400 : 3600, (len / (path ? 2.4 : 6)) * 1000));
    this.move = { t0: performance.now(), ms, from, q0: c.quaternion.clone(), q1: facing(s.pos, s.look), path };
    this.i = i;
    this.onShot?.(i);
  }

  next() {
    if (this.i < this.shots.length - 1) this.go(this.i + 1);
  }
  back() {
    if (this.i > 0) this.go(this.i - 1);
  }

  update(now: number) {
    const c = this.m.camera;
    if (this.move) {
      const { t0, ms, from, q0, q1, path } = this.move;
      // A frame's time can be a moment before the move began.
      const t = Math.max(0, Math.min(1, (now - t0) / ms));
      const k = ease(t);
      const s = this.shots[this.i];
      if (path) {
        c.position.copy(path.getPointAt(k));
        // Look where you are going, turning in at the start and out to the view at the end.
        const ahead = path.getPointAt(Math.min(1, k + 0.04));
        const along = ahead.distanceTo(c.position) > 1e-3 ? facing(c.position, ahead.setY(c.position.y)) : q1;
        const q = t < 0.2 ? q0.clone().slerp(along, ease(t / 0.2)) : along;
        c.quaternion.copy(t > 0.75 ? q.clone().slerp(q1, ease((t - 0.75) / 0.25)) : q);
      } else {
        c.position.lerpVectors(from, s.pos, k);
        c.quaternion.copy(q0).slerp(q1, k);
      }
      c.updateMatrixWorld();
      if (t >= 1) {
        this.move = null;
        this.arrived = now;
      }
      return true;
    }
    if (this.playing && this.i >= 0 && now - this.arrived > this.stay) {
      if (this.i < this.shots.length - 1) this.go(this.i + 1);
      else {
        this.playing = false;
        this.onEnd?.();
      }
    }
    return false;
  }

  /** Keeps the stay timer fair when play resumes. */
  play(on: boolean) {
    this.playing = on;
    if (on) this.arrived = performance.now();
  }
}
