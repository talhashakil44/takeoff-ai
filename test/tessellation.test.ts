import { describe, expect, it } from 'vitest';
import { mergeTessellated } from '../src/fill/tessellation';
import type { Segment } from '../src/fill/vectors';

const tri = (sub: number, a: [number, number], b: [number, number], c: [number, number]): Segment[] => [
  // Two edges drawn; the path closes without drawing the third (as flattened exports do).
  { x1: a[0], y1: a[1], x2: b[0], y2: b[1], width: 0, filled: true, sub },
  { x1: b[0], y1: b[1], x2: c[0], y2: c[1], width: 0, filled: true, sub },
];

describe('fills cut into triangles', () => {
  it('joins a wall strip of triangles back into its outline', () => {
    // A 6 × 80 wall as two triangles sharing the diagonal.
    const segs = [...tri(1, [0, 0], [6, 80], [0, 80]), ...tri(2, [0, 0], [6, 0], [6, 80])];
    const out = mergeTessellated(segs, 1);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((s) => s.sub)).size).toBe(1);
    // No diagonal left: only the wall's four sides.
    expect(out.every((s) => s.x1 === s.x2 || s.y1 === s.y2)).toBe(true);
  });

  it('leaves a page with few triangles as it is', () => {
    const segs = [...tri(1, [0, 0], [6, 80], [0, 80]), ...tri(2, [0, 0], [6, 0], [6, 80])];
    expect(mergeTessellated(segs)).toBe(segs);
  });
});
