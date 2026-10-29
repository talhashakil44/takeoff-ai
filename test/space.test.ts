import { describe, expect, it } from 'vitest';
import { placeByMeaning } from '../src/spec/space';
import type { MapNode } from '../src/spec/links';

const n = (id: string, words: string[]): MapNode => ({ id, kind: 'section', side: 'spec', label: id, sub: '', group: '00', words });

describe('placing by meaning', () => {
  it('puts things about the same subject together, and names the axes', () => {
    const nodes = [
      n('doors', ['door', 'frame', 'hollow', 'metal']),
      n('hardware', ['door', 'hardware', 'hinge', 'lock']),
      n('frames', ['frame', 'hollow', 'metal', 'door']),
      n('pipes', ['pipe', 'valve', 'water', 'domestic']),
      n('valves', ['valve', 'pipe', 'water', 'hot']),
      n('ducts', ['duct', 'air', 'damper', 'fan']),
      n('fans', ['fan', 'air', 'exhaust', 'duct']),
    ];
    const s = placeByMeaning(nodes, []);
    const d = (a: string, b: string) => Math.hypot(...[0, 1, 2].map((k) => s.pos.get(a)![k] - s.pos.get(b)![k]));
    expect(d('doors', 'frames')).toBeLessThan(d('doors', 'pipes'));
    expect(d('pipes', 'valves')).toBeLessThan(d('pipes', 'fans'));
    expect(d('ducts', 'fans')).toBeLessThan(d('ducts', 'doors'));
    expect(s.axes).toHaveLength(3);
    expect(s.explained).toBeGreaterThan(0.5);
  });
});
