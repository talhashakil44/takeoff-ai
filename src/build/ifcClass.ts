import type { BuildElement } from './types';

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** IFC's 22-character GlobalId from a UUID (or any string, hashed to 128 bits). */
export function ifcGuid(id: string): string {
  let hex = id.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    // Not a UUID: four 32-bit hashes of it.
    const h = (seed: number) => {
      let x = 2166136261 ^ seed;
      for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619);
      return (x >>> 0).toString(16).padStart(8, '0');
    };
    hex = h(1) + h(2) + h(3) + h(4);
  }
  const bytes = hex.match(/../g)!.map((b) => parseInt(b, 16));
  // 2 chars for the first byte, then 4 chars per 3 bytes.
  const out: string[] = [];
  const enc = (v: number, n: number) => {
    const s: string[] = [];
    for (let i = 0; i < n; i++) {
      s.unshift(CHARS[v % 64]);
      v = Math.floor(v / 64);
    }
    out.push(s.join(''));
  };
  enc(bytes[0], 2);
  for (let i = 1; i < 16; i += 3) enc((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2], 4);
  return out.join('');
}

/** A STEP string: quotes doubled, anything outside ASCII as \X2\…\X0\. */

/** Which IFC4 class (and the tail of its entity: the predefined type) an element is exported as. */
export function ifcClassOf(e: BuildElement): { cls: string; tail: string } {
  const name = e.typeName.toLowerCase();
  const t9 = (cls: string, pre: string) => ({ cls, tail: `,${pre}` });
  if (e.trade === 'demolition') return t9('IFCBUILDINGELEMENTPROXY', '.NOTDEFINED.');
  if (e.trade === 'structure' && /\bbeam\b/.test(name)) return t9('IFCBEAM', '.BEAM.');
  if (e.shape?.type === 'run') {
    if (e.trade === 'structure' && /^(?:l|bl)\d+\b|\blintel\b/.test(name)) return t9('IFCBEAM', '.LINTEL.');
    if (e.trade === 'structure' && /^b\d+\b|\bglulam beam\b/.test(name)) return t9('IFCBEAM', '.BEAM.');
    if (e.trade === 'mech-rough') return /duct/.test(name) ? t9('IFCDUCTSEGMENT', '.NOTDEFINED.') : t9('IFCPIPESEGMENT', '.NOTDEFINED.');
    if (e.trade === 'fire-rough') return t9('IFCPIPESEGMENT', '.NOTDEFINED.');
    if (e.trade === 'elec-rough') return t9('IFCCABLECARRIERSEGMENT', '.NOTDEFINED.');
    if (e.trade === 'partitions' || e.trade === 'structure' || /wall|partition/.test(name)) return t9('IFCWALL', '.STANDARD.');
    return t9('IFCBUILDINGELEMENTPROXY', '.NOTDEFINED.');
  }
  if (e.shape?.type === 'surface') {
    if (e.trade === 'ceilings') return t9('IFCCOVERING', '.CEILING.');
    if (e.trade === 'flooring') return t9('IFCCOVERING', '.FLOORING.');
    if (e.trade === 'structure') return t9('IFCSLAB', '.FLOOR.');
    if (e.trade === 'envelope') return t9('IFCROOF', '.NOTDEFINED.');
    return t9('IFCCOVERING', '.NOTDEFINED.');
  }
  if (e.trade === 'doors') {
    if (/window|glaz|storefront|curtain/.test(name)) return { cls: 'IFCWINDOW', tail: `,$,$,.NOTDEFINED.,.NOTDEFINED.,$` };
    return { cls: 'IFCDOOR', tail: `,$,$,.DOOR.,.NOTDEFINED.,$` };
  }
  if (e.trade === 'elec-trim') return /light|luminaire|fixture|exit/.test(name) ? t9('IFCLIGHTFIXTURE', '.NOTDEFINED.') : t9('IFCOUTLET', '.NOTDEFINED.');
  if (e.trade === 'fire-heads') return t9('IFCFIRESUPPRESSIONTERMINAL', '.SPRINKLER.');
  if (e.trade === 'mech-trim') return /diffuser|grille|register/.test(name) ? t9('IFCAIRTERMINAL', '.NOTDEFINED.') : /sink|lav|toilet|wc|urinal|shower|fountain|fixture/.test(name) ? t9('IFCSANITARYTERMINAL', '.NOTDEFINED.') : t9('IFCBUILDINGELEMENTPROXY', '.NOTDEFINED.');
  if (e.trade === 'specialties') return { cls: 'IFCFURNISHINGELEMENT', tail: '' };
  return t9('IFCBUILDINGELEMENTPROXY', '.NOTDEFINED.');
}

const NAMES: Record<string, string> = {
  IFCBUILDINGELEMENTPROXY: 'IfcBuildingElementProxy',
  IFCDUCTSEGMENT: 'IfcDuctSegment',
  IFCPIPESEGMENT: 'IfcPipeSegment',
  IFCCABLECARRIERSEGMENT: 'IfcCableCarrierSegment',
  IFCWALL: 'IfcWall',
  IFCBEAM: 'IfcBeam',
  IFCCOVERING: 'IfcCovering',
  IFCSLAB: 'IfcSlab',
  IFCROOF: 'IfcRoof',
  IFCWINDOW: 'IfcWindow',
  IFCDOOR: 'IfcDoor',
  IFCLIGHTFIXTURE: 'IfcLightFixture',
  IFCOUTLET: 'IfcOutlet',
  IFCFIRESUPPRESSIONTERMINAL: 'IfcFireSuppressionTerminal',
  IFCAIRTERMINAL: 'IfcAirTerminal',
  IFCSANITARYTERMINAL: 'IfcSanitaryTerminal',
  IFCFURNISHINGELEMENT: 'IfcFurnishingElement',
};

/** How the class reads to a person: IfcCovering · Ceiling. */
export function ifcClassLabel(e: BuildElement): string {
  const { cls, tail } = ifcClassOf(e);
  const name = NAMES[cls] ?? cls;
  const pre = /\.([A-Z]+)\./.exec(tail)?.[1];
  return pre && pre !== 'NOTDEFINED' ? `${name} · ${pre[0]}${pre.slice(1).toLowerCase()}` : name;
}
