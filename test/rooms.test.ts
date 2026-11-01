import { describe, expect, it } from 'vitest';
import { findDoorTags, findRoomLabels, fillRooms } from '../src/fill/rooms';
import type { WallModel } from '../src/fill/roomFill';
import type { Segment } from '../src/fill/vectors';
import type { PageText } from '../src/pageText';

const MPP = (100 * 0.0254) / 72;
const pt = (m: number) => m / MPP;
const seg = (x1: number, y1: number, x2: number, y2: number, width = 0.57): Segment => ({ x1: pt(x1), y1: pt(y1), x2: pt(x2), y2: pt(y2), width, filled: false });
const rect = (x1: number, y1: number, x2: number, y2: number, width = 0.57) => [
  seg(x1, y1, x2, y1, width),
  seg(x2, y1, x2, y2, width),
  seg(x2, y2, x1, y2, width),
  seg(x1, y2, x1, y1, width),
];
const text = (str: string, x: number, y: number): PageText => ({ str, cx: pt(x), cy: pt(y), w: str.length * 4.5, h: 5 });

/** A room tag drawn as a small box (in metres) around the number at (x, y). */
const tagBox = (x: number, y: number) => rect(x - 0.35, y - 0.18, x + 0.35, y + 0.18, 0.24);
/** A door tag: the number in an octagon. */
function oval(x: number, y: number): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    const b = ((i + 1) / 8) * 2 * Math.PI;
    out.push(seg(x + 0.4 * Math.cos(a), y + 0.25 * Math.sin(a), x + 0.4 * Math.cos(b), y + 0.25 * Math.sin(b), 0.24));
  }
  return out;
}

// Two rooms, 5 x 4 m and 3 x 4 m (inside faces), split by a 0.2 m wall.
const walls = [...rect(0, 0, 8.4, 4.4), ...rect(0.2, 0.2, 8.2, 4.2), seg(5.2, 0.2, 5.2, 4.2), seg(5.4, 0.2, 5.4, 4.2)];
const model: WallModel = { lines: walls, pens: ['0.57'], stats: [], bridges: 0, openings: [] };
const W = pt(30);
const H = pt(10);

describe('room takeoff', () => {
  const lines = [...walls, ...tagBox(2.7, 2.5), ...tagBox(6.8, 2.5), ...oval(5.3, 1)];
  const texts = [
    text('RECEIVING &', 2.7, 1.9),
    text('STORAGE', 2.7, 2.15),
    text('112', 2.7, 2.5),
    text('W2', 2.0, 2.2),
    text('STAFF OFFICE', 6.8, 2.15),
    text('116', 6.8, 2.5),
    text('201', 5.3, 1),
  ];

  it('finds room numbers in boxes with the name above, not door numbers in ovals', () => {
    const labels = findRoomLabels(texts, lines);
    expect(labels.map((l) => [l.number, l.name])).toEqual([
      ['112', 'RECEIVING & STORAGE'],
      ['116', 'STAFF OFFICE'],
    ]);
  });

  it('fills each room to the inside face of its walls', () => {
    const rooms = fillRooms(model, findRoomLabels(texts, lines), W, H);
    expect(rooms.map((r) => r.area * MPP * MPP)).toEqual([expect.closeTo(20, 2), expect.closeTo(11.2, 2)]);
  });

  it('takes bare room numbers under a name when no room number is boxed', () => {
    const bare = [...walls, ...oval(5.3, 1)];
    const labels = findRoomLabels(texts, bare);
    // 201 sits in a door oval, and W2 is a type tag: neither is a room.
    expect(labels.map((l) => [l.number, l.name])).toEqual([
      ['112', 'RECEIVING & STORAGE'],
      ['116', 'STAFF OFFICE'],
    ]);
  });

  it('finds door tags in ovals, not room numbers in boxes', () => {
    expect(findDoorTags(texts, lines).map((d) => d.number)).toEqual(['201']);
  });

  it('finds a basement door numbered after its lettered room (B23a)', () => {
    expect(findDoorTags([...texts, text('B23a', 40, 40)], [...lines, ...oval(40, 40)]).map((d) => d.number)).toContain('B23a');
  });

  it('keeps one copy of a room tagged again on a second plan', () => {
    const again = [...lines, ...tagBox(20, 2.5)];
    const labels = findRoomLabels([...texts, text('112', 20, 2.5)], again);
    const rooms = fillRooms(model, labels, W, H);
    expect(rooms.filter((r) => r.labels.some((l) => l.number === '112'))).toHaveLength(1);
    expect(rooms.find((r) => r.labels[0].number === '112')?.points).not.toBeNull();
  });
});

