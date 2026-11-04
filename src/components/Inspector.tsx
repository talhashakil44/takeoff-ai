import { useEffect, useMemo, useRef, useState } from 'react';
import { describeGroup, groupActivity, type ActivityEvent } from '../activity';
import { FINISH_ROLES, type Measurement, type Project, type Sheet, type TakeoffType } from '../model';
import { measurementVars, primaryOf, primaryUnit, type TypeTotals } from '../quantities';
import { disciplineOf, takeoffTree, type TypeNode } from '../takeoffTree';
import { formatQty } from '../units';
import { Icon } from './Icons';
import { QuantityPanel } from './QuantityPanel';
import type { QtyGrouping, QtySection } from '../buildings';
import type { Where } from './QuantityPanel';

export type InspectorTab = 'quantities' | 'takeoffs' | 'history';

interface Props {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  project: Project;
  sheet: Sheet | null;
  totals: TypeTotals[];
  /** The same, for the current sheet only. */
  sheetTotals: TypeTotals[];
  sections: QtySection[];
  /** The room a takeoff sits in, once worked out. */
  roomOf: (m: Measurement) => string | null;
  /** Each sheet a type is taken off on, with its share. */
  whereOf: (typeId: string) => Where[];
  /** Goes to a sheet and frames a type's takeoffs on it. */
  onShowType: (typeId: string, sheetId: string) => void;
  grouping: QtyGrouping;
  onGrouping: (g: QtyGrouping) => void;
  activity: ActivityEvent[];
  selectedId: string | null;
  /** Takeoffs picked together on the open sheet (a type clicked here, or Box select). */
  pickedIds: string[];
  /** The type picked on the left, shown with its takeoffs. */
  litTypeId: string | null;
  /** Picks every takeoff of a type on a sheet, going to that sheet. */
  onPickType: (typeId: string, sheetId: string) => void;
  onSelect: (id: string | null) => void;
  onDelete: (ids: string[]) => void;
  onRetype: (id: string, typeId: string) => void;
  onEditType: (typeId: string) => void;
  onEditFinishes: () => void;
  onFindSimilar: (id: string) => void;
  /** Selects a takeoff and brings it into view, switching sheets when needed. */
  onShow: (id: string) => void;
  onRename: (id: string, label: string) => void;
  canFindSimilar: boolean;
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'quantities', label: 'Quantities' },
  { id: 'takeoffs', label: 'Takeoffs' },
  { id: 'history', label: 'History' },
];

export function Inspector(props: Props) {
  const { tab, onTab, project, selectedId } = props;
  const selected = project.measurements.find((m) => m.id === selectedId) ?? null;
  return (
    <div className="inspector">
      {selected && <SelectionCard {...props} m={selected} />}
      <div className="inspector-tabs">
        <div className="segmented" role="tablist" aria-label="Inspector">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-body">
        {tab === 'quantities' && <QuantityPanel totals={props.totals} sheetTotals={props.sheetTotals} sections={props.sections} grouping={props.grouping} onGrouping={props.onGrouping} whereOf={props.whereOf} onShowType={props.onShowType} sheetName={props.sheet ? `${props.sheet.name}${props.sheet.repeat ? ` ×${props.sheet.repeat}` : ''}` : undefined} onEdit={props.onEditType} />}
        {tab === 'takeoffs' && <TakeoffList {...props} />}
        {tab === 'history' && <HistoryList events={props.activity} />}
      </div>
    </div>
  );
}

