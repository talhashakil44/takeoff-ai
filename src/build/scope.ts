import type { Activity, BuildModel, PlanSetup, SpecFact } from './types';

const link = (from: string, why: string) => ({
  from,
  why,
  type: 'FS' as const,
  lag: 0,
  basis: 'assumed' as const,
});
/** Complete scope is distinct from the takeoff: no invented measurements or quantities. */
export function completeScope(model: BuildModel, acts: Activity[], setup: PlanSetup, facts: SpecFact[]) {
  if (!model.floorAreas || !Object.keys(model.floorAreas).length) return;
  const renovation = model.projectType === 'renovation';
  const levels = model.levels.filter((l) => model.floorAreas![l.id] > 0);
  if (renovation) levels.sort((a, b) => b.elevation - a.elevation);
  const footprint = Math.max(...Object.values(model.floorAreas));
  const add = (id: string, name: string, area: number, rate: number, predecessors: string[], extra: Partial<Activity> = {}) => {
    const a: Activity = {
      id,
      name,
      kind: 'work',
      trade: null,
      level: null,
      elements: [],
      quantities: { 'm²': area },
      rates: { 'm²': rate },
      crews: 1,
      duration: Math.max(1, Math.ceil(area / rate)),
      durationBasis: 'assumed',
      durationWhy: `Building scope allowance: ${Math.round(area)} m² / ${rate} m² per crew-day. Confirm scope and production with superintendent.`,
      deps: predecessors.map((p) => link(p, 'Physical construction prerequisite')),
      specs: [],
      sources: [],
      ...extra,
    };
    acts.push(a);
    return a.id;
  };
  const procure = (key: string, name: string, lead: number) =>
    add(`longlead:${key}`, name, 0, 1, ['mobilize'], {
      kind: 'procurement',
      quantities: undefined,
      rates: undefined,
      duration: setup.submittalPrepDays.value + setup.reviewDays.value + lead,
      durationWhy: `Assumed ${lead} working days manufacture/delivery + ${setup.submittalPrepDays.value} preparation + ${setup.reviewDays.value} review. Confirm vendor quotation; not compressible by crews.`,
    });
  const steel = renovation ? null : procure('steel', 'Structural frame / timber fabrication', 80);
  const gear = procure('switchgear', 'Switchgear procurement', 180);
  const ahu = procure('ahu', 'Air handling equipment procurement', 120);
  const glazing = procure('glazing', 'Exterior glazing procurement', 100);
  const enabling = renovation
    ? add('scope:phasing', 'Occupied building: segregation, protection and phased access', footprint, 100, ['mobilize'])
    : add('scope:excavation', 'Site preparation and excavation', footprint, 35, ['mobilize'], { weather: 'site' });
  const foundation = renovation
    ? add('scope:abatement', 'Survey, selective abatement and clearance', footprint, 50, [enabling])
    : add('scope:foundations', 'Foundations and below-grade waterproofing', footprint, 20, [enabling], { weather: 'structure' });
  const underground = add(
    'scope:underground',
    renovation ? 'Service isolation and utility alterations' : 'Underground services and backfill',
    footprint,
    45,
    [foundation],
  );
  let prev = underground;
  const frame: string[] = [];
  for (const l of levels) {
    const id = `work:structure:${l.id}`;
    let a = acts.find((a) => a.id === id);
    if (!a) {
      add(
        id,
        `${renovation ? 'Structural alterations' : 'Structure and slab'} — ${l.name}`,
        model.floorAreas[l.id],
        renovation ? 100 : 25,
        [prev, ...(steel ? [steel] : [])],
        {
          trade: 'structure',
          level: l.id,
          elements: model.elements
            .filter((e) => e.origin === 'building' && e.trade === 'structure' && e.level === l.id && e.status !== 'existing')
            .map((e) => e.id),
          weather: renovation ? undefined : 'structure',
        },
      );
      a = acts.at(-1)!;
    } else {
      a.deps.push(link(prev, 'Supporting structure / underground first'), ...(steel ? [link(steel, 'Structural material on site')] : []));
      a.allowanceCrewDays = model.floorAreas[l.id] / (renovation ? 100 : 25);
      if (Math.ceil(a.allowanceCrewDays / (a.crews ?? 1)) > a.duration) a.durationBasis = 'assumed';
      a.duration = Math.max(a.duration, Math.ceil(a.allowanceCrewDays / (a.crews ?? 1)));
      a.durationWhy += ` · full floor structural coverage allowance: ${Math.round(model.floorAreas[l.id])} m² / ${renovation ? 100 : 25} m² per crew-day (partial takeoff cannot omit the frame/slab)`;
      a.weather = renovation ? undefined : 'structure';
    }
    a.elements = [
      ...new Set([
        ...a.elements,
        ...model.elements
          .filter((e) => e.origin === 'building' && e.trade === 'structure' && e.level === l.id && e.status !== 'existing')
          .map((e) => e.id),
      ]),
    ];
    prev = id;
    frame.push(id);
  }
  const roof = add('scope:roof', 'Roofing, flashing and drainage', footprint, 60, [prev], {
    trade: 'envelope',
    weather: 'roof',
    elements: model.elements
      .filter((e) => e.origin === 'building' && e.shape?.type === 'surface' && e.trade === 'envelope' && e.status !== 'existing')
      .map((e) => e.id),
  });
  const envelope = add(
    'scope:envelope',
    renovation ? 'Envelope repairs and glazing replacement' : 'Exterior envelope and glazing',
    footprint,
    40,
    [...frame, glazing],
    {
      trade: 'envelope',
      elements: model.elements
        .filter((e) => e.origin === 'building' && e.shape?.type === 'run' && e.trade === 'envelope' && e.status !== 'existing')
        .map((e) => e.id),
    },
  );
  add('ms:weather-tight', 'Weather-tight', 0, 1, [roof, envelope], {
    kind: 'milestone',
    duration: 0,
  });
  const rates: Record<string, number> = {
    'mech-rough': 20,
    'elec-rough': 30,
    'fire-rough': 60,
    partitions: 25,
    ceilings: 45,
    doors: 80,
    painting: 60,
    flooring: 45,
    'mech-trim': 55,
    'elec-trim': 55,
    'fire-heads': 100,
  };
  if (renovation) for (const a of acts) a.deps = a.deps.filter((d) => !/Same crew, level after level/.test(d.why));
  for (const [i, l] of levels.entries()) {
    for (const [trade, rate] of Object.entries(rates)) {
      const id = `work:${trade}:${l.id}`;
      if (!acts.some((a) => a.id === id))
        add(id, `${trade.replaceAll('-', ' ')} — ${l.name}`, model.floorAreas[l.id], rate, [], { trade, level: l.id });
      const a = acts.find((a) => a.id === id)!;
      if (a.elements.length) {
        a.allowanceCrewDays = model.floorAreas[l.id] / rate;
        const allowance = Math.ceil(a.allowanceCrewDays / (a.crews ?? 1));
        if (allowance > a.duration) {
          a.duration = allowance;
          a.durationBasis = 'assumed';
          a.durationWhy += ` · incomplete coverage allowance: ${Math.round(model.floorAreas[l.id])} m² / ${rate} m² per crew-day; greater of measured work and full floor coverage`;
        }
      }
      if (i > 0 && !setup.levelsInParallel.value && !a.deps.some((d) => d.from === `work:${trade}:${levels[i - 1].id}`))
        a.deps.push(link(`work:${trade}:${levels[i - 1].id}`, 'Same crew, level after level'));
      if (['partitions', 'mech-rough', 'elec-rough', 'fire-rough'].includes(trade))
        a.deps.push(
          link(`work:structure:${l.id}`, 'Structure released'),
          link(
            renovation ? `work:structure:${l.id}` : 'ms:weather-tight',
            renovation ? 'Existing enclosure retained' : 'Dry interior work',
          ),
        );
      if (trade === 'mech-trim') a.deps.push(link(ahu, 'Equipment delivered'));
      if (trade === 'elec-trim') a.deps.push(link(gear, 'Equipment delivered'));
    }
    const rough = ['mech-rough', 'elec-rough', 'fire-rough', 'partitions'].map((t) => `work:${t}:${l.id}`);
    const inspect = add(`scope:inspection:${l.id}`, `Concealed work inspection — ${l.name}`, 0, 1, rough, {
      kind: 'testing',
      duration: setup.testingDays.value,
      level: l.id,
      durationWhy: setup.testingDays.why,
    });
    for (const t of ['ceilings', 'painting', 'doors'])
      acts.find((a) => a.id === `work:${t}:${l.id}`)!.deps.push(link(inspect, 'Inspect before covering'));
    for (const t of ['flooring', 'mech-trim', 'elec-trim', 'fire-heads'])
      acts.find((a) => a.id === `work:${t}:${l.id}`)!.deps.push(link(`work:ceilings:${l.id}`, 'Ceilings complete'));
    acts.find((a) => a.id === `work:flooring:${l.id}`)!.deps.push(link(`work:painting:${l.id}`, 'Paint before final flooring'));
    if (renovation && i > 0)
      acts
        .find((a) => a.id === `work:partitions:${l.id}`)!
        .deps.push(link(`work:flooring:${levels[i - 1].id}`, 'Occupied building phase handover before next fit-out'));
  }
  const phase = facts.find((f) => f.key === 'phaseDate');
  if (phase)
    add(
      'ms:phase-one',
      'Phase one occupancy (whole-floor conservative scope)',
      0,
      1,
      acts
        .filter(
          (a) =>
            a.kind === 'work' &&
            ['L3', 'L2', 'L1'].includes(a.level ?? '') &&
            /trim|flooring|doors|painting|ceilings|fire-heads/.test(a.trade ?? ''),
        )
        .map((a) => a.id),
      {
        kind: 'milestone',
        duration: 0,
        requiredBy: String(phase.value),
        sources: [phase.source],
        durationWhy:
          'Contract phase-one includes upper floors and ground-floor entry/dining; whole ground floor used conservatively until zones are assigned.',
      },
    );
  for (const a of acts) a.deps = a.deps.filter((d, i, ds) => ds.findIndex((x) => x.from === d.from) === i);
  add('scope:site-completion', 'Final grading, paving and landscape reinstatement', footprint, 65, [roof], {
    weather: 'site',
    trade: 'site',
  });
  if (model.elements.some((e) => /elevator|lift/i.test(e.name))) {
    const lift = procure('elevator', 'Elevator fabrication', 160);
    add('scope:elevator', 'Elevator installation and certification', footprint, 60, [prev, lift], { trade: 'other' });
  }
}
