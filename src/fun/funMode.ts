import * as THREE from 'three';
import type { ModelRenderer } from '../scene3d/render';
import type { Walker, WalkAddOn } from '../scene3d/walk';

/**
 * FUN MODE (experimental). Ninjas come for you while you walk the model; you have a gun.
 *
 * Lives entirely in this file and is imported only when switched on, so the app never loads
 * or runs any of it otherwise. Everything it adds (the gun on the camera, ninjas, blood, the
 * HUD) is removed by dispose(). Delete this folder and the switch in ModelScene to take it out.
 */

const MAX_NINJAS = 6;
const SPAWN_EVERY = 2.2;
const NINJA_SPEED = 2.4;
const PARTICLES = 700;
const SPLATS = 500;
const GRAVITY = 9.8;

interface Ninja {
  root: THREE.Group;
  head: THREE.Mesh;
  legs: THREE.Mesh[];
  arms: THREE.Mesh[];
  hitboxes: THREE.Mesh[];
  floor: number;
  alive: boolean;
  t: number;
  attackIn: number;
  /** After death: time since, and the head flying off on its own. */
  dead: number;
  headVel: THREE.Vector3 | null;
  bleed: number;
}

export class FunMode implements WalkAddOn {
  private root = new THREE.Group();
  private gun = new THREE.Group();
  private flash: THREE.Mesh;
  private ninjas: Ninja[] = [];
  private spawnIn = 1;
  private recoil = 0;
  private flashFor = 0;
  private hurt = 0;
  private health = 100;
  private kills = 0;
  private wasted = 0;
  private addedCamera = false;
  private hud: HTMLDivElement;
  private audio: AudioContext | null = null;
  // Shared bits, made once.
  private mats: Record<string, THREE.Material>;
  private geos: Record<string, THREE.BufferGeometry>;
  // Blood: flying drops and the splats they leave.
  private drops: THREE.InstancedMesh;
  private dropPos = new Float32Array(PARTICLES * 3);
  private dropVel = new Float32Array(PARTICLES * 3);
  private dropLife = new Float32Array(PARTICLES);
  private dropFloor = new Float32Array(PARTICLES);
  private dropNext = 0;
  private splats: THREE.InstancedMesh;
  private splatNext = 0;
  private dummy = new THREE.Object3D();
  private ray = new THREE.Raycaster();
  // Mouse look (pointer lock, like a shooter) and the announcer.
  private canvas: HTMLCanvasElement | null;
  private sens = 0.0022;
  private streak = 0;
  private lastKill = -99;
  private multi = 0;
  private clock = 0;
  private shoutFor = 0;
  private onMouse = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return;
    this.w.look(e.movementX * (this.sens / 0.0042), e.movementY * (this.sens / 0.0042));
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'BracketRight' || e.code === 'Equal') this.sens = Math.min(0.01, this.sens * 1.2);
    else if (e.code === 'BracketLeft' || e.code === 'Minus') this.sens = Math.max(0.0005, this.sens / 1.2);
    else return;
    this.note(`Mouse ${Math.round(this.sens * 10000) / 10}`);
  };

  private constructor(private m: ModelRenderer, private w: Walker, host: HTMLElement) {
    const std = (color: number, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    this.mats = {
      cloth: std(0x15151a, 0.9),
      band: std(0xc8141e, 0.6),
      skin: std(0xd9a27a, 0.8),
      steel: std(0xb9bec6, 0.25, 0.9),
      gun: std(0x22252b, 0.35, 0.8),
      grip: std(0x3b2a1e, 0.8),
      gunBarrel: std(0x1b1d22, 0.3, 0.9),
      gore: std(0x7a0008, 0.4),
      flash: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
      drop: new THREE.MeshBasicMaterial({ color: 0x9a0010 }),
      splat: new THREE.MeshBasicMaterial({ color: 0x5e0009, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    this.geos = {
      torso: new THREE.BoxGeometry(0.42, 0.62, 0.24),
      head: new THREE.SphereGeometry(0.15, 14, 10),
      band: new THREE.CylinderGeometry(0.155, 0.155, 0.05, 14, 1, true),
      eyes: new THREE.BoxGeometry(0.2, 0.05, 0.05),
      // Limbs hang from the hip and shoulder, so they swing from there.
      limb: new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, -0.31, 0),
      arm: new THREE.BoxGeometry(0.1, 0.55, 0.1).translate(0, -0.25, 0),
      sword: new THREE.BoxGeometry(0.04, 0.9, 0.02),
      tail: new THREE.BoxGeometry(0.03, 0.22, 0.01),
      drop: new THREE.IcosahedronGeometry(0.025, 0),
      splat: new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
      stump: new THREE.CylinderGeometry(0.06, 0.07, 0.05, 8),
      hit: new THREE.BoxGeometry(0.7, 1.8, 0.6).translate(0, 0.9, 0),
    };

    // The gun, held at the bottom right of the view.
    const box = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(g, mat);
      o.position.set(x, y, z);
      return o;
    };
    this.gun.add(box(new THREE.BoxGeometry(0.07, 0.09, 0.38), this.mats.gun, 0, 0, 0));
    const barrel = box(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 10).rotateX(Math.PI / 2), this.mats.gunBarrel, 0, 0.025, -0.32);
    this.gun.add(barrel);
    const grip = box(new THREE.BoxGeometry(0.06, 0.15, 0.08), this.mats.grip, 0, -0.1, 0.1);
    grip.rotation.x = -0.25;
    this.gun.add(grip);
    this.gun.add(box(new THREE.BoxGeometry(0.05, 0.12, 0.05), this.mats.gun, 0, -0.08, -0.05));
    this.flash = box(new THREE.SphereGeometry(0.05, 8, 6), this.mats.flash, 0, 0.025, -0.52);
    this.flash.scale.set(1, 1, 2.2);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.gun.position.set(0.24, -0.22, -0.5);
    // Drawn over everything, so it never sinks into a wall you're standing against.
    let order = 20;
    this.gun.traverse((o) => {
      o.renderOrder = order++;
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).depthTest = false;
    });
    if (!m.camera.parent) {
      m.scene.add(m.camera);
      this.addedCamera = true;
    }
    m.camera.add(this.gun);

    this.drops = new THREE.InstancedMesh(this.geos.drop, this.mats.drop, PARTICLES);
    this.drops.frustumCulled = false;
    this.splats = new THREE.InstancedMesh(this.geos.splat, this.mats.splat, SPLATS);
    this.splats.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < PARTICLES; i++) this.drops.setMatrixAt(i, this.dummy.matrix);
    for (let i = 0; i < SPLATS; i++) this.splats.setMatrixAt(i, this.dummy.matrix);
    this.root.add(this.drops, this.splats);
    m.scene.add(this.root);

    this.hud = document.createElement('div');
    this.hud.className = 'fun-hud';
    this.hud.innerHTML = `<style>
      .fun-hud{position:absolute;inset:0;pointer-events:none;z-index:5;font:600 13px/1.2 system-ui,sans-serif;color:#fff}
      .fun-hud .x{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px}
      .fun-hud .x:before,.fun-hud .x:after{content:'';position:absolute;background:#fff;box-shadow:0 0 2px #000}
      .fun-hud .x:before{left:10px;top:0;width:2px;height:22px}.fun-hud .x:after{top:10px;left:0;height:2px;width:22px}
      .fun-hud .stat{position:absolute;right:14px;bottom:14px;background:rgba(0,0,0,.55);padding:8px 12px;border-radius:10px;text-shadow:0 1px 2px #000}
      .fun-hud .bar{width:150px;height:8px;background:#400;border-radius:4px;margin-top:6px;overflow:hidden}.fun-hud .bar i{display:block;height:100%;background:#e3222c}
      .fun-hud .hurt{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(190,0,0,.75));opacity:0;transition:opacity .15s}
      .fun-hud .count{position:absolute;left:50%;top:14px;transform:translateX(-50%);font:900 30px/1 Impact,system-ui,sans-serif;letter-spacing:2px;color:#fff;text-shadow:0 2px 0 #000,0 0 12px rgba(200,0,0,.7)}
      .fun-hud .count small{display:block;text-align:center;font:700 11px/1.4 system-ui,sans-serif;letter-spacing:3px;color:#ffb3b3}
      .fun-hud .shout{position:absolute;left:0;right:0;top:24%;text-align:center;font:900 54px/1 Impact,system-ui,sans-serif;letter-spacing:3px;color:#ffcf33;text-shadow:0 3px 0 #7a0000,0 0 18px rgba(255,60,0,.8);opacity:0}
      .fun-hud .shout.go{animation:funshout 1.6s ease-out forwards}
      @keyframes funshout{0%{opacity:0;transform:scale(2.4)}12%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0;transform:scale(1.05)}}
      .fun-hud .note{position:absolute;left:0;right:0;top:calc(50% + 26px);text-align:center;font-size:12px;opacity:0;transition:opacity .3s;text-shadow:0 1px 2px #000}
      .fun-hud .lock{position:absolute;left:0;right:0;top:calc(50% + 44px);text-align:center;font-size:13px;text-shadow:0 1px 3px #000}
      .fun-hud .big{position:absolute;left:0;right:0;top:38%;text-align:center;font:900 64px/1 Impact,system-ui,sans-serif;color:#d10f1a;letter-spacing:4px;text-shadow:0 3px 0 #000;display:none}
    </style><div class="hurt"></div><div class="x"></div><div class="big">WASTED</div>
    <div class="count"><span class="n">0</span><small>KILLS</small></div><div class="shout"></div><div class="note"></div>
    <div class="lock">Click to aim with the mouse · Esc lets go</div>
    <div class="stat">FUN MODE · experimental<br><span class="k">Ninjas down: 0</span><div class="bar"><i style="width:100%"></i></div><small>Click to shoot · Space jumps · Shift runs · [ ] mouse speed</small></div>`;
    host.appendChild(this.hud);
    this.canvas = host.querySelector('canvas');
    document.addEventListener('mousemove', this.onMouse);
    window.addEventListener('keydown', this.onKey);
    w.speed = 1.6;
  }

  /** A line under the crosshair for a moment. */
  private note(text: string) {
    const n = this.hud.querySelector('.note') as HTMLElement;
    n.textContent = text;
    n.style.opacity = '1';
    clearTimeout((this as unknown as { nt?: number }).nt);
    (this as unknown as { nt?: number }).nt = window.setTimeout(() => (n.style.opacity = '0'), 1200);
  }

  private shout(text: string) {
    const s = this.hud.querySelector('.shout') as HTMLElement;
    s.textContent = text;
    s.classList.remove('go');
    void s.offsetWidth;
    s.classList.add('go');
    this.shoutFor = 1.6;
    try {
      const u = new SpeechSynthesisUtterance(text.toLowerCase());
      u.pitch = 0.3;
      u.rate = 0.85;
      u.volume = 0.9;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      // No voice; the words still show.
    }
  }

  /** Loads fun mode: compiles its look first so switching it on doesn't stall the picture. */
  static async start(m: ModelRenderer, w: Walker, host: HTMLElement) {
    const f = new FunMode(m, w, host);
    const warm = f.makeNinja();
    warm.root.position.set(0, -500, 0);
    f.root.add(warm.root);
    try {
      await m.renderer.compileAsync(m.scene, m.camera);
    } catch {
      // Compiles on first draw instead.
    }
    f.root.remove(warm.root);
    return f;
  }

  private makeNinja(): Ninja {
    const g = this.geos, mt = this.mats;
    const root = new THREE.Group();
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      return o;
    };
    const torso = mesh(g.torso, mt.cloth, 0, 1.12);
    const head = mesh(g.head, mt.cloth, 0, 1.58);
    head.add(mesh(g.band, mt.band, 0, 0.05));
    head.add(mesh(g.eyes, mt.skin, 0, 0, -0.13));
    const tail = mesh(g.tail, mt.band, 0.04, 0.0, 0.16);
    tail.rotation.x = 0.6;
    head.add(tail);
    const legs = [mesh(g.limb, mt.cloth, -0.11, 0.8), mesh(g.limb, mt.cloth, 0.11, 0.8)];
    const arms = [mesh(g.arm, mt.cloth, -0.28, 1.4), mesh(g.arm, mt.cloth, 0.28, 1.4)];
    const sword = mesh(g.sword, mt.steel, 0.28, 1.0, -0.25);
    sword.rotation.x = -1.1;
    const body = new THREE.Mesh(g.hit, mt.hit);
    root.add(torso, head, ...legs, ...arms, sword, body);
    return { root, head, legs, arms, hitboxes: [head, body], floor: 0, alive: true, t: Math.random() * 10, attackIn: 0.6, dead: 0, headVel: null, bleed: 0 };
  }

  private spawn() {
    const feet = this.w.feet;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 9;
      const x = feet.x + Math.cos(a) * d, z = feet.z + Math.sin(a) * d;
      const y = this.w.floorNear(x, z, feet.y);
      if (y === null || Math.abs(y - feet.y) > 1.5) continue;
      const n = this.makeNinja();
      n.floor = y;
      n.root.position.set(x, y, z);
      this.root.add(n.root);
      this.ninjas.push(n);
      this.puff(new THREE.Vector3(x, y + 1, z), 0x222222);
      return;
    }
  }

  /** A little smoke where a ninja drops in. */
  private puff(at: THREE.Vector3, _c: number) {
    for (let i = 0; i < 6; i++) this.drop(at, new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), at.y - 1, 0.4, true);
  }

  private drop(at: THREE.Vector3, v: THREE.Vector3, floor: number, life = 3, noSplat = false) {
    const i = this.dropNext;
    this.dropNext = (this.dropNext + 1) % PARTICLES;
    this.dropPos.set([at.x, at.y, at.z], i * 3);
    this.dropVel.set([v.x, v.y, v.z], i * 3);
    this.dropLife[i] = noSplat ? -life : life;
    this.dropFloor[i] = floor;
  }

  private splat(x: number, y: number, z: number, size: number) {
    this.dummy.position.set(x, y + 0.012 + Math.random() * 0.004, z);
    this.dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    this.dummy.scale.set(size * (0.7 + Math.random() * 0.6), 1, size);
    this.dummy.updateMatrix();
    this.splats.setMatrixAt(this.splatNext, this.dummy.matrix);
    this.splatNext = (this.splatNext + 1) % SPLATS;
    this.splats.instanceMatrix.needsUpdate = true;
  }

  /** Blood out of a point, mostly along a direction. */
  private spray(at: THREE.Vector3, dir: THREE.Vector3, floor: number, n: number, force = 3) {
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(force * (0.4 + Math.random()));
      v.x += (Math.random() - 0.5) * 3;
      v.y += Math.random() * 3;
      v.z += (Math.random() - 0.5) * 3;
      this.drop(at, v, floor);
    }
  }

  private sound(kind: 'shot' | 'splat' | 'hurt') {
    try {
      this.audio ??= new AudioContext();
      const a = this.audio, t = a.currentTime;
      const len = kind === 'shot' ? 0.18 : kind === 'splat' ? 0.25 : 0.12;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'shot' ? 3 : 1.5);
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = kind === 'shot' ? 2400 : kind === 'splat' ? 500 : 900;
      const g = a.createGain();
      g.gain.value = kind === 'shot' ? 0.5 : 0.35;
      src.connect(f).connect(g).connect(a.destination);
      src.start(t);
    } catch {
      // No sound; the rest still works.
    }
  }

  click(aim?: THREE.Ray) {
    // First click takes the mouse (aim like a shooter); after that, clicks fire dead centre.
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && this.canvas) {
      try {
        void (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined);
      } catch {
        // No pointer lock: keep shooting where you click.
      }
    }
    if (locked) aim = undefined;
    if (this.wasted > 0) return true;
    this.recoil = 1;
    this.flashFor = 0.06;
    this.sound('shot');
    // Shoots where you click (or dead ahead from the keyboard).
    const cam = this.m.camera;
    const dir = aim ? aim.direction.clone() : cam.getWorldDirection(new THREE.Vector3());
    this.ray.set(aim ? aim.origin.clone() : cam.getWorldPosition(new THREE.Vector3()), dir);
    this.ray.far = 120;
    const live = this.ninjas.filter((n) => n.alive);
    const nh = this.ray.intersectObjects(live.flatMap((n) => n.hitboxes), false)[0];
    const wh = this.ray.intersectObjects(this.w.solids, false)[0];
    if (nh && (!wh || nh.distance < wh.distance)) {
      const n = live.find((x) => x.hitboxes.includes(nh.object as THREE.Mesh))!;
      this.kill(n, nh.point, dir, nh.point.y - n.floor > 1.42);
    } else if (wh) {
      // A puff of dust where it hits.
      for (let i = 0; i < 5; i++) this.drop(wh.point, new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), wh.point.y - 3, 0.3, true);
    }
    return true;
  }

  private kill(n: Ninja, at: THREE.Vector3, dir: THREE.Vector3, headshot: boolean) {
    n.alive = false;
    n.dead = 0;
    this.kills++;
    this.streak++;
    this.multi = this.clock - this.lastKill < 4 ? this.multi + 1 : 1;
    this.lastKill = this.clock;
    const MULTI = ['', '', 'DOUBLE KILL', 'MULTI KILL', 'MEGA KILL', 'ULTRA KILL', 'MONSTER KILL', 'LUDICROUS KILL', 'HOLY SHIT'];
    const SPREE: Record<number, string> = { 5: 'KILLING SPREE', 10: 'RAMPAGE', 15: 'DOMINATING', 20: 'UNSTOPPABLE', 25: 'GODLIKE', 30: 'WICKED SICK' };
    const say = this.multi >= 2 ? MULTI[Math.min(this.multi, MULTI.length - 1)] : SPREE[this.streak] ?? (headshot ? 'HEADSHOT' : '');
    if (say) this.shout(say);
    this.sound('splat');
    this.spray(at, dir, n.floor, headshot ? 140 : 90, 4);
    // Off comes the head, and the neck keeps going for a bit.
    const head = n.head;
    n.root.remove(head);
    head.position.copy(n.root.position).add(new THREE.Vector3(0, 1.58, 0));
    this.root.add(head);
    n.headVel = dir.clone().multiplyScalar(5).add(new THREE.Vector3((Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2));
    const stump = new THREE.Mesh(this.geos.stump, this.mats.gore);
    stump.position.set(0, 1.45, 0);
    n.root.add(stump);
    n.bleed = 1.4;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.clock += dt;
    this.shoutFor = Math.max(0, this.shoutFor - dt);
    (this.hud.querySelector('.lock') as HTMLElement).style.display = document.pointerLockElement === this.canvas ? 'none' : 'block';
    const feet = this.w.feet;
    // Spawning, unless you just died.
    if (this.wasted > 0) {
      this.wasted -= dt;
      if (this.wasted <= 0) {
        this.health = 100;
        (this.hud.querySelector('.big') as HTMLElement).style.display = 'none';
      }
    } else if ((this.spawnIn -= dt) <= 0) {
      this.spawnIn = SPAWN_EVERY * (0.6 + Math.random() * 0.8);
      if (this.ninjas.filter((n) => n.alive).length < MAX_NINJAS) this.spawn();
    }
    // Ninjas: run at you (through walls, they're ninjas), swing when close.
    for (const n of this.ninjas) {
      n.t += dt;
      if (n.alive) {
        const to = new THREE.Vector3(feet.x - n.root.position.x, 0, feet.z - n.root.position.z);
        const d = to.length();
        n.root.rotation.y = Math.atan2(-to.x, -to.z);
        if (d > 0.9) {
          n.root.position.addScaledVector(to.normalize(), Math.min(d - 0.9, NINJA_SPEED * dt));
          const y = this.w.floorNear(n.root.position.x, n.root.position.z, n.floor + 0.3);
          if (y !== null && Math.abs(y - n.floor) < 0.6) n.floor = y;
          n.root.position.y = n.floor;
          const s = Math.sin(n.t * 11) * 0.7;
          n.legs[0].rotation.x = s;
          n.legs[1].rotation.x = -s;
          n.arms[0].rotation.x = -s;
          n.arms[1].rotation.x = s;
        } else if (this.wasted <= 0 && (n.attackIn -= dt) <= 0) {
          n.attackIn = 0.8;
          n.arms[1].rotation.x = -2.2;
          this.health = Math.max(0, this.health - 12);
          this.hurt = 0.35;
          this.sound('hurt');
          if (!this.health) this.die();
        }
      } else {
        n.dead += dt;
        // Fall over, bleed out, then sink away.
        n.root.rotation.x = Math.max(-Math.PI / 2, -n.dead * 5);
        if (n.bleed > 0) {
          n.bleed -= dt;
          const neck = new THREE.Vector3(0, 1.45, 0).applyMatrix4(n.root.matrixWorld);
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(n.root.quaternion);
          this.spray(neck, up, n.floor, 4, 2.5);
        }
        if (n.headVel) {
          n.headVel.y -= GRAVITY * dt;
          n.head.position.addScaledVector(n.headVel, dt);
          n.head.rotation.x += dt * 8;
          if (n.head.position.y < n.floor + 0.15) {
            n.head.position.y = n.floor + 0.15;
            if (Math.abs(n.headVel.y) > 1) this.splat(n.head.position.x, n.floor, n.head.position.z, 0.35);
            n.headVel.set(n.headVel.x * 0.5, Math.abs(n.headVel.y) * 0.3, n.headVel.z * 0.5);
            if (n.headVel.length() < 0.3) n.headVel = null;
          }
        }
        if (n.dead > 9) n.root.position.y -= dt * 0.4;
      }
    }
    for (const n of this.ninjas.filter((x) => !x.alive && x.dead > 12)) {
      this.root.remove(n.root, n.head);
    }
    this.ninjas = this.ninjas.filter((x) => x.alive || x.dead <= 12);
    // Blood in flight; where it lands, it stays.
    let moving = false;
    for (let i = 0; i < PARTICLES; i++) {
      const life = this.dropLife[i];
      if (!life) continue;
      moving = true;
      const k = i * 3, smoke = life < 0;
      this.dropVel[k + 1] -= GRAVITY * dt * (smoke ? 0.1 : 1);
      this.dropPos[k] += this.dropVel[k] * dt;
      this.dropPos[k + 1] += this.dropVel[k + 1] * dt;
      this.dropPos[k + 2] += this.dropVel[k + 2] * dt;
      const left = smoke ? life + dt : life - dt;
      this.dropLife[i] = (smoke ? left >= 0 : left <= 0) ? 0 : left;
      if (!smoke && this.dropPos[k + 1] <= this.dropFloor[i]) {
        this.splat(this.dropPos[k], this.dropFloor[i], this.dropPos[k + 2], 0.06 + Math.random() * 0.18);
        this.dropLife[i] = 0;
      }
      this.dummy.position.set(this.dropPos[k], this.dropPos[k + 1], this.dropPos[k + 2]);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(this.dropLife[i] ? (smoke ? 3 : 1) : 0);
      this.dummy.updateMatrix();
      this.drops.setMatrixAt(i, this.dummy.matrix);
    }
    if (moving) this.drops.instanceMatrix.needsUpdate = true;
    // The gun kicks and settles; the flash blinks.
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.gun.position.z = -0.5 + this.recoil * 0.08;
    this.gun.rotation.x = this.recoil * 0.25;
    this.flashFor -= dt;
    this.flash.visible = this.flashFor > 0;
    this.hurt = Math.max(0, this.hurt - dt);
    (this.hud.querySelector('.hurt') as HTMLElement).style.opacity = String(Math.min(1, this.hurt * 3));
    (this.hud.querySelector('.k') as HTMLElement).textContent = `Ninjas down: ${this.kills}`;
    (this.hud.querySelector('.count .n') as HTMLElement).textContent = String(this.kills);
    (this.hud.querySelector('.bar i') as HTMLElement).style.width = `${this.health}%`;
    return true;
  }

  private die() {
    this.wasted = 2.5;
    this.streak = 0;
    this.multi = 0;
    (this.hud.querySelector('.big') as HTMLElement).style.display = 'block';
    for (const n of this.ninjas) if (n.alive) {
      this.root.remove(n.root);
      n.alive = false;
      n.dead = 13;
    }
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouse);
    window.removeEventListener('keydown', this.onKey);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    try {
      speechSynthesis.cancel();
    } catch {
      // Nothing to stop.
    }
    this.w.speed = 1;
    this.m.camera.remove(this.gun);
    if (this.addedCamera) this.m.scene.remove(this.m.camera);
    this.m.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const g of Object.values(this.geos)) g.dispose();
    for (const mt of Object.values(this.mats)) mt.dispose();
    this.gun.traverse((o) => {
      if (o instanceof THREE.Mesh && !Object.values(this.geos).includes(o.geometry)) o.geometry.dispose();
    });
    this.hud.remove();
    void this.audio?.close();
    this.ninjas = [];
  }
}
