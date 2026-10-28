import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Doc, Measurement, Sheet, SpecDoc } from '../model';
import { Icon } from './Icons';

/**
 * The project's files in one place: the drawing sets and the specification, each listed with
 * what it holds. Rename, drag to reorder, remove a file or several at once; open a drawing
 * set to reorder or remove its sheets. Everything here can be undone.
 */

interface Props {
  docs: Doc[];
  specs: SpecDoc[];
  sheets: Sheet[];
  measurements: Measurement[];
  onRename: (kind: 'drawings' | 'specs', id: string, name: string) => void;
  onReorder: (kind: 'drawings' | 'specs', ids: string[]) => void;
  onRemove: (kind: 'drawings' | 'specs', ids: string[]) => void;
  onReorderSheets: (docId: string, sheetIds: string[]) => void;
  onRemoveSheets: (sheetIds: string[]) => void;
  onAdd: (kind: 'drawings' | 'specs') => void;
  onClose: () => void;
}

export function FileManager({ docs, specs, sheets, measurements, onRename, onReorder, onRemove, onReorderSheets, onRemoveSheets, onAdd, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ kind: string; id: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  // Files gone (removed, or undone): forget them.
  useEffect(() => {
    const ids = new Set([...docs, ...specs].map((d) => d.id));
    setPicked((p) => new Set([...p].filter((id) => ids.has(id))));
  }, [docs, specs]);

  const takeoffsOn = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of measurements) n.set(m.sheetId, (n.get(m.sheetId) ?? 0) + 1);
    return n;
  }, [measurements]);
  const sheetsOf = (docId: string) => sheets.filter((s) => s.docId === docId);

  const toggle = (id: string) => setPicked((p) => (p.has(id) ? (p.delete(id), new Set(p)) : new Set(p).add(id)));
  const pickedDocs = docs.filter((d) => picked.has(d.id)).map((d) => d.id);
  const pickedSpecs = specs.filter((d) => picked.has(d.id)).map((d) => d.id);

  /** Drops the dragged row before `target` in its own list. */
  const dropOn = (kind: 'drawings' | 'specs', list: { id: string }[], target: string) => {
    if (!drag || drag.kind !== kind || drag.id === target) return;
    const ids = list.map((d) => d.id).filter((id) => id !== drag.id);
    ids.splice(ids.indexOf(target), 0, drag.id);
    onReorder(kind, ids);
  };
  const move = (kind: 'drawings' | 'specs', list: { id: string }[], id: string, by: number) => {
    const ids = list.map((d) => d.id);
    const i = ids.indexOf(id);
    const j = Math.max(0, Math.min(ids.length - 1, i + by));
    if (i === j) return;
    ids.splice(i, 1);
    ids.splice(j, 0, id);
    onReorder(kind, ids);
  };

  const section = (kind: 'drawings' | 'specs', title: string, list: Doc[], pickedIds: string[]) => (
    <section className="fm-section">
      <div className="fm-section-head">
        <h4>
          {title} <span className="count">{list.length}</span>
        </h4>
        {list.length > 1 && (
          <button className="link-button" onClick={() => setPicked((p) => (pickedIds.length === list.length ? new Set([...p].filter((id) => !list.some((d) => d.id === id))) : new Set([...p, ...list.map((d) => d.id)])))}>
            {pickedIds.length === list.length ? 'Select none' : 'Select all'}
          </button>
        )}
        {pickedIds.length > 0 && (
          <button className="danger small" onClick={() => onRemove(kind, pickedIds)}>
            <Icon name="trash" size={13} /> Remove {pickedIds.length}
          </button>
        )}
        <button className="secondary small" onClick={() => onAdd(kind)}>
          <Icon name="plus" size={13} /> Add {kind === 'drawings' ? 'drawings' : 'spec'}
        </button>
      </div>
      {!list.length ? (
        <p className="muted small fm-empty">{kind === 'drawings' ? 'No drawings yet.' : 'No specification yet. Add the whole project manual as one PDF, or one PDF per section: they read as one book.'}</p>
      ) : (
        <ul className="fm-list">
          {list.map((d, i) => {
            const own = kind === 'drawings' ? sheetsOf(d.id) : [];
            const book = kind === 'specs' ? (d as SpecDoc).book : undefined;
            const takeoffs = own.reduce((n, s) => n + (takeoffsOn.get(s.id) ?? 0), 0);
            const isOpen = open === d.id;
            return (
              <li
                key={d.id}
                className={`fm-row ${over === d.id && drag?.id !== d.id ? 'over' : ''} ${drag?.id === d.id ? 'dragging' : ''} ${picked.has(d.id) ? 'picked' : ''}`}
                draggable
                onDragStart={(e: DragEvent) => {
                  setDrag({ kind, id: d.id });
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (drag?.kind !== kind) return;
                  e.preventDefault();
                  setOver(d.id);
                }}
                onDragLeave={() => setOver((o) => (o === d.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(kind, list, d.id);
                  setDrag(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
              >
                <div className="fm-line">
                  <span className="fm-grip" aria-hidden="true" title="Drag to reorder">
                    ⋮⋮
                  </span>
                  <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} aria-label={`Select ${d.name}`} />
                  {kind === 'drawings' ? (
                    <button className="fm-expand" onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Hide sheets' : 'Show sheets'}>
                      <Icon name="chevronDown" size={12} className={isOpen ? '' : 'closed'} />
                    </button>
                  ) : (
                    <span className="fm-expand" />
                  )}
                  <Icon name={kind === 'drawings' ? 'sheet' : 'doc'} size={15} className="fm-icon" />
                  <input
                    className="fm-name"
                    defaultValue={d.name}
                    key={d.name}
                    aria-label="File name"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== d.name) onRename(kind, d.id, v);
                      else e.target.value = d.name;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        (e.target as HTMLInputElement).value = d.name;
                        (e.target as HTMLInputElement).blur();
                        e.stopPropagation();
                      }
                    }}
                  />
                  <span className="fm-meta">
                    {kind === 'drawings'
                      ? `${own.length} sheet${own.length === 1 ? '' : 's'}${takeoffs ? ` · ${takeoffs} takeoff${takeoffs === 1 ? '' : 's'}` : ''}`
                      : book
                        ? `${book.pages} page${book.pages === 1 ? '' : 's'} · ${book.sections.filter((s) => !s.missing).length} section${book.sections.filter((s) => !s.missing).length === 1 ? '' : 's'}`
                        : 'Not read'}
                  </span>
                  <span className="fm-actions">
                    <button className="icon-button small" onClick={() => move(kind, list, d.id, -1)} disabled={i === 0} aria-label="Move up" title="Move up">
                      ↑
                    </button>
                    <button className="icon-button small" onClick={() => move(kind, list, d.id, 1)} disabled={i === list.length - 1} aria-label="Move down" title="Move down">
                      ↓
                    </button>
                    <button className="icon-button small fm-del" onClick={() => onRemove(kind, [d.id])} aria-label={`Remove ${d.name}`} title="Remove">
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </div>
                {isOpen && <SheetList sheets={own} takeoffsOn={takeoffsOn} onReorder={(ids) => onReorderSheets(d.id, ids)} onRemove={onRemoveSheets} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide fm" role="dialog" aria-label="Files" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Files</h3>
          <button onClick={onClose} autoFocus>
            Done
          </button>
        </div>
        <p className="muted small">Drag to reorder. Click a name to rename it. Removing a drawing set removes its takeoffs too; Undo brings everything back.</p>
        {section('drawings', 'Drawings', docs, pickedDocs)}
        {section('specs', 'Specification', specs, pickedSpecs)}
      </div>
    </div>
  );
}

function SheetList({ sheets, takeoffsOn, onReorder, onRemove }: { sheets: Sheet[]; takeoffsOn: Map<string, number>; onReorder: (ids: string[]) => void; onRemove: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    const ids = new Set(sheets.map((s) => s.id));
    setPicked((p) => new Set([...p].filter((id) => ids.has(id))));
  }, [sheets]);
  const ids = picked.size ? [...picked] : [];
  return (
    <div className="fm-sheets">
      {ids.length > 0 && (
        <div className="fm-sheets-bar">
          <span>{ids.length} selected</span>
          <button className="danger small" onClick={() => onRemove(ids)}>
            <Icon name="trash" size={13} /> Remove {ids.length} sheet{ids.length === 1 ? '' : 's'}
          </button>
        </div>
      )}
      <ul>
        {sheets.map((s) => (
          <li
            key={s.id}
            className={`fm-sheet ${over === s.id && drag !== s.id ? 'over' : ''} ${s.superseded ? 'old' : ''}`}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDrag(s.id);
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.stopPropagation();
              setOver(s.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (drag && drag !== s.id) {
                const order = sheets.map((x) => x.id).filter((id) => id !== drag);
                order.splice(order.indexOf(s.id), 0, drag);
                onReorder(order);
              }
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              setDrag(null);
              setOver(null);
            }}
          >
            <span className="fm-grip" aria-hidden="true">
              ⋮⋮
            </span>
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => setPicked((p) => (p.has(s.id) ? (p.delete(s.id), new Set(p)) : new Set(p).add(s.id)))} aria-label={`Select ${s.name}`} />
            <span className="fm-page">p.{s.page}</span>
            <strong>{s.name}</strong>
            <span className="muted">{s.title}</span>
            {s.superseded && <span className="tag">old revision</span>}
            {takeoffsOn.get(s.id) ? <span className="tag link">{takeoffsOn.get(s.id)} takeoffs</span> : null}
            <button className="icon-button small fm-del" onClick={() => onRemove([s.id])} aria-label={`Remove ${s.name}`} title="Remove this sheet">
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
