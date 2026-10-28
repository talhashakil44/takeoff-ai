import { useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from '../graph/graph';
import type { SpecDoc } from '../model';
import type { PageText } from '../pageText';
import { pageTexts } from '../pageText';
import type { PDFDocumentProxy } from '../pdf';
import { keyOf, linesOf, mergeSections, type SpecSection } from '../spec/parse';
import type { MapNode, ProjectMap } from '../spec/links';
import { Icon } from './Icons';

/**
 * The specification, read: its table of contents by division on the left (what is missing
 * flagged "To follow"), the page in the middle with its references live (a Section number
 * jumps to that section, a sheet number opens the drawing), and on the right the open
 * section's articles and everything on the drawings it is tied to.
 */

export interface SpecTarget {
  docId: string;
  page: number;
  key?: string;
  n: number;
}

interface Props {
  specs: SpecDoc[];
  pdfOf: (docId: string) => Promise<PDFDocumentProxy | null>;
  map: ProjectMap | null;
  /** Sheets by their number in one form (A6.1 → a61), for a reference written in the spec. */
  sheetByName: (name: string) => { id: string; name: string; width: number; height: number } | undefined;
  target: SpecTarget | null;
  reading: { name: string; page: number; of: number } | null;
  onAdd: () => void;
  onRemove: (docId: string) => void;
  onManage: () => void;
  onOpenDrawing: (places: Place[], label: string) => void;
  onShowOnMap: (nodeId: string) => void;
}

const DIVISIONS: Record<string, string> = {
  '00': 'Procurement & contracting',
  '01': 'General requirements',
  '02': 'Existing conditions & site',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, plastics & composites',
  '07': 'Thermal & moisture protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special construction',
  '14': 'Conveying equipment',
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

type Hot = { box: [number, number, number, number]; kind: 'section' | 'sheet' | 'schedule'; text: string; key: string };

const NUM = String.raw`(\d{5}(?:\.\d{2})?|\d{2}\s\d{2}\s\d{2}(?:\.\d{2})?)`;
const SECTION_RE = new RegExp(`\\bSections?\\s+${NUM}|(?<=,\\s*|and\\s+|or\\s+)${NUM}`, 'gi');
const SHEET_RE = /\b([A-Z]{1,2}-?\d{1,2}\.\d{1,2}|[A-Z]{1,2}\d{3})\b/g;
const SCHEDULE_RE = /\b((?:[A-Z][A-Za-z]+\s+){1,3})Schedules?\b/g;

export function SpecView({ specs, pdfOf, map, sheetByName, target, reading, onAdd, onManage, onOpenDrawing, onShowOnMap }: Props) {
  const books = specs.filter((d) => d.book);
  const [docId, setDocId] = useState<string | null>(target?.docId ?? books[0]?.id ?? null);
  const [page, setPage] = useState(target?.page ?? 1);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const doc = specs.find((d) => d.id === docId) ?? books[0] ?? null;
  const book = doc?.book ?? null;
  const pages = book?.pages ?? 0;

  useEffect(() => {
    if (!target) return;
    setDocId(target.docId);
    setPage(target.page);
    const s = target.key ? specs.find((d) => d.id === target.docId)?.book?.sections.find((x) => x.key === target.key) : null;
    if (s) setOpen((o) => new Set(o).add(s.division));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.n]);
  useEffect(() => {
    if (!docId && books[0]) setDocId(books[0].id);
  }, [docId, books]);

  const sectionKey = book?.pageSection[page - 1] ?? null;
  const section = book?.sections.find((s) => s.key === sectionKey) ?? null;
  // Every file's sections as one book.
  const all = useMemo(() => mergeSections(books.map((d) => d.book!)), [books]);
  const sectionByKey = useMemo(() => new Map(all.map((s) => [s.key, s])), [all]);
  const addenda = useMemo(() => books.filter((d) => d.book!.addendum !== undefined).sort((a, b) => a.book!.addendum! - b.book!.addendum!), [books]);

  // The table of contents, by division, filtered.
  const divisions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter((s) => !q || `${s.number} ${s.key} ${s.title} ${s.articles.map((a) => a.title).join(' ')}`.toLowerCase().includes(q));
    const by = new Map<string, SpecSection[]>();
    for (const s of list) by.set(s.division, [...(by.get(s.division) ?? []), s]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all, query]);

  // How many drawing links each section has.
  const linkCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of map?.edges ?? []) {
      if (e.kind !== 'written' && e.kind !== 'matched') continue;
      for (const id of [e.a, e.b]) if (id.startsWith('spec:')) n.set(id.slice(5), (n.get(id.slice(5)) ?? 0) + 1);
    }
    return n;
  }, [map]);

  // The page, drawn.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [hots, setHots] = useState<Hot[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!doc) return;
    let gone = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const pdf = await pdfOf(doc.id);
      if (!pdf || gone) return;
      const pg = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
      if (gone) return;
      const base = pg.getViewport({ scale: 1 });
      const avail = (scrollRef.current?.clientWidth ?? 900) - 48;
      const scale = Math.min(2.2, avail / base.width) * zoom;
      const dpr = window.devicePixelRatio || 1;
      const vp = pg.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current!;
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      setSize({ w: base.width * scale, h: base.height * scale, scale });
      const t = pg.render({ canvas, viewport: vp });
      task = t;
      t.promise.catch(() => undefined);
      const texts = await pageTexts(pg).catch(() => [] as PageText[]);
      if (gone) return;
      setHots(hotsOf(texts, doc.book?.sections.find((s) => s.key === doc.book?.pageSection[page - 1])?.key ?? null, sheetByName));
      await t.promise.catch(() => undefined);
    })();
    return () => {
      gone = true;
      task?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, page, zoom]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page, doc?.id]);

  // Keys: arrows turn pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(pages, p + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages]);

  const goSection = (s: SpecSection) => {
    if (s.missing || !s.pages.length) return;
    setDocId(s.docId);
    setPage(s.pages[0]);
  };
  const followHot = (h: Hot) => {
    if (h.kind === 'section') {
      const s = sectionByKey.get(h.key);
      if (s) goSection(s);
      return;
    }
    if (h.kind === 'sheet') {
      const s = sheetByName(h.key);
      if (s) onOpenDrawing([{ sheetId: s.id, box: [0, 0, s.width, s.height], label: s.name }], s.name);
      return;
    }
    const node = map?.nodes.find((n) => n.kind === 'schedule' && n.label.toLowerCase().includes(h.key.replace(/ schedule$/, '')));
    if (node?.places?.length) onOpenDrawing(node.places, node.label);
  };

  // The open section's ties to the drawings.
  const ties = useMemo(() => {
    if (!section || !map) return [] as { node: MapNode; kind: string; why: string; at?: Place }[];
    const id = `spec:${section.key}`;
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    return map.edges
      .filter((e) => (e.a === id || e.b === id) && (e.kind === 'written' || e.kind === 'matched'))
      .map((e) => ({ node: byId.get(e.a === id ? e.b : e.a)!, kind: e.kind, why: e.why, at: e.at }))
      .filter((t) => t.node && t.node.side === 'drawing')
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'written' ? -1 : 1));
  }, [section, map]);
  const refers = section ? section.sections.map((k) => sectionByKey.get(k) ?? ({ key: k, number: k, title: '', missing: true } as SpecSection)) : [];

  if (!specs.length) {
    return (
      <div className="spec-empty">
        <div className="spec-empty-card">
          <div className="spec-empty-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2>Add the specification</h2>
          <p>Drop in the project manual. Every section is read, its references to sheets, schedules and other sections linked, and tied to what the drawings show.</p>
          <button className="primary" onClick={onAdd}>
            <Icon name="upload" size={16} /> Add spec PDFs
          </button>
          {reading && <ReadingBar reading={reading} />}
        </div>
      </div>
    );
  }

  return (
    <div className="spec-view">
      <aside className="spec-toc">
        <div className="spec-toc-head">
          <strong title={specs.map((d) => d.name).join('\n')}>{specs.length > 1 ? 'Specification' : (doc?.name.replace(/\.pdf$/i, '') ?? 'Specification')}</strong>
          <button className="icon-button small" onClick={onManage} title="Spec and drawing files: add, remove, reorder" aria-label="Manage files">
            <Icon name="folder" size={14} />
          </button>
          <button className="icon-button small" onClick={onAdd} title="Add spec files" aria-label="Add spec">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {all.length > 0 && (
          <div className="spec-toc-stats">
            <span>
              <b>{all.filter((s) => !s.missing).length}</b> sections
            </span>
            <span>
              <b>{books.reduce((n, d) => n + d.book!.pages, 0)}</b> pages
            </span>
            {specs.length > 1 && (
              <span>
                <b>{specs.length}</b> files
              </span>
            )}
            {all.some((s) => s.missing) && (
              <span className="warn">
                <b>{all.filter((s) => s.missing).length}</b> not issued
              </span>
            )}
          </div>
        )}
        <div className="spec-search">
          <Icon name="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a section or article" aria-label="Find in the specification" />
        </div>
        {reading && <ReadingBar reading={reading} />}
        <div className="spec-toc-list">
          {addenda.length > 0 && !query.trim() && (
            <div className={`spec-div ${open.has('AD') || addenda.some((d) => d.id === doc?.id) ? 'open' : ''}`}>
              <button className="spec-div-head" onClick={() => setOpen((o) => (o.has('AD') ? (o.delete('AD'), new Set(o)) : new Set(o).add('AD')))}>
                <span className="spec-div-num" style={{ ['--c' as string]: '#e0457b' }}>
                  AD
                </span>
                <span className="spec-div-name">Addenda</span>
                <span className="count">{addenda.length}</span>
                <Icon name="chevronDown" size={12} className="chev" />
              </button>
              {(open.has('AD') || addenda.some((d) => d.id === doc?.id)) && (
                <ul>
                  {addenda.map((d) => (
                    <li key={d.id}>
                      <button className={`spec-sec ${d.id === doc?.id ? 'on' : ''}`} onClick={() => (setDocId(d.id), setPage(1))} title={d.name}>
                        <span className="n">#{d.book!.addendum}</span>
                        <span className="t">{d.name.replace(/\.pdf$/i, '')}</span>
                        {d.book!.changes?.length ? <span className="tag add">{d.book!.changes.length}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {divisions.map(([div, list]) => {
            const isOpen = open.has(div) || !!query.trim() || list.some((s) => s.key === sectionKey);
            return (
              <div key={div} className={`spec-div ${isOpen ? 'open' : ''}`}>
                <button className="spec-div-head" onClick={() => setOpen((o) => (o.has(div) ? (o.delete(div), new Set(o)) : new Set(o).add(div)))}>
                  <span className="spec-div-num" style={{ ['--c' as string]: divColor(div) }}>
                    {div}
                  </span>
                  <span className="spec-div-name">{DIVISIONS[div] ?? 'Division'}</span>
                  <span className="count">{list.length}</span>
                  <Icon name="chevronDown" size={12} className="chev" />
                </button>
                {isOpen && (
                  <ul>
                    {list.map((s) => (
                      <li key={s.key}>
                        <button className={`spec-sec ${s.key === sectionKey ? 'on' : ''} ${s.missing ? 'missing' : ''}`} onClick={() => goSection(s)} disabled={s.missing} title={s.missing ? 'Listed in the table of contents, not in the spec book (to follow, or issued elsewhere)' : `${s.pages.length} pages`}>
                          <span className="n">{s.number}</span>
                          <span className="t">{s.title || 'Untitled'}</span>
                          {s.revisions?.length ? <span className="tag add" title={`Issued in Addendum ${s.revisions.map((r) => r.addendum).join(', ')}`}>ADD {s.revisions[s.revisions.length - 1].addendum}</span> : null}
                          {s.missing ? <span className="tag warn">Not issued</span> : linkCount.get(s.key) ? <span className="tag link">{linkCount.get(s.key)}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <button className="link-button spec-remove" onClick={onManage}>
          Manage files…
        </button>
      </aside>

      <section className="spec-page-pane">
        <div className="spec-pagebar">
          <div className="spec-crumb">
            {section ? (
              <>
                <span className="spec-div-num small" style={{ ['--c' as string]: divColor(section.division) }}>
                  {section.division}
                </span>
                <strong>{section.number}</strong>
                <span>{section.title}</span>
              </>
            ) : (
              <span className="muted">Front matter</span>
            )}
          </div>
          <div className="spec-pager">
            <button className="icon-button small" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
              <Icon name="back" size={14} />
            </button>
            <input
              className="spec-pagenum"
              value={page}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (n >= 1 && n <= pages) setPage(n);
              }}
              aria-label="Page"
            />
            <span className="muted">of {pages}</span>
            <button className="icon-button small" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Next page">
              <Icon name="forward" size={14} />
            </button>
            <span className="spec-sep" />
            <button className="icon-button small" onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))} aria-label="Zoom out">
              −
            </button>
            <button className="icon-button small" onClick={() => setZoom((z) => Math.min(3, z * 1.2))} aria-label="Zoom in">
              +
            </button>
          </div>
        </div>
        <div className="spec-scroll" ref={scrollRef}>
          <div className="spec-paper" style={size ? { width: size.w, height: size.h } : undefined}>
            <canvas ref={canvasRef} style={size ? { width: size.w, height: size.h } : undefined} />
            {size &&
              hots.map((h, i) => {
                const ok = h.kind === 'section' ? sectionByKey.has(h.key) && !sectionByKey.get(h.key)!.missing : h.kind === 'sheet' ? !!sheetByName(h.key) : !!map?.nodes.some((n) => n.kind === 'schedule' && n.label.toLowerCase().includes(h.key.replace(/ schedule$/, '')));
                const miss = h.kind === 'section' && sectionByKey.get(h.key)?.missing;
                if (!ok && !miss) return null;
                const [x0, y0, x1, y1] = h.box;
                const s = size.scale;
                return (
                  <button
                    key={i}
                    className={`spec-hot ${h.kind} ${miss ? 'missing' : ''}`}
                    style={{ left: x0 * s - 2, top: y0 * s - 2, width: (x1 - x0) * s + 4, height: (y1 - y0) * s + 4 }}
                    onClick={() => followHot(h)}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    title={miss ? `${h.text}: not in the spec book (To follow)` : h.kind === 'section' ? `Go to Section ${h.text}` : h.kind === 'sheet' ? `Open ${h.text} on the drawings` : `Open the ${h.text}`}
                  >
                    {hover === i && <span className="spec-hot-tip">{miss ? 'To follow' : h.kind === 'section' ? `${sectionByKey.get(h.key)?.title ?? ''}` : h.kind === 'sheet' ? 'Open drawing' : 'Open schedule'}</span>}
                  </button>
                );
              })}
          </div>
        </div>
      </section>

      <aside className="spec-side">
        {section ? (
          <>
            <div className="spec-side-head">
              <span className="spec-div-num" style={{ ['--c' as string]: divColor(section.division) }}>
                {section.division}
              </span>
              <div>
                <h3>{section.number}</h3>
                <p>{section.title}</p>
              </div>
            </div>
            <div className="spec-side-actions">
              <button className="secondary small" onClick={() => onShowOnMap(`spec:${section.key}`)}>
                <Icon name="graph" size={14} /> Show on map
              </button>
              <span className="muted">
                pp. {section.pages[0]}–{section.pages[section.pages.length - 1]}
              </span>
            </div>

            {(() => {
              const merged = sectionByKey.get(section.key);
              const revs = merged?.revisions ?? [];
              const changedBy = addenda.flatMap((d) => (d.book!.changes ?? []).filter((c) => c.sections.includes(section.key)).map((c) => ({ d, c })));
              if (!revs.length && !changedBy.length) return null;
              return (
                <>
                  <h4>Addenda</h4>
                  <ul className="spec-changes">
                    {revs.map((r) => (
                      <li key={`r${r.addendum}`}>
                        <button onClick={() => (setDocId(r.docId), setPage(r.page))}>
                          <span className="tag add">ADD {r.addendum}</span> Re-issued in Addendum {r.addendum}
                          {r.docId === doc?.id ? ' (this one)' : ''}
                        </button>
                      </li>
                    ))}
                    {changedBy.map(({ d, c }, i) => (
                      <li key={`c${i}`}>
                        <button onClick={() => (setDocId(d.id), setPage(c.page))}>
                          <span className="tag add">ADD {d.book!.addendum}</span> <b>{c.action}</b> · {c.label} {c.text.slice(0, 120)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}

            <h4>On the drawings {ties.length ? <span className="count">{ties.length}</span> : null}</h4>
            {ties.length ? (
              <ul className="spec-ties">
                {ties.map((t, i) => (
                  <li key={i}>
                    <button
                      onClick={() => {
                        const to = t.at ? [t.at] : t.node.places;
                        if (to?.length) onOpenDrawing(to, t.node.label);
                      }}
                      disabled={!t.at && !t.node.places?.length}
                    >
                      <span className={`pmap-badge ${t.kind}`}>{t.kind === 'written' ? 'Written' : 'Matched'}</span>
                      <span className="spec-tie-main">
                        <strong>{t.node.label}</strong>
                        {t.node.sub && t.node.kind !== 'schedule' ? <span> {t.node.sub}</span> : null}
                        <small>{t.why}</small>
                      </span>
                      <Icon name="forward" size={12} className="go" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{map ? 'Nothing on the drawings tied to this section.' : 'Open the map once to tie the spec to the drawings.'}</p>
            )}

            {refers.length > 0 && (
              <>
                <h4>Refers to</h4>
                <div className="spec-chips">
                  {refers.map((s) => (
                    <button key={s.key} className={`spec-chip ${s.missing ? 'missing' : ''}`} onClick={() => goSection(s)} disabled={s.missing || !s.pages?.length} title={s.title || (s.missing ? 'Not in this spec' : '')}>
                      {s.number}
                      {s.missing && ' ?'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {section.articles.length > 0 && (
              <>
                <h4>Articles</h4>
                <ol className="spec-articles">
                  {section.parts.map((p, i) => {
                    return (
                      <li key={`${p.name}${i}`}>
                        <button className="spec-part" onClick={() => setPage(p.page)}>
                          Part {i + 1} · {p.name}
                        </button>
                        <ul>
                          {section.articles
                            .filter((a) => parseInt(a.number, 10) === i + 1)
                            .map((a) => (
                              <li key={a.number + a.page}>
                                <button className={a.page === page ? 'on' : ''} onClick={() => setPage(a.page)}>
                                  <span className="n">{a.number}</span> {a.title}
                                </button>
                              </li>
                            ))}
                        </ul>
                      </li>
                    );
                  })}
                  {!section.parts.length &&
                    section.articles.map((a) => (
                      <li key={a.number + a.page}>
                        <button onClick={() => setPage(a.page)}>
                          <span className="n">{a.number}</span> {a.title}
                        </button>
                      </li>
                    ))}
                </ol>
              </>
            )}
          </>
        ) : book?.addendum !== undefined ? (
          <>
            <div className="spec-side-head">
              <span className="spec-div-num" style={{ ['--c' as string]: '#e0457b' }}>
                AD
              </span>
              <div>
                <h3>Addendum {book.addendum}</h3>
                <p>{doc?.name.replace(/\.pdf$/i, '')}</p>
              </div>
            </div>
            <h4>What it changes {book.changes?.length ? <span className="count">{book.changes.length}</span> : null}</h4>
            {book.changes?.length ? (
              <ul className="spec-changes">
                {book.changes.map((c, i) => (
                  <li key={i}>
                    <button onClick={() => setPage(c.page)} className={c.page === page ? 'here' : ''}>
                      <span className={`chg ${c.action}`}>{c.action}</span> <b>{c.label}</b> {c.text.slice(0, 220)}
                    </button>
                    <div className="spec-chips">
                      {c.sections.map((k) => {
                        const t = sectionByKey.get(k);
                        return t ? (
                          <button key={k} className="spec-chip" onClick={() => goSection(t)} disabled={t.missing} title={t.title}>
                            {t.number}
                          </button>
                        ) : null;
                      })}
                      {c.sheets.map((tok) => {
                        const sh = sheetByName(tok);
                        return sh ? (
                          <button key={tok} className="spec-chip sheet" onClick={() => onOpenDrawing([{ sheetId: sh.id, box: [0, 0, sh.width, sh.height], label: sh.name }], sh.name)}>
                            {sh.name}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No items naming a section or a sheet were read from it.</p>
            )}
          </>
        ) : (
          <p className="muted small spec-side-empty">Pick a section on the left. References on the page are live: blue goes to a section, green opens a drawing.</p>
        )}
      </aside>
    </div>
  );
}

function ReadingBar({ reading }: { reading: { name: string; page: number; of: number } }) {
  return (
    <div className="spec-reading">
      <div>
        Reading {reading.name.replace(/\.pdf$/i, '')}: page {reading.page} of {reading.of}
      </div>
      <div className="bar">
        <i style={{ width: `${(100 * reading.page) / Math.max(1, reading.of)}%` }} />
      </div>
    </div>
  );
}

/** The page's live references and where they are on it. */
function hotsOf(texts: PageText[], own: string | null, sheetByName: Props['sheetByName']): Hot[] {
  const out: Hot[] = [];
  for (const line of linesOf(texts)) {
    // Each part's span in the line's text.
    const spans: { from: number; to: number; t: PageText }[] = [];
    let at = 0;
    const text = line.parts
      .map((p) => {
        const s = p.str.replace(/\s+/g, ' ');
        spans.push({ from: at, to: at + s.length, t: p });
        at += s.length + 1;
        return s;
      })
      .join(' ');
    const boxOf = (from: number, to: number): Hot['box'] | null => {
      let b: Hot['box'] | null = null;
      for (const sp of spans) {
        if (sp.to <= from || sp.from >= to) continue;
        const { t } = sp;
        const len = Math.max(1, sp.to - sp.from);
        const x0 = t.cx - t.w / 2 + (t.w * Math.max(0, from - sp.from)) / len;
        const x1 = t.cx - t.w / 2 + (t.w * Math.min(len, to - sp.from)) / len;
        const bb: Hot['box'] = [x0, t.cy - t.h * 0.75, x1, t.cy + t.h * 0.55];
        b = b ? [Math.min(b[0], bb[0]), Math.min(b[1], bb[1]), Math.max(b[2], bb[2]), Math.max(b[3], bb[3])] : bb;
      }
      return b;
    };
    const taken: [number, number][] = [];
    const push = (from: number, to: number, kind: Hot['kind'], label: string, key: string) => {
      if (taken.some(([a, b]) => from < b && to > a)) return;
      const box = boxOf(from, to);
      if (!box) return;
      taken.push([from, to]);
      out.push({ box, kind, text: label, key });
    };
    for (const m of text.matchAll(SECTION_RE)) {
      const n = m[1] ?? m[2];
      if (!n || keyOf(n) === own) continue;
      const i = m.index! + m[0].lastIndexOf(n);
      push(i, i + n.length, 'section', n, keyOf(n));
    }
    // Header and footer lines name the section itself: skip lines that are only a number and page.
    if (/^\s*\d{2}\s?\d{2}\s?\d{2}\s*[-–]\s*\d+\s*$|^\s*\d{5}\s*[-–]\s*\d+\s*$/.test(text)) continue;
    for (const m of text.matchAll(SHEET_RE)) if (sheetByName(m[1])) push(m.index!, m.index! + m[1].length, 'sheet', m[1], m[1]);
    for (const m of text.matchAll(SCHEDULE_RE)) {
      const what = m[1].trim().toLowerCase().replace(/^(the|per|see|refer to|on|in)\s+/, '');
      if (!what || /^(the|a|an|per|see|on|in|refer|to)$/.test(what)) continue;
      push(m.index!, m.index! + m[0].length, 'schedule', `${what} schedule`, `${what} schedule`);
    }
  }
  return out;
}

function divColor(div: string): string {
  const n = parseInt(div, 10);
  if (n <= 1) return '#8e8e93';
  if (n === 2 || n >= 31) return '#a2845e';
  if (n >= 3 && n <= 5) return '#ff9f0a';
  if (n >= 6 && n <= 14) return '#0a84ff';
  if (n === 21) return '#ff375f';
  if (n === 22) return '#32ade6';
  if (n === 23) return '#30d158';
  return '#e0b000';
}
