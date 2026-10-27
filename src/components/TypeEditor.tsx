import { evaluate } from '../formula';
import { DIVISIONS, newId, type Kind, type TakeoffType, type Units } from '../model';
import { formulaVars, type Vars } from '../quantities';
import { areaUnit, formatQty, lengthUnit } from '../units';
import { Icon } from './Icons';

interface Props {
  type: TakeoffType;
  units: Units;
  totals: Vars | undefined;
  onChange: (type: TakeoffType) => void;
  onDelete: () => void;
  /** Makes a copy of this type, with its assembly, to edit into a similar one. */
  onDuplicate: () => void;
  /** Back (and Save): keeps the changes. */
  onClose: () => void;
  /** Changed since it was opened. */
  dirty?: boolean;
  /** Puts the type back as it was when it was opened. */
  onCancel?: () => void;
}

const VARS_HELP: [keyof Vars, string][] = [
  ['L', 'Total length'],
  ['H', 'Height'],
  ['A', 'Area (L × H for linear types)'],
  ['P', 'Perimeter, incl. cutouts'],
  ['I', 'Cutout edges only'],
  ['O', 'Doorways in filled rooms (part of P)'],
  ['N', 'Number of runs, rooms or items'],
];

/** Edits a takeoff type: name, kind, colour, height, estimate grouping and its assembly items. */
/** How a material is worked out, as one-click choices; anything else is a custom formula. */
function basesFor(type: TakeoffType, units: Units): { id: string; label: string; formula: string; unit: string }[] {
  const len = lengthUnit(units);
  const area = areaUnit(units);
  if (type.kind === 'linear')
    return [
      { id: 'L', label: 'Per length', formula: 'L', unit: len },
      { id: 'L * H', label: 'Per wall area (length × height)', formula: 'L * H', unit: area },
      { id: 'N', label: 'Each (per takeoff)', formula: 'N', unit: 'ea' },
    ];
  if (type.kind === 'area')
    return [
      { id: 'A', label: 'Per area', formula: 'A', unit: area },
      { id: 'P', label: 'Per perimeter', formula: 'P', unit: len },
      { id: 'P * H', label: 'Per wall area (perimeter × height)', formula: 'P * H', unit: area },
      { id: 'N', label: 'Each (per takeoff)', formula: 'N', unit: 'ea' },
    ];
  return [{ id: 'N', label: 'Each', formula: 'N', unit: 'ea' }];
}

/** A new material's starting formula: by length, by wall area once a height is set, by area, or each. */
function defaultItem(type: TakeoffType, units: Units) {
  if (type.kind === 'linear') return type.height ? { formula: 'L * H', unit: areaUnit(units) } : { formula: 'L', unit: lengthUnit(units) };
  if (type.kind === 'area') return { formula: 'A', unit: areaUnit(units) };
  return { formula: 'N', unit: 'ea' };
}

