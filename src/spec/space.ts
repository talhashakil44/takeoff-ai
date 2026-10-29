import type { MapEdge, MapNode } from './links';

/**
 * The project in a space of meaning. Every section, schedule, tag and sheet is a vector of the
 * words it is about (TF-IDF: a word counts for more the fewer things use it), nudged towards
 * what it is linked to, so a schedule and the section that names it sit together. The three
 * directions along which the project varies most (kernel PCA of the cosine similarities) are
 * the axes of the 3D view; each axis is named by the words that pull hardest along it, so
 * you can read the space: doors and frames one way, pipes and valves the other.
 *
 * Close together means about the same thing. It is the same mathematics as an embedding, from
 * the documents' own words, with nothing sent anywhere.
 */

export interface Space {
  /** Each node's place, scaled so most of the project sits within `radius`. */
  pos: Map<string, [number, number, number]>;
  /** Each axis: the words at its two ends. */
  axes: { plus: string[]; minus: string[] }[];
  /** How much of the variation the three axes hold (0–1). */
  explained: number;
}

type Vec = Map<string, number>;

/** Words that say nothing about what a thing is (they are in every kind of document). */
const PLAIN = new Set('not build building facility project work works new existing general all see refer note notes per as provide provided install installed include including item items type types level plan plans detail details section sections drawing drawings sheet sheets schedule schedules page part parts product products execution historic site area areas room rooms legend legends symbol symbols key'.split(' '));

export function placeByMeaning(nodes: MapNode[], edges: MapEdge[], radius = 420): Space {
  // Term frequencies, then IDF over the nodes that have words.
  const df = new Map<string, number>();
  const docs = nodes.map((n) => {
    const tf: Vec = new Map();
    for (const w of n.words ?? []) if (!PLAIN.has(w)) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
    return tf;
  });
  const N = nodes.length;
  const idf = (w: string) => Math.log((N + 1) / ((df.get(w) ?? 0) + 1));
  const unit = (v: Vec) => {
    let s = 0;
    for (const x of v.values()) s += x * x;
    const k = s > 0 ? 1 / Math.sqrt(s) : 0;
    for (const [w, x] of v) v.set(w, x * k);
    return v;
  };
  // Words that only one thing uses say nothing about how things relate: left out.
  let vecs: Vec[] = docs.map((tf) => unit(new Map([...tf].filter(([w]) => (df.get(w) ?? 0) > 1).map(([w, c]) => [w, (1 + Math.log(c)) * idf(w)]))));

  // Linked things lean together: each vector takes in a share of its neighbours'.
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const nb: number[][] = nodes.map(() => []);
  for (const e of edges) {
    const a = index.get(e.a);
    const b = index.get(e.b);
    if (a === undefined || b === undefined || e.kind === 'spec-spec') continue;
    nb[a].push(b);
    nb[b].push(a);
  }
  for (let round = 0; round < 2; round++) {
    vecs = vecs.map((v, i) => {
      if (!nb[i].length) return v;
      const out: Vec = new Map([...v].map(([w, x]) => [w, x]));
      const share = (v.size ? 0.35 : 1) / nb[i].length;
      for (const j of nb[i]) for (const [w, x] of vecs[j]) out.set(w, (out.get(w) ?? 0) + x * share);
      return unit(out);
    });
  }

  // Cosine similarities, double-centred: kernel PCA.
  const K = new Float64Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = i; j < N; j++) {
      let s = 0;
      const [a, b] = vecs[i].size < vecs[j].size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
      for (const [w, x] of a) {
        const y = b.get(w);
        if (y) s += x * y;
      }
      K[i * N + j] = s;
      K[j * N + i] = s;
    }
  const rowMean = new Float64Array(N);
  let all = 0;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = 0; j < N; j++) s += K[i * N + j];
    rowMean[i] = s / N;
    all += s;
  }
  all /= N * N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) K[i * N + j] = K[i * N + j] - rowMean[i] - rowMean[j] + all;
  let trace = 0;
  for (let i = 0; i < N; i++) trace += Math.max(0, K[i * N + i]);

  // The top three directions, by power iteration with deflation.
  const comps: { v: Float64Array; l: number }[] = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let c = 0; c < 3 && N > 1; c++) {
    let v = Float64Array.from({ length: N }, rnd);
    let l = 0;
    for (let it = 0; it < 70; it++) {
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        const row = i * N;
        for (let j = 0; j < N; j++) s += K[row + j] * v[j];
        w[i] = s;
      }
      for (const p of comps) {
        let d = 0;
        for (let i = 0; i < N; i++) d += w[i] * p.v[i];
        for (let i = 0; i < N; i++) w[i] -= d * p.v[i];
      }
      let norm = 0;
      for (let i = 0; i < N; i++) norm += w[i] * w[i];
      norm = Math.sqrt(norm);
      if (!norm) break;
      for (let i = 0; i < N; i++) w[i] /= norm;
      l = norm;
      v = w;
    }
    comps.push({ v, l });
  }
  const coords = nodes.map((_, i) => comps.map((c) => c.v[i] * Math.sqrt(Math.max(c.l, 0))));
  while (coords.length && coords[0].length < 3) for (const p of coords) p.push(0);

  // Spread: the direction from the centre is the meaning, the distance by rank, so the project
  // fills the ball evenly (a few outliers do not squeeze everything else into the middle).
  const rad = coords.map((p) => Math.hypot(p[0], p[1], p[2]));
  const order = rad.map((_, i) => i).sort((a, b) => rad[a] - rad[b]);
  const pos = new Map<string, [number, number, number]>();
  const taken = new Map<string, number>();
  order.forEach((i, rank) => {
    const r = rad[i] || 1;
    const to = radius * Math.cbrt((rank + 1) / order.length);
    let p = coords[i].map((x) => (rad[i] ? (x / r) * to : rnd() * 40)) as [number, number, number];
    // Things in the same spot (the same words): set around it, not on top of each other.
    const key = p.map((x) => Math.round(x / 6)).join(',');
    const k = taken.get(key) ?? 0;
    taken.set(key, k + 1);
    if (k) {
      const a = k * 2.399;
      const ring = 14 * Math.sqrt(k);
      p = [p[0] + ring * Math.cos(a), p[1] + ring * Math.sin(a), p[2] + (k % 2 ? 8 : -8)];
    }
    pos.set(nodes[i].id, p);
  });
  // Things with no words of their own: amid what they are linked to.
  for (const [i, n] of nodes.entries()) {
    if (vecs[i].size || !nb[i].length) continue;
    const ps = nb[i].map((j) => pos.get(nodes[j].id)!);
    pos.set(n.id, [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length + (Math.random() - 0.5) * 12) as [number, number, number]);
  }

  // Name each axis by the words that load on it most, each way.
  const axes = comps.map((c) => {
    const load = new Map<string, number>();
    for (let i = 0; i < N; i++) for (const [w, x] of vecs[i]) load.set(w, (load.get(w) ?? 0) + x * c.v[i]);
    const sorted = [...load].sort((a, b) => b[1] - a[1]);
    return { plus: sorted.slice(0, 3).map(([w]) => w), minus: sorted.slice(-3).reverse().map(([w]) => w) };
  });
  return { pos, axes, explained: trace ? comps.reduce((s, c) => s + c.l, 0) / trace : 0 };
}
