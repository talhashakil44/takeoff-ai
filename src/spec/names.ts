import type { MapNode } from './links';

/** MasterFormat divisions by number. */
export const DIVISIONS: Record<string, string> = {
  '00': 'Procurement & contracting',
  '01': 'General requirements',
  '02': 'Existing conditions & site',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, plastics & composites',
  '07': 'Thermal & moisture',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special construction',
  '14': 'Conveying',
  '20': 'Mechanical general',
  '21': 'Fire suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic safety & security',
  '31': 'Earthwork',
  '32': 'Exterior improvements',
  '33': 'Utilities',
  '34': 'Transportation',
  '35': 'Waterway & marine',
  '40': 'Process integration',
  '48': 'Electrical power generation',
};
export const TRADES: Record<string, string> = { A: 'Architectural', S: 'Structural', M: 'Mechanical', P: 'Plumbing', E: 'Electrical', FP: 'Fire protection', F: 'Fire', C: 'Civil', SP: 'Site', L: 'Landscape', ID: 'Interiors', '#': 'Other' };


/** What a map node belongs to, in a word or two: "Openings", "Electrical", "Addenda". */
export const shortGroupName = (n: MapNode): string => (n.group === 'AD' ? 'Addenda' : n.side === 'spec' ? (DIVISIONS[n.group] ?? `Division ${n.group}`) : (TRADES[n.group] ?? n.group));
