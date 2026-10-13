import { useState } from 'react';
import { useEscape } from './Dialogs';

export interface SheetNumberRow {
  sheetId: string;
  /** The name the sheet has now. */
  current: string;
  /** Read from the box on this sheet ('' when nothing was found there). */
  number: string;
  /** Read from the title box, when one was marked. */
  title?: string;
}

interface Props {
  rows: SheetNumberRow[];
  /** Whether a title box was marked (the Title column is shown). */
  hasTitle: boolean;
  /** Close and mark the title box on the open sheet. */
  onPickTitle: () => void;
  onApply: (rows: SheetNumberRow[]) => void;
  onClose: () => void;
}

/** What was read at the marked spot on every sheet, to check, correct and apply. */
export function SheetNumbersDialog({ rows, hasTitle, onPickTitle, onApply, onClose }: Props) {
  const [draft, setDraft] = useState(() =>
    rows.map((r) => ({ ...r, on: !!r.number && (r.number !== r.current || (!!r.title && r.title !== r.current)) })),
  );
  useEscape(onClose);
  const set = (i: number, patch: Partial<(typeof draft)[number]>) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const picked = draft.filter((d) => d.on && d.number.trim());
  // The same number on two sheets is usually a misread (or a revision): flag it.
  const counts = new Map<string, number>();
  for (const d of draft) if (d.on && d.number.trim()) counts.set(d.number.trim(), (counts.get(d.number.trim()) ?? 0) + 1);
  const found = rows.filter((r) => r.number).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Sheet numbers" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Sheet numbers</h3>
          <button onClick={onClose}>Cancel</button>
        </div>
        <p className="muted small-text">
          Read from the spot you marked, on all {rows.length} sheets: found on {found}. Correct any here; sheets left unticked keep their name.
        </p>
        <div className="sheet-numbers-scroll">
          <table className="rooms-table sheet-numbers">
            <thead>
              <tr>
                <th />
                <th>Now</th>
                <th>Sheet number</th>
                {hasTitle && <th>Title</th>}
              </tr>
            </thead>
            <tbody>
              {draft.map((d, i) => (
                <tr key={d.sheetId} className={d.on ? '' : 'disabled-row'}>
                  <td>
                    <input type="checkbox" checked={d.on} onChange={(e) => set(i, { on: e.target.checked })} aria-label={`Rename ${d.current}`} />
                  </td>
                  <td className="muted">{d.current}</td>
                  <td>
                    <input
                      className="room-name"
                      value={d.number}
                      placeholder="Nothing found here"
                      onChange={(e) => set(i, { number: e.target.value, on: !!e.target.value.trim() })}
                      aria-label="Sheet number"
                    />
                    {d.on && (counts.get(d.number.trim()) ?? 0) > 1 && <div className="field-hint error">Same number as another sheet</div>}
                  </td>
                  {hasTitle && (
                    <td>
                      <input className="room-name" value={d.title ?? ''} onChange={(e) => set(i, { title: e.target.value })} aria-label="Sheet title" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row-actions sticky library-actions">
          {!hasTitle && (
            <button onClick={onPickTitle} title="Mark where the sheet title is, to read titles the same way">
              Also read titles…
            </button>
          )}
          <div className="spacer" />
          <button className="primary" disabled={!picked.length} onClick={() => onApply(picked)}>
            {picked.length ? `Rename ${picked.length} sheet${picked.length === 1 ? '' : 's'}` : 'Rename sheets'}
          </button>
        </div>
      </div>
    </div>
  );
}
