import { describe, expect, it } from 'vitest';
import type { MapEdge, MapNode } from '../src/spec/links';
import { buildMeaning, louvain } from '../src/spec/meaning';

const node = (id: string, kind: MapNode['kind'], side: MapNode['side'], group: string, words: string[]): MapNode => ({ id, kind, side, label: id, sub: id, group, words });

describe('meaning', () => {
  it('finds the communities of a graph', () => {
    // Two triangles joined by one thin edge.
    const adj = [0, 1, 2, 3, 4, 5].map(() => new Map<number, number>());
    const link = (a: number, b: number, w = 1) => (adj[a].set(b, w), adj[b].set(a, w));
    link(0, 1), link(1, 2), link(0, 2), link(3, 4), link(4, 5), link(3, 5), link(2, 3, 0.1);
    const c = louvain(adj);
    expect(c[0]).toBe(c[1]);
    expect(c[1]).toBe(c[2]);
    expect(c[3]).toBe(c[4]);
    expect(c[0]).not.toBe(c[3]);
  });

  it('puts like with like, names the clusters and finds sections nothing drawn is about', async () => {
    const doors = ['door', 'frame', 'hardware', 'hinge', 'closer', 'steel'];
    const pipes = ['pipe', 'valve', 'pump', 'water', 'copper', 'fitting'];
    const nodes: MapNode[] = [];
    for (let i = 0; i < 6; i++) nodes.push(node(`spec:08${i}`, 'section', 'spec', '08', [...doors.slice(i % 3, (i % 3) + 4), `d${i}`]));
    for (let i = 0; i < 6; i++) nodes.push(node(`spec:22${i}`, 'section', 'spec', '22', [...pipes.slice(i % 3, (i % 3) + 4), `p${i}`]));
    nodes.push(node('sched:door', 'schedule', 'drawing', 'A', ['door', 'frame', 'hardware']));
    nodes.push(node('sched:pump', 'schedule', 'drawing', 'M', ['pump', 'water', 'valve']));
    nodes.push(node('spec:321', 'section', 'spec', '32', ['asphalt', 'paving', 'curb']));
    nodes.push(node('spec:322', 'section', 'spec', '32', ['asphalt', 'paving', 'line']));
    const edges: MapEdge[] = [];
    const m = await buildMeaning(nodes, edges, { groupName: (n) => ({ '08': 'Openings', '22': 'Plumbing', '32': 'Exterior' })[n.group] ?? n.group });
    expect(m.source).toBe('words');
    expect(m.near.get('spec:080')!.slice(0, 3).every((x) => x.id.startsWith('spec:08') || x.id === 'sched:door')).toBe(true);
    expect(m.clusterOf.get('spec:080')).toBe(m.clusterOf.get('sched:door'));
    expect(m.clusterOf.get('spec:080')).not.toBe(m.clusterOf.get('spec:220'));
    expect(m.clusters.map((c) => c.name)).toEqual(expect.arrayContaining(['Openings', 'Plumbing']));
    expect(m.loners.map((l) => l.id)).toEqual(expect.arrayContaining(['spec:321']));
    expect(m.pos.size).toBe(nodes.length);
  });
});
