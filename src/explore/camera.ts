/** Long-lens → perspective framing inspired by Samnang Aing's MIT flat-to-3d demo.
 * Independently implemented for arbitrary measured building bounds. See THIRD_PARTY.md. */
export const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
export function lensDistance(frameHeight: number, fov: number) {
  return frameHeight / (2 * Math.tan((fov * Math.PI) / 360));
}
export function logMix(a: number, b: number, t: number) {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
}

/** Perspective fit includes camera-space depth, not just plan width/length. */
export function perspectiveBoundsDistance(
  corners: readonly (readonly [number, number, number])[],
  target: readonly [number, number, number],
  direction: readonly [number, number, number],
  fov: number,
  aspect: number,
  padding = 1.15,
) {
  const length = Math.hypot(...direction);
  const d = direction.map((v) => v / length);
  // Camera uses world Y as up. Derive the same right/up basis as lookAt.
  const rightLength = Math.hypot(d[0], d[2]);
  const right =
    rightLength > 1e-8
      ? [d[2] / rightLength, 0, -d[0] / rightLength]
      : [1, 0, 0];
  const up = [
    d[1] * right[2] - d[2] * right[1],
    d[2] * right[0] - d[0] * right[2],
    d[0] * right[1] - d[1] * right[0],
  ];
  const tangent = Math.tan((fov * Math.PI) / 360);
  return Math.max(
    0.1,
    ...corners.map((c) => {
      const p = c.map((v, i) => v - target[i]);
      const dot = (v: number[]) => p.reduce((sum, x, i) => sum + x * v[i], 0);
      return (
        dot(d) +
        Math.max(
          Math.abs(dot(right)) / (tangent * Math.max(aspect, 0.01)),
          Math.abs(dot(up)) / tangent,
        ) *
          padding +
        0.05
      );
    }),
  );
}
