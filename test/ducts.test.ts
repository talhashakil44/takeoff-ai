import { describe, expect, it } from 'vitest';
import { bridgeRuns, sideBySide } from '../src/automate/ducts';

describe('ducts by label', () => {
  it('reads a duct drawn in two tones as one band as wide as both', () => {
    const pairs = sideBySide([
      { a: [500, 100], b: [500, 300], width: 5 }, // lit half, 497.5–502.5
      { a: [507, 110], b: [507, 300], width: 9 }, // shaded half, 502.5–511.5
      { a: [600, 100], b: [600, 300], width: 8 }, // another duct
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].of).toEqual([0, 1]);
    expect(pairs[0].run.width).toBeCloseTo(14, 5);
    expect(pairs[0].run.a).toEqual([504.5, 110]);
  });

  it('joins a duct drawn over (chairs across it) back into one run', () => {
    const z = { text: '400x300', w: 400, h: 300, at: [100, 90] as [number, number] };
    const runs = [
      { a: [100, 100], b: [160, 100], width: 11 } as const, // sized piece
      { a: [240, 100], b: [290, 100], width: 11 } as const, // same duct past the chairs
      { a: [165, 99], b: [230, 99], width: 6 } as const, // duct showing between the chairs
      { a: [400, 100], b: [450, 100], width: 11 } as const, // too far, nothing between
    ];
    const sizes: (typeof z | null)[] = [z, null, null, null];
    const out = bridgeRuns(runs.map((r) => ({ ...r, a: [...r.a] as [number, number], b: [...r.b] as [number, number] })), sizes, 100);
    expect(out).toHaveLength(1);
    expect(out[0].run.a).toEqual([160, 100]);
    expect(out[0].run.b).toEqual([240, 100]);
    expect(sizes[1]).toBe(z);
    expect(sizes[3]).toBeNull();
  });
});