describe('rooms drawn without lineweights', () => {
  it('fills the tag’s own room when its box sits just above a wall', async () => {
    const { buildWallModel } = await import('../src/fill/roomFill');
    const { fillRooms, findRoomLabels } = await import('../src/fill/rooms');
    const s = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, width: 0.5, filled: false });
    const rect = (x0: number, y0: number, x1: number, y1: number) => [s(x0, y0, x1, y0), s(x1, y0, x1, y1), s(x1, y1, x0, y1), s(x0, y1, x0, y0)];
    // Two rooms, one above the other, a 4 pt partition between; everything in one pen.
    const segs = [...rect(-6, -6, 206, 210), ...rect(0, 0, 200, 100), ...rect(0, 104, 200, 204), ...rect(90, 85, 114, 97), ...rect(90, 150, 114, 162)];
    const texts = [
      { str: 'ROOM A', cx: 102, cy: 75, w: 30, h: 5 },
      { str: '101', cx: 102, cy: 91, w: 12, h: 5 },
      { str: 'ROOM B', cx: 102, cy: 140, w: 30, h: 5 },
      { str: '102', cx: 102, cy: 156, w: 12, h: 5 },
    ];
    const model = buildWallModel(segs, (100 * 0.0254) / 72, { pens: ['0.50'] });
    const rooms = fillRooms(model, findRoomLabels(texts, segs), 400, 400);
    // Each room on its own (without lineweights the tag box notches it a few percent).
    expect(rooms.map((r) => r.labels.map((l) => l.number).join('+')).sort()).toEqual(['101', '102']);
    for (const r of rooms) expect(r.area / 20000).toBeGreaterThan(0.9);
  });
});

describe('room tags of any set', () => {
  // Tags drawn as on 84 Frederick: alphanumeric numbers in small boxes, the name below.
  const box = (x: number, y: number, w = 24, h = 11) => {
    const s = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.3, filled: false });
    return [s(x - w / 2, y - h / 2, x + w / 2, y - h / 2), s(x + w / 2, y - h / 2, x + w / 2, y + h / 2), s(x + w / 2, y + h / 2, x - w / 2, y + h / 2), s(x - w / 2, y + h / 2, x - w / 2, y - h / 2)];
  };
  const t = (str: string, cx: number, cy: number): PageText => ({ str, cx, cy, w: str.length * 3.6, h: 6 });
  const segs = [...box(100, 100), ...box(300, 100), ...box(500, 100), ...box(700, 100), ...box(900, 100), ...box(1500, 100, 16)];
  const texts = [
    t('101a', 100, 100),
    t('Program Room', 100, 116),
    t('B24S', 300, 100),
    t('Corridor', 300, 116),
    // A note beside the name is not part of it.
    t('CR', 330, 118),
    t('M01', 500, 100),
    t('Shelter', 500, 116),
    t('Intake', 500, 125),
    t('2.14', 700, 100),
    t('WC', 700, 116),
    // A type tag and a dimension under a tag are not its name.
    t('118a', 900, 100),
    t('Kitchen', 900, 116),
    t('fx2', 900, 125),
    t(`8'-6"`, 900, 134),
    // The legend's sample tag, explained beside it.
    t('07', 1500, 100),
    t('Room Numbers', 1545, 100),
    t('See Room Finish Schedule(s)', 1570, 110),
  ];

  it('reads numbers with letters (101a, B24S, M01, 2.14) and the name below the box, not legend samples', () => {
    expect(findRoomLabels(texts, segs).map((l) => [l.number, l.name])).toEqual([
      ['101a', 'Program Room'],
      ['B24S', 'Corridor'],
      ['M01', 'Shelter Intake'],
      ['2.14', 'WC'],
      ['118a', 'Kitchen'],
    ]);
  });

  it('reads the name on the side most of the sheet uses when there is text on both', () => {
    // A note above one tag: the sheet writes names below.
    const labels = findRoomLabels([...texts, t('Mirror', 100, 84)], segs);
    expect(labels.find((l) => l.number === '101a')?.name).toBe('Program Room');
  });

  it('takes no lone boxed code or symbol letter for a room', () => {
    // A sheet with one boxed number (a keynote) and a boxed letter: no room plan.
    const lone = [...box(100, 100), ...box(300, 100)];
    expect(findRoomLabels([t('13', 100, 100), t('D', 300, 100), t('LF', 300, 116)], lone)).toEqual([]);
    // A title block's drawing number under its caption.
    expect(findRoomLabels([t('A912', 100, 100), t('Dwg. No.', 100, 84)], box(100, 100))).toEqual([]);
  });
});

