import { describe, expect, it } from 'vitest';
import { bounds, meshOf, shapeProblem, tradeOf, type Element3D, type Shape3D } from '../src/scene3d/scene';
import { runTool, type McpContext } from '../src/mcp/tools';
import { newProject, type Project, type Sheet } from '../src/model';
import type { Segment } from '../src/fill/vectors';

const mpp = (0.0254 / 72) * 100;
const pt = (m: number) => m / mpp;
const line = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.7, filled: false });

const ok = (m: { positions: number[]; indices: number[] }) => {
  const n = m.positions.length / 3;
  expect(m.positions.length % 3).toBe(0);
  expect(m.indices.length % 3).toBe(0);
  expect(m.indices.length).toBeGreaterThan(0);
  expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
  expect(m.positions.every(Number.isFinite)).toBe(true);
};
const el = (id: string, shapes: Shape3D[], extra: Partial<Element3D> = {}): Element3D => ({ id, name: id, category: 'envelope', level: 'Ground', material: 'block', source: 'A2-1', basis: 'dimensioned', shapes, ...extra });

describe('3D model shapes', () => {
  it('meshes every shape type', () => {
    const shapes: Shape3D[] = [
      { type: 'box', min: [0, 0, 0], max: [1, 2, 3] },
      { type: 'wall', from: [0, 0], to: [10, 0], thickness: 0.2, z0: 0, z1: 3 },
      { type: 'slab', polygon: [[0, 0], [10, 0], [10, 5], [5, 8], [0, 5]], z0: -0.1, z1: 0 },
      { type: 'cylinder', at: [1, 1], radius: 0.2, z0: 0, z1: 4 },
      { type: 'tube', from: [0, 0, 3], to: [5, 2, 3.5], radius: 0.1 },
      { type: 'cone', at: [3, 3], radius: 2, z0: 2, z1: 7 },
      { type: 'sphere', at: [3, 3, 5], radius: 2 },
    ];
    for (const s of shapes) ok(meshOf(s));
  });

  it('cuts openings through a wall', () => {
    const solid = meshOf({ type: 'wall', from: [0, 0], to: [10, 0], thickness: 0.2, z0: 0, z1: 3 });
    const holed = meshOf({ type: 'wall', from: [0, 0], to: [10, 0], thickness: 0.2, z0: 0, z1: 3, openings: [{ start: 2, end: 3, sill: 0.9, head: 2.1 }, { start: 6, end: 8, sill: 0, head: 2.4 }] });
    ok(holed);
    // Solid: one prism. With a window (left, below, above, gap) and a door (above, right): six.
    expect(holed.positions.length).toBe(solid.positions.length * 6);
    // Nothing of the wall inside the window.
    for (let i = 0; i < holed.positions.length; i += 3) {
      const [x, , z] = [holed.positions[i], holed.positions[i + 1], holed.positions[i + 2]];
      expect(x > 2 + 1e-6 && x < 3 - 1e-6 && z > 0.9 + 1e-6 && z < 2.1 - 1e-6).toBe(false);
    }
  });

  it('slopes a roof slab from the origin', () => {
    const m = meshOf({ type: 'slab', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], z0: 5.9, z1: 6, slope: { dzdy: 0.05 } });
    const zs = new Map<string, number[]>();
    for (let i = 0; i < m.positions.length; i += 3) zs.set(`${m.positions[i]},${m.positions[i + 1]}`, [...(zs.get(`${m.positions[i]},${m.positions[i + 1]}`) ?? []), m.positions[i + 2]]);
    expect(Math.max(...zs.get('0,0')!)).toBeCloseTo(6);
    expect(Math.max(...zs.get('0,10')!)).toBeCloseTo(6.5);
    expect(Math.min(...zs.get('0,10')!)).toBeCloseTo(6.4);
  });

  it('turns away shapes it cannot draw, with a reason the AI can act on', () => {
    expect(shapeProblem({ type: 'wall', from: [0, 0], to: [1, 0], thickness: 0.2, z0: 0, z1: 3 })).toBeNull();
    expect(shapeProblem({ type: 'wall', from: [0, 0], to: [1, 0], z0: 0, z1: 3 })).toMatch(/thickness/);
    expect(shapeProblem({ type: 'box', min: [0, 0, 0], max: [5000, 1, 1] })).toMatch(/metres/);
    expect(shapeProblem({ type: 'slab', polygon: [[0, 0], [1, 1], [2, 2]], z0: 0, z1: 1 })).toMatch(/no area/);
    expect(shapeProblem({ type: 'pyramid' })).toMatch(/unknown shape/);
  });

  it('measures the model and files each element under a trade', () => {
    expect(bounds([el('a', [{ type: 'box', min: [0, 0, -1], max: [4, 5, 6] }])])).toEqual([0, 0, -1, 4, 5, 6]);
    expect(tradeOf({ category: 'floor', material: 'epoxy' })).toBe('flooring');
    expect(tradeOf({ category: 'floor', material: 'concrete' })).toBe('structure');
    expect(tradeOf({ category: 'electrical', material: 'light' })).toBe('elec-trim');
    expect(tradeOf({ category: 'interior', material: 'gypsum' })).toBe('partitions');
  });
});

