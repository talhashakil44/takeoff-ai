import { UMAP } from 'umap-js';
import type { MapEdge, MapNode } from './links';

/**
 * The project by meaning. Every section, schedule, tag and sheet is a vector: the words it is
 * about (TF-IDF, a word counting for more the fewer things use it) or, with an embeddings key,
 * an AI embedding of what it says. Linked things lean together a little.
 *
 * Everything that is an answer is worked out in that full space, not in the picture: each
 * thing's nearest neighbours, the clusters (Louvain communities of the nearest-neighbour graph)
 * and the loners (spec sections nothing on the drawings is about). The 3D picture is UMAP of the
 * same nearest-neighbour graph: it keeps each thing beside its true neighbours, and has no axes
 * to read.
 */

export interface Near {
  id: string;
  /** Cosine similarity in the full space (0–1, higher is closer). */
  sim: number;
}

export interface Cluster {
  i: number;
  /** What the cluster is: its divisions or trades ("OPENINGS · FINISHES"). */
  name: string;
  /** Its most central member ("08100 HOLLOW METAL WORK"). */
  sub: string;
  members: string[];
  center: [number, number, number];
  radius: number;
  color: string;
}

export interface Loner {
  id: string;
  /** The drawing-side thing it is closest to, and how close (still not close). */
  best?: Near;
}

export interface Meaning {
  pos: Map<string, [number, number, number]>;
  near: Map<string, Near[]>;
  clusters: Cluster[];
  clusterOf: Map<string, number>;
  loners: Loner[];
  source: 'words' | 'embeddings';
}

export const CLUSTER_COLORS = ['#5b9cff', '#ff8a5b', '#5be3b0', '#c58cff', '#ffd35b', '#ff5fa2', '#5bd6ff', '#a3e35b', '#ff6b6b', '#9d9bff', '#e3a35b', '#5bffd6', '#f0a0ff', '#b8c4ff'];

/** Words that say nothing about what a thing is (they are in every kind of document). */
const PLAIN = new Set(
  'not build building facility project work works new existing general all see refer note notes per as provide provided install installed include including item items type types level plan plans detail details section sections drawing drawings sheet sheets schedule schedules page part parts product products execution historic site area areas room rooms legend legends symbol symbols key'.split(' '),
);

type Sparse = Map<string, number>;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** TF-IDF word vectors, unit length; words only one thing uses are left out (they relate nothing). */
export function wordVectors(nodes: MapNode[]): Sparse[] {
  const df = new Map<string, number>();
  const docs = nodes.map((n) => {
    const tf: Sparse = new Map();
    // Its name's words count most; what its text says most often counts too.
    for (const w of n.words ?? []) if (!PLAIN.has(w)) tf.set(w, (tf.get(w) ?? 0) + 3);
    for (const [w, c] of n.about ?? []) if (!PLAIN.has(w)) tf.set(w, (tf.get(w) ?? 0) + c);
    for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    return tf;
  });
  const N = nodes.length;
  // Words in more than a third of everything are the project's, not any one thing's.
  return docs.map((tf) => unitSparse(new Map([...tf].filter(([w]) => (df.get(w) ?? 0) > 1 && (df.get(w) ?? 0) < N / 3).map(([w, c]) => [w, (1 + Math.log(c)) * Math.log((N + 1) / ((df.get(w) ?? 0) + 1))]))));
}

function unitSparse(v: Sparse): Sparse {
  let s = 0;
  for (const x of v.values()) s += x * x;
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (const [w, x] of v) v.set(w, x * k);
  return v;
}

function unitDense(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= k;
  return v;
}

/** Who is linked to whom (written, matched, part of; not spec cross-references, which are everywhere). */
function linkLists(nodes: MapNode[], edges: MapEdge[]): number[][] {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const nb: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const a = index.get(e.a);
    const b = index.get(e.b);
    if (a === undefined || b === undefined || e.kind === 'spec-spec' || e.kind === 'revises') continue;
    nb[a].push(b);
    nb[b].push(a);
  }
  return nb;
}

