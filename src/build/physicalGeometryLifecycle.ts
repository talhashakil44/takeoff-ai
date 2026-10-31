import type { Project } from '../model';
import type {
  Basis,
  BuildElement,
  BuildModel,
  ElementShape,
  SourceRef,
} from './types';

export interface PhysicalGeometryBaseline {
  version: 1;
  sourceFingerprint: string;
  shape: ElementShape | null;
  placement: Basis;
  sources: SourceRef[];
  issues: string[];
  requiresEvidence: boolean;
}
type TrackedElement = BuildElement & {
  physicalGeometryBaseline?: PhysicalGeometryBaseline;
};
/** These qualifications are emitted only by successful physical resolvers. They
 * must be removed before a new pass, or old success can masquerade as new proof. */
const derivedIssue = (value: string) =>
  /^(?:Physical (?:floor|high-roof|low-roof) beam:|Physical (?:roof (?:column|cantilever)|floor column):|Foundation revision applied:|Footing section taken from|Pier section and eccentric centre recovered|Interior slab concrete depth|Steel profile and datum offset inferred from calibrated section linework)/.test(
    value,
  );
const cleanIssues = (issues: string[]) =>
  issues.filter(
    (i) =>
      !derivedIssue(i) &&
      !i.startsWith('Physical geometry evidence unavailable:'),
  );
const fingerprint = (project: Project, e: BuildElement) =>
  JSON.stringify([
    project.measurements.find((m) => m.id === e.measurementId),
    project.types.find((t) => t.id === e.typeId),
    project.sheets.find((s) => s.id === e.sheetId),
  ]);
const copy = <T>(value: T): T => structuredClone(value);
const solid = (shape: ElementShape | null) =>
  !!shape && !['axis', 'locator'].includes(shape.type);
const footingSeed = (e: BuildElement) =>
  e.measurementSource === 'foundations' &&
  (/\b(?:footing|pier)\b/i.test(e.typeName) ||
    /^Slab on grade$/i.test(e.typeName));
const legacyPhysical = (e: BuildElement) =>
  e.issues.some(derivedIssue) || (e.shape?.type === 'run' && !!e.shape.profile);

function symbolic(shape: ElementShape | null): ElementShape | null {
  if (!shape) return null;
  if (shape.type === 'run')
    return { type: 'axis', points: copy(shape.points), z: shape.z0 };
  if (shape.type === 'point')
    return { type: 'locator', at: copy(shape.at), z: shape.z };
  if (shape.type === 'surface') return null;
  return copy(shape);
}
function legacySeed(e: BuildElement, model: BuildModel): ElementShape | null {
  const shape = e.shape;
  // Foundation run/surface resolvers need their source outline as input. This
  // seed is internal to the pass and is suppressed by end() without new proof.
  if (footingSeed(e) && (shape?.type === 'run' || shape?.type === 'surface'))
    return copy(shape);
  if (shape?.type === 'point' && /^P-?\d+\b/.test(e.typeName)) {
    // A previously recovered pier may be eccentric to its pad/grid. Reset to
    // the unique underlying pad before finding its actual source outline again.
    const pads = model.elements.filter(
      (p) =>
        p.sheetId === e.sheetId &&
        /^F\d+\b/.test(p.typeName) &&
        (p.shape?.type === 'point' || p.shape?.type === 'locator') &&
        Math.hypot(p.shape.at[0] - shape.at[0], p.shape.at[1] - shape.at[1]) <
          0.5,
    );
    if (pads.length === 1) {
      const p = pads[0].shape!;
      if (p.type === 'point' || p.type === 'locator')
        return { type: 'locator', at: copy(p.at), z: shape.z };
    }
  }
  return symbolic(shape);
}
function baselineIsUsable(
  value: PhysicalGeometryBaseline | undefined,
): value is PhysicalGeometryBaseline {
  return (
    value?.version === 1 &&
    typeof value.sourceFingerprint === 'string' &&
    Array.isArray(value.sources) &&
    Array.isArray(value.issues) &&
    typeof value.requiresEvidence === 'boolean'
  );
}