function qtyOf(m: Measurement, type: TakeoffType | undefined, project: Project): string {
  const sheet = project.sheets.find((s) => s.id === m.sheetId);
  if (!type || !sheet) return '';
  const v = measurementVars(m, type, sheet, project.units);
  return v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, project.units)}` : 'no scale';
}

function SelectionCard({ m, project, sheet: current, onDelete, onRetype, onSelect, onEditFinishes, onFindSimilar, canFindSimilar, onRename, roomOf, onShow }: Props & { m: Measurement }) {
  const type = project.types.find((t) => t.id === m.typeId);
  const sheet = project.sheets.find((s) => s.id === m.sheetId);
  const room = roomOf(m);
  return (
    <div className="selection-card">
      <div className="selection-top">
        <span className="dot" style={{ background: type?.color }} />
        <div className="selection-text">
          <div className="selection-qty">{qtyOf(m, type, project)}</div>
          <div className="selection-sub">
            <button className="link-button" title="Show it on the sheet" onClick={() => onShow(m.id)}>
              {sheet?.name}
              {room ? ` · ${room}` : ''}
            </button>
            {m.source === 'walls' ? ' · wall takeoff' : m.source === 'ai' ? ' · added by AI, to check' : ''}
          </div>
        </div>
        <button className="icon-button" title="Deselect (Esc)" aria-label="Deselect" onClick={() => onSelect(null)}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <label className="field">
        <span>Name</span>
        <input id="takeoff-name" value={m.label ?? ''} placeholder="e.g. 112 Receiving" onChange={(e) => onRename(m.id, e.target.value)} />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={m.typeId} onChange={(e) => onRetype(m.id, e.target.value)}>
          {project.types
            .filter((t) => t.kind === type?.kind)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </label>
      {type?.kind === 'area' && (
        <div className="field">
          <span>Finishes</span>
          <div className="finish-chips">
            {FINISH_ROLES.flatMap(({ role, label }) => {
              const t = m.finishes?.[role] ? project.types.find((x) => x.id === m.finishes![role]) : undefined;
              return t ? [<span key={role} className="finish-chip" title={t.name}>{`${label}: ${t.name.split(' – ')[0]}`}</span>] : [];
            })}
            <button className="link-button" onClick={onEditFinishes}>
              {m.finishes && Object.keys(m.finishes).length ? 'Edit…' : 'Set floor, base, walls, ceiling…'}
            </button>
          </div>
        </div>
      )}
      {type?.kind === 'area' && m.sheetId === current?.id && (
        <button className="wide" disabled={!canFindSimilar} onClick={() => onFindSimilar(m.id)} title="Adds every other area on this sheet drawn with the same hatch, as this type">
          <Icon name="sparkle" size={16} /> Find areas hatched like this
        </button>
      )}
      <button className="destructive wide" onClick={() => onDelete([m.id])}>
        <Icon name="trash" size={16} /> Delete takeoff
      </button>
    </div>
  );
}

/** A type's takeoffs added up, in its unit; ones on unscaled sheets are left out. */
function typeTotal(items: Measurement[], type: TakeoffType, project: Project, sheets: Map<string, Sheet>): string {
  let sum = 0;
  let scaled = 0;
  for (const m of items) {
    const sheet = sheets.get(m.sheetId);
    const v = sheet ? measurementVars(m, type, sheet, project.units) : null;
    if (!v) continue;
    sum += primaryOf(type.kind, v);
    scaled++;
  }
  return scaled ? `${formatQty(sum)} ${primaryUnit(type.kind, project.units)}` : 'no scale';
}

function TakeoffList({ project, sheet, selectedId, pickedIds, litTypeId, onPickType, onShow, onDelete, roomOf }: Props) {
  const [scope, setScope] = useState<'sheet' | 'all'>('sheet');
  const [query, setQuery] = useState('');
  /** Groups folded open or shut by hand, over their defaults. */
  const [folds, setFolds] = useState<Map<string, boolean>>(new Map());
  const typeName = useMemo(() => new Map(project.types.map((t) => [t.id, t.name.toLowerCase()])), [project.types]);
  const q = query.trim().toLowerCase();
  const sheetsById = useMemo(() => new Map(project.sheets.map((s) => [s.id, s])), [project.sheets]);
  const docs = useMemo(() => new Map(project.docs.map((d) => [d.id, d])), [project.docs]);
  const list = useMemo(
    () =>
      (scope === 'sheet' && sheet ? project.measurements.filter((m) => m.sheetId === sheet.id) : project.measurements).filter((m) => {
        if (!q) return true;
        const s = sheetsById.get(m.sheetId);
        return (
          (m.label ?? '').toLowerCase().includes(q) ||
          (typeName.get(m.typeId) ?? '').includes(q) ||
          (roomOf(m) ?? '').toLowerCase().includes(q) ||
          (scope === 'all' && !!s && `${s.name} ${s.title ?? ''}`.toLowerCase().includes(q))
        );
      }),
    [project.measurements, scope, sheet, q, sheetsById, typeName, roomOf],
  );
  const tree = useMemo(() => takeoffTree(project, list), [project, list]);

  // What is picked: on the drawing, here, or a type on the left.
  const picked = useMemo(() => new Set([...pickedIds, ...(selectedId ? [selectedId] : [])]), [pickedIds, selectedId]);
  const first = project.measurements.find((m) => m.id === (selectedId ?? pickedIds[0]));
  const litOn = litTypeId ? (list.find((m) => m.typeId === litTypeId && m.sheetId === sheet?.id) ?? list.find((m) => m.typeId === litTypeId)) : undefined;
  // Where the list scrolls to: the picked takeoff's row, else the picked or lit type's header.
  const target = selectedId ? `m:${selectedId}` : first ? `t:${first.sheetId}:${first.typeId}` : litOn ? `t:${litOn.sheetId}:${litOn.typeId}` : '';
  const isOpen = (key: string, dflt: boolean) => folds.get(`${scope}|${key}`) ?? dflt;
  const fold = (key: string, dflt: boolean) => setFolds((f) => new Map(f).set(`${scope}|${key}`, !isOpen(key, dflt)));

  // Open the groups that hold what was picked, then bring it into view.
  const scrollTo = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const pickKey = `${selectedId}|${pickedIds.join()}|${litTypeId}|${scope}`;
  useEffect(() => {
    const shown = picked.size ? project.measurements.filter((m) => picked.has(m.id)) : litOn ? [litOn] : [];
    if (shown.length)
      setFolds((f) => {
        const next = new Map(f);
        for (const m of shown.slice(0, 200)) {
          const s = sheetsById.get(m.sheetId);
          const keys = [`d:${s ? disciplineOf(s, docs.get(s.docId)) : 'Other'}`, `s:${m.sheetId}`, `t:${m.sheetId}:${m.typeId}`];
          for (const k of keys) for (const sc of ['sheet', 'all']) next.set(`${sc}|${k}`, true);
        }
        return next;
      });
    scrollTo.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey]);
  useEffect(() => {
    if (!scrollTo.current || !target) return;
    const el = listRef.current?.querySelector(`[data-key="${target}"]`);
    if (!el) return;
    scrollTo.current = false;
    el.scrollIntoView({ block: 'nearest' });
  });

  const renderType = ({ type, items }: TypeNode, sheetId: string) => {
    const key = `t:${sheetId}:${type.id}`;
    const open = isOpen(key, scope === 'sheet');
    const all = items.every((m) => picked.has(m.id));
    const some = !all && items.some((m) => picked.has(m.id));
    const short = type.name.split(' – ')[0];
    return (
      <section className={`takeoff-group ${all ? 'picked' : some ? 'has-picked' : ''} ${type.id === litTypeId ? 'lit' : ''}`} key={key}>
        <header data-key={key}>
          <button className="icon-button fold" onClick={() => fold(key, scope === 'sheet')} aria-expanded={open} aria-label={open ? `Fold ${short}` : `Show each ${short}`}>
            <span className={`doc-chevron ${open ? 'open' : ''}`}>
              <Icon name="chevron" size={12} />
            </span>
          </button>
          <button className="type-pick" onClick={() => onPickType(type.id, sheetId)} title={all ? 'Click again to clear' : `Highlight all ${items.length} on the sheet`} aria-pressed={all}>
            <span className="dot" style={{ background: type.color }} />
            <span className="group-name">{type.name}</span>
            {type.kind !== 'count' && <span className="group-total">{typeTotal(items, type, project, sheetsById)}</span>}
            <span className="group-count">{items.length}</span>
          </button>
          <button className="icon-button" title={`Delete all ${items.length} ${short} takeoffs shown`} aria-label="Delete group" onClick={() => onDelete(items.map((m) => m.id))}>
            <Icon name="trash" size={15} />
          </button>
        </header>
        {open && (
          <ul>
            {items.map((m, i) => (
              <li key={m.id} data-key={`m:${m.id}`} className={picked.has(m.id) ? 'selected' : ''} onClick={() => onShow(m.id)} title="Show on the sheet">
                <span className="row-index">{i + 1}</span>
                <span className="row-qty">
                  {m.label && <span className="row-label">{m.label}</span>}
                  {/* An unnamed count is one each: its type's name says more than "1 ea". */}
                  {type.kind === 'count' && !m.label ? short : qtyOf(m, type, project)}
                </span>
                <span className="row-where" title={roomOf(m) ?? ''}>
                  {roomOf(m) && <span className="row-room">{roomOf(m)}</span>}
                </span>
                <button
                  className="icon-button row-delete"
                  title="Delete takeoff"
                  aria-label="Delete takeoff"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete([m.id]);
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className="takeoff-list" ref={listRef}>
      <div className="list-toolbar">
        <div className="segmented small" role="tablist" aria-label="Show takeoffs from">
          <button role="tab" aria-selected={scope === 'sheet'} className={scope === 'sheet' ? 'on' : ''} onClick={() => setScope('sheet')}>
            This sheet
          </button>
          <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All sheets
          </button>
        </div>
        {list.length > 0 && (
          <button className="quiet danger" onClick={() => onDelete(list.map((m) => m.id))}>
            Delete all {list.length}
          </button>
        )}
      </div>
      <label className="search takeoff-search">
        <Icon name="search" size={14} />
        <input id="takeoff-filter" placeholder="Find a room, sheet or type" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {tree.length === 0 && (
        <div className="empty-note">
          <Icon name="list" size={22} />
          <p>
            {q ? `Nothing matches “${query.trim()}”.` : `No takeoffs ${scope === 'sheet' ? 'on this sheet' : 'yet'}. Pick a type on the left and measure, fill a room, or run a wall takeoff.`}
          </p>
        </div>
      )}
      {/* Discipline, then sheet (all sheets), then type, then each takeoff. Click a type to
          highlight all of it on the sheet, or a takeoff to show just that one. */}
      {tree.map((d) => {
        const dKey = `d:${d.discipline}`;
        const dOpen = isOpen(dKey, true);
        const one = scope === 'sheet' ? d.sheets[0]?.sheet : undefined;
        return (
          <section className="takeoff-disc" key={dKey}>
            <button className="tree-head disc-head" onClick={() => fold(dKey, true)} aria-expanded={dOpen}>
              <span className={`doc-chevron ${dOpen ? 'open' : ''}`}>
                <Icon name="chevron" size={12} />
              </span>
              <span className="tree-name">{d.discipline}</span>
              <span className="tree-sub">{one ? `${one.name}${one.title ? ` · ${one.title}` : ''}` : `${d.sheets.length} sheet${d.sheets.length === 1 ? '' : 's'}`}</span>
              <span className="group-count">{d.count}</span>
            </button>
            {dOpen &&
              (scope === 'sheet'
                ? d.sheets.flatMap((s) => s.types.map((t) => renderType(t, s.sheet.id)))
                : d.sheets.map((s) => {
                    const sKey = `s:${s.sheet.id}`;
                    const sOpen = isOpen(sKey, true);
                    const current = s.sheet.id === sheet?.id;
                    return (
                      <div className={`takeoff-sheet ${current ? 'current' : ''}`} key={sKey}>
                        <button className="tree-head sheet-head" onClick={() => fold(sKey, true)} aria-expanded={sOpen} title={current ? 'The open sheet' : undefined}>
                          <span className={`doc-chevron ${sOpen ? 'open' : ''}`}>
                            <Icon name="chevron" size={12} />
                          </span>
                          <span className="tree-name">{s.sheet.name}</span>
                          <span className="tree-sub">{s.sheet.title}</span>
                          <span className="group-count">{s.count}</span>
                        </button>
                        {sOpen && s.types.map((t) => renderType(t, s.sheet.id))}
                      </div>
                    );
                  }))}
          </section>
        );
      })}
    </div>
  );
}

const time = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

function HistoryList({ events }: { events: ActivityEvent[] }) {
  const groups = useMemo(() => groupActivity(events).slice(0, 300), [events]);
  const [open, setOpen] = useState<string | null>(null);
  if (!groups.length)
    return (
      <div className="empty-note">
        <Icon name="clock" size={22} />
        <p>Every takeoff you add, change or delete is recorded here, with the time and the sheet.</p>
      </div>
    );
  return (
    <ol className="history">
      {groups.map((g) => {
        const sheets = [...new Set(g.map((e) => e.sheet).filter(Boolean))];
        const kind = g.every((e) => e.action === 'deleted') ? 'deleted' : g.every((e) => e.action === 'created') ? 'created' : 'updated';
        const id = g[0].batch;
        return (
          <li key={id} className={`history-item ${kind}`}>
            <button className="history-row" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
              <span className={`history-mark ${kind}`} />
              <span className="history-text">
                <span className="history-title">
                  {describeGroup(g)}
                  {g.length === 1 && g[0].detail && <span className="history-detail"> · {g[0].detail}</span>}
                </span>
                <span className="history-meta">
                  {time(g[0].at)} · {g[0].source}
                  {sheets.length ? ` · ${sheets.slice(0, 3).join(', ')}${sheets.length > 3 ? '…' : ''}` : ''}
                </span>
              </span>
              {g.length > 1 && <Icon name={open === id ? 'chevronDown' : 'chevron'} size={14} />}
            </button>
            {open === id && g.length > 1 && (
              <ul className="history-details">
                {g.slice(0, 200).map((e) => (
                  <li key={e.id}>
                    <span>{e.name}</span>
                    <span className="muted">
                      {e.detail}
                      {e.sheet && e.what === 'takeoff' && g.length > 1 ? ` · ${e.sheet}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