/** The similarity of every pair, in the full space: words (sparse) or embeddings (dense). */
function similarities(nodes: MapNode[], edges: MapEdge[], embeddings?: Map<string, Float32Array>): { S: Float32Array; has: boolean[]; source: Meaning['source'] } {
  const N = nodes.length;
  const nb = linkLists(nodes, edges);
  const S = new Float32Array(N * N);
  const share = (i: number, own: boolean) => (own ? 0.35 : 1) / nb[i].length;
  if (embeddings && nodes.some((n) => embeddings.has(n.id))) {
    const dim = [...embeddings.values()][0].length;
    let vecs: (Float32Array | null)[] = nodes.map((n) => (embeddings.has(n.id) ? Float32Array.from(embeddings.get(n.id)!) : null));
    // Centred: embeddings all lean one way; what tells things apart is how they differ from the mean.
    const mean = new Float32Array(dim);
    let count = 0;
    for (const v of vecs) if (v) (count++, v.forEach((x, k) => (mean[k] += x)));
    for (const v of vecs) if (v) for (let k = 0; k < dim; k++) v[k] = v[k] - mean[k] / count;
    vecs = vecs.map((v) => (v ? unitDense(v) : null));
    for (let round = 0; round < 2; round++) {
      vecs = vecs.map((v, i) => {
        if (!nb[i].length) return v;
        const out = v ? Float32Array.from(v) : new Float32Array(dim);
        const s = share(i, !!v);
        for (const j of nb[i]) {
          const u = vecs[j];
          if (u) for (let k = 0; k < dim; k++) out[k] += u[k] * s;
        }
        return out.some((x) => x !== 0) ? unitDense(out) : null;
      });
    }
    for (let i = 0; i < N; i++)
      for (let j = i; j < N; j++) {
        const a = vecs[i];
        const b = vecs[j];
        let s = 0;
        if (a && b) for (let k = 0; k < dim; k++) s += a[k] * b[k];
        S[i * N + j] = S[j * N + i] = s;
      }
    return { S, has: vecs.map((v) => !!v), source: 'embeddings' };
  }
  let vecs = wordVectors(nodes);
  for (let round = 0; round < 2; round++) {
    vecs = vecs.map((v, i) => {
      if (!nb[i].length) return v;
      const out: Sparse = new Map(v);
      const s = share(i, v.size > 0);
      for (const j of nb[i]) for (const [w, x] of vecs[j]) out.set(w, (out.get(w) ?? 0) + x * s);
      return unitSparse(out);
    });
  }
  for (let i = 0; i < N; i++)
    for (let j = i; j < N; j++) {
      const [a, b] = vecs[i].size < vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
      let s = 0;
      for (const [w, x] of a) {
        const y = b.get(w);
        if (y) s += x * y;
      }
      S[i * N + j] = S[j * N + i] = s;
    }
  return { S, has: vecs.map((v) => v.size > 0), source: 'words' };
}

/** Communities of a weighted graph (Louvain: move each node to the neighbouring community that raises modularity most, then merge, repeat). */
export function louvain(adj: Map<number, number>[], resolution = 1): number[] {
  let graph = adj;
  let mapping = adj.map((_, i) => i);
  for (let level = 0; level < 12; level++) {
    const N = graph.length;
    const k = graph.map((row) => [...row.values()].reduce((a, b) => a + b, 0));
    const m2 = k.reduce((a, b) => a + b, 0);
    if (!m2) break;
    const c = graph.map((_, i) => i);
    const tot = k.slice();
    let any = false;
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (let i = 0; i < N; i++) {
        const ci = c[i];
        const w = new Map<number, number>();
        for (const [j, wij] of graph[i]) if (j !== i) w.set(c[j], (w.get(c[j]) ?? 0) + wij);
        tot[ci] -= k[i];
        let best = ci;
        let gain = (w.get(ci) ?? 0) - (resolution * tot[ci] * k[i]) / m2;
        for (const [cj, wc] of w) {
          const g = wc - (resolution * tot[cj] * k[i]) / m2;
          if (g > gain + 1e-12) {
            best = cj;
            gain = g;
          }
        }
        tot[best] += k[i];
        if (best !== ci) {
          c[i] = best;
          moved = any = true;
        }
      }
      if (!moved) break;
    }
    if (!any) break;
    const ids = new Map<number, number>();
    for (const x of c) if (!ids.has(x)) ids.set(x, ids.size);
    mapping = mapping.map((s) => ids.get(c[s])!);
    const next: Map<number, number>[] = [...ids.keys()].map(() => new Map());
    for (let i = 0; i < N; i++) for (const [j, w] of graph[i]) next[ids.get(c[i])!].set(ids.get(c[j])!, (next[ids.get(c[i])!].get(ids.get(c[j])!) ?? 0) + w);
    graph = next;
  }
  return mapping;
}