/** Begin one source-evidence pass. Call endPhysicalGeometry before exposing the
 * returned model to a scene/export: foundation seeds are temporarily physical. */
export function beginPhysicalGeometry(
  project: Project,
  model: BuildModel,
): BuildModel {
  return {
    ...model,
    elements: model.elements.map((original) => {
      // Plan-only placement must be requalified even when a pending revision
      // prevents the column resolver from running.
      let e = original as TrackedElement;
      if(original.planFootprint){
        const {planFootprint: _priorPlanFootprint, ...fresh} = original;
        e = fresh as TrackedElement;
      }
      if (e.origin === 'building' || e.trade !== 'structure') return e;
      const current = fingerprint(project, e),
        old = e.physicalGeometryBaseline;
      let baseline: PhysicalGeometryBaseline;
      if (baselineIsUsable(old) && old.sourceFingerprint === current) {
        baseline = copy(old);
      } else {
        const stale = !!old,
          legacy = legacyPhysical(e),
          requiresEvidence = stale || legacy || footingSeed(e);
        // If the source record changed, old world coordinates are not valid plan
        // evidence either. A rebuild is required; a symbolic stale axis is unsafe.
        const shape = stale
          ? null
          : legacy
            ? legacySeed(e, model)
            : copy(e.shape);
        baseline = {
          version: 1,
          sourceFingerprint: current,
          shape,
          placement: shape ? e.placement : 'unknown',
          sources: copy(
            legacy || stale ? e.sources.filter((s) => !s.quote) : e.sources,
          ),
          issues: cleanIssues(e.issues),
          requiresEvidence,
        };
        if (stale)
          baseline.issues.push(
            'Physical geometry baseline invalidated: source measurement, type or sheet changed; rebuild source geometry before placement.',
          );
      }
      // Clear success markers even if an older cached baseline incorrectly had
      // enriched issues. Fresh resolver success must come from this pass alone.
      baseline.issues = cleanIssues(baseline.issues);
      return {
        ...e,
        shape: copy(baseline.shape),
        placement: baseline.placement,
        sources: copy(baseline.sources),
        issues: copy(baseline.issues),
        physicalGeometryBaseline: baseline,
      };
    }),
  };
}

/** End the pass and fail closed. No source-backed solid may survive merely
 * because a prior pass produced it. The baseline is retained for later retries. */
export function endPhysicalGeometry(model: BuildModel): BuildModel {
  return {
    ...model,
    elements: model.elements.map((original) => {
      const e = {
          ...original,
          placement: original.shape ? original.placement : 'unknown',
          issues: [...new Set(original.issues)],
        } as TrackedElement,
        b = e.physicalGeometryBaseline;
      if (!baselineIsUsable(b)) return original;
      const qualified = e.issues.some(derivedIssue);
      const changed = JSON.stringify(e.shape) !== JSON.stringify(b.shape);
      const needsProof = b.requiresEvidence || (changed && solid(e.shape));
      if (qualified) {
        return {
          ...e,
          // Keep the locator warning in the baseline for evidence withdrawal,
          // but do not describe a freshly recovered solid as an unplaced tag.
          issues: solid(e.shape)
            ? e.issues.filter(i => !i.startsWith('Symbolic 3D location inferred'))
            : e.issues,
          physicalGeometryBaseline: { ...b, requiresEvidence: true },
        };
      }
      if (needsProof) {
        // Use only baseline geometry: an unsuccessfully generated intermediate
        // solid must not supply its coordinates to the fallback either.
        const shape = symbolic(b.shape);
        return {
          ...e,
          shape,
          placement: shape ? b.placement : 'unknown',
          sources: copy(e.sources),
          issues: [
            ...new Set([
              ...cleanIssues(e.issues),
              'Physical geometry evidence unavailable: no fresh source qualification in this pass; physical solid withheld.',
            ]),
          ],
          physicalGeometryBaseline: { ...b, requiresEvidence: true },
        };
      }
      const { physicalGeometryBaseline: _, ...untracked } = e;
      return untracked;
    }),
  };
}