export function TypeEditor({ type, units, totals, onChange, onDelete, onDuplicate, onClose, dirty, onCancel }: Props) {
  const set = (patch: Partial<TakeoffType>) => onChange({ ...type, ...patch });
  const vars = totals ?? { L: 0, H: type.height, A: 0, P: 0, N: 0, I: 0 };

  return (
    <div className="type-editor">
      <div className="editor-head">
        <button className="back" onClick={onClose} title="Back to the quantities (keeps your changes)">
          <Icon name="chevron" size={14} /> Back
        </button>
        <span className="editor-title">{dirty ? 'Edited' : 'Takeoff type'}</span>
        <span className="editor-actions">
          {dirty && onCancel && (
            <button className="small" onClick={onCancel} title="Undo every change made since you opened this type">
              Cancel
            </button>
          )}
          <button className={`small ${dirty ? 'primary' : ''}`} onClick={onClose} title={dirty ? 'Keep these changes' : 'Close'}>
            {dirty ? 'Save' : 'Done'}
          </button>
        </span>
      </div>

      <div className="form-group">
        <label className="field">
          <span>Name</span>
          <input id="type-name" value={type.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Measured as</span>
            <select id="type-kind" value={type.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
              <option value="area">Area</option>
              <option value="linear">Length</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label className="field narrow">
            <span>
              {type.kind === 'linear' ? 'Wall height' : 'Height'} ({lengthUnit(units)})
            </span>
            {/* Blank is no height: only items that use H (a wall's area) need one. */}
            <input
              id="type-height"
              type="number"
              min={0}
              step={0.1}
              placeholder="optional"
              value={type.height || ''}
              onChange={(e) => set({ height: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="field color">
            <span>Colour</span>
            <input id="type-color" type="color" value={type.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
        </div>
        <div className="field-row">
          {(['width', 'depth', 'thickness'] as const).map((k) => (
            <label className="field" key={k} title={`${k[0].toUpperCase()} in formulas`}>
              <span>
                {k[0].toUpperCase() + k.slice(1)} ({units === 'metric' ? 'm' : 'ft'})
              </span>
              <input
                id={`type-${k}`}
                type="number"
                min={0}
                step={0.01}
                value={type[k] ?? ''}
                placeholder="—"
                onChange={(e) => set({ [k]: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
          ))}
        </div>
        {type.kind === 'linear' && (
          <label className="inline check-row">
            <input type="checkbox" checked={!!type.stopsAtDoors} onChange={(e) => set({ stopsAtDoors: e.target.checked })} /> Wall takeoff stops this type at
            door openings
          </label>
        )}
        {type.kind === 'linear' && (
          <label className="inline check-row">
            <input type="checkbox" checked={type.headline === 'area'} onChange={(e) => set({ headline: e.target.checked ? 'area' : undefined })} /> Show the total as
            area (length × height), as for paint
          </label>
        )}
        <label className="field">
          <span>Estimate division</span>
          <input
            id="type-division"
            list="division-list"
            placeholder="09 Finishes"
            value={type.division ?? ''}
            onChange={(e) => set({ division: e.target.value || undefined })}
          />
          <datalist id="division-list">
            {DIVISIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Subtrade package</span>
          <input
            id="type-package"
            placeholder="Drywall & ceilings"
            value={type.package ?? ''}
            onChange={(e) => set({ package: e.target.value || undefined })}
          />
        </label>
      </div>

      <div className="group-title">Assembly</div>
      <div className="assembly-items">
        {type.items.length === 0 && <p className="muted small-text">Add the materials this type needs. Each one is a formula of the totals below.</p>}
        {type.items.map((it, i) => {
          const r = evaluate(it.formula, formulaVars(vars, type));
          const bases = basesFor(type, units);
          const update = (patch: Partial<typeof it>) => set({ items: type.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div className="assembly-item" key={it.id}>
              <div className="item-top">
                <input id={`item-name-${it.id}`} className="item-name" value={it.name} aria-label="Material" onChange={(e) => update({ name: e.target.value })} />
                <span className="item-qty">{r.ok ? formatQty(r.value) : '—'}</span>
                <button className="icon-button" title="Remove material" aria-label="Remove material" onClick={() => set({ items: type.items.filter((_, j) => j !== i) })}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="item-basis">
                <select
                  aria-label="Calculated"
                  value={bases.find((b) => b.formula === it.formula.replace(/\s+/g, ' ').trim())?.id ?? 'custom'}
                  onChange={(e) => {
                    const b = bases.find((x) => x.id === e.target.value);
                    if (b) update({ formula: b.formula, unit: b.unit });
                    else document.getElementById(`item-formula-${it.id}`)?.focus();
                  }}
                >
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                  <option value="custom">Custom formula…</option>
                </select>
              </div>
              <div className="item-bottom">
                <input
                  id={`item-formula-${it.id}`}
                  className={r.ok ? 'formula' : 'formula bad'}
                  value={it.formula}
                  aria-label="Formula"
                  title={r.ok ? '' : r.error}
                  onChange={(e) => update({ formula: e.target.value })}
                />
                <input id={`item-unit-${it.id}`} className="unit" value={it.unit} placeholder="unit" aria-label="Unit (optional)" onChange={(e) => update({ unit: e.target.value })} />
              </div>
              {!r.ok && <div className="field-hint error">{r.error}</div>}
              {r.ok && /\bH\b|Height/.test(it.formula) && !type.height && <div className="field-hint">Uses the wall height: enter one above.</div>}
            </div>
          );
        })}
        <button className="add-row" onClick={() => set({ items: [...type.items, { id: newId(), name: 'New material', ...defaultItem(type, units) }] })}>
          <Icon name="plus" size={14} /> Add material
        </button>
      </div>

      <div className="vars-card">
        <div className="vars-title">Totals for this type</div>
        <dl>
          {VARS_HELP.map(([k, d]) => (
            <div key={k}>
              <dt>
                <code>{k}</code> {d}
              </dt>
              <dd>{formatQty(vars[k] ?? 0)}</dd>
            </div>
          ))}
        </dl>
        <p className="small-text muted">
          Formulas use these letters, and the type’s <code>W</code> <code>D</code> <code>T</code>, with + - * / and <code>ceil</code> <code>floor</code>{' '}
          <code>round</code> <code>min</code> <code>max</code>, e.g. <code>ceil(L / 0.61) + N</code>. Autodesk-style names work too: <code>Distance</code>{' '}
          <code>Area</code> <code>Perimeter</code> <code>InnerPerimeter</code> <code>Height</code> <code>Width</code> <code>Depth</code> <code>Thickness</code>.
        </p>
      </div>

      <button className="wide" onClick={onDuplicate}>
        <Icon name="plus" size={16} /> Duplicate type
      </button>
      <button className="destructive wide" onClick={onDelete}>
        <Icon name="trash" size={16} /> Delete type and its takeoffs
      </button>
    </div>
  );
}
