import { describe, expect, it } from 'vitest';
import { chainage, pipeLabel, serviceOf } from '../src/automate/site';
import { measurementVars } from '../src/quantities';
import type { Measurement, Sheet, TakeoffType } from '../src/model';

describe('site works', () => {
  it('reads labelled pipe runs, metric and imperial, and leaves existing ones out', () => {
    expect(pipeLabel('80.2m - 75mmØ HDPE DR17 SANITARY FORCEMAIN')).toEqual({ meters: 80.2, size: 75, what: 'HDPE DR17 SANITARY FORCEMAIN', existing: false });
    expect(pipeLabel('5.8m-400mmØ CULVERT')).toMatchObject({ meters: 5.8, size: 400, what: 'CULVERT' });
    expect(pipeLabel('7.5m - 375mmØ HDPE STM @ -0.50%')).toMatchObject({ what: 'HDPE STM' });
    expect(pipeLabel('120 LF - 8" PVC SAN @ 1.0%')).toMatchObject({ size: 203, what: 'PVC SAN' });
    expect(pipeLabel('120 LF - 8" PVC SAN')!.meters).toBeCloseTo(36.58, 2);
    expect(pipeLabel('EX. 8.5m - 450mmØ STM @ 4.37%')).toMatchObject({ existing: true });
    expect(pipeLabel('6.0m WIDE FIRE TRUCK ACCESS ROAD')).toBeNull();
    expect(pipeLabel('2.5m - 3000')).toBeNull();
    expect(serviceOf('HDPE DR17 SANITARY FORCEMAIN')).toBe('Sanitary');
    expect(serviceOf('HDPE DR17 WTM')).toBe('Water');
    expect(serviceOf('HDPE STM')).toBe('Storm');
  });

  it('reads chainages', () => {
    expect(chainage('0+275.15')).toBe(275.15);
    expect(chainage('1+050')).toBe(1050);
    expect(chainage('STA. 0+100')).toBe(100);
    expect(chainage('2+5')).toBeNull();
  });

  it('takes a stated length instead of the drawn line, without a scale', () => {
    const type = { kind: 'linear', height: 0 } as TakeoffType;
    const m = { points: [[0, 0], [10, 0]], holes: [], statedLength: 80.2 } as unknown as Measurement;
    expect(measurementVars(m, type, { metersPerPoint: null } as Sheet, 'metric')!.L).toBe(80.2);
    expect(measurementVars(m, type, { metersPerPoint: 0.1 } as Sheet, 'imperial')!.L).toBeCloseTo(263.12, 2);
    expect(measurementVars({ ...m, statedLength: undefined }, type, { metersPerPoint: 0.1 } as Sheet, 'metric')!.L).toBe(1);
  });
});
