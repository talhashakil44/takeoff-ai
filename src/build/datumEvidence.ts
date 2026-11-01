import type { Project } from '../model';
import type { DrawingTexts } from './building';
import type { SourceRef } from './types';
export interface DatumEvidence {
  level: string;
  zone: string;
  elevation: number;
  sources: SourceRef[];
  count: number;
}
export function imperialFeet(text: string): number | null {
  const m = /^(-?\d+)\s*['′]\s*-?\s*(\d+)?(?:\s+(\d+)\/(\d+))?\s*["″]$/.exec(text.trim());
  if (!m) return null;
  const fraction = m[3] ? Number(m[3]) / Number(m[4]) : 0;
  const inches = Number(m[2] ?? 0) + fraction;
  if (!Number.isFinite(inches) || inches >= 12 || fraction >= 1) return null;
  // The leading sign applies to the entire dimension, including negative zero feet.
  const feet = Math.abs(Number(m[1])) + inches / 12;
  return Number.isFinite(feet) ? (m[1].startsWith('-') ? -feet : feet) : null;
}
/** Separate wing datums remain separate evidence; never average split-level elevations. */
export function imperialDatumEvidence(project: Project, texts: DrawingTexts): DatumEvidence[] {
  const evidence: DatumEvidence[] = [];
  for (const s of project.sheets.filter(
    (s) => /ELEVATION|BUILDING SECTION/i.test(s.title ?? '') && !/INTERIOR|DETAIL/i.test(s.title ?? ''),
  )) {
    const ts = texts[s.id] ?? [];
    for (const t of ts) {
      if (!/^(?:t\.?\s*o\.?|fin\.?)/i.test(t.str) || !/floor|roof deck/i.test(t.str)) continue;
      const level = /basement/i.test(t.str)
        ? 'L0'
        : /ground|first|main/i.test(t.str)
          ? 'L1'
          : /second/i.test(t.str)
            ? 'L2'
            : /third/i.test(t.str)
              ? 'L3'
              : /fourth/i.test(t.str)
                ? 'L4'
                : /roof deck/i.test(t.str)
                  ? 'roof'
                  : null;
      if (!level) continue;
      const value = ts
        .filter((v) => Math.abs(v.cy - t.cy) < 4 && Math.abs(v.cx - t.cx) < 150 && imperialFeet(v.str) !== null)
        .sort((a, b) => Math.abs(a.cx - t.cx) - Math.abs(b.cx - t.cx))[0];
      if (!value) continue;
      const zone = /\(([^)]+)\)/.exec(t.str)?.[1] ?? 'Building';
      const elevation = imperialFeet(value.str)! * 0.3048;
      const source: SourceRef = {
        kind: 'sheet',
        id: s.id,
        page: s.page,
        label: s.name,
        quote: `${t.str}: ${value.str}`,
        box: [Math.min(t.cx, value.cx) - 60, t.cy - 15, Math.max(t.cx, value.cx) + 60, t.cy + 15],
      };
      const prior = evidence.find((e) => e.level === level && e.zone === zone && Math.abs(e.elevation - elevation) < 0.01);
      if (prior) {
        prior.count++;
        prior.sources.push(source);
      } else evidence.push({ level, zone, elevation, sources: [source], count: 1 });
    }
  }
  if (!evidence.length) return [];
  const floors = evidence.filter((e) => e.level !== 'roof');
  // A roof elevation alone cannot establish the model's floor datum origin.
  if (!floors.length) return [];
  const base = Math.min(...floors.map((e) => e.elevation));
  return evidence.map((e) => ({ ...e, elevation: e.elevation - base }));
}
