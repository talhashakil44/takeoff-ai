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

/** Something riding along on a walk (fun mode): loaded only when switched on, gone when off. */
export interface WalkAddOn {
  /** Per frame; true when the picture changed. */
  update(dt: number): boolean;
  /** A click while walking, along the ray under the pointer; true when it was used (so it doesn't pick or open anything). */
  click(ray?: THREE.Ray): boolean;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const RADIUS = 0.3;
const STEP = 0.5;
const WALK = 2.8;
const RUN = 6.5;
/** Radians per pixel of drag. */
const LOOK = 0.0034;
const GRAVITY = 12;
/** Clears about 1.1 m: pipes, low walls, curbs and kerbs. */
const JUMP = 5.2;
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
  /** Speed multiplier, for add-ons. */
  speed = 1;
  /** Where the view is turning to: drags and keys set it, the view eases there. */
  private aimYaw = 0;
  private aimPitch = 0;
  /** Walking velocity (three coords), eased so starts and stops aren't jerky. */
  private vel = new THREE.Vector3();
  addOn: WalkAddOn | null = null;
  private vy = 0;
  private grounded = true;
  /** Doors swung open, by element id: angle now and where it's going. */
  private swung = new Map<string, { angle: number; to: number; hinge: THREE.Vector3; mesh: THREE.Mesh; alongX: boolean; centre: THREE.Vector3 }>();
  private swungVersion = -1;
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
    this.yaw = this.aimYaw = Math.atan2(-d.x, -d.z);
    this.pitch = this.aimPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  look(dx: number, dy: number) {
    this.aimYaw -= dx * LOOK;
    this.aimPitch = Math.max(-1.4, Math.min(1.4, this.aimPitch - dy * LOOK));
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
    this.vy = 0;
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
    if (this.swingDoors(dt)) this.moved = true;
    if (this.addOn?.update(dt)) this.moved = true;
    if (!this.moved) return false;
    this.moved = false;
    this.place();
    return true;
  }

  /** Space: up and over pipes, curbs and low walls. */
  jump() {
    if (!this.grounded) return;
    this.vy = JUMP;
    this.grounded = false;
    this.moved = true;
  }

  /** The door straight ahead within reach, or the one under a click (a ray in three coords). */
  doorAt(ray?: THREE.Ray, reach = 3.5): { id: string; mesh: THREE.Mesh } | null {
    const r = new THREE.Raycaster();
    if (ray) r.ray.copy(ray);
    else r.set(this.m.camera.position, this.m.camera.getWorldDirection(new THREE.Vector3()));
    r.far = reach;
    const doors = this.m.items.filter((i) => i.mesh.visible && i.el.category === 'doors');
    const hit = r.intersectObjects(doors.map((i) => i.mesh), false)[0];
    const it = hit ? doors.find((i) => i.mesh === hit.object) : null;
    return it ? { id: it.el.id, mesh: it.mesh } : null;
  }

  /** Swings a door open (away from you) or shut. */
  toggleDoor(d: { id: string; mesh: THREE.Mesh }) {
    if (this.swungVersion !== this.m.version) {
      this.swung.clear();
      this.swungVersion = this.m.version;
    }
    let s = this.swung.get(d.id);
    if (!s) {
      const b = d.mesh.geometry.boundingBox ?? (d.mesh.geometry.computeBoundingBox(), d.mesh.geometry.boundingBox!);
      const c = b.getCenter(new THREE.Vector3());
      const alongX = b.max.x - b.min.x >= b.max.z - b.min.z;
      s = { angle: 0, to: 0, hinge: alongX ? new THREE.Vector3(b.min.x, 0, c.z) : new THREE.Vector3(c.x, 0, b.min.z), mesh: d.mesh, alongX, centre: c };
      this.swung.set(d.id, s);
    }
    if (s.to) s.to = 0;
    else {
      // Swing the free end away from whoever opens it.
      const away = s.alongX ? (this.feet.z > s.centre.z ? 1 : -1) : this.feet.x < s.centre.x ? 1 : -1;
      s.to = (away * Math.PI) / 2;
    }
    this.moved = true;
  }

  private swingDoors(dt: number) {
    let any = false;
    for (const s of this.swung.values()) {
      if (s.angle === s.to) continue;
      const step = 3.2 * dt;
      s.angle = Math.abs(s.to - s.angle) <= step ? s.to : s.angle + Math.sign(s.to - s.angle) * step;
      const [c, n, h] = [Math.cos(s.angle), Math.sin(s.angle), s.hinge];
      s.mesh.rotation.set(0, s.angle, 0);
      s.mesh.position.set(h.x - (h.x * c + h.z * n), 0, h.z - (-h.x * n + h.z * c));
      s.mesh.updateMatrixWorld();
      any = true;
    }
    if (any) this.m.shadowsChanged();
    return any;
  }

  /** Floor height under a point near a height (three coords), for things placed on the floor. */
  floorNear(x: number, z: number, y: number): number | null {
    return this.groundBelow(new THREE.Vector3(x, y, z), 1.2);
  }

  /** What bullets stop at: the solid parts of the model. */
  get solids(): THREE.Object3D[] {
    return this.meshes.walls;
  }

  private step(dt: number) {
    const k = this.keys;
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    if (turn) {
      this.aimYaw -= turn * 2.2 * dt;
      this.moved = true;
    }
    // The view eases to where it's aimed: smooth, but quick enough to feel direct.
    const ease = Math.min(1, dt * 22);
    if (Math.abs(this.aimYaw - this.yaw) > 1e-4 || Math.abs(this.aimPitch - this.pitch) > 1e-4) {
      this.yaw += (this.aimYaw - this.yaw) * ease;
      this.pitch += (this.aimPitch - this.pitch) * ease;
      this.moved = true;
    }
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const want = new THREE.Vector3();
    if (fwd || side) {
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      want.copy(f.multiplyScalar(fwd).add(r.multiplyScalar(side)).normalize().multiplyScalar((this.run ? RUN : WALK) * this.speed));
    }
    // Speed up and slow down over a fraction of a second, not instantly.
    this.vel.lerp(want, Math.min(1, dt * (want.lengthSq() ? 10 : 14)));
    if (this.vel.lengthSq() > 1e-4) {
      this.move(this.vel.clone().multiplyScalar(dt));
      this.moved = true;
    } else this.vel.set(0, 0, 0);
    // Stay on the floor: step up onto stairs, drop off edges, come down from a jump.
    const g = this.groundBelow(this.feet, this.vy > 0 ? 0.05 : STEP);
    if (this.vy > 0 || (g !== null && g < this.feet.y - 0.02)) {
      this.vy -= GRAVITY * dt;
      this.feet.y += this.vy * dt;
      if (g !== null && this.feet.y <= g && this.vy <= 0) {
        this.feet.y = g;
        this.vy = 0;
        this.grounded = true;
      } else this.grounded = false;
      this.moved = true;
    } else if (g !== null) {
      if (Math.abs(g - this.feet.y) > 1e-3) this.moved = true;
      this.feet.y += (g - this.feet.y) * Math.min(1, dt * 14);
      this.vy = 0;
      this.grounded = true;
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
    this.yaw = this.aimYaw = best.yaw;
    this.pitch = this.aimPitch = -0.06;
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
