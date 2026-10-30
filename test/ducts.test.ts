import { describe, expect, it } from 'vitest';
import { sideBySide } from '../src/automate/ducts';

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
});
