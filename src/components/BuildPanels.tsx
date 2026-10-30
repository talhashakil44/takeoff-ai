import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TRADES, tradeByKey } from '../build/extract';
import type { Activity, Basis, BuildElement, BuildModel, Scheduled, SourceRef } from '../build/types';
import { evaluate } from '../formula';
import type { Project } from '../model';
import { formulaVars, measurementVars } from '../quantities';
import type { SpecSection } from '../spec/parse';
import { ifcClassLabel, ifcGuid } from '../build/ifcClass';
import type { ElementState } from './BuildScene';
import { Icon } from './Icons';

/**
 * The BIM side of Build It: the model browser (levels › systems › types › elements, with
 * visibility), the properties of what is picked (identity, dimensions, the takeoff and its
 * materials, the specification, the schedule, the drawing it came from, blown up), and the
 * quantity schedule.
 */

const BASIS_LABEL: Record<Basis, string> = { documented: 'Documented', inferred: 'Inferred', assumed: 'Assumption', unknown: 'Unknown' };
export function Badge({ basis }: { basis: Basis }) {
  return <span className={`bld-badge ${basis}`}>{BASIS_LABEL[basis]}</span>;
}
const fmtN = (v: number, d = 1) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10 ** d) / 10 ** d).toLocaleString());
const fmtDate = (iso?: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

// ---------- Model browser ----------

export interface TreeSel {
  kind: 'level' | 'trade' | 'type';
  key: string;
  ids: string[];
  label: string;
}

export function ModelTree(props: { model: BuildModel; hidden: Set<string>; onHidden: (h: Set<string>) => void; onPick: (s: TreeSel) => void; onIsolate: (ids: string[]) => void; picked: string | null }) {
  const { model, hidden, onHidden, onPick, onIsolate, picked } = props;
  const [open, setOpen] = useState<Set<string>>(() => new Set(model.levels.slice(0, 1).map((l) => `L:${l.id}`)));
  const [q, setQ] = useState('');
  const [placement,setPlacement] = useState<'all'|'placed'|'unplaced'>('all');
  const tree = useMemo(() => {
    const lv = [...model.levels.map((l) => ({ id: l.id, name: l.name })), { id: '', name: 'Unassigned level' }];
    return lv
      .map((l) => {
        const els = model.elements.filter((e) => (e.level ?? '') === l.id && (placement==='all' || (placement==='placed' ? !!e.shape : !e.shape)) && (!q || `${e.name} ${e.typeName}`.toLowerCase().includes(q.toLowerCase())));
        const trades = TRADES.map((t) => {
          const te = els.filter((e) => e.trade === t.key);
          const types = new Map<string, BuildElement[]>();
          for (const e of te) types.set(e.typeId, [...(types.get(e.typeId) ?? []), e]);
          return { t, els: te, types: [...types.values()].sort((a, b) => b.length - a.length) };
        }).filter((x) => x.els.length);
        return { l, els, trades };
      })
      .filter((x) => x.els.length);
  }, [model, q, placement]);
  const toggle = (k: string) => {
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOpen(n);
  };
  const eye = (ids: string[]) => {
    const allHidden = ids.every((id) => hidden.has(id));
    const someHidden = !allHidden && ids.some((id) => hidden.has(id));
    return (
      <button
        className={`bld-eye ${allHidden ? 'off' : someHidden ? 'some' : ''}`}
        title={allHidden ? 'Show' : 'Hide'}
        onClick={(ev) => {
          ev.stopPropagation();
          const n = new Set(hidden);
          for (const id of ids) {
            if (allHidden) n.delete(id);
            else n.add(id);
          }
          onHidden(n);
        }}
      >
        <Icon name={allHidden ? 'eyeOff' : 'eye'} size={13} />
      </button>
    );
  };
  const qty = (els: BuildElement[]) => {
    const by = new Map<string, number>();
    for (const e of els) by.set(e.unit, (by.get(e.unit) ?? 0) + e.quantity);
    return [...by].map(([u, v]) => `${fmtN(v, 0)} ${u}`).join(' · ');
  };
  return (
    <div className="bld-tree">
      <div className="bld-tree-search">
        <Icon name="search" size={13} />
        <input aria-label="Search model elements" placeholder="Find an element or type…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <select className="bld-placement-filter" aria-label="Geometry placement" value={placement} onChange={e=>setPlacement(e.target.value as typeof placement)}>
        <option value="all">All elements · {model.elements.length}</option>
        <option value="placed">With geometry · {model.elements.filter(e=>e.shape).length}</option>
        <option value="unplaced">Needs placement · {model.elements.filter(e=>!e.shape).length}</option>
      </select>
      {tree.map(({ l, els, trades }) => {
        const lk = `L:${l.id}`;
        return (
          <div key={lk} className="bld-tree-node">
            <div tabIndex={0} role="button" aria-expanded={open.has(lk)} onKeyDown={ev => { if(ev.target===ev.currentTarget && (ev.key==='Enter'||ev.key===' ')){ev.preventDefault();ev.currentTarget.click();} }} className={`bld-tree-row lvl ${picked === lk ? 'on' : ''}`} onClick={() => (toggle(lk), onPick({ kind: 'level', key: lk, ids: els.map((e) => e.id), label: l.name }))} onDoubleClick={() => onIsolate(els.map((e) => e.id))}>
              <span className={`caret ${open.has(lk) ? 'open' : ''}`}>▸</span>
              <b>{l.name}</b>
              <em>{els.length}</em>
              {eye(els.map((e) => e.id))}
            </div>
            {open.has(lk) &&
              trades.map(({ t, els: te, types }) => {
                const tk = `${lk}|T:${t.key}`;
                return (
                  <div key={tk}>
                    <div tabIndex={0} role="button" aria-expanded={open.has(tk)} onKeyDown={ev => { if(ev.target===ev.currentTarget && (ev.key==='Enter'||ev.key===' ')){ev.preventDefault();ev.currentTarget.click();} }} className={`bld-tree-row trade ${picked === tk ? 'on' : ''}`} onClick={() => (toggle(tk), onPick({ kind: 'trade', key: tk, ids: te.map((e) => e.id), label: `${t.name} · ${l.name}` }))} onDoubleClick={() => onIsolate(te.map((e) => e.id))}>
                      <span className={`caret ${open.has(tk) ? 'open' : ''}`}>▸</span>
                      <i style={{ background: t.colour }} />
                      <span className="nm">{t.name}</span>
                      <em>{te.length}</em>
                      {eye(te.map((e) => e.id))}
                    </div>
                    {open.has(tk) &&
                      types.map((ty) => {
                        const yk = `${tk}|Y:${ty[0].typeId}`;
                        return (
                          <div key={yk} tabIndex={0} role="button" onKeyDown={ev => { if(ev.target===ev.currentTarget && (ev.key==='Enter'||ev.key===' ')){ev.preventDefault();ev.currentTarget.click();} }} className={`bld-tree-row type ${picked === yk ? 'on' : ''}`} onClick={() => onPick({ kind: 'type', key: yk, ids: ty.map((e) => e.id), label: ty[0].typeName })} onDoubleClick={() => onIsolate(ty.map((e) => e.id))} title={`${ty[0].typeName} — double-click to isolate`}>
                            <span className="nm">{ty[0].typeName}</span>
                            <em>{qty(ty)}</em>
                            {eye(ty.map((e) => e.id))}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}
      <p className="dim small bld-tree-hint">Click to select · double-click to isolate · eye to hide</p>
    </div>
  );
}

// ---------- Properties ----------

function Group({ title, children, open: initial = true, extra }: { title: string; children: ReactNode; open?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className={`bld-pg ${open ? 'open' : ''}`}>
      <header onClick={() => setOpen(!open)}>
        <span className="caret">▸</span>
        <b>{title}</b>
        {extra}
      </header>
      {open && <div className="bld-pg-body">{children}</div>}
    </section>
  );
}
function Prop({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="bld-prop">
      <span>{k}</span>
      <span>{children}</span>
    </div>
  );
}

const SOURCE_TOOL: Record<string, string> = { walls: 'Wall takeoff (automatic)', rooms: 'Room fill (automatic)', legend: 'From a legend (automatic)', sprinklers: 'Sprinkler count (automatic)', ceilings: 'Ceiling takeoff (automatic)', symbols: 'Symbol count (automatic)', windows: 'Window tags (automatic)', runs: 'Ductwork and piping (automatic)', trades: 'Trade counts (automatic)', demolition: 'Keynotes and demolition (automatic)', ai: 'Added by an AI (to review)' };
const STATE: Record<ElementState, string> = { todo: 'Not started', doing: 'Being built', done: 'Built', existing: 'Existing, to be demolished', removing: 'Being demolished', gone: 'Demolished' };

/** The drawing around an element, rendered with the takeoff on it: the blow-up. */
function BlowUp({ el, project, render, onOpen }: { el: BuildElement; project: Project; render: (sheetId: string, box: [number, number, number, number], scale: number) => Promise<string>; onOpen: () => void }) {
  const [img, setImg] = useState<{ src: string; box: [number, number, number, number] } | null>(null);
  const [failed, setFailed] = useState(false);
  const m = project.measurements.find((x) => x.id === el.measurementId);
  const sheet = project.sheets.find((s) => s.id === el.sheetId);
  useEffect(() => {
    let gone = false;
    setImg(null);
    setFailed(false);
    const b = el.sources[0]?.box;
    if (!b || !sheet) return;
    // Around the element: at least a room's width, more for a long run.
    const w = Math.max(b[2] - b[0], 60);
    const h = Math.max(b[3] - b[1], 60);
    const pad = Math.max(w, h) * 0.45 + 40;
    const box: [number, number, number, number] = [Math.max(0, b[0] - pad), Math.max(0, b[1] - pad), Math.min(sheet.width, b[2] + pad), Math.min(sheet.height, b[3] + pad)];
    const scale = Math.min(4, 620 / Math.max(box[2] - box[0], box[3] - box[1]));
    void render(sheet.id, box, scale)
      .then((data) => !gone && setImg({ src: data.startsWith('data:') ? data : `data:image/png;base64,${data}`, box }))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [el.id, sheet, render, el.sources]);
  if (!sheet) return null;
  if (failed) return <p className="dim small">The drawing isn’t on this computer.</p>;
  if (!img) return <div className="bld-blowup loading">Rendering {sheet.name}…</div>;
  const [x0, y0, x1, y1] = img.box;
  const pts = m?.points ?? [];
  return (
    <button className="bld-blowup" onClick={onOpen} title={`Open ${sheet.name} at this place`}>
      <img src={img.src} alt={`${sheet.name} around ${el.name}`} />
      <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="none">
        {pts.length === 1 ? (
          <circle cx={pts[0][0]} cy={pts[0][1]} r={(x1 - x0) / 28} className="hl" />
        ) : (
          <polyline points={pts.map((p) => p.join(',')).join(' ')} className={`hl ${m && el.shape?.type === 'surface' ? 'area' : ''}`} />
        )}
      </svg>
      <span className="bld-blowup-tag">
        {sheet.name} · {sheet.title ?? ''} <b>Open →</b>
      </span>
    </button>
  );
}

export function ElementProperties(props: {
  e: BuildElement;
  project: Project;
  sections: SpecSection[];
  act?: Activity;
  t?: Scheduled;
  state: ElementState;
  render: (sheetId: string, box: [number, number, number, number], scale: number) => Promise<string>;
  onPickAct: (id: string) => void;
  onSection: (key: string, page?: number) => void;
  onSource: (s: SourceRef) => void;
  onFrame: () => void;
  onIsolate: () => void;
}) {
  const { e, project, sections, act, t, state, render, onPickAct, onSection, onSource, onFrame, onIsolate } = props;
  const type = project.types.find((x) => x.id === e.typeId);
  const m = project.measurements.find((x) => x.id === e.measurementId);
  const sheet = project.sheets.find((s) => s.id === e.sheetId);
  const trade = tradeByKey.get(e.trade);
  // The takeoff's own materials for this one element (its assembly's formulas on its quantities).
  const materials = useMemo(() => {
    if (!type || !m || !sheet) return [];
    const v = measurementVars(m, type, sheet, project.units);
    if (!v) return [];
    return type.items.map((it) => {
      const r = evaluate(it.formula, formulaVars(v, type));
      return { name: it.name, unit: it.unit, value: r.ok ? r.value : null, formula: it.formula };
    });
  }, [type, m, sheet, project.units]);
  const sh = e.shape;
  const lenM = sh?.type === 'run' ? sh.points.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - sh.points[i][0], p[1] - sh.points[i][1]), 0) : 0;
  const ft = project.units === 'imperial';
  const L = (mtrs: number) => (ft ? `${fmtN(mtrs / 0.3048)} ft` : `${fmtN(mtrs)} m`);
  const secs = e.specs.map((s) => ({ link: s, sec: sections.find((x) => x.key === s.key) }));
  return (
    <div className="bld-props">
      <div className="bld-props-head">
        <span className="bld-kind" style={{ borderColor: trade?.colour, color: trade?.colour }}>
          {trade?.name}
        </span>
        <h3>{e.name}</h3>
        {e.origin === 'building' && <p>Building context allowance — excluded from measured takeoff totals.</p>}
        <p className="bld-big">
          {fmtN(e.quantity)} {e.unit}
          <span className={`bld-state ${state}`}>{STATE[state]}</span>
        </p>
        <div className="bld-props-actions">
          <button onClick={onFrame}>
            <Icon name="fit" size={13} /> Zoom to
          </button>
          <button onClick={onIsolate}>
            <Icon name="eye" size={13} /> Isolate
          </button>
          {sheet && (
            <button onClick={() => onSource(e.sources[0])}>
              <Icon name="sheet" size={13} /> {sheet.name}
            </button>
          )}
        </div>
      </div>

      <Group title="From the drawing">
        <BlowUp el={e} project={project} render={render} onOpen={() => onSource(e.sources[0])} />
      </Group>

      <Group title="Identity">
        <Prop k="Takeoff type">{e.typeName}</Prop>
        {type?.assemblyTitle && <Prop k="Assembly">{type.assemblyTitle}</Prop>}
        <Prop k="System">{trade?.name}</Prop>
        <Prop k="Division">{e.division || '—'}</Prop>
        <Prop k="Level">{e.level ?? 'Not placed'}</Prop>
        {m?.label && <Prop k="Label">{m.label}</Prop>}
        <Prop k="IFC class">{ifcClassLabel(e)}</Prop>
        <Prop k="IFC GlobalId">
          <code>{ifcGuid(e.id)}</code>
        </Prop>
      </Group>

      <Group title="Dimensions">
        {sh?.type === 'run' && (
          <>
            <Prop k="Length">{L(lenM)}</Prop>
            <Prop k="Height">{L(sh.height)}</Prop>
            <Prop k="Thickness (shown)">{L(sh.thickness)}</Prop>
            <Prop k="Face area">{ft ? `${fmtN((lenM * sh.height) / 0.0929)} SF` : `${fmtN(lenM * sh.height)} m²`}</Prop>
            <Prop k="Base elevation">{L(sh.z0)}</Prop>
          </>
        )}
        {sh?.type === 'surface' && (
          <>
            <Prop k="Area">
              {fmtN(e.quantity)} {e.unit}
            </Prop>
            <Prop k="Elevation">{L(sh.z)}</Prop>
            <Prop k="Openings in it">{sh.holes.length}</Prop>
          </>
        )}
        {sh?.type === 'point' && (
          <>
            <Prop k="Count">1 ea</Prop>
            <Prop k="Mounting height">{L(sh.z)}</Prop>
          </>
        )}
        {!sh && <p className="dim small">Not placed in the model.</p>}
        {type && type.height > 0 && <Prop k="Type height">{`${type.height} ${ft ? 'ft' : 'm'}`}</Prop>}
      </Group>

      <Group title="Takeoff and materials">
        <Prop k="Quantity">
          {fmtN(e.quantity)} {e.unit}
        </Prop>
        <Prop k="Taken off by">{m?.source ? SOURCE_TOOL[m.source] ?? m.source : 'By hand'}</Prop>
        {materials.length > 0 ? (
          <table className="bld-mats">
            <tbody>
              {materials.map((x) => (
                <tr key={x.name}>
                  <td>{x.name}</td>
                  <td className="num">{x.value === null ? '—' : fmtN(x.value)}</td>
                  <td className="u">{x.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim small">No materials on this takeoff type.</p>
        )}
        {type?.description && <p className="dim small bld-desc">{type.description}</p>}
      </Group>

      <Group title="Specification" extra={<em className="bld-count">{secs.length}</em>}>
        {secs.length === 0 && <p className="dim small">No section linked to this type.</p>}
        {secs.map(({ link, sec }) => (
          <div key={link.key} className="bld-spec">
            <button className="bld-spec-title" onClick={() => onSection(link.key)}>
              <b>{sec?.number ?? link.key}</b> {sec?.title ?? ''}
            </button>
            <div className="bld-spec-tags">
              <Badge basis={link.basis} />
              {sec?.missing && <span className="tag warn">Not issued</span>}
              {sec?.revisions?.length ? <span className="tag add">Revised by Addendum {sec.revisions.map((r) => r.addendum).join(', ')}</span> : null}
              {sec?.articles.some((a) => /SUBMITTAL|SHOP DRAWING|PRODUCT DATA/i.test(a.title)) && <span className="tag">Submittals</span>}
              {sec?.articles.some((a) => /TEST|INSPECTION|QUALITY CONTROL/i.test(a.title)) && <span className="tag">Testing</span>}
              {sec?.articles.some((a) => /WARRANT/i.test(a.title)) && <span className="tag">Warranty</span>}
            </div>
            {sec?.excerpt && <p className="bld-excerpt">{sec.excerpt.slice(0, 260)}…</p>}
            {sec && sec.articles.length > 0 && (
              <div className="bld-arts">
                {sec.articles.slice(0, 14).map((a) => (
                  <button key={`${a.number}-${a.page}`} onClick={() => onSection(sec.key, a.page)} title={`Page ${a.page}`}>
                    <em>{a.number}</em> {a.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </Group>

      <Group title="Construction">
        {act ? (
          <>
            <Prop k="Built by">
              <button className="link-button" onClick={() => onPickAct(act.id)}>
                {act.name} →
              </button>
            </Prop>
            {t && (
              <>
                <Prop k="Start">{fmtDate(t.start)}</Prop>
                <Prop k="Finish">{fmtDate(t.finish)}</Prop>
                <Prop k="Duration">{act.duration} working days</Prop>
                <Prop k="Float">{t.critical ? <span className="crit">Critical</span> : `${t.float} days`}</Prop>
                {t.late && (
                  <Prop k="Target">
                    <span className="crit">Can’t make it</span>
                  </Prop>
                )}
              </>
            )}
          </>
        ) : (
          <p className="dim small">Not in the schedule.</p>
        )}
      </Group>

      <Group title="Data quality" open={e.issues.length > 0}>
        <Prop k="Place">
          <Badge basis={e.placement} />
        </Prop>
        <Prop k="Quantity">
          <Badge basis={m ? 'documented' : 'unknown'} />
        </Prop>
        {e.issues.length > 0 && (
          <ul className="bld-warn">
            {e.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  );
}

/** A level, a system or a type picked in the browser: what it holds, in total. */
export function GroupProperties(props: { sel: TreeSel; model: BuildModel; project: Project; sections: SpecSection[]; onSection: (k: string) => void; onIsolate: () => void; onFrame: () => void }) {
  const { sel, model, project, sections, onSection, onIsolate, onFrame } = props;
  const els = useMemo(() => {
    const ids = new Set(sel.ids);
    return model.elements.filter((e) => ids.has(e.id));
  }, [sel, model]);
  const byUnit = new Map<string, number>();
  for (const e of els) byUnit.set(e.unit, (byUnit.get(e.unit) ?? 0) + e.quantity);
  // Materials summed over the group's types.
  const mats = useMemo(() => {
    const out = new Map<string, { unit: string; value: number }>();
    const types = new Map(project.types.map((t) => [t.id, t]));
    const ms = new Map(project.measurements.map((x) => [x.id, x]));
    const sheets = new Map(project.sheets.map((x) => [x.id, x]));
    for (const e of els) {
      const type = types.get(e.typeId);
      const m = ms.get(e.measurementId);
      const sheet = sheets.get(e.sheetId);
      if (!type || !m || !sheet) continue;
      const v = measurementVars(m, type, sheet, project.units);
      if (!v) continue;
      for (const it of type.items) {
        const r = evaluate(it.formula, formulaVars(v, type));
        if (!r.ok) continue;
        const k = `${it.name}|${it.unit}`;
        out.set(k, { unit: it.unit, value: (out.get(k)?.value ?? 0) + r.value });
      }
    }
    return [...out].sort((a, b) => b[1].value - a[1].value).slice(0, 30);
  }, [els, project]);
  const specKeys = [...new Set(els.flatMap((e) => e.specs.map((s) => s.key)))];
  const issues = [...new Set(els.flatMap((e) => e.issues))];
  return (
    <div className="bld-props">
      <div className="bld-props-head">
        <span className="bld-kind">{sel.kind === 'level' ? 'Level' : sel.kind === 'trade' ? 'System' : 'Type'}</span>
        <h3>{sel.label}</h3>
        <p className="bld-big">
          {els.length.toLocaleString()} elements
          <span> · {[...byUnit].map(([u, v]) => `${fmtN(v, 0)} ${u}`).join(' · ')}</span>
        </p>
        <div className="bld-props-actions">
          <button onClick={onFrame}>
            <Icon name="fit" size={13} /> Zoom to
          </button>
          <button onClick={onIsolate}>
            <Icon name="eye" size={13} /> Isolate
          </button>
        </div>
      </div>
      {mats.length > 0 && (
        <Group title="Materials">
          <table className="bld-mats">
            <tbody>
              {mats.map(([k, v]) => (
                <tr key={k}>
                  <td>{k.split('|')[0]}</td>
                  <td className="num">{fmtN(v.value)}</td>
                  <td className="u">{v.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Group>
      )}
      {specKeys.length > 0 && (
        <Group title="Specification" extra={<em className="bld-count">{specKeys.length}</em>}>
          <div className="bld-chips2">
            {specKeys.slice(0, 20).map((k) => {
              const s = sections.find((x) => x.key === k);
              return (
                <button key={k} className={s?.missing ? 'missing' : ''} onClick={() => onSection(k)}>
                  {s ? `${s.number} ${s.title}` : k}
                  {s?.missing ? ' · not issued' : ''}
                </button>
              );
            })}
          </div>
        </Group>
      )}
      {issues.length > 0 && (
        <Group title="Unresolved" open={false} extra={<em className="bld-count warn">{issues.length}</em>}>
          <ul className="bld-warn">
            {issues.slice(0, 12).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}

// ---------- Quantity schedule ----------

export function QuantitySchedule(props: { model: BuildModel; onPick: (s: TreeSel) => void; picked: string | null }) {
  const { model, onPick, picked } = props;
  const levels = model.levels;
  const rows = useMemo(() => {
    const by = new Map<string, BuildElement[]>();
    for (const e of model.elements.filter(e => e.origin !== 'building')) by.set(e.typeId, [...(by.get(e.typeId) ?? []), e]);
    return [...by.values()]
      .map((els) => ({
        typeId: els[0].typeId,
        name: els[0].typeName,
        trade: els[0].trade,
        unit: els[0].unit,
        els,
        byLevel: new Map(levels.map((l) => [l.id, els.filter((e) => e.level === l.id).reduce((s, e) => s + e.quantity, 0)])),
        unplaced: els.filter((e) => !e.level).reduce((s, e) => s + e.quantity, 0),
        total: els.reduce((s, e) => s + e.quantity, 0),
      }))
      .sort((a, b) => (tradeByKey.get(a.trade)?.order ?? 9) - (tradeByKey.get(b.trade)?.order ?? 9) || a.trade.localeCompare(b.trade) || b.total - a.total);
  }, [model, levels]);
  return (
    <div className="bld-qty">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>System</th>
            {levels.map((l) => (
              <th key={l.id} className="num">
                {l.name}
              </th>
            ))}
            <th className="num">Not placed</th>
            <th className="num">Total</th>
            <th>Unit</th>
            <th className="num">Elements</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const key = `Q:${r.typeId}`;
            const t = tradeByKey.get(r.trade);
            return (
              <tr key={r.typeId} className={picked === key ? 'on' : ''} onClick={() => onPick({ kind: 'type', key, ids: r.els.map((e) => e.id), label: r.name })}>
                <td className="nm" title={r.name}>
                  {r.name}
                </td>
                <td>
                  <i className="dot" style={{ background: t?.colour }} /> {t?.name}
                </td>
                {levels.map((l) => (
                  <td key={l.id} className="num">
                    {r.byLevel.get(l.id) ? fmtN(r.byLevel.get(l.id)!, 0) : ''}
                  </td>
                ))}
                <td className="num dim">{r.unplaced ? fmtN(r.unplaced, 0) : ''}</td>
                <td className="num b">{fmtN(r.total, 0)}</td>
                <td>{r.unit}</td>
                <td className="num dim">{r.els.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
