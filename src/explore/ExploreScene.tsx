import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { geometryOf } from "../build/sceneGeometry";
import type { BuildElement, BuildModel } from "../build/types";
import type { Pt, Sheet } from "../model";
import { lensDistance, logMix, smooth } from "./camera";
import {
  moveInside,
  sheetPoint,
  worldPoint,
  type RoomStop,
  type SheetFrame,
} from "./spatial";
export type ExploreMode = "sheet" | "lift" | "assembly" | "room";
interface Props {
  model: BuildModel;
  sheet: Sheet;
  frame: SheetFrame;
  page: HTMLCanvasElement;
  mode: ExploreMode;
  room: RoomStop | null;
  selected: string | null;
  focus: Pt | null;
  onSelect: (id: string | null) => void;
  onSheetPoint: (point: Pt) => void;
  onPose: (at: Pt, yaw: number) => void;
  onExitRoom: () => void;
  reduced: boolean;
  visibleSheets?: Set<string>;
  overlays?: {
    sheet: Sheet;
    frame: SheetFrame;
    page: HTMLCanvasElement;
    opacity: number;
  }[];
  showBase?: boolean;
  resetView?: number;
  showGrids?: boolean;
  grids?: { label: string; a: Pt; b: Pt }[];
  pins?: { id: string; sheetId: string; at: Pt; label: string }[];
}
const palette = (e: BuildElement) =>
  /window|glaz/i.test(e.name)
    ? "#a4b6b0"
    : /roof/i.test(e.name)
      ? "#626d64"
      : e.trade === "structure"
        ? "#c5b696"
        : e.shape?.type === "surface"
          ? "#d6d1c3"
          : "#e8e3d6";