export interface MeaningOptions {
  embeddings?: Map<string, Float32Array>;
  /** A node's division or trade, to name clusters by ("Openings", "Electrical"). */
  groupName?: (n: MapNode) => string;
  radius?: number;
  /** Called as the layout settles (0–1). */
  progress?: (f: number) => void;
}

const DRAWN = new Set<MapNode['kind']>(['sheet', 'schedule', 'item', 'type', 'finish']);

export async function buildMeaning(nodes: MapNode[], edges: MapEdge[], opts: MeaningOptions = {}): Promise<Meaning> {
  const radius = opts.radius ?? 420;
  const N = nodes.length;
  const { S, has, source } = similarities(nodes, edges, opts.embeddings);
  const at = (i: number, j: number) => S[i * N + j];

  // Nearest neighbours, in the full space.
  const K = 12;
  const live = nodes.map((_, i) => i).filter((i) => has[i]);
  const knn = new Map<number, { j: number; s: number }[]>();
  for (const i of live) {
    const row = live.filter((j) => j !== i).map((j) => ({ j, s: at(i, j) }));
    row.sort((a, b) => b.s - a.s);
    knn.set(i, row.slice(0, K));
  }
  const near = new Map<string, Near[]>();
  for (const [i, row] of knn) near.set(nodes[i].id, row.filter((r) => r.s > 0.02).slice(0, 8).map((r) => ({ id: nodes[r.j].id, sim: Math.round(r.s * 1000) / 1000 })));

  // Clusters: communities of the nearest-neighbour graph.
  const local = new Map(live.map((i, li) => [i, li]));
  const adj: Map<number, number>[] = live.map(() => new Map());
  for (const [i, row] of knn)
    for (const r of row.slice(0, 10)) {
      if (r.s <= 0) continue;
      const a = local.get(i)!;
      const b = local.get(r.j)!;
      adj[a].set(b, Math.max(adj[a].get(b) ?? 0, r.s));
      adj[b].set(a, Math.max(adj[b].get(a) ?? 0, r.s));
    }
  let comm = louvain(adj, 1.4);
  // Tiny communities join the community they are most like.
  const size = new Map<number, number>();
  for (const c of comm) size.set(c, (size.get(c) ?? 0) + 1);
  const minSize = Math.max(3, Math.round(live.length / 60));
  comm = comm.map((c, li) => {
    if ((size.get(c) ?? 0) >= minSize) return c;
    const i = live[li];
    const to = knn.get(i)?.find((r) => (size.get(comm[local.get(r.j)!]) ?? 0) >= minSize);
    return to ? comm[local.get(to.j)!] : c;
  });

  // The picture: UMAP of the same neighbour graph.
  const coords = new Map<number, number[]>();
  if (live.length >= 8) {
    const umap = new UMAP({ nComponents: 3, nNeighbors: Math.min(15, live.length - 1), minDist: 0.35, spread: 1.6, random: rng(7), distanceFn: (a, b) => 1 - at(a[0], b[0]) });
    const kk = Math.min(15, live.length - 1);
    const idx: number[][] = [];
    const dist: number[][] = [];
    for (const i of live) {
      const row = live.map((j) => ({ j, d: i === j ? 0 : 1 - at(i, j) })).sort((a, b) => a.d - b.d).slice(0, kk);
      idx.push(row.map((r) => local.get(r.j)!));
      dist.push(row.map((r) => Math.max(0, r.d)));
    }
    umap.setPrecomputedKNN(idx, dist);
    const epochs = umap.initializeFit(live.map((i) => [i]));
    for (let e = 0; e < epochs; e++) {
      umap.step();
      if (e % 25 === 0) {
        opts.progress?.(e / epochs);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    umap.getEmbedding().forEach((p, li) => coords.set(live[li], p));
  } else live.forEach((i, li) => coords.set(i, [Math.cos(li * 2.4) * 2, Math.sin(li * 2.4) * 2, (li % 3) - 1]));
  // Centred, and scaled so most of it sits within the radius.
  const mean = [0, 1, 2].map((k) => [...coords.values()].reduce((s, p) => s + p[k], 0) / Math.max(1, coords.size));
  const rs = [...coords.values()].map((p) => Math.hypot(p[0] - mean[0], p[1] - mean[1], p[2] - mean[2])).sort((a, b) => a - b);
  const r95 = rs[Math.floor(rs.length * 0.95)] || 1;
  const pos = new Map<string, [number, number, number]>();
  const placed = new Map<number, [number, number, number]>();
  for (const [i, p] of coords) placed.set(i, [0, 1, 2].map((k) => ((p[k] - mean[k]) / r95) * radius) as [number, number, number]);
  // Clusters apart: each moved whole (its inside as UMAP drew it) until none overlaps another.
  {
    const byComm = new Map<number, number[]>();
    live.forEach((i, li) => byComm.set(comm[li], [...(byComm.get(comm[li]) ?? []), i]));
    const cs = [...byComm.values()].filter((m) => m.length >= 2).map((m) => {
      const ps = m.map((i) => placed.get(i)!);
      const c = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length);
      const ds = ps.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
      return { m, c, r: Math.max(24, ds[Math.floor(ds.length * 0.8)] ?? 24), o: c.slice() };
    });
    for (let it = 0; it < 120; it++) {
      let moved = false;
      for (let a = 0; a < cs.length; a++)
        for (let b = a + 1; b < cs.length; b++) {
          const A = cs[a];
          const B = cs[b];
          const d = [0, 1, 2].map((k) => B.c[k] - A.c[k]);
          const len = Math.hypot(d[0], d[1], d[2]) || 0.01;
          const need = (A.r + B.r) * 1.2 + 24;
          if (len >= need) continue;
          moved = true;
          const push = (need - len) / 2;
          const wa = B.m.length / (A.m.length + B.m.length);
          for (let k = 0; k < 3; k++) {
            A.c[k] -= (d[k] / len) * push * 2 * wa;
            B.c[k] += (d[k] / len) * push * 2 * (1 - wa);
          }
        }
      if (!moved) break;
    }
    for (const x of cs) for (const i of x.m) placed.set(i, placed.get(i)!.map((v, k) => v + x.c[k] - x.o[k]) as [number, number, number]);
    // Back to the radius.
    const all = [...placed.values()];
    const mid = [0, 1, 2].map((k) => all.reduce((s, p) => s + p[k], 0) / all.length);
    const rr = all.map((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2])).sort((a, b) => a - b);
    const k95 = radius / (rr[Math.floor(rr.length * 0.95)] || radius);
    for (const [i, p] of placed) pos.set(nodes[i].id, [0, 1, 2].map((k) => (p[k] - mid[k]) * k95) as [number, number, number]);
  }

  // Things with nothing to say: beside what they are linked to, in its cluster.
  const nb = linkLists(nodes, edges);
  const clusterOfIdx = new Map<number, number>(live.map((i, li) => [i, comm[li]]));
  const jitter = rng(11);
  for (let i = 0; i < N; i++) {
    if (has[i]) continue;
    const ps = nb[i].filter((j) => coords.has(j));
    if (!ps.length) continue;
    const p = [0, 1, 2].map((k) => ps.reduce((s, j) => s + pos.get(nodes[j].id)![k], 0) / ps.length + (jitter() - 0.5) * 24) as [number, number, number];
    pos.set(nodes[i].id, p);
    const votes = new Map<number, number>();
    for (const j of ps) votes.set(clusterOfIdx.get(j)!, (votes.get(clusterOfIdx.get(j)!) ?? 0) + 1);
    clusterOfIdx.set(i, [...votes].sort((a, b) => b[1] - a[1])[0][0]);
  }

  // The clusters, biggest first, named by what they hold.
  const groups = new Map<number, number[]>();
  for (const [i, c] of clusterOfIdx) groups.set(c, [...(groups.get(c) ?? []), i]);
  const ordered = [...groups.values()].filter((m) => m.length >= 2).sort((a, b) => b.length - a.length);
  const clusters: Cluster[] = [];
  const clusterOf = new Map<string, number>();
  const groupName = opts.groupName ?? ((n: MapNode) => n.group);
  for (const members of ordered) {
    const ci = clusters.length;
    const ps = members.map((i) => pos.get(nodes[i].id)!).filter(Boolean);
    const center = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length) as [number, number, number];
    const ds = ps.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])).sort((a, b) => a - b);
    const withVec = members.filter((i) => has[i]);
    const centrality = (i: number) => withVec.reduce((s, j) => s + at(i, j), 0);
    const named = withVec.filter((i) => nodes[i].kind === 'section' || nodes[i].kind === 'schedule');
    const pool = named.length ? named : withVec.length ? withVec : members;
    const central = pool.reduce((b, i) => (centrality(i) > centrality(b) ? i : b), pool[0]);
    // Name: the divisions (or trades) most of it belongs to.
    const counts = new Map<string, number>();
    const spec = members.filter((i) => nodes[i].side === 'spec');
    const from = spec.length >= Math.max(2, members.length * 0.2) ? spec : members;
    for (const i of from) {
      const g = groupName(nodes[i]);
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1]);
    const parts = top.filter(([, c], k) => k === 0 || (k < 2 && c >= from.length * 0.3)).map(([g]) => g);
    const c = nodes[central];
    clusters.push({
      i: ci,
      name: parts.join(' · ') || c.label,
      sub: c.kind === 'section' ? `${c.label} ${c.sub}` : c.label,
      members: members.map((i) => nodes[i].id),
      center,
      radius: Math.max(28, ds[Math.floor(ds.length * 0.8)] ?? 28),
      color: CLUSTER_COLORS[ci % CLUSTER_COLORS.length],
    });
    for (const i of members) clusterOf.set(nodes[i].id, ci);
  }

  // Loners: spec sections that nothing on the drawings is about (and no link says otherwise).
  const linked = new Set(edges.filter((e) => e.kind === 'written' || e.kind === 'matched').flatMap((e) => [e.a, e.b]));
  const drawn = live.filter((j) => DRAWN.has(nodes[j].kind));
  const cands = live.filter((i) => nodes[i].kind === 'section' && !nodes[i].missing && !['00', '01'].includes(nodes[i].group));
  const loners: Loner[] = [];
  if (drawn.length && cands.length) {
    const best = cands.map((i) => {
      let b = -1;
      let bj = -1;
      for (const j of drawn)
        if (at(i, j) > b) {
          b = at(i, j);
          bj = j;
        }
      return { i, b, bj };
    });
    const m = best.reduce((s, x) => s + x.b, 0) / best.length;
    const sd = Math.sqrt(best.reduce((s, x) => s + (x.b - m) ** 2, 0) / best.length);
    for (const x of best.sort((a, b) => a.b - b.b))
      if (!linked.has(nodes[x.i].id) && x.b < m - 0.75 * sd) loners.push({ id: nodes[x.i].id, ...(x.bj >= 0 && x.b > 0 ? { best: { id: nodes[x.bj].id, sim: Math.round(x.b * 1000) / 1000 } } : {}) });
  }
  opts.progress?.(1);
  return { pos, near, clusters, clusterOf, loners, source };
}
