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