describe('3D model tools', () => {
  const sheet: Sheet = { id: 's1', docId: 'd1', page: 1, name: 'A2-1', title: 'GROUND FLOOR PLAN', width: 2600, height: 1200, metersPerPoint: mpp, scaleLabel: '1:100', scaleSource: 'detected', scaleHints: [] };
  function fake() {
    let project: Project = { ...newProject('metric'), name: 'Dunnville', docs: [{ id: 'd1', name: 'A.pdf' }], sheets: [sheet], measurements: [{ id: 'm1', sheetId: 's1', typeId: 't', points: [[pt(12), pt(20)], [pt(14), pt(20)]], holes: [] }] };
    const history: Project[] = [];
    // A 20 × 10 m building, walls 200 mm, its left face on grid 1 and bottom face on grid A.
    const [x0, y0, w, h, t] = [pt(5), pt(25), pt(20), pt(10), pt(0.2)];
    const box = (a: number, b: number, c: number, d: number) => [line(a, b, c, b), line(c, b, c, d), line(c, d, a, d), line(a, d, a, b)];
    // The plan, with partitions, and a second view of it (a key plan) further along the sheet.
    const plan = (dx: number) => {
      const mid = x0 + dx + w / 2;
      return [
        ...box(x0 + dx, y0 - h, x0 + dx + w, y0),
        ...box(x0 + dx + t, y0 - h + t, x0 + dx + w - t, y0 - t),
        line(mid - t / 2, y0 - h + t, mid - t / 2, y0 - t),
        line(mid + t / 2, y0 - h + t, mid + t / 2, y0 - t),
      ];
    };
    const lines = [...plan(0), ...plan(pt(40))];
    const bubble = (str: string, cx: number, cy: number) => ({ str, cx, cy, w: 8, h: 8 });
    const texts = [
      bubble('1', x0, y0 - h - pt(4)), bubble('1', x0, y0 + pt(4)), bubble('2', x0 + w, y0 - h - pt(4)), bubble('2', x0 + w, y0 + pt(4)),
      bubble('A', x0 - pt(4), y0), bubble('A', x0 + w + pt(4), y0), bubble('B', x0 - pt(4), y0 - h), bubble('B', x0 + w + pt(4), y0 - h),
    ];
    const ctx = {
      project: () => project,
      commit: (fn: (p: Project) => Project) => {
        history.push(project);
        project = fn(project);
      },
      undo: () => {
        const p = history.pop();
        if (p) project = p;
        return !!p;
      },
      texts: async () => texts,
      sheetLines: async () => lines,
      snapshot3d: async () => 'iVBORw0KGgo=',
    } as unknown as McpContext;
    return { ctx, get: () => project };
  }
  const textOf = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');

  it('gives the instructions', async () => {
    const { ctx } = fake();
    const r = await runTool(ctx, 'model_3d_instructions', {});
    expect(textOf(r)).toMatch(/Workflow/);
    expect(textOf(r)).toMatch(/metal_panel/);
  });

  it('adds, replaces, lists and removes elements, and never touches the takeoff', async () => {
    const { ctx, get } = fake();
    const r = await runTool(ctx, 'add_3d_elements', {
      elements: [
        el('wall-n', [{ type: 'wall', from: [0, 10], to: [20, 10], thickness: 0.2, z0: 0, z1: 6 }]),
        el('slab', [{ type: 'slab', polygon: [[0, 0], [20, 0], [20, 10], [0, 10]], z0: -0.15, z1: 0 }], { category: 'floor', material: 'concrete' }),
        { id: 'bad', name: 'bad', category: 'envelope', material: 'block', shapes: [{ type: 'wall', from: [0, 0] }] },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/Added 2 elements/);
    expect(textOf(r)).toMatch(/bad: wall needs/);
    expect(get().scene3d?.elements.map((e) => e.id)).toEqual(['wall-n', 'slab']);
    await runTool(ctx, 'add_3d_elements', { elements: [el('wall-n', [{ type: 'wall', from: [0, 10], to: [20, 10], thickness: 0.3, z0: 0, z1: 6 }])] });
    expect(get().scene3d?.elements.length).toBe(2);
    expect((get().scene3d?.elements.find((e) => e.id === 'wall-n')?.shapes[0] as { thickness: number }).thickness).toBe(0.3);
    const list = await runTool(ctx, 'list_3d_model', {});
    expect(list.structuredContent?.by_layer).toEqual({ envelope: 1, floor: 1 });
    expect(textOf(await runTool(ctx, 'remove_3d_elements', { prefix: 'wall' }))).toMatch(/Removed 1/);
    expect((await runTool(ctx, 'clear_3d_model', {})).isError).toBe(true);
    await runTool(ctx, 'clear_3d_model', { confirm: true });
    expect(get().scene3d).toBeUndefined();
    expect(get().measurements.length).toBe(1);
  });

  it('records the title and origin, and draws the model for the AI to check', async () => {
    const { ctx, get } = fake();
    expect((await runTool(ctx, 'view_3d_model', {})).isError).toBe(true);
    await runTool(ctx, 'add_3d_elements', { elements: [el('b', [{ type: 'box', min: [0, 0, 0], max: [1, 1, 1] }])] });
    await runTool(ctx, 'set_3d_model_info', { title: 'Dunnville Park Shop', origin: 'grid 1/A at FFE 178.30' });
    expect(get().scene3d?.origin).toBe('grid 1/A at FFE 178.30');
    const r = await runTool(ctx, 'view_3d_model', { view: 'exterior' });
    expect(r.content[0].type).toBe('image');
  });

  it('reads a plan\'s walls and grid in metres from a grid intersection', async () => {
    const { ctx } = fake();
    const r = await runTool(ctx, 'find_walls', { sheet_id: 's1', origin_grid: '1/A' });
    expect(r.isError, textOf(r)).toBeFalsy();
    const out = r.structuredContent as { grid_x: Record<string, number>; grid_y: Record<string, number>; walls: { from: number[]; to: number[]; thickness: number; length: number }[] };
    expect(out.grid_x['1']).toBeCloseTo(0, 2);
    expect(out.grid_x['2']).toBeCloseTo(20, 1);
    expect(out.grid_y['A']).toBeCloseTo(0, 2);
    // Y is north: grid B, up the sheet, is +10 m.
    expect(out.grid_y['B']).toBeCloseTo(10, 1);
    const total = out.walls.reduce((n, w) => n + w.length, 0);
    // The perimeter (about 59 m on the centreline) and the partition (about 10 m), not the key plan.
    expect(total).toBeGreaterThan(62);
    expect(total).toBeLessThan(75);
    for (const w of out.walls) {
      expect(w.thickness).toBeCloseTo(0.2, 1);
      for (const [x, y] of [w.from, w.to]) {
        expect(x).toBeGreaterThan(-0.5);
        expect(x).toBeLessThan(20.5);
        expect(y).toBeGreaterThan(-0.5);
        expect(y).toBeLessThan(10.5);
      }
    }
  });
});