export function ExploreScene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    api = useRef<{
      select: () => void;
      retarget: () => void;
      overlays: () => void;
    } | null>(null),
    live = useRef(props);
  live.current = props;
  const [error, setError] = useState("");
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      setError(
        "3D could not start on this device. The original PDF remains available below.",
      );
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#ece9e1");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive drawing and building. In a room use W A S D or arrow keys to move; drag to look; Escape to exit.",
    );
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(1.5, 1, 0.05, 10000),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.screenSpacePanning = true;
    controls.enabled = false;
    scene.add(new THREE.HemisphereLight("#fffaf0", "#8c9586", 1.3));
    const sun = new THREE.DirectionalLight("#fff2d7", 2);
    scene.add(sun);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.normalBias = 0.12;
    sun.shadow.bias = -0.001;
    const floorLevel = props.model.elements.find(
      (e) => e.sheetId === props.sheet.id && e.level,
    )?.level;
    const base =
      props.model.levels.find((l) => l.id === floorLevel)?.elevation ?? 0;
    const floorEls = props.model.elements.filter(
      (e) => e.level === floorLevel && e.shape && e.status !== "demolished",
    );
    const box = new THREE.Box3();
    for (const e of floorEls.filter(
      (e) => e.origin === "building" || e.sheetId === props.sheet.id,
    )) {
      const g = geometryOf(e);
      if (g) {
        g.computeBoundingBox();
        box.union(g.boundingBox!);
        g.dispose();
      }
    }
    if (box.isEmpty())
      box.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 4, 10));
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3()),
      span = Math.max(size.x, size.z, 10);
    center.y = base;
    sun.position.set(center.x - span * 0.4, base + span, center.z + span * 0.3);
    sun.target.position.copy(center);
    Object.assign(sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 0.1,
      far: span * 4,
    });
    const items: {
      e: BuildElement;
      mesh: THREE.Mesh;
      edge: THREE.LineSegments;
      min: number;
      layer: number;
    }[] = [];
    for (const e of floorEls) {
      // A planning allowance is not a measured wall; keep it out of the room view.
      const g = geometryOf(e);
      if (!g) continue;
      g.computeBoundingBox();
      const material = new THREE.MeshStandardMaterial({
        color: palette(e),
        roughness: 0.86,
        metalness: 0,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1 + items.length * 0.01,
      });
      const mesh = new THREE.Mesh(g, material);
      mesh.userData.id = e.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(g, 28),
        new THREE.LineBasicMaterial({
          color: "#494d42",
          transparent: true,
          opacity: 0.65,
        }),
      );
      mesh.add(edge);
      scene.add(mesh);
      const layer = /roof/i.test(e.name)
        ? 3
        : e.trade === "ceilings"
          ? 2
          : e.shape?.type === "surface"
            ? 0
            : 1;
      items.push({ e, mesh, edge, min: g.boundingBox!.min.y, layer });
    }
    const corners: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ] = [
      [0, 0],
      [props.sheet.width, 0],
      [props.sheet.width, props.sheet.height],
      [0, props.sheet.height],
    ];
    const coords = corners.flatMap((p) => {
      const w = worldPoint(p, props.frame);
      return [w[0], base - 0.05, w[1]];
    });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    pg.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2),
    );
    pg.setIndex([0, 2, 1, 0, 3, 2]);
    pg.computeVertexNormals();
    const texture = new THREE.CanvasTexture(props.page);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const paperMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const paper = new THREE.Mesh(pg, paperMaterial);
    scene.add(paper);
    const sourceMarker = new THREE.Group();
    scene.add(sourceMarker);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 7, span * 7),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center.x, base - 0.08, center.z);
    ground.receiveShadow = true;
    scene.add(ground);
    const gridGroup = new THREE.Group();
    scene.add(gridGroup);
    const textSprite = (text: string, color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f7f5ed";
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = color;
      ctx.font = "bold 38px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(text.slice(0, 18), 32, 46);
      const texture = new THREE.CanvasTexture(canvas),
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            depthTest: false,
            toneMapped: false,
          }),
        );
      texture.colorSpace = THREE.SRGBColorSpace;
      sprite.renderOrder = 101;
      sprite.scale.set(2, 0.5, 1);
      return sprite;
    };
    for (const g of props.grids ?? []) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(g.a[0], base + 0.06, g.a[1]),
        new THREE.Vector3(g.b[0], base + 0.06, g.b[1]),
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineDashedMaterial({
          color: "#008c9c",
          toneMapped: false,
          transparent: true,
          dashSize: 0.5,
          gapSize: 0.25,
          depthTest: false,
        }),
      );
      line.renderOrder = 100;
      line.computeLineDistances();
      gridGroup.add(line);
      const label = textSprite(g.label, "#446d78");
      label.position.set(g.a[0], base + 0.08, g.a[1]);
      gridGroup.add(label);
    }
    const pins = (props.pins ?? []).map((p) => {
      const sprite = textSprite("●", "#9c602f");
      sprite.scale.set(0.7, 0.35, 1);
      sprite.userData.id = p.id;
      sprite.position.set(p.at[0], base + 0.12, p.at[1]);
      scene.add(sprite);
      return { sprite, sheetId: p.sheetId };
    });
    const keys = new Set<string>();
    let dragging = false,
      lastX = 0,
      lastY = 0,
      yaw = 0,
      pitch = 0,
      position: Pt = [center.x, center.z],
      clock = 0,
      lastPose = 0,
      raf = 0,
      disposed = false,
      dirty = true,
      transition = 1,
      currentLift = 0,
      targetLift = 0,
      currentExplode = 0,
      targetExplode = 0;
    let startPos = new THREE.Vector3(),
      startTarget = new THREE.Vector3(),
      startFov = 1.5,
      endPos = new THREE.Vector3(),
      endTarget = new THREE.Vector3(),
      endFov = 1.5;
    const aspect = () =>
      Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight);
    const board = (sheetMode: boolean) => {
      const focus = live.current.focus;
      const target =
        focus && sheetMode
          ? new THREE.Vector3(focus[0], base, focus[1])
          : center.clone();
      const height =
        focus && sheetMode
          ? Math.min(span * 0.6, 12)
          : Math.max(size.z, size.x / aspect()) * 1.28;
      const fov = sheetMode ? 1.5 : 38,
        dist = lensDistance(height, fov);
      const dir = sheetMode
        ? new THREE.Vector3(0, 1, 0.00001)
        : new THREE.Vector3(0.65, 0.9, 0.8).normalize();
      return { target, pos: target.clone().addScaledVector(dir, dist), fov };
    };
    const retarget = () => {
      const p = live.current;
      controls.enabled = false;
      keys.clear();
      renderer.shadowMap.enabled = p.mode !== "room";
      startPos.copy(camera.position);
      startTarget.copy(controls.target);
      startFov = camera.fov;
      if (p.mode === "room" && p.room) {
        renderer.domElement.focus({ preventScroll: true });
        position = [...p.room.at];
        const far = [...p.room.ring].sort(
          (a, b) =>
            Math.hypot(b[0] - position[0], b[1] - position[1]) -
            Math.hypot(a[0] - position[0], a[1] - position[1]),
        )[0];
        yaw = Math.atan2(far[0] - position[0], far[1] - position[1]);
        pitch = 0.22;
        endPos.set(position[0], p.room.floor + 1.6, position[1]);
        endTarget.set(
          position[0] + Math.sin(yaw) * 4,
          p.room.floor + 1.6,
          position[1] + Math.cos(yaw) * 4,
        );
        endFov = 72;
        // Deliberate room jump: no camera route through unverified walls.
        transition = 1;
        camera.position.copy(endPos);
        controls.target.copy(endTarget);
        camera.fov = endFov;
        camera.lookAt(endTarget);
        camera.updateProjectionMatrix();
      } else {
        const b = board(p.mode === "sheet");
        endPos.copy(b.pos);
        endTarget.copy(b.target);
        endFov = b.fov;
        transition = p.reduced ? 1 : 0;
      }
      targetLift = p.mode === "sheet" ? 0 : 1;
      targetExplode = p.mode === "assembly" ? 1 : 0;
      dirty = true;
      if (p.reduced) {
        camera.position.copy(endPos);
        controls.target.copy(endTarget);
        camera.fov = endFov;
        camera.lookAt(endTarget);
        camera.updateProjectionMatrix();
        currentLift = targetLift;
        currentExplode = targetExplode;
      }
    };
    const select = () => {
      for (const o of [...sourceMarker.children]) {
        sourceMarker.remove(o);
        const line = o as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      const chosen = live.current.model.elements.find(
        (e) => e.id === live.current.selected,
      );
      const ref = chosen?.sources.find((s) => s.id === props.sheet.id && s.box);
      if (ref?.box) {
        const [x0, y0, x1, y1] = ref.box,
          pad = Math.max(3, Math.min(x1 - x0, y1 - y0) * 0.02);
        const points: Pt[] = [
          [x0 - pad, y0 - pad],
          [x1 + pad, y0 - pad],
          [x1 + pad, y1 + pad],
          [x0 - pad, y1 + pad],
          [x0 - pad, y0 - pad],
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            points.map((p) => {
              const w = worldPoint(p, props.frame);
              return new THREE.Vector3(w[0], base + 0.025, w[1]);
            }),
          ),
          new THREE.LineBasicMaterial({ color: "#b66b33", depthTest: false }),
        );
        line.renderOrder = 50;
        sourceMarker.add(line);
      }
      for (const { e, mesh, edge } of items) {
        const selected = e.id === live.current.selected;
        (mesh.material as THREE.MeshStandardMaterial).color.set(
          selected ? "#d5a16d" : palette(e),
        );
        (edge.material as THREE.LineBasicMaterial).color.set(
          selected ? "#a05425" : "#494d42",
        );
      }
      dirty = true;
    };
    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);
    const clearOverlays = () => {
      for (const o of [...overlayGroup.children]) {
        const mesh = o as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshBasicMaterial
        >;
        mesh.geometry.dispose();
        mesh.material.map?.dispose();
        mesh.material.dispose();
        overlayGroup.remove(mesh);
      }
    };
    const overlays = () => {
      clearOverlays();
      for (const [i, layer] of (live.current.overlays ?? []).entries()) {
        const points: Pt[] = [
          [box.min.x - 2, box.min.z - 2],
          [box.max.x + 2, box.min.z - 2],
          [box.max.x + 2, box.max.z + 2],
          [box.min.x - 2, box.max.z + 2],
        ];
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            points.flatMap((p) => [p[0], base + 0.01 + i * 0.015, p[1]]),
            3,
          ),
        );
        g.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute(
            points.flatMap((p) => {
              const s = sheetPoint(p, layer.frame);
              return [s[0] / layer.sheet.width, 1 - s[1] / layer.sheet.height];
            }),
            2,
          ),
        );
        g.setIndex([0, 2, 1, 0, 3, 2]);
        const tex = new THREE.CanvasTexture(layer.page);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          blending: THREE.MultiplyBlending,
          premultipliedAlpha: true,
        });
        const mesh = new THREE.Mesh(g, mat);
        mesh.renderOrder = 10 + i;
        overlayGroup.add(mesh);
      }
      dirty = true;
    };
    api.current = { retarget, select, overlays };
    overlays();
    select();
    const initial = board(true);
    camera.position.copy(initial.pos);
    controls.target.copy(initial.target);
    camera.lookAt(initial.target);
    camera.fov = initial.fov;
    camera.updateProjectionMatrix();
    retarget();
    const ray = new THREE.Raycaster();
    let down: Pt | null = null;
    const onDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.focus();
    };
    const onMove = (e: PointerEvent) => {
      if (dragging && live.current.mode === "room") {
        yaw -= (e.clientX - lastX) * 0.004;
        pitch = Math.max(
          -0.8,
          Math.min(0.8, pitch + (e.clientY - lastY) * 0.003),
        );
        dirty = true;
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
        const r = el.getBoundingClientRect();
        ray.setFromCamera(
          new THREE.Vector2(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            (-(e.clientY - r.top) / r.height) * 2 + 1,
          ),
          camera,
        );
        if (live.current.mode === "sheet") {
          const pinHit = ray.intersectObjects(
            pins.filter((p) => p.sprite.visible).map((p) => p.sprite),
          )[0];
          if (pinHit) {
            live.current.onSelect(String(pinHit.object.userData.id));
            down = null;
            return;
          }
          const hit = ray.intersectObject(paper, false)[0];
          if (hit?.uv)
            live.current.onSheetPoint([
              hit.uv.x * props.sheet.width,
              (1 - hit.uv.y) * props.sheet.height,
            ]);
          down = null;
          return;
        }
        const hit = ray.intersectObjects<THREE.Object3D>(
          [
            ...items.filter((i) => i.mesh.visible).map((i) => i.mesh),
            ...pins.filter((p) => p.sprite.visible).map((p) => p.sprite),
          ],
          false,
        )[0];
        live.current.onSelect(hit ? String(hit.object.userData.id) : null);
      }
      down = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        live.current.onExitRoom();
        keys.clear();
        return;
      }
      if (
        live.current.mode === "room" &&
        [
          "w",
          "a",
          "s",
          "d",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "q",
          "e",
        ].includes(e.key)
      ) {
        e.preventDefault();
        keys.add(e.key);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key),
      onBlur = () => {
        keys.clear();
        dragging = false;
      };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    renderer.domElement.addEventListener("blur", onBlur);
    const lost = (e: Event) => {
      e.preventDefault();
      setError(
        "The graphics connection was lost. Close and reopen Explore Drawing to restore it.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    controls.addEventListener("change", () => {
      dirty = true;
    });
    const resize = () => {
      renderer.setSize(
        Math.max(1, el.clientWidth),
        Math.max(1, el.clientHeight),
      );
      camera.aspect = aspect();
      camera.updateProjectionMatrix();
      if (live.current.mode === "sheet") retarget();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let lastVisible: Set<string> | undefined,
      lastBase: boolean | undefined,
      lastGrids: boolean | undefined;
    const draw = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.04, (now - clock) / 1000 || 0.016);
      clock = now;
      const p = live.current;
      sourceMarker.visible = p.mode === "sheet";
      overlayGroup.visible = p.mode === "sheet" || p.mode === "lift";
      paper.visible = p.showBase !== false;
      gridGroup.visible = !!p.showGrids;
      pins.forEach((pin) => {
        pin.sprite.visible =
          p.mode !== "room" && !!p.visibleSheets?.has(pin.sheetId);
      });
      dirty =
        dirty ||
        p.visibleSheets !== lastVisible ||
        p.showBase !== lastBase ||
        p.showGrids !== lastGrids;
      lastVisible = p.visibleSheets;
      lastBase = p.showBase;
      lastGrids = p.showGrids;
      if (transition < 1) {
        transition = Math.min(1, transition + dt / 0.95);
        const t = smooth(transition);
        controls.target.lerpVectors(startTarget, endTarget, t);
        camera.fov = logMix(startFov, endFov, t);
        const startDir = startPos.clone().sub(startTarget),
          endDir = endPos.clone().sub(endTarget),
          h0 = 2 * startDir.length() * Math.tan((startFov * Math.PI) / 360),
          h1 = 2 * endDir.length() * Math.tan((endFov * Math.PI) / 360);
        const dir = startDir
          .normalize()
          .lerp(endDir.normalize(), t)
          .normalize();
        camera.position
          .copy(controls.target)
          .addScaledVector(
            dir,
            lensDistance(
              logMix(Math.max(0.1, h0), Math.max(0.1, h1), t),
              camera.fov,
            ),
          );
        camera.lookAt(controls.target);
        camera.updateProjectionMatrix();
        dirty = true;
      }
      const liftBefore = currentLift,
        explodeBefore = currentExplode;
      currentLift += (targetLift - currentLift) * Math.min(1, dt * 7);
      currentExplode += (targetExplode - currentExplode) * Math.min(1, dt * 7);
      if (
        Math.abs(currentLift - targetLift) > 0.0001 ||
        Math.abs(currentExplode - targetExplode) > 0.0001
      )
        dirty = true;
      if (
        liftBefore !== currentLift ||
        explodeBefore !== currentExplode ||
        dirty
      ) {
        for (const item of items) {
          const { mesh, min, layer, e } = item;
          mesh.visible =
            currentLift > 0.002 &&
            (e.origin === "building" ||
              !p.visibleSheets ||
              p.visibleSheets.has(e.sheetId)) &&
            !(
              p.mode === "room" &&
              (e.trade === "ceilings" ||
                /roof/i.test(e.name) ||
                (e.origin === "building" && e.shape?.type === "run"))
            );
          mesh.scale.y = Math.max(0.001, currentLift);
          mesh.position.y =
            base * (1 - currentLift) + layer * currentExplode * 3;
          if (
            e.shape?.type === "surface" &&
            min > base + 1 &&
            p.mode === "lift"
          )
            mesh.visible = false;
          (item.edge.material as THREE.LineBasicMaterial).opacity =
            0.6 + currentExplode * 0.2;
        }
        paperMaterial.opacity =
          p.mode === "room" ? 0.13 : 1 - currentLift * 0.55;
      }
      if (p.mode === "room" && p.room) {
        if (keys.has("q") || keys.has("e")) {
          yaw += (Number(keys.has("q")) - Number(keys.has("e"))) * dt * 1.25;
          dirty = true;
        }
        let forward =
            Number(keys.has("w") || keys.has("ArrowUp")) -
            Number(keys.has("s") || keys.has("ArrowDown")),
          side =
            Number(keys.has("d") || keys.has("ArrowRight")) -
            Number(keys.has("a") || keys.has("ArrowLeft"));
        const norm = Math.max(1, Math.hypot(forward, side));
        forward /= norm;
        side /= norm;
        if (forward || side) {
          position = moveInside(
            position,
            [
              position[0] +
                (Math.sin(yaw) * forward - Math.cos(yaw) * side) * dt * 1.5,
              position[1] +
                (Math.cos(yaw) * forward + Math.sin(yaw) * side) * dt * 1.5,
            ],
            p.room,
            floorEls,
          );
          dirty = true;
        }
        camera.position.set(position[0], p.room.floor + 1.6, position[1]);
        camera.lookAt(
          position[0] + Math.sin(yaw) * Math.cos(pitch),
          p.room.floor + 1.6 - Math.sin(pitch),
          position[1] + Math.cos(yaw) * Math.cos(pitch),
        );
        if (now - lastPose > 100) {
          p.onPose(position, yaw);
          lastPose = now;
        }
      } else {
        controls.enabled = transition >= 1;
        controls.enableRotate = p.mode !== "sheet";
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = p.mode === "sheet" ? 0 : Math.PI * 0.49;
        controls.minDistance =
          p.mode === "sheet" ? lensDistance(0.5, 1.5) : 0.5;
        controls.maxDistance =
          p.mode === "sheet" ? lensDistance(span * 8, 1.5) : span * 8;
        if (controls.enabled && controls.update()) dirty = true;
      }
      // The cinematic lens puts the sheet kilometres from the camera. Track the
      // clipping interval and constrain dolly distance so wheel zoom cannot clip it.
      const distance = camera.position.distanceTo(controls.target);
      const near =
        p.mode === "sheet" && transition >= 1
          ? Math.max(0.05, distance - span * 4)
          : 0.05;
      const far = Math.max(1000, distance + span * 12);
      if (camera.near !== near || camera.far !== far) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      if (dirty) {
        const iconSize =
          ((2 * distance * Math.tan((camera.fov * Math.PI) / 360)) /
            Math.max(1, el.clientHeight)) *
          18;
        for (const child of [
          ...gridGroup.children,
          ...pins.map((v) => v.sprite),
        ])
          if (child instanceof THREE.Sprite)
            child.scale.set(iconSize, iconSize, 1);
        renderer.render(scene, camera);
        dirty = false;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      api.current = null;
      ro.disconnect();
      controls.dispose();
      clearOverlays();
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          geometries.add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            materials.add(m);
        }
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      for (const child of [...gridGroup.children, ...pins.map((p) => p.sprite)])
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      texture.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [
    props.model,
    props.sheet.id,
    props.frame,
    props.page,
    props.grids,
    props.pins,
  ]);
  useEffect(
    () => api.current?.retarget(),
    [props.mode, props.room, props.focus, props.reduced, props.resetView],
  );
  useEffect(() => api.current?.select(), [props.selected]);
  useEffect(() => api.current?.overlays(), [props.overlays]);
  return (
    <div className="ex-scene" ref={host}>
      {error && (
        <div className="ex-fallback">
          <img
            src={props.page.toDataURL("image/png")}
            alt={`Original PDF sheet ${props.sheet.name}`}
          />
          <p role="alert">{error}</p>
        </div>
      )}
    </div>
  );
}
