import { describe, expect, it } from 'vitest';
import { Calendar, schedule } from '../src/build/cpm';
import { defaultSetup } from '../src/build/plan';
import type { Activity, BuildModel } from '../src/build/types';

const activity = (id: string, duration: number, from: string[] = [], weather?: Activity['weather']): Activity => ({
  id,
  name: id,
  kind: id === 'ms:start' || id === 'ms:finish' ? 'milestone' : 'work',
  trade: id.startsWith('ms:') ? null : 'site',
  level: null,
  elements: [],
  duration,
  durationBasis: 'assumed',
  durationWhy: 'Test production days',
  deps: from.map((predecessor) => ({ from: predecessor, type: 'FS', lag: 0, basis: 'assumed', why: 'Test link' })),
  specs: [],
  sources: [],
  ...(weather ? { weather } : {}),
});

describe('weather-aware CPM float', () => {
  it('advances calendar dates independently of the computer timezone', () => {
    const cal = new Calendar('2026-10-01', [1, 2, 3, 4, 5], []);
    expect(cal.date(1)).toBe('2026-10-02');
    expect(cal.date(2)).toBe('2026-10-05');
  });
  it('moves a roof activity before the winter pause when working backward', () => {
    const setup = defaultSetup({ units: 'metric' } as BuildModel, [], '2026-10-01');
    const acts = [
      activity('ms:start', 0),
      activity('roof', 10, ['ms:start'], 'roof'),
      activity('other', 80, ['ms:start']),
      activity('ms:finish', 0, ['roof', 'other']),
    ];
    const result = schedule(acts, setup);
    const cal = new Calendar(setup.start.value, setup.workDays.value, []);
    expect(result.times.roof.start).toBe('2026-10-01');
    expect(cal.date(result.times.roof.ls)).toMatch(/^2026-11-/);
    expect(result.times.roof.lf).toBeLessThanOrEqual(result.times['ms:finish'].ef);
    expect(result.times.roof.float).toBe(result.times.roof.ls - result.times.roof.es);
  });

  it('uses productive days rather than February elapsed days for a summer latest start', () => {
    const setup = defaultSetup({ units: 'metric' } as BuildModel, [], '2027-02-01');
    const acts = [
      activity('ms:start', 0),
      activity('site', 10, ['ms:start'], 'site'),
      activity('other', 100, ['ms:start']),
      activity('ms:finish', 0, ['site', 'other']),
    ];
    const result = schedule(acts, setup);
    const cal = new Calendar(setup.start.value, setup.workDays.value, []);
    expect(result.activities.find((a) => a.id === 'site')?.duration).toBeGreaterThan(10);
    expect(cal.date(result.times.site.ls)).toMatch(/^2027-06-/);
    expect(result.times.site.lf).toBeLessThanOrEqual(result.times['ms:finish'].ef);
  });
});