describe('leaks', () => {
  it('leaves tags unclosed when one outline swallows more than three rooms', () => {
    // One big box (no partitions) holding five rooms' tags.
    const s = (x1: number, y1: number, x2: number, y2: number): Segment => ({ x1, y1, x2, y2, width: 0.57, filled: false });
    const walls = [s(0, 0, 600, 0), s(600, 0, 600, 300), s(600, 300, 0, 300), s(0, 300, 0, 0)];
    const m: WallModel = { lines: walls, pens: ['0.57'], stats: [], bridges: 0, openings: [] };
    const labels = [100, 200, 300, 400, 500].map((x, i) => ({ number: `10${i}`, name: 'Office', at: [x, 150] as [number, number] }));
    const rooms = fillRooms(m, labels, 1000, 1000);
    expect(rooms.every((r) => r.points === null && r.reason === 'not-closed')).toBe(true);
    expect(rooms).toHaveLength(5);
    // Two tags in one open space still share it.
    expect(fillRooms(m, labels.slice(0, 2), 1000, 1000).map((r) => r.labels.length)).toEqual([2]);
  });
});

describe('room tags among other boxed tags', () => {
  // Three named rooms, wall type tags boxed like room numbers but never named, a room number
  // written with its RM prefix, and a pen width that differs in its last digits side to side.
  const wobbly = (x: number, y: number) => tagBox(x, y).map((s, i) => ({ ...s, width: i % 2 ? 0.2400003 : 0.2399997 }));
  const lines = [...tagBox(2, 2), ...tagBox(6, 2), ...wobbly(10, 2), ...tagBox(2, 6), ...tagBox(6, 6), ...tagBox(10, 6)];
  const texts = [
    text('OFFICE', 2, 1.6),
    text('101', 2, 2),
    text('LUNCH ROOM', 6, 1.6),
    text('RM 102', 6, 2),
    text('LOCKERS', 10, 1.6),
    text('103', 10, 2),
    text('W3', 2, 6),
    text('EW1', 6, 6),
    text('W3', 10, 6),
  ];

  it('takes the named numbers as rooms and leaves the unnamed family of wall tags', () => {
    const labels = findRoomLabels(texts, lines);
    expect(labels.map((l) => [l.number, l.name])).toEqual([
      ['101', 'OFFICE'],
      ['102', 'LUNCH ROOM'],
      ['103', 'LOCKERS'],
    ]);
  });

  it('takes one-digit numbers in wide boxes as rooms when they are named', () => {
    const wide = (x: number, y: number) => rect(x - 0.7, y - 0.2, x + 0.7, y + 0.2, 0.24);
    const t = [text('STORAGE', 2, 1.6), text('1', 2, 2), text('WASHROOM', 6, 1.6), text('2', 6, 2), text('CORRIDOR', 10, 1.6), text('3', 10, 2), text('4', 14, 2)];
    const labels = findRoomLabels(t, [...wide(2, 2), ...wide(6, 2), ...wide(10, 2), ...wide(14, 2)]);
    expect(labels.map((l) => l.number)).toEqual(['1', '2', '3']);
  });
});
