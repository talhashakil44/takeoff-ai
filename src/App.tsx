import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diffProjects, type ActivityEvent } from './activity';
import { AiAssembliesDialog } from './components/AiAssembliesDialog';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { askConfirm, askText, DialogHost, notify } from './components/Dialogs';
import { Icon, type IconName } from './components/Icons';
import { Inspector, type InspectorTab } from './components/Inspector';
import { Menu, Popover } from './components/Popover';
import { RoomsDialog } from './components/RoomsDialog';
import { RoomFinishesDialog } from './components/RoomFinishesDialog';
import { QuickStartDialog } from './components/QuickStartDialog';
import { TypeLibraryDialog } from './components/TypeLibraryDialog';
import { SheetPickDialog, type SheetPick } from './components/SheetPickDialog';
import { LegendDialog, type LegendChoice } from './components/LegendDialog';
import { findLegendAreas, readLegendAsync, type LegendRow } from './fill/legend';
import { guessDivision } from './divisionGuess';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ScalePicker } from './components/ScalePicker';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { TypeEditor } from './components/TypeEditor';
import { Viewer, type Tool } from './components/Viewer';
import { WallTakeoffDialog } from './components/WallTakeoffDialog';
import { exportWorkbook } from './exportExcel';
import { segmentsOf, segmentsOnce, wallModelFor } from './fill/sheetWalls';
import { canAskClaude, readSheetName } from './ai/sheetName';
import { describeAiError } from './ai/readLegend';
import { findPatternOn, findSimilar, pointInRing, type Pattern } from './fill/similar';
import { buildWallModel } from './fill/roomFill';
import { findDoorTags, findRoomLabels } from './fill/rooms';
import type { Segment } from './fill/vectors';
import { matchSymbol, sampleSymbol, type SymbolSample } from './fill/symbols';
import { traceLine } from './fill/trace';
import { checkScale, type ScaleCheck } from './scaleCheck';
import { sheetImage } from './sheetImage';
import { compareSheets } from './compareSheets';
import { pageTexts, type PageText } from './pageText';
import { isHosted, saveFile } from './host';
import { defaultTypes, newId, newProject, type Kind, type Measurement, type Project, type Pt, type Sheet, type TakeoffType, type Units } from './model';
import { inspectPage, openPdf, type PDFDocumentProxy, type PDFPageProxy } from './pdf';
import { typeTotals } from './quantities';
import { clearStarterTypes, deleteProject, listProjects, type ProjectSummary, loadActivity, loadCurrentProject, deletePdf, loadPdf, loadProjectById, loadStarterTypes, persistStorage, saveActivity, savePdf, saveProject, saveStarterTypes, setStorageHooks, getSyncMark, setSyncMark } from './storage';
import { readProjectFiles, writeBackup, writeProjectFile } from './projectFile';
import { canUseServiceWorker, isInstalled, onLaunchFiles, promptInstall, registerServiceWorker } from './pwa';
import { ringArea } from './geometry';
import { scoringOn, setScoringOn } from './scoring';
import { desktopApi, folderLabel } from './desktop';
import { FolderSync, type PullResult } from './folderSync';
import { linesIn, onSheet, readNumber, readTitle, relativeBox, type Box } from './sheetNumbers';
import { SheetNumbersDialog, type SheetNumberRow } from './components/SheetNumbersDialog';
import { formatQty, parseScale } from './units';

const PALETTE = ['#0a84ff', '#ff9f0a', '#30d158', '#bf5af2', '#ff375f', '#64d2ff', '#ffd60a', '#ac8e68', '#5e5ce6', '#ff6961'];
const UNDO_LIMIT = 200;

interface Toast {
  text: string;
  undo: boolean;
  /** A button other than Undo, e.g. "Restart" for an update. */
  action?: { label: string; run: () => void };
  /** Stay until dismissed. */
  sticky?: boolean;
  /** For Undo: the history count the change left. After another change, undo or redo, Undo would undo something else. */
  after?: number;
}

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; help: string }[] = [
  { id: 'select', label: 'Select', icon: 'select', key: 'V', help: 'Select, move around and delete takeoffs' },
  { id: 'box', label: 'Box select', icon: 'marquee', key: 'B', help: 'Drag a box over several takeoffs to select them, then Delete' },
  { id: 'measure', label: 'Measure', icon: 'measure', key: 'M', help: 'Measure with the chosen takeoff type' },
  { id: 'fill', label: 'Fill', icon: 'fill', key: 'R', help: 'Click inside a room to take off its area' },
  { id: 'trace', label: 'Trace', icon: 'linear', key: 'T', help: 'Click a drawn line to measure the whole run' },
  { id: 'symbol', label: 'Symbols', icon: 'count', key: 'S', help: 'Drag a box around one symbol to count every copy on the sheet' },
  { id: 'cutout', label: 'Cutout', icon: 'cutout', key: 'C', help: 'Cut a hole out of the selected area' },
];

/** A project from the undo or redo stack, with the types shown or hidden as they are now (that is a view, not an edit). */
function keepVisibility(target: Project, now: Project): Project {
  const hidden = new Map(now.types.map((t) => [t.id, t.hidden]));
  if (!target.types.some((t) => hidden.has(t.id) && !!hidden.get(t.id) !== !!t.hidden)) return target;
  return { ...target, types: target.types.map((t) => (hidden.has(t.id) ? { ...t, hidden: hidden.get(t.id) || undefined } : t)) };
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastCommit = useRef<{ key: string; at: number; batch: string } | null>(null);
  const [, setHistoryTick] = useState(0);
  /** Counts commits, undos and redos: a toast's Undo belongs to the count it was shown at. */
  const historyRev = useRef(0);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const activityRef = useRef<ActivityEvent[]>([]);

  const [pdfs, setPdfsState] = useState<Map<string, PDFDocumentProxy>>(new Map());
  /** The open drawings, current even in callbacks made before a later upload (toast buttons). */
  const pdfsRef = useRef(pdfs);
  const setPdfs = useCallback((next: Map<string, PDFDocumentProxy> | ((m: Map<string, PDFDocumentProxy>) => Map<string, PDFDocumentProxy>)) => {
    setPdfsState((cur) => {
      const value = typeof next === 'function' ? next(cur) : next;
      pdfsRef.current = value;
      return value;
    });
  }, []);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [activeTypeId, setActiveTypeId] = useState<string | null>(null);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Drawing files folded shut in the sheet list. */
  const [collapsedDocs, setCollapsedDocs] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  /** The "Move to group" menu open for a type, anchored to its button. */
  const [moveMenu, setMoveMenu] = useState<{ typeId: string; anchor: { current: HTMLElement | null } } | null>(null);
  /** A type being dragged onto a group, and the group it is over ('' for no group). */
  const dragType = useRef<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  /** Takeoffs picked together (Box select), on the open sheet. */
  const [multiIds, setMultiIds] = useState<string[]>([]);
  // A selection belongs to its sheet.
  useEffect(() => setMultiIds([]), [sheetId]);
  const [focus, setFocus] = useState<{ id?: string; box?: [number, number, number, number]; n: number } | null>(null);
  /** Text runs per drawing page, read once for the sheet search. */
  const textCache = useRef(new Map<string, PageText[]>());
  const [textHits, setTextHits] = useState<{ q: string; hits: Map<string, PageText[]> } | null>(null);
  const hitTurn = useRef(0);
  const [comparison, setComparison] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToastState] = useState<Toast | null>(null);
  /** The latest chooseTool, for the keyboard handler. */
  const chooseToolRef = useRef<(id: Tool) => void>(() => {});
  // A toast's Undo belongs to the change just made, the latest in the history.
  const setToast = useCallback((t: Toast | null) => setToastState(t?.undo ? { ...t, after: historyRev.current } : t), []);
  const [sheetFilter, setSheetFilter] = useState('');
  const [aiDialog, setAiDialog] = useState<'assemblies' | 'settings' | 'walls' | 'rooms' | 'finishes' | 'shortcuts' | 'help' | 'library' | 'legend' | null>(null);
  /** Reading a legend: the next box dragged is the legend; then its rows, for the dialog. */
  const [legendPick, setLegendPick] = useState(false);
  /** Results of a search on every sheet, waiting for the user to keep or leave out each sheet. */
  const [sheetPick, setSheetPick] = useState<{ title: string; intro: string; rows: SheetPick[]; onAdd: (ids: string[]) => void } | null>(null);
  const legendPickRef = useRef(false);
  useEffect(() => {
    legendPickRef.current = legendPick;
  }, [legendPick]);
  const [legend, setLegend] = useState<{ sheetId: string; rows: LegendRow[] } | null>(null);
  /** Numbering sheets: the next box dragged marks where the number (or title) is in the title block. */
  const [numberPick, setNumberPick] = useState<'number' | 'title' | null>(null);
  const numberPickRef = useRef(numberPick);
  numberPickRef.current = numberPick;
  /** The marked spots, as fractions of the sheet, read on every sheet. */
  const numberBoxes = useRef<{ number?: Box; title?: Box }>({});
  const [sheetNumbers, setSheetNumbers] = useState<{ rows: SheetNumberRow[]; hasTitle: boolean } | null>(null);
  useEffect(() => {
    if (tool !== 'symbol') setLegendPick(false);
  }, [tool]);
  const [popover, setPopover] = useState<'scale' | 'more' | 'automate' | 'projects' | 'copy' | 'export' | 'newtype' | null>(null);
  const [tab, setTab] = useState<InspectorTab>('quantities');
  const [persisted, setPersisted] = useState(false);
  /** Desktop app: the shared projects folder (iCloud Drive), and its sync. */
  const [syncFolder, setSyncFolder] = useState<string | null>(null);
  const folderSync = useRef<FolderSync | null>(null);
  /** Desktop app with no projects folder yet (or one that went missing): the setup screen. */
  const [folderSetup, setFolderSetup] = useState<{ suggested: string; iCloud: boolean; missing: string | null } | null>(null);
  /** Saves the open project and writes every waiting change to the projects folder. */
  const flushAllRef = useRef<() => Promise<void>>(async () => undefined);
  /** From now on, keeps projects in `folder` too: each save is sent there, each delete trashed there. */
  function startFolderSync(folder: string) {
    const sync = new FolderSync(desktopApi!, { listProjects, loadProjectById, saveProject, loadActivity, saveActivity, loadPdf, savePdf, getSyncMark, setSyncMark });
    folderSync.current = sync;
    setSyncFolder(folder);
    setStorageHooks({ saved: (id) => sync.pushSoon(id), deleted: (id) => void sync.remove(id) });
  }
  const projectFileInput = useRef<HTMLInputElement>(null);
  const projectsButton = useRef<HTMLButtonElement>(null);
  /** Fill closes wall openings up to this width (metres); wider ones count as open. */
  const [maxOpening, setMaxOpening] = useState(3);
  const fileInput = useRef<HTMLInputElement>(null);
  const scaleButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const newTypeButton = useRef<HTMLButtonElement>(null);
  const automateButton = useRef<HTMLButtonElement>(null);

  // Load the saved project, its PDFs and its activity log.
  /** Opens a project: its drawings, its history, a fresh undo stack. */
  const openProjectState = useCallback(async (p: Project) => {
    const opened = new Map<string, PDFDocumentProxy>();
    for (const doc of p.docs) {
      const data = await loadPdf(doc.id);
      if (data) opened.set(doc.id, await openPdf(data));
    }
    const log = p.id ? await loadActivity(p.id) : [];
    past.current = [];
    future.current = [];
    lastCommit.current = null;
    // A new history: no toast from the last project can undo anything here.
    historyRev.current++;
    activityRef.current = log;
    setActivity(log);
    setPdfs(opened);
    projectRef.current = p;
    setProject(p);
    setSheetId(p.sheets[0]?.id ?? null);
    setActiveTypeId(null);
    setEditingTypeId(null);
    setSelectedId(null);
    setTool('select');
  }, []);

  useEffect(() => {
    (async () => {
      // Desktop app: bring in what changed on the other computer before opening anything.
      const folder = desktopApi ? await desktopApi.getFolder().catch(() => null) : null;
      if (folder) {
        startFolderSync(folder);
        await folderSync.current!.pull().catch(() => undefined);
      }
      const saved = (await loadCurrentProject()) ?? newProject('metric');
      await openProjectState(saved.id ? saved : { ...saved, id: newId() });
      setPersisted(await persistStorage());
      // Desktop app: projects live in a folder on disk, so one has to be chosen first.
      if (desktopApi && !folder) {
        const [suggested, missing] = await Promise.all([desktopApi.getDefaultFolder(), desktopApi.getMissingFolder()]);
        setFolderSetup({ suggested: suggested.path, iCloud: suggested.iCloud, missing });
      }
      // The window waits for the last changes to reach the projects folder before closing.
      desktopApi?.onFlush(() => flushAllRef.current());
    })();
    registerServiceWorker((apply) =>
      setToast({ text: 'A new version of Takeoff AI is ready', undo: false, sticky: true, action: { label: 'Restart', run: apply } }),
    );
  }, [openProjectState]);

  // Files the installed app was opened with from Finder.
  const launchHandler = useRef<(files: File[]) => void>(() => {});
  useEffect(() => onLaunchFiles((files) => launchHandler.current(files)), []);

  // Autosave.
  useEffect(() => {
    if (!project) return;
    const t = window.setTimeout(() => void saveProject(project), 400);
    return () => window.clearTimeout(t);
  }, [project]);

  const sheet = project?.sheets.find((s) => s.id === sheetId) ?? null;

  // A sheet with almost no linework is a scanned image: the automatic tools can't read it.
  const [scanned, setScanned] = useState<{ sheetId: string; dismissed: boolean } | null>(null);
  useEffect(() => {
    if (!page || !sheet) return;
    let live = true;
    const id = sheet.id;
    // Text first, which is cheap: a sheet with text is not a scan.
    void pageTexts(page)
      .then(async (texts) => (texts.length > 5 ? Infinity : (await segmentsOf(page)).length))
      .then((n) => {
        if (live) setScanned((cur) => (n < 30 ? (cur?.sheetId === id ? cur : { sheetId: id, dismissed: false }) : null));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sheet?.id]);

  // The scale picker checks the sheet's scale against its dimension strings, once per sheet.
  const [scaleCheck, setScaleCheck] = useState<{ sheetId: string; result: ScaleCheck | null } | null>(null);
  // It also runs on its own, shortly after a sheet with a scale read from its title block
  // opens, so a scale its dimensions confirm stops asking to be checked.
  useEffect(() => {
    if (!page || !sheet || scaleCheck?.sheetId === sheet.id) return;
    if (popover !== 'scale' && sheet.scaleSource !== 'detected') return;
    let live = true;
    const units: Units = sheet.scaleLabel ? (/^\s*1\s*:/.test(sheet.scaleLabel) ? 'metric' : 'imperial') : project!.units;
    const wait = popover === 'scale' ? Promise.resolve() : new Promise((r) => setTimeout(r, 800));
    void wait
      .then(() => (live ? Promise.all([pageTexts(page), segmentsOf(page)]) : Promise.reject(new Error('moved on'))))
      .then(([texts, segs]) => {
        if (!live) return;
        const result = checkScale(texts, segs, units);
        setScaleCheck({ sheetId: sheet.id, result });
        // A scale read from the title block that the dimensions confirm needs no checking.
        if (result && result.agree >= 5 && sheet.scaleSource === 'detected' && sheet.scaleHints?.includes(sheet.scaleLabel ?? '') && sheet.metersPerPoint && Math.abs(result.metersPerPoint / sheet.metersPerPoint - 1) < 0.02) {
          // Not a user change: kept out of undo and history.
          const prev = projectRef.current;
          if (prev) {
            const next = { ...prev, sheets: prev.sheets.map((x) =>
              // Only if the scale is still the one that was checked (not recalibrated meanwhile).
              x.id === sheet.id && x.scaleSource === 'detected' && x.metersPerPoint === sheet.metersPerPoint ? { ...x, scaleSource: 'verified' as const } : x,
            ) };
            projectRef.current = next;
            setProject(next);
          }
        }
      })
      .catch(() => live && setScaleCheck({ sheetId: sheet.id, result: null }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover, page, sheet?.id]);

  // Load the current sheet's page.
  useEffect(() => {
    let cancelled = false;
    setPage(null);
    if (!sheet) return;
    const doc = pdfs.get(sheet.docId);
    if (!doc) return;
    doc.getPage(sheet.page).then((p) => {
      if (!cancelled) setPage(p);
    });
    return () => {
      cancelled = true;
    };
  }, [sheet?.id, sheet?.docId, sheet?.page, pdfs]);

  useEffect(() => {
    if (!toast || toast.sticky) return;
    // Long enough to read: longer messages stay up longer.
    const t = window.setTimeout(() => setToast(null), Math.min(14000, Math.max(6000, toast.text.length * 60)));
    return () => window.clearTimeout(t);
  }, [toast]);

  // The sheet search also finds text drawn on the sheets: room names, tags, notes.
  const sheetList = project?.sheets;
  useEffect(() => {
    const q = sheetFilter.trim().toLowerCase();
    if (q.length < 2 || !sheetList) {
      setTextHits(null);
      return;
    }
    let stop = false;
    const t = window.setTimeout(async () => {
      const hits = new Map<string, PageText[]>();
      for (const s of sheetList) {
        if (stop) return;
        const key = `${s.docId}:${s.page}`;
        let texts = textCache.current.get(key);
        if (!texts) {
          // A drawing not loaded yet is searched when it is (the effect reruns on pdfs).
          const pg = await pdfsRef.current
            .get(s.docId)
            ?.getPage(s.page)
            .catch(() => null);
          if (!pg) continue;
          texts = await pageTexts(pg).catch(() => []);
          textCache.current.set(key, texts);
        }
        const found = texts.filter((x) => x.str.toLowerCase().includes(q));
        if (found.length) hits.set(s.id, found);
      }
      if (!stop) setTextHits({ q, hits });
    }, 250);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [sheetFilter, sheetList, pdfs]);

  const totals = useMemo(() => (project ? typeTotals(project) : []), [project]);
  const sheetTotals = useMemo(
    () => (project && sheetId ? typeTotals({ ...project, measurements: project.measurements.filter((m) => m.sheetId === sheetId) }) : []),
    [project, sheetId],
  );

  const record = useCallback((events: ActivityEvent[], replaceBatch?: string) => {
    if (!events.length && !replaceBatch) return;
    const kept = replaceBatch ? activityRef.current.filter((e) => e.batch !== replaceBatch) : activityRef.current;
    const all = [...kept, ...events];
    activityRef.current = all;
    setActivity(all);
    const id = projectRef.current?.id;
    if (id) void saveActivity(id, all);
  }, []);

  /**
   * Applies a change: keeps it for undo and records what changed in the activity log.
   * Changes with the same `key` in quick succession (typing in a field) count as one.
   */
  const commit = useCallback(
    (fn: (p: Project) => Project, source: string, key?: string) => {
      const prev = projectRef.current;
      if (!prev) return;
      const next = fn(prev);
      if (next === prev) return;
      const now = Date.now();
      const last = lastCommit.current;
      if (key && last && last.key === key && now - last.at < 4000 && past.current.length) {
        const base = past.current[past.current.length - 1];
        const events = diffProjects(base, next, source).map((e) => ({ ...e, batch: last.batch }));
        record(events, last.batch);
        lastCommit.current = { key, at: now, batch: last.batch };
      } else {
        past.current.push(prev);
        if (past.current.length > UNDO_LIMIT) past.current.shift();
        const events = diffProjects(prev, next, source);
        record(events);
        lastCommit.current = key ? { key, at: now, batch: events[0]?.batch ?? newId() } : null;
      }
      future.current = [];
      projectRef.current = next;
      setProject(next);
      historyRev.current++;
      setHistoryTick((n) => n + 1);
    },
    [record],
  );

  const undo = useCallback(() => {
    const cur = projectRef.current;
    const prev = past.current.pop();
    if (!cur || !prev) return;
    future.current.push(cur);
    record(diffProjects(cur, prev, 'Undo'));
    lastCommit.current = null;
    const back = keepVisibility(prev, cur);
    projectRef.current = back;
    setProject(back);
    setSelectedId(null);
    historyRev.current++;
    setHistoryTick((n) => n + 1);
  }, [record]);

  const redo = useCallback(() => {
    const cur = projectRef.current;
    const next = future.current.pop();
    if (!cur || !next) return;
    past.current.push(cur);
    record(diffProjects(cur, next, 'Redo'));
    lastCommit.current = null;
    const fwd = keepVisibility(next, cur);
    projectRef.current = fwd;
    setProject(fwd);
    historyRev.current++;
    setHistoryTick((n) => n + 1);
  }, [record]);

  // Keyboard: tools, undo and redo. Typing in a field or a dialog is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-backdrop, .popover')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      // Find: the sheet search, which also searches the drawings' text.
      if (mod && e.key.toLowerCase() === 'f') {
        const box = document.getElementById('sheet-filter') as HTMLInputElement | null;
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape' && (legendPickRef.current || numberPickRef.current)) {
        setLegendPick(false);
        setNumberPick(null);
        setTool('select');
        return;
      }
      if (e.key === '?') {
        setAiDialog('shortcuts');
        return;
      }
      if (e.key === '[' || e.key === ']') {
        // Previous / next sheet.
        const sheets = projectRef.current?.sheets ?? [];
        setSheetId((cur) => {
          const i = sheets.findIndex((x) => x.id === cur);
          const next = sheets[Math.min(sheets.length - 1, Math.max(0, i + (e.key === ']' ? 1 : -1)))];
          return next?.id ?? cur;
        });
        setSelectedId(null);
        return;
      }
      const found = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (found) chooseToolRef.current(found.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Other projects, to copy their types from (the + menu).
  const [otherProjects, setOtherProjects] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    if (popover !== 'newtype') {
      // Cleared on close, so the menu never offers a list from before a switch or a delete.
      setOtherProjects([]);
      return;
    }
    void listProjects().then((list) => setOtherProjects(list.filter((x) => x.id !== projectRef.current?.id)));
  }, [popover]);

  // Desktop app: every so often, and on coming back to the window, bring in the other computer's changes.
  const sheetIdRef = useRef(sheetId);
  sheetIdRef.current = sheetId;
  useEffect(() => {
    if (!syncFolder) return;
    const run = async () => {
      const sync = folderSync.current;
      if (!sync) return;
      let res: PullResult;
      try {
        res = await sync.pull();
      } catch {
        return;
      }
      const openId = projectRef.current?.id;
      // Changed only on the other computer, so nothing here is lost: show the new version.
      if (openId && res.updated.includes(openId)) {
        const fresh = await loadProjectById(openId);
        if (fresh) {
          const keep = sheetIdRef.current;
          await openProjectState(fresh);
          if (keep && fresh.sheets.some((s) => s.id === keep)) setSheetId(keep);
          setToast({ text: 'Updated with changes from your other computer', undo: false });
        }
      }
      const clash = res.conflicts.find((c) => c.id === openId) ?? res.conflicts[0];
      if (clash) setToast({ text: `Changed on both computers: the other computer’s version is kept as “${clash.name}”`, undo: false, sticky: true });
    };
    const timer = window.setInterval(() => void run(), 45000);
    const onFocus = () => void run();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [syncFolder, openProjectState]);

  /** Desktop app: picks the shared projects folder, then sends this computer's projects there and brings in the other's. */
  async function chooseProjectsFolder(useDefault = false) {
    if (!desktopApi) return;
    const folder = await (useDefault ? desktopApi.useDefaultFolder() : desktopApi.chooseFolder()).catch(() => null);
    if (!folder) return;
    setFolderSetup(null);
    startFolderSync(folder);
    try {
      const res = await folderSync.current!.pull();
      await folderSync.current!.pushMissing();
      const n = res.added.length;
      setToast({ text: `Projects are kept in ${folderLabel(folder)}${n ? ` · ${n} brought in from your other computer` : ''}`, undo: false });
    } catch (e) {
      setToast({ text: `That folder couldn’t be used: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    }
  }

  if (!project) return <div className="loading">Opening your project…</div>;

  /**
   * Picks a tool. One that measures a kind of type the active one isn't (Fill needs an area
   * type) takes the first type of that kind, and says so, rather than doing nothing.
   */
  function chooseTool(id: Tool) {
    if (!page) return;
    const need: Kind | null = id === 'fill' ? 'area' : id === 'symbol' ? 'count' : id === 'trace' ? 'linear' : null;
    const current = projectRef.current?.types.find((t) => t.id === activeTypeId);
    if ((need && current?.kind !== need) || (id === 'measure' && !current)) {
      const pick = projectRef.current?.types.find((t) => !need || t.kind === need);
      if (!pick) {
        const what = need === 'area' ? 'an area' : need === 'count' ? 'a count' : need === 'linear' ? 'a length' : 'a';
        setToast({ text: `Add ${what} type first, with + next to Takeoff types.`, undo: false });
        return;
      }
      setActiveTypeId(pick.id);
      // A note, so it doesn't take the place of a toast that can still undo something.
      if (!(toast?.undo && toast.after === historyRev.current)) setToast({ text: `Taking off as ${pick.name}. Pick another type on the left to change it.`, undo: false });
    }
    setTool(id);
  }
  chooseToolRef.current = chooseTool;

  const updateSheet = (id: string, patch: Partial<Sheet>, source: string) =>
    commit((p) => ({ ...p, sheets: p.sheets.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), source);
  const updateType = (type: TakeoffType) =>
    commit((p) => ({ ...p, types: p.types.map((t) => (t.id === type.id ? type : t)) }), 'Edit type', `type:${type.id}`);

  const activeType = project.types.find((t) => t.id === activeTypeId) ?? null;
  const editingType = project.types.find((t) => t.id === editingTypeId) ?? null;
  const selected = project.measurements.find((m) => m.id === selectedId) ?? null;
  const selectedType = selected ? project.types.find((t) => t.id === selected.typeId) : undefined;
  const sheetMeasurements = sheet ? project.measurements.filter((m) => m.sheetId === sheet.id) : [];
  // Takeoffs of hidden types are left off the drawing (they still count everywhere else).
  const hiddenTypes = new Set(project.types.filter((t) => t.hidden).map((t) => t.id));
  const shownMeasurements = hiddenTypes.size ? sheetMeasurements.filter((m) => !hiddenTypes.has(m.typeId)) : sheetMeasurements;
  // Picked takeoffs still on this sheet (an undo may have taken some away).
  const picked = sheetMeasurements.filter((m) => multiIds.includes(m.id));
  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  async function upload(files: FileList | File[]) {
    // Desktop app: drawings added to the blank starting project make it a real job with a
    // folder of its own, so it gets its name first (offered from the file name).
    const open = projectRef.current;
    if (syncFolder && open && !open.docs.length && !open.measurements.length && open.name === 'Untitled project') {
      const first = Array.from(files)[0]?.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() ?? '';
      const name = await askText('Name this project', { initial: first, hint: `Its drawings and takeoffs are kept in a folder with this name in ${folderLabel(syncFolder)}.` });
      if (name === null) return;
      if (name.trim()) commit((p) => ({ ...p, name: name.trim() }), 'Rename project');
    }
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`);
      const data = await file.arrayBuffer();
      const docId = newId();
      await savePdf(docId, data);
      const pdf = await openPdf(data);
      const sheets: Sheet[] = [];
      let noText = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        setBusy(`Reading ${file.name}: sheet ${n} of ${pdf.numPages}`);
        const pg = await pdf.getPage(n);
        const info = await inspectPage(pg);
        if (info.textRuns < 5) noText++;
        // A single standard scale on the sheet is applied automatically and flagged for checking;
        // a sheet noting its scale in both systems (1:100 and 1/8" = 1'-0") gets the project's.
        const inUnits = info.scaleHints.filter((h) => /^1:/.test(h) === (projectRef.current?.units === 'metric'));
        let detected = info.scaleHints.length === 1 ? info.scaleHints[0] : inUnits.length === 1 ? inUnits[0] : null;
        // No scale printed (a plan whose title gives none): the one its dimensions agree on.
        if (!detected && !info.scaleHints.length && info.textRuns >= 20) {
          const read = checkScale(await pageTexts(pg), await segmentsOnce(pg), projectRef.current?.units ?? 'metric');
          if (read && read.agree >= 5) detected = read.label;
        }
        pg.cleanup();
        sheets.push({
          id: newId(),
          docId,
          page: n,
          name: info.name ?? `Page ${n}`,
          width: info.width,
          height: info.height,
          metersPerPoint: detected ? parseScale(detected) : null,
          scaleLabel: detected,
          scaleSource: detected ? 'detected' : null,
          scaleHints: info.scaleHints,
        });
      }
      setPdfs((m) => new Map(m).set(docId, pdf));
      commit((p) => ({ ...p, docs: [...p.docs, { id: docId, name: file.name }], sheets: [...p.sheets, ...sheets] }), 'Add drawings');
      setSheetId((cur) => cur ?? sheets[0]?.id ?? null);
      setBusy(null);
      // What is ready: scales read, and sheets the automatic tools can't read.
      const scaled = sheets.filter((x) => x.metersPerPoint).length;
      const parts = [
        `Added ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`,
        scaled === sheets.length ? 'every scale read' : `${scaled} scales read, ${sheets.length - scaled} to set`,
        ...(noText ? [`${noText} without text (tags can't be read there)`] : []),
      ];
      setToast({ text: `${parts.join(' · ')}`, undo: false, action: { label: 'Fix sheet numbers', run: () => startNumberPick('number') } });
      await offerRevision(sheets);
    }
    setBusy(null);
  }

  /**
   * New sheets with the numbers of sheets already in the project (an addendum, a
   * re-issue): offer to move the old sheets' takeoffs onto them. Takeoffs keep their
   * place on the page, so only sheets of the same size are matched.
   */
  async function offerRevision(added: Sheet[]) {
    const p = projectRef.current!;
    const addedIds = new Set(added.map((x) => x.id));
    const pairs = added.flatMap((n) => {
      if (/^Page \d+$/.test(n.name)) return [];
      const old = p.sheets.find(
        (o) => !addedIds.has(o.id) && !o.superseded && o.name === n.name && Math.abs(o.width - n.width) < 1 && Math.abs(o.height - n.height) < 1,
      );
      return old ? [{ old, n }] : [];
    });
    const withTakeoffs = pairs.filter(({ old }) => p.measurements.some((m) => m.sheetId === old.id));
    if (!withTakeoffs.length) return;
    const list = withTakeoffs.map(({ n }) => n.name);
    const yes = await askConfirm(
      `${list.length === 1 ? 'A new sheet has the number of a sheet' : `${list.length} new sheets have the numbers of sheets`} you've taken off (${list.slice(0, 6).join(', ')}${list.length > 6 ? '…' : ''}). Move those takeoffs onto the new revision? The old sheets stay, marked superseded.`,
      { confirmLabel: 'Move takeoffs' },
    );
    if (!yes) return;
    const move = new Map(withTakeoffs.map(({ old, n }) => [old.id, n]));
    commit(
      (q) => ({
        ...q,
        measurements: q.measurements.map((m) => (move.has(m.sheetId) ? { ...m, sheetId: move.get(m.sheetId)!.id } : m)),
        sheets: q.sheets.map((x) => {
          // The old sheet is kept for reference; the new one keeps a scale set by hand on the old.
          if (move.has(x.id)) return { ...x, name: `${x.name} (superseded)`, superseded: true };
          // A scale set by hand on the old sheet wins over one read from the new sheet's text.
          const from = withTakeoffs.find((w) => w.n.id === x.id)?.old;
          const handSet = from?.metersPerPoint && (from.scaleSource === 'preset' || from.scaleSource === 'calibrated');
          // So does the number of floors it stands for.
          const y = from?.repeat ? { ...x, repeat: from.repeat } : x;
          return from && handSet && (!x.metersPerPoint || x.scaleSource === 'detected')
            ? { ...y, metersPerPoint: from.metersPerPoint, scaleLabel: from.scaleLabel, scaleSource: from.scaleSource }
            : y;
        }),
      }),
      'New revision',
    );
    setSheetId(withTakeoffs[0].n.id);
    setToast({ text: `Moved takeoffs onto ${list.length} new sheet${list.length === 1 ? '' : 's'}`, undo: true });
  }

  /** Saves the open project now (rather than on the autosave timer), before switching away. */
  const flush = async () => {
    if (projectRef.current) await saveProject(projectRef.current);
  };
  flushAllRef.current = async () => {
    await flush();
    await folderSync.current?.flush();
  };

  /** Desktop app: opens the open project's folder in Finder or Explorer (writing it first if needed). */
  async function revealProjectFolder() {
    const sync = folderSync.current;
    const id = projectRef.current?.id;
    if (!sync || !id || !desktopApi) return;
    await flushAllRef.current();
    const dir = (await sync.dirOf(id)) ?? (await sync.push(id).then(() => sync.dirOf(id)));
    if (dir) await desktopApi.revealProject(dir);
  }

  async function startNewProject(units: Units) {
    const name = await askText('New project', {
      initial: '',
      hint: syncFolder ? `Its drawings and takeoffs are kept in a folder with this name in ${folderLabel(syncFolder)}.` : 'The job name, e.g. Kelso Lodge.',
    });
    if (name === null) return;
    await flush();
    const fresh = { ...newProject(units), name: name.trim() || 'Untitled project' };
    // The user's own starting types, when they saved a set in these units.
    const starter = await loadStarterTypes();
    if (starter?.units === units && starter.types.length) {
      fresh.types = starter.types.map((t) => ({ ...t, id: newId(), items: t.items.map((it) => ({ ...it, id: newId() })) }));
    }
    await saveProject(fresh);
    // Desktop app: the project's folder is made now, not on the first takeoff.
    await folderSync.current?.push(fresh.id!).catch(() => undefined);
    await openProjectState(fresh);
    setToast({ text: syncFolder ? `Created ${fresh.name} in ${folderLabel(syncFolder)}` : `New ${units} project: ${fresh.name}`, undo: false });
  }

  async function switchProject(id: string) {
    await flush();
    const p = await loadProjectById(id);
    if (!p) {
      await notify('That project could not be opened. It may have been deleted in another window.');
      return;
    }
    await openProjectState(p);
  }

  /**
   * A copy of the open project to change separately (a bid alternate, another option):
   * its drawings are copied too, so deleting one project never takes the other's.
   */
  async function duplicateProject() {
    setBusy('Duplicating the project…');
    try {
      await flush();
      const p = projectRef.current!;
      const names = new Set((await listProjects()).map((x) => x.name));
      let name = `${p.name} (copy)`;
      for (let n = 2; names.has(name); n++) name = `${p.name} (copy ${n})`;
      const docIds = new Map(p.docs.map((d) => [d.id, newId()]));
      // Storage writes don't throw (they're made safe for private windows), so each copy is
      // read back: a full disk must not leave a copy with blank sheets.
      const written: string[] = [];
      for (const [from, to] of docIds) {
        const data = await loadPdf(from);
        if (!data) continue;
        await savePdf(to, data);
        if (!(await loadPdf(to))) {
          for (const id of written) await deletePdf(id);
          throw new Error('There is not enough storage space on this computer to copy the drawings. Nothing was duplicated.');
        }
        written.push(to);
      }
      const copy: Project = {
        ...p,
        id: newId(),
        name,
        docs: p.docs.map((d) => ({ ...d, id: docIds.get(d.id)! })),
        sheets: p.sheets.map((x) => ({ ...x, docId: docIds.get(x.docId) ?? x.docId })),
      };
      await saveProject(copy);
      await saveActivity(copy.id!, activityRef.current);
      await openProjectState(copy);
      setToast({ text: `Opened ${name}. The original is unchanged.`, undo: false });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  async function removeProject(id: string) {
    const target = id === project!.id ? project! : await loadProjectById(id);
    if (!target) return;
    const ok = await askConfirm(
      `Delete “${target.name}” with its drawings, takeoffs and history from this computer? Save it to a file first if you may need it again.`,
      { confirmLabel: 'Delete project', danger: true },
    );
    if (!ok) return;
    await deleteProject(target);
    if (id === project!.id) {
      const next = await loadCurrentProject();
      await openProjectState(next ?? newProject(project!.units));
    }
    setPopover(null);
    setToast({ text: `Deleted ${target.name}`, undo: false });
  }

  async function saveProjectFile() {
    setBusy('Saving the project file…');
    try {
      await flush();
      const { blob, missing } = await writeProjectFile(project!, activityRef.current, async (id) => await loadPdf(id));
      const filename = `${project!.name.replace(/[^\w\- ]+/g, '').trim() || 'takeoff'}.takeoff`;
      const result = await saveFile(filename, blob);
      if (result === 'failed') await notify('The project file could not be saved here. Try again in a moment.');
      else if (missing.length) await notify(`Saved, but these drawings were missing from this browser and are not in the file: ${missing.join(', ')}.`);
    } finally {
      setBusy(null);
    }
  }

  async function openProjectFile(file: File) {
    setBusy(`Opening ${file.name}…`);
    try {
      // Opening a file always makes new projects; say so when a name is already taken.
      const names = new Set((await listProjects()).map((p) => p.name));
      await flush();
      let last: Project | null = null;
      // Each project is saved as soon as it is read, so a big backup is never all in memory.
      const count = await readProjectFiles(file, async (opened) => {
        if (names.has(opened.project.name)) opened.project = { ...opened.project, name: `${opened.project.name} (copy)` };
        names.add(opened.project.name);
        for (const [id, data] of opened.pdfs) await savePdf(id, data);
        await saveProject(opened.project);
        if (opened.project.id) await saveActivity(opened.project.id, opened.activity);
        last = opened.project;
      });
      const opened = last as Project | null;
      if (opened) await openProjectState(opened);
      setToast({ text: count === 1 ? `Opened ${opened?.name}` : `Restored ${count} projects from the backup`, undo: false });
    } catch (e) {
      await notify(e instanceof Error ? e.message : 'That file could not be opened.');
    } finally {
      setBusy(null);
    }
  }

  /** Saves every project, with its history and drawings, in one backup file. */
  async function backupAll() {
    setBusy('Backing up every project…');
    try {
      await flush();
      const list = await listProjects();
      const entries: { project: Project; activity: ActivityEvent[] }[] = [];
      for (const summary of list) {
        const p = await loadProjectById(summary.id);
        if (p) entries.push({ project: p, activity: await loadActivity(summary.id) });
      }
      const { blob, missing } = await writeBackup(entries, loadPdf);
      const date = new Date().toISOString().slice(0, 10);
      if ((await saveFile(`Takeoff AI backup ${date}.zip`, blob)) === 'failed') setToast({ text: 'The backup could not be saved.', undo: false });
      else if (missing.length)
        await notify(`Backed up ${entries.length} projects, but these drawings were not in this browser and are not in the backup: ${missing.join(', ')}. Add them again to those projects.`);
      else setToast({ text: `Backed up ${entries.length} project${entries.length === 1 ? '' : 's'}`, undo: false });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  async function installApp() {
    const result = await promptInstall();
    if (result === 'manual')
      await notify(
        'To install Takeoff AI: in Safari choose File › Add to Dock; in Chrome or Edge click the install button at the right of the address bar. It then opens in its own window, works offline and updates itself.',
      );
  }

  launchHandler.current = (files: File[]) => {
    const takeoff = files.find((f) => /\.(takeoff|zip)$/i.test(f.name));
    if (takeoff) void openProjectFile(takeoff);
    const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfFiles.length) {
      const dt = new DataTransfer();
      pdfFiles.forEach((f) => dt.items.add(f));
      void upload(dt.files);
    }
  };

  async function removeDrawings(docId: string) {
    const doc = project!.docs.find((d) => d.id === docId);
    const sheetIds = new Set(project!.sheets.filter((s) => s.docId === docId).map((s) => s.id));
    const count = project!.measurements.filter((m) => sheetIds.has(m.sheetId)).length;
    const ok = await askConfirm(
      `Remove ${doc?.name ?? 'this drawing set'}${count ? ` and its ${count} takeoff${count === 1 ? '' : 's'}` : ''}? Its sheets leave the project.`,
      { confirmLabel: 'Remove', danger: true },
    );
    if (!ok) return;
    commit(
      (p) => ({
        ...p,
        docs: p.docs.filter((d) => d.id !== docId),
        sheets: p.sheets.filter((s) => s.docId !== docId),
        measurements: p.measurements.filter((m) => !sheetIds.has(m.sheetId)),
      }),
      'Remove drawings',
    );
    if (sheetId && sheetIds.has(sheetId)) setSheetId(project!.sheets.find((s) => !sheetIds.has(s.id))?.id ?? null);
    setToast({ text: `Removed ${doc?.name ?? 'drawings'}`, undo: true });
  }

  async function exportExcel() {
    setBusy('Building the Excel file…');
    try {
      const blob = await exportWorkbook(project!, activityRef.current);
      const filename = `${project!.name.replace(/[^\w\- ]+/g, '').trim() || 'takeoff'} - takeoff.xlsx`;
      if ((await saveFile(filename, blob)) === 'failed') {
        await notify('The Excel file could not be saved here. Try again in a moment.');
      }
    } finally {
      setBusy(null);
    }
  }

  /** Copies another project's types (with their assemblies) into this one, skipping names already here. */
  async function importTypes(fromId: string) {
    const from = await loadProjectById(fromId);
    if (!from) {
      setToast({ text: 'That project could not be opened. It may have been deleted.', undo: false });
      return;
    }
    if (!from.types.length) {
      setToast({ text: `${from.name} has no takeoff types to copy.`, undo: false });
      return;
    }
    const p = projectRef.current!;
    const have = new Set(p.types.map((t) => t.name));
    const types = from.types.filter((t) => !have.has(t.name)).map((t) => ({ ...t, id: newId(), items: t.items.map((it) => ({ ...it, id: newId() })) }));
    if (!types.length) {
      setToast({ text: `This project already has every type in ${from.name}.`, undo: false });
      return;
    }
    if (from.units !== p.units) {
      const ok = await askConfirm(`${from.name} measures in ${from.units} units and this project in ${p.units}. Heights and formulas are copied as they are. Copy the types anyway?`, { confirmLabel: 'Copy types' });
      if (!ok) return;
    }
    commit((q) => ({ ...q, types: [...q.types, ...types] }), 'Import types');
    setToast({ text: `Copied ${types.length} type${types.length === 1 ? '' : 's'} from ${from.name}`, undo: true });
  }

  /** Adds a small generated floor plan to try the tools on. */
  async function openSample() {
    setBusy('Drawing the sample plan…');
    try {
      const { samplePlanPdf } = await import('./samplePlan');
      const bytes = await samplePlanPdf(project!.units);
      // The sample comes with a few starter types to try the tools with.
      if (project!.name === 'Untitled project' && !project!.sheets.length)
        commit((p) => ({ ...p, name: 'Sample project', types: p.types.length ? p.types : defaultTypes(p.units) }), 'Rename project');
      await upload([new File([bytes as BlobPart], 'Sample floor plan.pdf', { type: 'application/pdf' })]);
    } catch (e) {
      setBusy(null);
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    }
  }

  /** Counts every place the searched text is drawn exactly (a fixture or equipment tag) as one count type. */
  async function countTextTags() {
    const tag = sheetFilter.trim();
    const name = await askText(`Count the ${exactTags} “${tag}” tags as`, { initial: tag.toUpperCase(), hint: 'A new count type, with one count at each tag on every sheet.' });
    if (!name?.trim()) return;
    const p = projectRef.current!;
    const type: TakeoffType = {
      id: newId(),
      name: name.trim(),
      color: PALETTE[p.types.length % PALETTE.length],
      kind: 'count',
      height: p.units === 'metric' ? 3 : 10,
      division: guessDivision(name),
      items: [{ id: newId(), name: name.trim(), unit: 'ea', formula: 'N' }],
    };
    const added = exactHits.map(({ sheetId, t }) => ({ id: newId(), sheetId, typeId: type.id, points: [[t.cx, t.cy]] as Pt[], holes: [] }));
    commit((q) => ({ ...q, types: [...q.types, type], measurements: [...q.measurements, ...added] }), 'Count tags');
    setActiveTypeId(type.id);
    const sheets = new Set(added.map((m) => m.sheetId)).size;
    setToast({ text: `Counted ${added.length} ${type.name} on ${sheets} sheet${sheets === 1 ? '' : 's'}`, undo: true });
  }

  /** Sets how many times a sheet's takeoffs count: a typical floor drawn once for several floors. */
  async function setRepeat(s: Sheet) {
    const answer = await askText(`How many floors does ${s.name} stand for?`, {
      initial: String(s.repeat ?? 1),
      hint: 'Its takeoffs count this many times in the quantities and the export. 1 counts it once.',
    });
    if (answer === null) return;
    const n = Math.floor(Number(answer));
    if (!Number.isFinite(n) || n < 1 || n > 999) {
      setToast({ text: 'Enter a whole number from 1 to 999.', undo: false });
      return;
    }
    if (n === (s.repeat ?? 1)) return;
    updateSheet(s.id, { repeat: n > 1 ? n : undefined }, n > 1 ? `Count ${s.name} ×${n}` : `Count ${s.name} once`);
  }

  /** The drawings with takeoffs drawn over them, as one PDF with a summary page. */
  async function exportMarkup() {
    setBusy('Building the marked-up PDF…');
    try {
      const { markupPdf } = await import('./markupPdf');
      const { bytes, sheets, missing } = await markupPdf(projectRef.current!, {
        loadBytes: loadPdf,
        transformOf: async (s) => (await pdfsRef.current.get(s.docId)?.getPage(s.page))?.getViewport({ scale: 1 }).transform,
        renderJpeg: async (s) => {
          const pg = await pdfsRef.current.get(s.docId)?.getPage(s.page);
          if (!pg) return undefined;
          const base = pg.getViewport({ scale: 1 });
          const scale = Math.min(3, 5000 / Math.max(base.width, base.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(base.width * scale);
          canvas.height = Math.ceil(base.height * scale);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await pg.render({ canvas, viewport: pg.getViewport({ scale }) }).promise;
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
          return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
        },
      });
      if (!sheets) {
        setToast({ text: 'The drawings for these takeoffs are not on this computer.', undo: false });
        return;
      }
      const filename = `${project!.name.replace(/[^\w\- ]+/g, '').trim() || 'takeoff'} - marked up.pdf`;
      if ((await saveFile(filename, new Blob([bytes as BlobPart], { type: 'application/pdf' }))) === 'failed') {
        setToast({ text: 'The PDF could not be saved.', undo: false });
      } else if (missing.length) {
        setToast({ text: `Saved ${sheets} sheets. Left out (drawings missing): ${missing.join(', ')}`, undo: false });
      }
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  function addType() {
    const type: TakeoffType = {
      id: newId(),
      name: 'New takeoff type',
      color: PALETTE[project!.types.length % PALETTE.length],
      kind: 'area',
      // No height until one is entered (only wall areas need it).
      height: 0,
      items: [],
    };
    commit((p) => ({ ...p, types: [...p.types, type] }), 'New type');
    setEditingTypeId(type.id);
  }

  /**
   * Shows or hides types' takeoffs on the drawing. A view setting, not an edit: kept with
   * the project but out of undo (an undo leaves what is shown alone).
   */
  function setHidden(typeIds: string[], hidden: boolean) {
    const prev = projectRef.current;
    if (!prev) return;
    const ids = new Set(typeIds);
    const next = { ...prev, types: prev.types.map((t) => (ids.has(t.id) ? { ...t, hidden: hidden || undefined } : t)) };
    projectRef.current = next;
    setProject(next);
    if (hidden) {
      const gone = new Set(next.measurements.filter((m) => ids.has(m.typeId)).map((m) => m.id));
      if (selectedId && gone.has(selectedId)) setSelectedId(null);
      setMultiIds((cur) => cur.filter((id) => !gone.has(id)));
    }
  }

  /** Option/Alt-click on an eye: only this type (or group) shown; again shows everything. */
  function soloTypes(typeIds: string[]) {
    const ids = new Set(typeIds);
    const alreadySolo = project!.types.every((t) => ids.has(t.id) === !t.hidden);
    if (alreadySolo) setHidden(project!.types.map((t) => t.id), false);
    else {
      setHidden(project!.types.filter((t) => !ids.has(t.id)).map((t) => t.id), true);
      setHidden(typeIds, false);
    }
  }

  async function newGroup(withTypes: string[] = []): Promise<string | null> {
    const name = await askText('New group', { hint: 'e.g. Phase 2, Drywall, Level 1' });
    if (!name?.trim()) return null;
    const id = newId();
    const ids = new Set(withTypes);
    commit(
      (p) => ({ ...p, groups: [...(p.groups ?? []), { id, name: name.trim() }], types: p.types.map((t) => (ids.has(t.id) ? { ...t, groupId: id } : t)) }),
      'New group',
    );
    return id;
  }

  async function renameGroup(id: string) {
    const g = project!.groups?.find((x) => x.id === id);
    if (!g) return;
    const name = await askText('Rename group', { initial: g.name });
    if (name?.trim()) commit((p) => ({ ...p, groups: (p.groups ?? []).map((x) => (x.id === id ? { ...x, name: name.trim() } : x)) }), 'Rename group');
  }

  /** Removes a group; its types stay, ungrouped. */
  function deleteGroup(id: string) {
    const g = project!.groups?.find((x) => x.id === id);
    commit(
      (p) => ({ ...p, groups: (p.groups ?? []).filter((x) => x.id !== id), types: p.types.map((t) => (t.groupId === id ? { ...t, groupId: undefined } : t)) }),
      'Delete group',
    );
    setToast({ text: `Removed the group ${g?.name ?? ''}; its types are kept, ungrouped`, undo: true });
  }

  function moveToGroup(typeId: string, groupId: string | undefined) {
    const t = project!.types.find((x) => x.id === typeId);
    if (!t || (t.groupId ?? undefined) === groupId) return;
    commit((p) => ({ ...p, types: p.types.map((x) => (x.id === typeId ? { ...x, groupId } : x)) }), 'Move to group');
  }

  function deleteType(typeId: string) {
    const type = project!.types.find((t) => t.id === typeId);
    const count = project!.measurements.filter((m) => m.typeId === typeId).length;
    commit(
      (p) => ({
        ...p,
        types: p.types.filter((t) => t.id !== typeId),
        measurements: p.measurements
          .filter((m) => m.typeId !== typeId)
          .map((m) =>
            m.finishes && Object.values(m.finishes).includes(typeId)
              ? { ...m, finishes: Object.fromEntries(Object.entries(m.finishes).filter(([, id]) => id !== typeId)) }
              : m,
          ),
      }),
      'Delete type',
    );
    if (editingTypeId === typeId) setEditingTypeId(null);
    if (activeTypeId === typeId) setActiveTypeId(null);
    setToast({ text: `Deleted ${type?.name.split(' – ')[0] ?? 'type'}${count ? ` and ${count} takeoff${count === 1 ? '' : 's'}` : ''}`, undo: true });
  }

  /** Measures the drawn line under a click, as the active length type. */
  async function traceAt(at: Pt, reach: number) {
    if (!page || !sheet || activeType?.kind !== 'linear') return;
    let line: Pt[] | null;
    try {
      line = traceLine(await segmentsOf(page), at, reach);
    } catch (e) {
      setToast({ text: `Couldn’t read this sheet’s linework: ${e instanceof Error ? e.message : String(e)}`, undo: false });
      return;
    }
    if (!line) {
      setToast({ text: 'No line there. Click right on a drawn line.', undo: false });
      return;
    }
    const m = { id: newId(), sheetId: sheet.id, typeId: activeType.id, points: line, holes: [] };
    commit((p) => ({ ...p, measurements: [...p.measurements, m] }), 'Trace line');
    setSelectedId(m.id);
  }

  /** Counts every copy of the symbol in the box, as the active count type. */
  async function countSymbols(box: [number, number, number, number]) {
    if (!page || !sheet || activeType?.kind !== 'count') return;
    setBusy('Looking for this symbol…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const segs = await segmentsOf(page);
      const sample = sampleSymbol(segs, box);
      const found = sample ? matchSymbol(sample, segs) : [];
      if (!sample || !found.length) {
        setToast({ text: 'Nothing to match in that box. Drag it tightly around one symbol’s linework.', undo: false });
        return;
      }
      // Copies already counted as this type are left alone.
      const span = Math.max(Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1]));
      const counted = project!.measurements.filter((m) => m.sheetId === sheet.id && m.typeId === activeType.id).map((m) => m.points[0]);
      const fresh = found.filter((f) => !counted.some((p) => Math.hypot(p[0] - f.at[0], p[1] - f.at[1]) < span / 2));
      if (!fresh.length) {
        setToast({ text: `All ${found.length} copies of this symbol are already counted.`, undo: false });
        return;
      }
      const added = fresh.map((f) => ({ id: newId(), sheetId: sheet.id, typeId: activeType.id, points: [f.at], holes: [] }));
      commit((p) => ({ ...p, measurements: [...p.measurements, ...added] }), 'Count symbols');
      const typeId = activeType.id;
      setToast({
        text: `Counted ${added.length} ${activeType.name.split(' – ')[0]}${found.length > added.length ? ` (${found.length - added.length} already counted)` : ''}`,
        undo: true,
        action: project!.sheets.length > 1 ? { label: 'Count on all sheets', run: () => void countEverywhere([{ sample, typeId }], sheet.id) } : undefined,
      });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
      return;
    } finally {
      setBusy(null);
    }
  }

  /** Reads the legend boxed on the sheet into rows for the legend dialog. */
  /** Starts marking where the sheet number (or title) sits in the title block. */
  function startNumberPick(kind: 'number' | 'title') {
    if (!page) return;
    if (kind === 'number') numberBoxes.current = {};
    setLegendPick(false);
    setNumberPick(kind);
    setSelectedId(null);
    setTool('symbol');
  }

  /** The text on a sheet, read once and kept (the search uses the same cache). */
  async function sheetTexts(s: Sheet): Promise<PageText[]> {
    const key = `${s.docId}:${s.page}`;
    const cached = textCache.current.get(key);
    if (cached) return cached;
    const pg = await pdfsRef.current
      .get(s.docId)
      ?.getPage(s.page)
      .catch(() => null);
    const texts = pg ? await pageTexts(pg).catch(() => []) : [];
    if (pg) textCache.current.set(key, texts);
    return texts;
  }

  /** The box just marked: remember the spot, then read that spot on every sheet. */
  async function readNumberBox(box: Box) {
    const kind = numberPickRef.current;
    if (!kind || !sheet) return;
    numberBoxes.current[kind] = relativeBox(box, sheet.width, sheet.height);
    setNumberPick(null);
    setTool('select');
    const { number, title } = numberBoxes.current;
    const sheets = projectRef.current!.sheets;
    const rows: SheetNumberRow[] = [];
    try {
      for (let i = 0; i < sheets.length; i++) {
        const s = sheets[i];
        setBusy(`Reading sheet numbers: ${i + 1} of ${sheets.length}`);
        const texts = await sheetTexts(s);
        rows.push({
          sheetId: s.id,
          current: s.name,
          number: number ? readNumber(linesIn(texts, onSheet(number, s.width, s.height))) : '',
          ...(title ? { title: readTitle(linesIn(texts, onSheet(title, s.width, s.height))) } : {}),
        });
      }
    } finally {
      setBusy(null);
    }
    setSheetNumbers({ rows, hasTitle: !!title });
  }

  async function readLegendBox(box: [number, number, number, number]) {
    if (!page || !sheet) return;
    setLegendPick(false);
    setTool('select');
    setBusy('Reading the legend…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const [texts, segs] = await Promise.all([pageTexts(page), segmentsOf(page)]);
      const rows = await readLegendAsync(texts, segs, box, (i, n) => setBusy(`Reading the legend… symbol ${i + 1} of ${n}`));
      // Hatch swatches: the areas hatched the same way (the walls need the sheet's scale).
      if (sheet.metersPerPoint && rows.some((r) => r.kind === 'area')) {
        setBusy('Reading the legend… hatches');
        await new Promise((r) => setTimeout(r, 0));
        findLegendAreas(rows, segs, box, sheet.width, sheet.height, sheet.metersPerPoint);
        // Each area takes the name of the room tagged in it, as Rooms does.
        const tags = findRoomLabels(texts, segs);
        for (const r of rows)
          for (const a of r.areas ?? []) {
            const inside = tags.filter((l) => pointInRing(l.at, a.points));
            if (inside.length) a.label = inside.map((l) => `${l.number}${l.name ? ` ${l.name}` : ''}`).join(' / ');
          }
      }
      if (!rows.length) {
        setToast({ text: 'No legend lines in that box. Box the symbols together with their labels.', undo: false });
        return;
      }
      setLegend({ sheetId: sheet.id, rows });
      setAiDialog('legend');
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  /** Adds the legend lines chosen as types, with the symbols found counted. */
  function addLegendTypes(sheetId: string, choices: LegendChoice[], everywhere = false) {
    const p = projectRef.current!;
    const h = p.units === 'metric' ? 3 : 10;
    const area = p.units === 'metric' ? 'm²' : 'SF';
    const len = p.units === 'metric' ? 'm' : 'ft';
    const types: TakeoffType[] = [];
    const added: Project['measurements'] = [];
    choices.forEach((c, i) => {
      const id = newId();
      const item = c.kind === 'count' ? { name: c.label, unit: 'ea', formula: 'N' } : c.kind === 'area' ? { name: c.label, unit: area, formula: 'A' } : { name: c.label, unit: len, formula: 'L' };
      types.push({
        id,
        name: c.label,
        color: PALETTE[(p.types.length + i) % PALETTE.length],
        kind: c.kind,
        height: c.kind === 'linear' ? 0 : h,
        division: guessDivision(c.label),
        items: [{ id: newId(), ...item }],
      });
      if (c.kind === 'area') {
        for (const a of c.row.areas ?? []) added.push({ id: newId(), sheetId, typeId: id, points: a.points, holes: [], source: 'legend' as const, ...(a.openings ? { openings: a.openings } : {}), ...(a.label ? { label: a.label } : {}) });
        return;
      }
      if (c.kind !== 'count') return;
      const places = c.row.found?.length ? c.row.found.map((f) => f.at) : (c.row.tagged ?? []).map((t) => [t.cx, t.cy] as Pt);
      for (const at of places) added.push({ id: newId(), sheetId, typeId: id, points: [at], holes: [] });
    });
    commit((q) => ({ ...q, types: [...q.types, ...types], measurements: [...q.measurements, ...added] }), 'Legend');
    setActiveTypeId(types[0].id);
    setToast({ text: `Added ${types.length} type${types.length === 1 ? '' : 's'} from the legend${added.length ? ` with ${added.length} takeoff${added.length === 1 ? '' : 's'}` : ''}`, undo: true });
    // Then the legend's symbols on the rest of the set, as their own change.
    const symbols = choices.flatMap((c, n) => (c.kind === 'count' && c.row.sample ? [{ sample: c.row.sample, typeId: types[n].id }] : []));
    if (everywhere && symbols.length) void countEverywhere(symbols, sheetId, `Added ${types.length} type${types.length === 1 ? '' : 's'}. `);
  }

  /**
   * Counts door tags, named by their number; prefixed tags (S114A) by prefix. On every
   * sheet, a door number counts once in the project (enlarged plans repeat tags), on the
   * first sheet it appears.
   */
  async function countDoorTags(everywhere = false) {
    if (!page || !sheet) return;
    setBusy('Finding door tags…');
    try {
      const p = projectRef.current!;
      const found: { sheetId: string; tags: ReturnType<typeof findDoorTags> }[] = [];
      const targets = everywhere ? p.sheets.filter((x) => !x.superseded || x.id === sheet.id) : [sheet];
      for (const [i, x] of targets.entries()) {
        if (everywhere) setBusy(`Finding door tags… sheet ${i + 1} of ${targets.length}`);
        const pg = x.id === sheet.id ? page : await pdfsRef.current.get(x.docId)?.getPage(x.page);
        if (!pg) continue;
        const segs = x.id === sheet.id ? await segmentsOf(pg) : await segmentsOnce(pg);
        const texts = await pageTexts(pg);
        let tags = findDoorTags(texts, segs);
        // Elevations and sections carry level markers (4000, 8570) in ovals that look like
        // door tags. Door numbers follow the room numbers (door 113A by room 113), so only
        // tags in the sheet's room-number range count; other sheets also need a plan's
        // worth of them.
        // (Lettered rooms, corridor A, have no number to go by.)
        const rooms = findRoomLabels(texts, segs)
          .map((r) => parseInt(r.number.replace(/^\D/, ''), 10))
          .filter((n) => !Number.isNaN(n));
        if (rooms.length) {
          const [lo, hi] = [Math.min(...rooms) - 20, Math.max(...rooms) + 20];
          // On the sheet being counted, doors numbered on their own (D001) are kept; only
          // numbers well above the rooms' (level markers) go. Other sheets keep the range.
          tags = tags.filter((d) => {
            const n = parseInt(d.number.replace(/^\D/, ''), 10);
            return x.id === sheet.id ? n <= hi : n >= lo && n <= hi;
          });
        }
        if (x.id !== sheet.id && (!rooms.length || tags.length < 4)) continue;
        found.push({ sheetId: x.id, tags });
      }
      const total = found.reduce((n, f) => n + f.tags.length, 0);
      if (!total) {
        setToast({ text: `No door tags on ${everywhere ? 'any sheet' : 'this sheet'}. A door tag is a door number in an oval, circle or hexagon.`, undo: false });
        return;
      }
      const newTypes: TakeoffType[] = [];
      const typeFor = (prefix: string): string => {
        const name = prefix ? `${prefix} – Openings tagged ${prefix}` : 'Doors';
        const hit = [...p.types, ...newTypes].find((t) => t.kind === 'count' && (prefix ? t.name.split(' – ')[0] === prefix : /^doors?\b/i.test(t.name)));
        if (hit) return hit.id;
        const t: TakeoffType = {
          id: newId(),
          name,
          color: PALETTE[(p.types.length + newTypes.length) % PALETTE.length],
          kind: 'count',
          height: p.units === 'metric' ? 3 : 10,
          division: '08 Openings',
          items: [{ id: newId(), name: prefix ? `Opening ${prefix}` : 'Door, frame & hardware', unit: 'ea', formula: 'N' }],
        };
        newTypes.push(t);
        return t.id;
      };
      // Doors already counted under their number are left alone: on this sheet, or anywhere when counting every sheet.
      const counted = new Set(p.measurements.filter((m) => m.label && (everywhere || m.sheetId === sheet.id)).map((m) => `${m.typeId}|${m.label}`));
      const added = found.flatMap(({ sheetId, tags }) =>
        tags.flatMap((d) => {
          const typeId = typeFor(/^[A-Z]/.test(d.number) ? d.number[0] : '');
          const key = `${typeId}|${d.number}`;
          if (counted.has(key)) return [];
          counted.add(key);
          return [{ id: newId(), sheetId, typeId, points: [d.at], holes: [], label: d.number }];
        }),
      );
      if (!added.length) {
        setToast({ text: `All ${total} door tags ${everywhere ? 'on the drawings' : 'on this sheet'} are already counted.`, undo: false });
        return;
      }
      const used = new Set(added.map((m) => m.typeId));
      commit((q) => ({ ...q, types: [...q.types, ...newTypes.filter((t) => used.has(t.id))], measurements: [...q.measurements, ...added] }), 'Door tags');
      const byType = [...used].map((id) => `${added.filter((m) => m.typeId === id).length} ${([...p.types, ...newTypes].find((t) => t.id === id)?.name ?? '').split(' – ')[0]}`);
      const sheets = new Set(added.map((m) => m.sheetId)).size;
      setToast({
        text: `Counted ${byType.join(', ')}${everywhere ? ` on ${sheets} sheet${sheets === 1 ? '' : 's'}` : ''}`,
        undo: true,
        action: !everywhere && p.sheets.length > 1 ? { label: 'Count on all sheets', run: () => void countDoorTags(true) } : undefined,
      });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  /** The superseded revision of the current sheet, if one was kept. */
  const previousRevision = sheet ? ([...(project?.sheets ?? [])].reverse().find((x) => x.name === `${sheet.name} (superseded)`) ?? null) : null;

  /** Shows what changed between the current sheet and its superseded revision. */
  async function compareRevision() {
    if (!page || !sheet || !previousRevision) return;
    setBusy('Comparing with the previous revision…');
    try {
      const oldPage = await pdfs.get(previousRevision.docId)?.getPage(previousRevision.page);
      if (!oldPage) throw new Error('The previous revision’s drawing is not available.');
      const blob = await compareSheets(oldPage, page);
      // A data URL rather than a blob: URL, which hosted pages may not be allowed to show.
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error('Could not show the comparison.'));
        r.readAsDataURL(blob);
      });
      setComparison({ url, blob, name: sheet.name });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Copies every takeoff on this sheet to another sheet of the same size at the same
   * place on the page: for typical floors drawn on their own sheets. Copies are new
   * takeoffs; the scale of the sheet they land on applies.
   */
  function copyTakeoffsTo(target: Sheet) {
    if (!sheet) return;
    const source = projectRef.current!.measurements.filter((m) => m.sheetId === sheet.id);
    if (!source.length) return;
    const copies = source.map((m) => ({
      ...m,
      id: newId(),
      sheetId: target.id,
      points: m.points.map((pt) => [...pt] as Pt),
      holes: m.holes.map((h) => h.map((pt) => [...pt] as Pt)),
    }));
    commit((p) => ({ ...p, measurements: [...p.measurements, ...copies] }), 'Copy takeoffs');
    setToast({
      text: `Copied ${copies.length} takeoff${copies.length === 1 ? '' : 's'} to ${target.name}${target.metersPerPoint ? '' : ' (set its scale to count them)'}`,
      undo: true,
      action: { label: `Go to ${target.name}`, run: () => setSheetId(target.id) },
    });
  }

  /** Saves the current sheet as a PNG with its takeoffs drawn on and a legend of totals. */
  async function saveSheetImage() {
    if (!page || !sheet) return;
    setBusy('Making the sheet image…');
    try {
      const blob = await sheetImage(page, sheet, project!);
      const name = `${project!.name} - ${sheet.name}`.replace(/[\\/:*?"<>|]+/g, '-');
      if ((await saveFile(`${name}.png`, blob)) === 'failed') setToast({ text: 'The image could not be saved.', undo: false });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
    } finally {
      setBusy(null);
    }
  }

  /** Names the sheets drawn without a text layer ("Page 34") from their title blocks, with Claude. */
  async function nameSheetsWithAi() {
    const unnamed = project!.sheets.filter((x) => /^Page \d+$/.test(x.name));
    if (!unnamed.length) return;
    if (!(await canAskClaude())) {
      setToast({ text: 'Reading sheet names needs Claude: add your API key in AI settings.', undo: false });
      return;
    }
    const names = new Map<string, string>();
    try {
      for (const [i, x] of unnamed.entries()) {
        setBusy(`Reading sheet names… ${i + 1} of ${unnamed.length}`);
        const pg = await pdfsRef.current.get(x.docId)?.getPage(x.page);
        if (!pg) continue;
        const read = await readSheetName(pg);
        if (read.number) names.set(x.id, read.number);
      }
    } catch (e) {
      setToast({ text: describeAiError(e), undo: false });
    } finally {
      setBusy(null);
    }
    if (!names.size) return;
    commit((p) => ({ ...p, sheets: p.sheets.map((x) => (names.has(x.id) ? { ...x, name: names.get(x.id)! } : x)) }), 'Name sheets');
    setToast({ text: `Named ${names.size} sheet${names.size === 1 ? '' : 's'}: ${[...names.values()].join(', ')}`, undo: true });
  }

  /**
   * Whether another sheet is drawn at the source sheet's scale: by its own scale when
   * set, else by what its dimension strings read as (a sheet they can't read counts).
   */
  async function sameScale(other: Sheet, source: Sheet, pg: PDFPageProxy, segs: Segment[]): Promise<boolean> {
    const want = source.metersPerPoint;
    if (!want) return true;
    if (other.metersPerPoint) return Math.abs(other.metersPerPoint / want - 1) <= 0.01;
    const read = checkScale(await pageTexts(pg), segs, project!.units);
    return !read || read.agree < 5 || Math.abs(read.metersPerPoint / want - 1) <= 0.02;
  }

  /** Adds the areas carrying a sampled hatch on every other sheet drawn at that scale, as one change. */
  async function findEverywhere(pattern: Pattern, typeId: string, fromSheet: string) {
    const p = projectRef.current!;
    const type = p.types.find((t) => t.id === typeId);
    const source = p.sheets.find((x) => x.id === fromSheet);
    if (!type || !source) return;
    const added: Project['measurements'] = [];
    const perSheet: string[] = [];
    const centroid = (pts: Pt[]): Pt => [pts.reduce((n, q) => n + q[0], 0) / pts.length, pts.reduce((n, q) => n + q[1], 0) / pts.length];
    try {
      // A hatch is only the same at the same drawing scale.
      const others = p.sheets.filter(
        (x) => x.id !== fromSheet && !x.superseded && !(x.metersPerPoint && source.metersPerPoint && Math.abs(x.metersPerPoint / source.metersPerPoint - 1) > 0.01),
      );
      for (const [i, other] of others.entries()) {
        setBusy(`Looking on every sheet… ${i + 1} of ${others.length}`);
        await new Promise((r) => setTimeout(r, 0));
        const pg = await pdfsRef.current.get(other.docId)?.getPage(other.page);
        if (!pg) continue;
        const segs = await segmentsOnce(pg);
        if (!(await sameScale(other, source, pg, segs))) continue;
        const model = () => buildWallModel(segs, other.metersPerPoint ?? source.metersPerPoint, { maxOpening });
        const own = p.measurements.filter((x) => x.sheetId === other.id && x.typeId === typeId);
        const fresh = findPatternOn(segs, model, pattern, other.width, other.height).areas.filter(
          (a) => !own.some((x) => pointInRing(centroid(a.points), x.points)),
        );
        if (!fresh.length) continue;
        perSheet.push(`${other.name} ${fresh.length}`);
        for (const a of fresh) added.push({ id: newId(), sheetId: other.id, typeId, points: a.points, holes: [], ...(a.openings ? { openings: a.openings } : {}) });
      }
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
      return;
    } finally {
      setBusy(null);
    }
    if (!added.length) {
      setToast({ text: 'No areas with this hatch on the other sheets.', undo: false });
      return;
    }
    // Sheet by sheet, to keep or leave out: a detail sheet with no scale to compare can carry
    // the same hatch for something else (a countertop's stipple).
    const sheetsById = new Map(p.sheets.map((x) => [x.id, x]));
    const rows = [...new Set(added.map((m) => m.sheetId))].map((id) => {
      const x = sheetsById.get(id)!;
      const mine = added.filter((m) => m.sheetId === id);
      const m2 = x.metersPerPoint ? mine.reduce((n, m) => n + Math.abs(ringArea(m.points)) * x.metersPerPoint! ** 2, 0) : null;
      const area = m2 === null ? '' : ` · ${formatQty(p.units === 'metric' ? m2 : m2 / 0.09290304)} ${p.units === 'metric' ? 'm²' : 'SF'}`;
      return {
        sheetId: id,
        name: x.name,
        found: `${mine.length} area${mine.length === 1 ? '' : 's'}${area}`,
        note: x.metersPerPoint ? undefined : 'No scale set: check this sheet is a plan at the same scale.',
      };
    });
    setSheetPick({
      title: `Hatched like this on ${rows.length} other sheet${rows.length === 1 ? '' : 's'}`,
      intro: `Areas with the same hatch as ${type.name}. Untick any sheet where it means something else.`,
      rows,
      onAdd: (ids) => {
        const keep = added.filter((m) => ids.includes(m.sheetId));
        commit((q) => ({ ...q, measurements: [...q.measurements, ...keep] }), 'Find similar');
        setToast({ text: `Added ${keep.length} more areas on ${ids.length} sheet${ids.length === 1 ? '' : 's'}`, undo: true });
      },
    });
  }

  /** Counts a sampled symbol on every other sheet, as one change. */
  async function countEverywhere(symbols: { sample: SymbolSample; typeId: string }[], fromSheet: string, lead = '') {
    const p = projectRef.current!;
    const items = symbols.filter((s) => p.types.some((t) => t.id === s.typeId));
    if (!items.length) return;
    const type = p.types.find((t) => t.id === items[0].typeId)!;
    const added: Project['measurements'] = [];
    const perSheet: string[] = [];
    try {
      const source = p.sheets.find((x) => x.id === fromSheet);
      // A symbol only matches at the scale it was drawn at.
      const others = p.sheets.filter(
        (x) => x.id !== fromSheet && !x.superseded && !(x.metersPerPoint && source?.metersPerPoint && Math.abs(x.metersPerPoint / source.metersPerPoint - 1) > 0.01),
      );
      for (const [i, other] of others.entries()) {
        setBusy(`Counting on every sheet… ${i + 1} of ${others.length}`);
        await new Promise((r) => setTimeout(r, 0));
        const pg = await pdfsRef.current.get(other.docId)?.getPage(other.page);
        if (!pg) continue;
        const segs = await segmentsOnce(pg);
        if (source && !(await sameScale(other, source, pg, segs))) continue;
        let here = 0;
        for (const { sample, typeId } of items) {
          const counted = p.measurements.filter((m) => m.sheetId === other.id && m.typeId === typeId).map((m) => m.points[0]);
          const fresh = matchSymbol(sample, segs).filter(
            (f) => !counted.some((q) => Math.hypot(q[0] - f.at[0], q[1] - f.at[1]) < sample.span / 2),
          );
          here += fresh.length;
          for (const f of fresh) added.push({ id: newId(), sheetId: other.id, typeId, points: [f.at], holes: [] });
        }
        if (here) perSheet.push(`${other.name} ${here}`);
      }
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
      return;
    } finally {
      setBusy(null);
    }
    if (!added.length) {
      setToast({ text: `${lead}No copies of ${items.length > 1 ? 'these symbols' : 'this symbol'} on the other sheets.`, undo: false });
      return;
    }
    commit((q) => ({ ...q, measurements: [...q.measurements, ...added] }), 'Count symbols');
    const what = items.length > 1 ? 'symbols' : type.name.split(' – ')[0];
    setToast({ text: `${lead}Counted ${added.length} more ${what}: ${perSheet.slice(0, 4).join(', ')}${perSheet.length > 4 ? '…' : ''}`, undo: true });
  }

  /** Adds every area on the sheet hatched like the given one, as the same type. */
  async function addSimilar(id: string) {
    const m = project!.measurements.find((x) => x.id === id);
    if (!m || !page || !sheet || m.sheetId !== sheet.id) return;
    setBusy('Looking for areas hatched like this one…');
    try {
      // Let the busy note paint before the sheet-wide search.
      await new Promise((r) => setTimeout(r, 30));
      const [segs, model] = await Promise.all([segmentsOf(page), wallModelFor(page, sheet, maxOpening)]);
      const { pattern, areas, found } = findSimilar(segs, model, m.points, sheet.width, sheet.height);
      if (!pattern) {
        setToast({ text: 'This area has no hatch pattern to match. Pick an area drawn with a hatch (dots, tile grid, lines).', undo: false });
        return;
      }
      // Skip areas already taken off as this type.
      const own = project!.measurements.filter((x) => x.sheetId === sheet.id && x.typeId === m.typeId);
      const centroid = (pts: Pt[]): Pt => [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length];
      const fresh = areas.filter((a) => !own.some((x) => pointInRing(centroid(a.points), x.points)));
      if (!fresh.length) {
        setToast({ text: 'No other areas hatched like this one on this sheet.', undo: false });
        return;
      }
      const added = fresh.map((a) => ({ id: newId(), sheetId: sheet.id, typeId: m.typeId, points: a.points, holes: [], ...(a.openings ? { openings: a.openings } : {}) }));
      commit((p) => ({ ...p, measurements: [...p.measurements, ...added] }), 'Find similar');
      const typeId = m.typeId;
      setToast({
        text: `Added ${added.length} area${added.length === 1 ? '' : 's'} hatched like this one`,
        undo: true,
        action: found && project!.sheets.length > 1 ? { label: 'Find on all sheets', run: () => void findEverywhere(found, typeId, sheet.id) } : undefined,
      });
    } catch (e) {
      setToast({ text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`, undo: false });
      return;
    } finally {
      setBusy(null);
    }
  }

  function deleteMeasurements(ids: string[]) {
    if (!ids.length) return;
    const gone = new Set(ids);
    commit((p) => ({ ...p, measurements: p.measurements.filter((m) => !gone.has(m.id)) }), 'Delete');
    if (selectedId && gone.has(selectedId)) setSelectedId(null);
    setMultiIds((cur) => cur.filter((id) => !gone.has(id)));
    setToast({ text: `Deleted ${ids.length} takeoff${ids.length === 1 ? '' : 's'}`, undo: true });
  }

  const addMeasurement = (points: Pt[], openings?: number) => {
    if (!sheet || !activeType) return;
    const m = { id: newId(), sheetId: sheet.id, typeId: activeType.id, points, holes: [], ...(openings ? { openings } : {}) };
    commit((p) => ({ ...p, measurements: [...p.measurements, m] }), tool === 'fill' ? 'Fill room' : 'Measure');
    return m.id;
  };

  const chooseType = (t: TakeoffType) => {
    setActiveTypeId(t.id);
    setSelectedId(null);
    if (tool === 'select' || tool === 'calibrate' || (tool === 'fill' && t.kind !== 'area') || (tool === 'symbol' && t.kind !== 'count') || (tool === 'trace' && t.kind !== 'linear') || tool === 'cutout') setTool('measure');
  };

  const query = sheetFilter.trim().toLowerCase();
  const hitsOn = (id: string) => (textHits && textHits.q === query ? textHits.hits.get(id) : undefined);
  const filteredSheets = project.sheets.filter((s) => s.name.toLowerCase().includes(query) || (s.title ?? '').toLowerCase().includes(query) || hitsOn(s.id));
  // Text that is exactly the search (a tag such as WC-1 or EX-1, not WC-10), on current sheets.
  const exactHits = textHits && textHits.q === query ? project.sheets.filter((s) => !s.superseded).flatMap((s) => (hitsOn(s.id) ?? []).filter((t) => t.str.trim().toLowerCase() === query).map((t) => ({ sheetId: s.id, t }))) : [];
  const exactTags = exactHits.length;
  const totalFor = (typeId: string) => totals.find((t) => t.type.id === typeId);
  const scaleState = !sheet ? 'none' : !sheet.metersPerPoint ? 'unset' : sheet.scaleSource === 'detected' ? 'check' : 'set';
  const renderSheet = (s: Sheet) => {
              const count = project.measurements.filter((m) => m.sheetId === s.id).length;
              const state = !s.metersPerPoint ? 'unset' : s.scaleSource === 'detected' ? 'check' : 'set';
              return (
                <li key={s.id}>
                  <button
                    className={`source-row ${s.id === sheetId ? 'active' : ''}`}
                    onClick={() => {
                      setSheetId(s.id);
                      setSelectedId(null);
                      // Text found on the sheet: show it, the next one on each further click.
                      const hits = hitsOn(s.id);
                      if (hits) {
                        hitTurn.current = s.id === sheetId ? hitTurn.current + 1 : 0;
                        const t = hits[hitTurn.current % hits.length];
                        // With the drawing around it.
                        const r = Math.max(t.w, t.h) / 2 + 120;
                        setFocus((f) => ({ box: [t.cx - r, t.cy - r, t.cx + r, t.cy + r], n: (f?.n ?? 0) + 1 }));
                      }
                    }}
                    onDoubleClick={async () => {
                      const name = await askText('Rename sheet', { initial: s.name });
                      if (name?.trim()) updateSheet(s.id, { name: name.trim() }, 'Rename sheet');
                    }}
                    title="Double-click to rename"
                  >
                    <Icon name="sheet" size={16} />
                    <span className="row-main">
                      <span className="row-title sheet-name" title={s.title}>
                        {s.name}
                        {s.title && <span className="sheet-title"> {s.title}</span>}
                      </span>
                      <span className={`row-sub scale-${state}`}>
                        {state === 'check' && <span className="check-dot" title="Read from the sheet; check it against a dimension" />}
                        {s.metersPerPoint ? s.scaleLabel : 'No scale'}
                        {state === 'check' && <span title="Read from the sheet; check it against a dimension"> · check</span>}
                        {s.done ? <span className="done-tag" title="Marked done"> · done</span> : null}
                        {hitsOn(s.id) ? <span className="found-tag"> · {hitsOn(s.id)!.length} found</span> : null}
                        {s.repeat ? <span className="repeat-tag" title={`Takeoffs on this sheet count ${s.repeat} times`}> · ×{s.repeat}</span> : null}
                      </span>
                    </span>
                    {count > 0 && (
                      <span className="badge" title={`${count} takeoff${count === 1 ? '' : 's'} on this sheet`}>
                        {count}
                      </span>
                    )}
                  </button>
                </li>
              );
            };

  const toolDisabled = (id: Tool) => !page || (id === 'cutout' && selectedType?.kind !== 'area');
  const toolTitle = (t: (typeof TOOLS)[number]) => `${t.help} (${t.key})${t.id === 'cutout' && selectedType?.kind !== 'area' ? ' — select an area first' : ''}`;

  return (
    <div className="app">
      <header className="titlebar">
        <input
          ref={projectFileInput}
          type="file"
          accept=".takeoff,.zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openProjectFile(f);
            e.target.value = '';
          }}
        />
        <div className="tb-left">
          <div className="app-mark" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="20" height="20">
              <rect x="1" y="1" width="18" height="18" rx="5" fill="var(--accent)" />
              <path d="M5 14.5V6h4.5L15 14.5z" fill="#fff" />
            </svg>
          </div>
          <input
            id="project-name"
            className="project-name"
            aria-label="Project name"
            value={project.name}
            onChange={(e) => {
              const name = e.target.value;
              const next = { ...projectRef.current!, name };
              projectRef.current = next;
              setProject(next);
            }}
          />
          <button
            ref={projectsButton}
            className="icon-button small"
            onClick={() => setPopover(popover === 'projects' ? null : 'projects')}
            aria-expanded={popover === 'projects'}
            aria-label="Projects"
            title="Projects"
          >
            <Icon name="chevronDown" size={14} />
          </button>
        </div>

        <div className="tb-center">
          <div className="segmented tools" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={tool === t.id ? 'on' : ''}
                aria-pressed={tool === t.id}
                disabled={toolDisabled(t.id)}
                onClick={() => chooseTool(t.id)}
                title={toolTitle(t)}
              >
                <Icon name={t.icon} size={16} />
                <span className={t.id === 'trace' || t.id === 'cutout' ? 'tool-label minor' : t.id === 'box' ? 'tool-label box' : 'tool-label'}>{t.label}</span>
              </button>
            ))}
          </div>
          {sheet && (
            <button
              ref={scaleButton}
              className={`scale-pill ${scaleState}`}
              onClick={() => setPopover(popover === 'scale' ? null : 'scale')}
              aria-expanded={popover === 'scale'}
              title="Drawing scale for this sheet"
            >
              <Icon name="scale" size={16} />
              <span>{sheet.metersPerPoint ? sheet.scaleLabel : 'Set scale'}</span>
              {scaleState === 'check' && <span className="pill-badge">Check</span>}
              <Icon name="chevronDown" size={12} />
            </button>
          )}
          {sheet && (
            <button
              ref={automateButton}
              className="ai-button"
              onClick={() => setPopover(popover === 'automate' ? null : 'automate')}
              aria-expanded={popover === 'automate'}
              title="Read assemblies, take off walls, fill rooms"
            >
              <Icon name="sparkle" size={16} />
              <span>Automate</span>
              <Icon name="chevronDown" size={12} />
            </button>
          )}
        </div>

        <div className="tb-right">
          <button className="icon-button" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button className="icon-button" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
            <Icon name="redo" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <button className="secondary" onClick={() => fileInput.current?.click()} title="Add PDF drawings">
            <Icon name="upload" size={16} />
            <span className="hide-narrow">
              Add<span className="hide-medium"> drawings</span>
            </span>
          </button>
          <button
            ref={exportButton}
            className="primary"
            onClick={() => setPopover(popover === 'export' ? null : 'export')}
            disabled={!project.measurements.length}
            title="Export the takeoff"
            aria-haspopup="menu"
          >
            <Icon name="download" size={16} />
            <span className="hide-narrow">Export</span>
          </button>
          <button ref={moreButton} className="icon-button" onClick={() => setPopover(popover === 'more' ? null : 'more')} aria-label="More" title="More">
            <Icon name="more" />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section className="source sheets">
          <div className="source-head">
            <h2>Sheets</h2>
            {page && project.sheets.length > 0 && (
              <button className="link-button number-sheets" onClick={() => startNumberPick('number')} title="Mark where the sheet number is in the title block, and every sheet is named from that spot">
                Number sheets
              </button>
            )}
            <span className="count">
              {project.sheets.some((x) => x.done)
                ? `${project.sheets.filter((x) => x.done).length} of ${project.sheets.length} done`
                : project.sheets.length || ''}
            </span>
          </div>
          {project.sheets.length > 1 && (
            <label className="search">
              <Icon name="search" size={14} />
              <input id="sheet-filter" placeholder="Search sheets and text" value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)} />
            </label>
          )}
          <ul className="source-list">
            {project.docs.length > 1
              ? project.docs.map((d) => {
                  const own = filteredSheets.filter((x) => x.docId === d.id);
                  if (!own.length && query) return null;
                  const all = project.sheets.filter((x) => x.docId === d.id);
                  const done = all.filter((x) => x.done).length;
                  const open = !collapsedDocs.has(d.id) || !!query;
                  return (
                    <Fragment key={d.id}>
                      <li className="doc-group">
                        <button
                          className="doc-head"
                          onClick={() => setCollapsedDocs((c) => (c.has(d.id) ? new Set([...c].filter((x) => x !== d.id)) : new Set(c).add(d.id)))}
                          onDoubleClick={async () => {
                            const name = await askText('Rename drawing file', { initial: d.name.replace(/\.pdf$/i, ''), hint: 'e.g. Architectural, Structural, Mechanical' });
                            if (name?.trim()) commit((p) => ({ ...p, docs: p.docs.map((x) => (x.id === d.id ? { ...x, name: name.trim() } : x)) }), 'Rename drawing file');
                          }}
                          aria-expanded={open}
                          title={`${d.name} · click to fold, double-click to rename`}
                        >
                          <span className={`doc-chevron ${open ? 'open' : ''}`}>
                            <Icon name="chevron" size={12} />
                          </span>
                          <span className="doc-name">{d.name.replace(/\.pdf$/i, '')}</span>
                          <span className="doc-count">{done ? `${done}/${all.length}` : all.length}</span>
                        </button>
                        <button className="icon-button small danger doc-remove" title={`Remove ${d.name} and its takeoffs`} aria-label={`Remove ${d.name}`} onClick={() => void removeDrawings(d.id)}>
                          <Icon name="trash" size={13} />
                        </button>
                      </li>
                      {open && own.map(renderSheet)}
                    </Fragment>
                  );
                })
              : filteredSheets.map(renderSheet)}
          </ul>
          {project.sheets.length === 0 && <p className="source-empty">Drawings you add appear here, one row per sheet.</p>}
          {query.length >= 2 && textHits?.q !== query && <p className="source-empty">Searching the drawings…</p>}
          {query.length >= 2 && textHits?.q === query && !filteredSheets.length && <p className="source-empty">No sheet or drawing text matches “{sheetFilter.trim()}”.</p>}
          {exactTags > 0 && (
            <button className="link-button count-tags" onClick={() => void countTextTags()}>
              Count the {exactTags} “{sheetFilter.trim()}” tag{exactTags === 1 ? '' : 's'} as a takeoff…
            </button>
          )}
        </section>

        <section className="source types">
          <div className="source-head">
            <h2>Takeoff types</h2>
            <button
              ref={newTypeButton}
              className="icon-button small push-right"
              onClick={() => setPopover(popover === 'newtype' ? null : 'newtype')}
              title="New takeoff type"
              aria-label="New takeoff type"
              aria-haspopup="menu"
            >
              <Icon name="plus" size={16} />
            </button>
            <button className="icon-button small" onClick={() => void newGroup()} title="New group (a folder for takeoff types)" aria-label="New group">
              <Icon name="folderPlus" size={16} />
            </button>
          </div>
          <ul className="source-list">
            {(() => {
              const groups = project.groups ?? [];
              const known = new Set(groups.map((g) => g.id));
              const eye = (ids: string[], hidden: boolean, label: string) => (
                <button
                  className={`icon-button small eye ${hidden ? 'off' : ''}`}
                  title={`${hidden ? 'Show' : 'Hide'} ${label} on the drawing (Option-click: show only ${ids.length > 1 ? 'these' : 'this'})`}
                  aria-label={`${hidden ? 'Show' : 'Hide'} ${label}`}
                  aria-pressed={!hidden}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) soloTypes(ids);
                    else setHidden(ids, !hidden);
                  }}
                >
                  <Icon name={hidden ? 'eyeOff' : 'eye'} size={15} />
                </button>
              );
              const dropProps = (groupId: string) => ({
                onDragOver: (e: React.DragEvent) => {
                  if (!dragType.current) return;
                  e.preventDefault();
                  setDropOn(groupId);
                },
                onDragLeave: () => setDropOn((d) => (d === groupId ? null : d)),
                onDrop: (e: React.DragEvent) => {
                  e.preventDefault();
                  if (dragType.current) moveToGroup(dragType.current, groupId || undefined);
                  dragType.current = null;
                  setDropOn(null);
                },
              });
              const renderType = (t: TakeoffType) => {
                const tt = totalFor(t.id);
                return (
                  <li
                    key={t.id}
                    className={`type-item ${t.hidden ? 'is-hidden' : ''} ${t.groupId && known.has(t.groupId) ? 'in-group' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      dragType.current = t.id;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', t.name);
                    }}
                    onDragEnd={() => {
                      dragType.current = null;
                      setDropOn(null);
                    }}
                  >
                    {eye([t.id], !!t.hidden, t.name)}
                    <button className={`source-row ${t.id === activeTypeId ? 'active' : ''}`} onClick={() => chooseType(t)} title={`Take off ${t.name}`}>
                      <span className="dot" style={{ background: t.color }} />
                      <span className="row-main">
                        <span className="row-title type-name">{t.name}</span>
                        <span className="row-sub">
                          {t.kind === 'area' ? 'Area' : t.kind === 'linear' ? (t.headline === 'area' ? 'Wall area' : 'Length') : 'Count'}
                          {tt && tt.vars.N > 0 ? ` · ${formatQty(tt.primary)} ${tt.unit}` : ''}
                        </span>
                      </span>
                    </button>
                    <span className="row-actions-hover">
                      <button
                        className="icon-button small"
                        title="Move to a group"
                        aria-label={`Move ${t.name} to a group`}
                        onClick={(e) => setMoveMenu({ typeId: t.id, anchor: { current: e.currentTarget } })}
                      >
                        <Icon name="folder" size={14} />
                      </button>
                      <button className="icon-button small" title="Edit type" aria-label={`Edit ${t.name}`} onClick={() => setEditingTypeId(t.id)}>
                        <Icon name="edit" size={14} />
                      </button>
                      <button className="icon-button small danger" title="Delete type and its takeoffs" aria-label={`Delete ${t.name}`} onClick={() => deleteType(t.id)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </span>
                  </li>
                );
              };
              const loose = project.types.filter((t) => !t.groupId || !known.has(t.groupId));
              return (
                <>
                  {groups.map((g) => {
                    const members = project.types.filter((t) => t.groupId === g.id);
                    const open = !collapsedGroups.has(g.id);
                    const allHidden = members.length > 0 && members.every((t) => t.hidden);
                    return (
                      <Fragment key={g.id}>
                        <li className={`type-group ${dropOn === g.id ? 'drop' : ''} ${allHidden ? 'is-hidden' : ''}`} {...dropProps(g.id)}>
                          {members.length ? eye(members.map((t) => t.id), allHidden, `the ${g.name} group`) : <span className="eye-space" />}
                          <button
                            className="doc-head group-head"
                            onClick={() => setCollapsedGroups((c) => (c.has(g.id) ? new Set([...c].filter((x) => x !== g.id)) : new Set(c).add(g.id)))}
                            onDoubleClick={() => void renameGroup(g.id)}
                            aria-expanded={open}
                            title={`${g.name} · click to fold, double-click to rename, drag types here to file them`}
                          >
                            <span className={`doc-chevron ${open ? 'open' : ''}`}>
                              <Icon name="chevron" size={12} />
                            </span>
                            <Icon name="folder" size={14} />
                            <span className="doc-name">{g.name}</span>
                            <span className="doc-count">{members.length}</span>
                          </button>
                          <span className="row-actions-hover">
                            <button className="icon-button small" title="Rename group" aria-label={`Rename ${g.name}`} onClick={() => void renameGroup(g.id)}>
                              <Icon name="edit" size={13} />
                            </button>
                            <button className="icon-button small danger" title="Remove the group (its types are kept)" aria-label={`Remove group ${g.name}`} onClick={() => deleteGroup(g.id)}>
                              <Icon name="trash" size={13} />
                            </button>
                          </span>
                        </li>
                        {open && members.map(renderType)}
                        {open && !members.length && <li className="group-empty">Drag types here, or use a type’s folder button</li>}
                      </Fragment>
                    );
                  })}
                  {groups.length > 0 && (loose.length > 0 || dropOn !== null) && (
                    <li className={`type-group loose ${dropOn === '' ? 'drop' : ''}`} {...dropProps('')}>
                      <span className="eye-space" />
                      <span className="group-head muted">No group</span>
                    </li>
                  )}
                  {loose.map(renderType)}
                </>
              );
            })()}
          </ul>
        </section>
      </aside>

      <main className="stage">
        <Viewer
          page={page}
          sheet={sheet}
          measurements={shownMeasurements}
          types={project.types}
          activeType={activeType}
          units={project.units}
          tool={tool}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setMultiIds([]);
            if (id) setEditingTypeId(null);
          }}
          multiIds={picked.map((m) => m.id)}
          onMultiSelect={(ids, add) => {
            setSelectedId(null);
            setMultiIds((cur) => (add ? [...new Set([...cur, ...ids])] : ids));
          }}
          onDeleteMany={deleteMeasurements}
          onAdd={addMeasurement}
          onReplacePoints={(id, points, source = 'Fill room', openings) =>
            commit((p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, points, openings } : m)) }), source)
          }
          getWallModel={() => (page && sheet ? wallModelFor(page, sheet, maxOpening) : null)}
          onAddHole={(id, ring) =>
            commit(
              (p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, holes: [...m.holes, ring] } : m)) }),
              'Cutout',
            )
          }
          onDelete={(id) => deleteMeasurements([id])}
          onCalibrate={(mpp, label) => sheet && updateSheet(sheet.id, { metersPerPoint: mpp, scaleLabel: label, scaleSource: 'calibrated' }, 'Calibrate')}
          onToolDone={() => setTool('select')}
          onFindSymbols={(box) => void (numberPick ? readNumberBox(box) : legendPick ? readLegendBox(box) : countSymbols(box))}
          onTrace={(at, reach) => void traceAt(at, reach)}
          focus={focus}
          highlights={sheet ? hitsOn(sheet.id) : undefined}
        />

        {picked.length > 0 && (
          <div className="selection-bar" role="toolbar" aria-label="Selected takeoffs">
            <span className="selection-count">{picked.length} selected</span>
            <span className="selection-types">{pickedSummary(picked, project.types)}</span>
            <button onClick={() => setMultiIds([])}>Clear</button>
            <button className="danger-solid" onClick={() => deleteMeasurements(picked.map((m) => m.id))}>
              <Icon name="trash" size={15} /> Delete {picked.length}
            </button>
          </div>
        )}

        {project.sheets.length === 0 && (
          <div className="welcome">
            <div className="welcome-card">
              <div className="welcome-icon">
                <Icon name="doc" size={28} />
              </div>
              <h1>Start a takeoff</h1>
              <p>
                Add a PDF drawing set. Every page becomes a sheet, with its number and scale read for you. Measure by hand, fill a room with one click,
                count every copy of a symbol, or let Automate take off walls by type, rooms and their finishes.
              </p>
              <button className="primary large" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={18} /> Add drawings
              </button>
              <button className="link-button try-sample" onClick={() => void openSample()}>
                No drawings handy? Try a sample plan
              </button>
              <div className="welcome-units">
                <span>Measure in</span>
                <div className="segmented small" role="radiogroup" aria-label="Units">
                  {(['metric', 'imperial'] as const).map((u) => (
                    <button
                      key={u}
                      role="radio"
                      aria-checked={project.units === u}
                      className={project.units === u ? 'on' : ''}
                      disabled={project.measurements.length > 0}
                      onClick={async () => {
                        if (project.units === u) return;
                        // Nothing measured yet. The untouched starter types are swapped for the
                        // other units' set (the user's own, if saved); types made or edited are kept.
                        const own = await loadStarterTypes();
                        const names = project.types.map((t) => t.name).join('|');
                        const untouched =
                          names === defaultTypes(project.units).map((t) => t.name).join('|') ||
                          (own?.units === project.units && names === own.types.map((t) => t.name).join('|'));
                        const next = own?.units === u && own.types.length ? own.types.map((t) => ({ ...t, id: newId() })) : defaultTypes(u);
                        commit((p) => ({ ...p, units: u, types: untouched ? next : p.types }), 'Units');
                        if (untouched) setActiveTypeId(null);
                      }}
                    >
                      {u === 'metric' ? 'Metric (m, m²)' : 'Imperial (ft, SF)'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="welcome-foot">
                Projects and drawings are saved on this computer and work offline.{' '}
                <button className="link-button" onClick={() => setAiDialog('help')}>
                  Quick start
                </button>
              </p>
            </div>
          </div>
        )}

        {page && sheet && !sheet.metersPerPoint && (
          <div className="scale-banner" role="status">
            <span>
              <b>Scale not set.</b> Takeoffs on this sheet aren’t counted until it has one.
            </span>
            <button className="primary small-button" onClick={() => setPopover('scale')}>
              Set scale
            </button>
          </div>
        )}
        {page && sheet?.metersPerPoint && scanned?.sheetId === sheet.id && !scanned.dismissed && (
          <div className="scale-banner info-banner" role="status">
            <span>
              <b>Scanned sheet.</b> It’s an image, so Fill, Trace, Symbols and Automate can’t read it. Measure by hand (M).
            </span>
            <button className="small-button" onClick={() => setScanned({ sheetId: sheet.id, dismissed: true })}>
              OK
            </button>
          </div>
        )}
        {tool === 'fill' && page && (
          <div className="tool-options">
            <label htmlFor="max-opening">Close openings up to</label>
            <input
              id="max-opening"
              type="number"
              min={0.5}
              step={project.units === 'metric' ? 0.5 : 1}
              value={project.units === 'metric' ? maxOpening : Math.round(maxOpening / 0.3048)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > 0) setMaxOpening(project.units === 'metric' ? v : v * 0.3048);
              }}
            />
            <span>{project.units === 'metric' ? 'm' : 'ft'}</span>
          </div>
        )}

        {page && (
          <div className="hint-pill">
            {numberPick && tool === 'symbol'
              ? `Drag a box around the sheet ${numberPick} in the title block; the same spot is read on every sheet · Esc cancels`
              : legendPick && tool === 'symbol'
                ? 'Drag a box around the legend: its symbols and their labels · Esc cancels'
                : toolHint(tool, activeType, sheet)}
          </div>
        )}
        {busy && (
          <div className="busy">
            <span className="spinner small" /> {busy}
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <span>{toast.text}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
            {toast.sticky && (
              <button aria-label="Dismiss" onClick={() => setToast(null)}>
                Later
              </button>
            )}
            {toast.undo && toast.after === historyRev.current && (
              <button
                onClick={() => {
                  undo();
                  setToast(null);
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </main>

      <aside className="inspector-pane">
        {editingType ? (
          <TypeEditor
            type={editingType}
            units={project.units}
            totals={totalFor(editingType.id)?.vars}
            onChange={updateType}
            onDelete={() => deleteType(editingType.id)}
            onDuplicate={() => {
              const t = editingType;
              const copy: TakeoffType = {
                ...t,
                id: newId(),
                name: `${t.name} (copy)`,
                color: PALETTE[project.types.length % PALETTE.length],
                items: t.items.map((it) => ({ ...it, id: newId() })),
              };
              commit((p) => ({ ...p, types: [...p.types, copy] }), 'Duplicate type');
              setEditingTypeId(copy.id);
            }}
            onClose={() => setEditingTypeId(null)}
          />
        ) : (
          <Inspector
            tab={tab}
            onTab={setTab}
            project={project}
            sheet={sheet}
            totals={totals}
            sheetTotals={sheetTotals}
            activity={activity}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={deleteMeasurements}
            onRetype={(id, typeId) => commit((p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, typeId } : m)) }), 'Change type')}
            onEditType={setEditingTypeId}
            onEditFinishes={() => setAiDialog('finishes')}
            onFindSimilar={(id) => void addSimilar(id)}
            onShow={(id) => {
              const m = project.measurements.find((x) => x.id === id);
              if (!m) return;
              if (m.sheetId !== sheetId) setSheetId(m.sheetId);
              setSelectedId(id);
              setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
            }}
            onRename={(id, label) =>
              commit(
                (p) => ({ ...p, measurements: p.measurements.map((m) => (m.id === id ? { ...m, label: label || undefined } : m)) }),
                'Rename',
                `label:${id}`,
              )
            }
            canFindSimilar={!!page && !!sheet?.metersPerPoint && !busy}
          />
        )}
      </aside>

      {popover === 'scale' && sheet && (
        <Popover anchor={scaleButton} onClose={() => setPopover(null)} width={340} label="Drawing scale">
          <ScalePicker
            sheet={sheet}
            units={project.units}
            onPick={(label, mpp) => {
              updateSheet(sheet.id, { metersPerPoint: mpp, scaleLabel: label, scaleSource: 'preset' }, 'Scale');
              setPopover(null);
            }}
            onCalibrate={() => {
              setPopover(null);
              setTool('calibrate');
            }}
            onClear={() => {
              updateSheet(sheet.id, { metersPerPoint: null, scaleLabel: null, scaleSource: null }, 'Scale');
              setPopover(null);
            }}
            check={scaleCheck?.sheetId === sheet.id ? scaleCheck.result : 'reading'}
          />
        </Popover>
      )}
      {popover === 'projects' && (
        <Popover anchor={projectsButton} onClose={() => setPopover(null)} width={400} label="Projects">
          <ProjectsPanel
            currentId={project.id}
            persisted={persisted}
            folder={syncFolder ? folderLabel(syncFolder) : undefined}
            onOpen={(id) => {
              setPopover(null);
              void switchProject(id);
            }}
            onNew={(units) => {
              setPopover(null);
              void startNewProject(units);
            }}
            onDelete={(id) => void removeProject(id)}
            onDuplicate={() => {
              setPopover(null);
              void duplicateProject();
            }}
            onSaveFile={() => {
              setPopover(null);
              void saveProjectFile();
            }}
            onOpenFile={() => {
              setPopover(null);
              projectFileInput.current?.click();
            }}
            onBackupAll={() => {
              setPopover(null);
              void backupAll();
            }}
          />
        </Popover>
      )}
      {popover === 'automate' && sheet && (
        <Popover anchor={automateButton} onClose={() => setPopover(null)} width={360} label="Automate">
          <div className="automate-menu" role="menu">
            {[
              {
                id: 'assemblies' as const,
                icon: 'sparkle' as const,
                title: sheet.aiAssemblies ? 'Assembly types (saved)' : 'Read assembly types',
                text: 'On an assembly schedule sheet: every wall, floor, roof and ceiling type becomes a takeoff type with its materials.',
                ready: !!page,
              },
              {
                id: 'walls' as const,
                icon: 'walls' as const,
                title: 'Wall takeoff',
                text: 'On a plan: measures every tagged wall on its centreline, by type.',
                ready: !!page && !!sheet.metersPerPoint,
              },
              {
                id: 'rooms' as const,
                icon: 'area' as const,
                title: 'Rooms',
                text: 'On a plan: fills every tagged room and adds it as a named area.',
                ready: !!page && !!sheet.metersPerPoint,
              },
              {
                id: 'doors' as const,
                icon: 'door' as const,
                title: 'Door tags',
                text: 'On a plan: counts every door tag (a number in an oval or hexagon), named by its number.',
                ready: !!page,
              },
              {
                id: 'legend' as const,
                icon: 'count' as const,
                title: 'Read a legend',
                text: 'Box a symbols legend: each line becomes a takeoff type, and symbols drawn on the sheet are counted.',
                ready: !!page,
              },
              {
                id: 'finishes' as const,
                icon: 'list' as const,
                title: 'Room finishes',
                text: 'Floor, base, walls and ceiling for every room, typed in or read from the finish schedule.',
                ready: true,
              },
            ].map((a) => (
              <button
                key={a.id}
                role="menuitem"
                className="automate-item"
                disabled={!a.ready}
                onClick={() => {
                  setPopover(null);
                  if (a.id === 'doors') void countDoorTags();
                  else if (a.id === 'legend') {
                    setLegendPick(true);
                    setTool('symbol');
                  } else setAiDialog(a.id);
                }}
              >
                <span className="automate-icon">
                  <Icon name={a.icon} size={18} />
                </span>
                <span className="automate-text">
                  <span className="automate-title">{a.title}</span>
                  <span className="automate-desc">{a.ready ? a.text : 'Set this sheet’s scale first.'}</span>
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
      {popover === 'copy' && sheet && (
        <Menu
          anchor={moreButton}
          onClose={() => setPopover(null)}
          label="Copy takeoffs to"
          groups={[
            project.sheets
              .filter((x) => x.id !== sheet.id && Math.abs(x.width - sheet.width) < 1 && Math.abs(x.height - sheet.height) < 1)
              .map((x) => ({
                label: `Copy to ${x.name}`,
                hint: x.metersPerPoint ? x.scaleLabel ?? '' : 'no scale',
                onSelect: () => copyTakeoffsTo(x),
              })),
          ].filter((g) => g.length)}
        />
      )}
      {popover === 'newtype' && (
        <Menu
          anchor={newTypeButton}
          onClose={() => setPopover(null)}
          label="New takeoff type"
          groups={[
            [
              { label: 'Blank type', onSelect: addType },
              { label: 'From the library…', hint: 'Ceilings, flooring, paint…', onSelect: () => setAiDialog('library') },
            ],
            otherProjects.slice(0, 8).map((o) => ({ label: `Types from ${o.name}`, onSelect: () => void importTypes(o.id) })),
          ].filter((g) => g.length)}
        />
      )}
      {moveMenu && (
        <Menu
          anchor={moveMenu.anchor}
          onClose={() => setMoveMenu(null)}
          label="Move to group"
          groups={[
            (project.groups ?? []).map((g) => ({
              label: g.name,
              hint: project.types.find((t) => t.id === moveMenu.typeId)?.groupId === g.id ? 'In this group' : undefined,
              onSelect: () => moveToGroup(moveMenu.typeId, g.id),
            })),
            [
              ...(project.types.find((t) => t.id === moveMenu.typeId)?.groupId ? [{ label: 'No group', onSelect: () => moveToGroup(moveMenu.typeId, undefined) }] : []),
              { label: 'New group…', onSelect: () => void newGroup([moveMenu.typeId]) },
            ],
          ].filter((g) => g.length)}
        />
      )}
      {popover === 'export' && (
        <Menu
          anchor={exportButton}
          onClose={() => setPopover(null)}
          label="Export"
          groups={[
            [
              { label: 'Excel workbook', hint: 'Quantities and materials', onSelect: () => void exportExcel() },
              { label: 'Marked-up PDF', hint: 'Drawings with takeoffs', onSelect: () => void exportMarkup() },
            ],
          ]}
        />
      )}
      {popover === 'more' && (
        <Menu
          anchor={moreButton}
          onClose={() => setPopover(null)}
          label="More"
          groups={[
            [
              { label: 'History', hint: 'Every change', onSelect: () => setTab('history') },
              { label: 'Quick start', onSelect: () => setAiDialog('help') },
              { label: 'Keyboard shortcuts', onSelect: () => setAiDialog('shortcuts') },
              ...(page && sheet ? [{ label: 'Save sheet as image…', hint: 'With takeoffs', onSelect: () => void saveSheetImage() }] : []),
              ...(page && project.sheets.length ? [{ label: 'Number sheets from the title block…', hint: 'Mark it once', onSelect: () => startNumberPick('number') }] : []),
              ...(sheet
                ? [
                    {
                      label: sheet.done ? 'Mark this sheet not done' : 'Mark this sheet done',
                      hint: 'Track progress',
                      onSelect: () => updateSheet(sheet.id, { done: sheet.done ? undefined : true }, sheet.done ? `Reopen ${sheet.name}` : `${sheet.name} done`),
                    },
                    { label: sheet.repeat ? `Counts ×${sheet.repeat}…` : 'Count this sheet ×N…', hint: 'Typical floors', onSelect: () => void setRepeat(sheet) },
                  ]
                : []),
              ...(previousRevision ? [{ label: 'Compare with previous revision', onSelect: () => void compareRevision() }] : []),
              ...(sheet && project.measurements.some((m) => m.sheetId === sheet.id)
                ? [{ label: 'Copy takeoffs to another sheet…', hint: 'Typical floors', onSelect: () => setTimeout(() => setPopover('copy'), 0) }]
                : []),
              ...(project.sheets.some((x) => /^Page \d+$/.test(x.name))
                ? [{ label: 'Name sheets with Claude…', hint: 'Sheets with no text', onSelect: () => void nameSheetsWithAi() }]
                : []),
              ...(canUseServiceWorker() && !isInstalled() ? [{ label: 'Install as an app…', onSelect: () => void installApp() }] : []),
              ...(isHosted ? [] : [{ label: 'AI settings…', onSelect: () => setAiDialog('settings') }]),
              ...(desktopApi
                ? syncFolder
                  ? [
                      { label: 'Show this project’s folder', hint: 'Drawings and takeoffs', onSelect: () => void revealProjectFolder() },
                      { label: 'Show projects folder', hint: folderLabel(syncFolder), onSelect: () => void desktopApi!.revealFolder() },
                      { label: 'Change projects folder…', onSelect: () => void chooseProjectsFolder() },
                    ]
                  : [{ label: 'Keep projects in iCloud Drive…', hint: 'Other computer', onSelect: () => void chooseProjectsFolder() }]
                : []),
            ],
            project.docs.map((d) => ({ label: `Remove ${d.name}…`, danger: true, onSelect: () => void removeDrawings(d.id) })),
            [
              {
                label: 'Use these types for new projects',
                hint: `${project.units}`,
                onSelect: async () => {
                  await saveStarterTypes(project.units, project.types);
                  setToast({ text: `New ${project.units} projects will start with these ${project.types.length} types`, undo: false });
                },
              },
              {
                label: 'Reset types for new projects',
                onSelect: async () => {
                  await clearStarterTypes();
                  setToast({ text: 'New projects will start with the built-in types', undo: false });
                },
              },
            ],
            [
              { label: 'Projects…', onSelect: () => setPopover('projects') },
              { label: 'Save project to file…', onSelect: () => void saveProjectFile() },
              { label: 'Open project file…', onSelect: () => projectFileInput.current?.click() },
              {
                label: scoringOn() ? 'Hide bid workbook scoring' : 'Show bid workbook scoring',
                hint: 'Estimators',
                onSelect: () => {
                  const on = !scoringOn();
                  setScoringOn(on);
                  setToast({ text: on ? 'Wall takeoff and assembly reading can now be scored against a bid workbook.' : 'Bid workbook scoring hidden.', undo: false });
                },
              },
            ],
          ].filter((g) => g.length)}
        />
      )}

      {aiDialog === 'walls' && page && sheet && (
        <WallTakeoffDialog
          page={page}
          sheet={sheet}
          units={project.units}
          types={project.types}
          earlier={project.measurements.filter((m) => m.sheetId === sheet.id && m.source === 'walls').length}
          palette={PALETTE}
          // This drawing file's schedules first: another building's WE1 may be a different wall.
          legend={[...project.sheets.filter((s) => s.docId === sheet.docId), ...project.sheets.filter((s) => s.docId !== sheet.docId)].flatMap((s) => s.aiAssemblies?.assemblies ?? [])}
          maxOpening={maxOpening}
          onApply={({ types, measurements, replaceEarlier, stopsAtDoors }) =>
            commit(
              (p) => ({
                ...p,
                types: [...p.types, ...types].map((t) =>
                  stopsAtDoors.has(t.id) && (t.stopsAtDoors ?? false) !== stopsAtDoors.get(t.id) ? { ...t, stopsAtDoors: stopsAtDoors.get(t.id) } : t,
                ),
                measurements: [...p.measurements.filter((m) => !(replaceEarlier && m.sheetId === sheet.id && m.source === 'walls')), ...measurements],
              }),
              'Wall takeoff',
            )
          }
          onClose={() => setAiDialog(null)}
        />
      )}
      {aiDialog === 'rooms' && page && sheet && (
        <RoomsDialog
          page={page}
          sheet={sheet}
          units={project.units}
          types={project.types}
          earlier={project.measurements.filter((m) => m.sheetId === sheet.id && m.source === 'rooms').length}
          palette={PALETTE}
          maxOpening={maxOpening}
          onApply={({ types, measurements, replaceEarlier }) =>
            commit(
              (p) => ({
                ...p,
                types: [...p.types, ...types],
                measurements: [...p.measurements.filter((m) => !(replaceEarlier && m.sheetId === sheet.id && m.source === 'rooms')), ...measurements],
              }),
              'Room takeoff',
            )
          }
          onClose={() => setAiDialog(null)}
        />
      )}
      {aiDialog === 'legend' && legend && (
        <LegendDialog
          sheetName={project.sheets.find((x) => x.id === legend.sheetId)?.name ?? ''}
          rows={legend.rows}
          onClose={() => {
            setAiDialog(null);
            setLegend(null);
          }}
          multiSheet={project.sheets.length > 1}
          // Only types in use: an unused starter W1 counts nothing twice.
          existing={project.types.filter((t) => project.measurements.some((m) => m.typeId === t.id || Object.values(m.finishes ?? {}).includes(t.id)))}
          onAdd={(choices, everywhere) => {
            setAiDialog(null);
            setLegend(null);
            addLegendTypes(legend.sheetId, choices, everywhere);
          }}
        />
      )}
      {sheetPick && (
        <SheetPickDialog
          title={sheetPick.title}
          intro={sheetPick.intro}
          rows={sheetPick.rows}
          onClose={() => setSheetPick(null)}
          onAdd={(ids) => {
            setSheetPick(null);
            sheetPick.onAdd(ids);
          }}
        />
      )}
      {aiDialog === 'library' && (
        <TypeLibraryDialog
          units={project.units}
          existing={new Set(project.types.map((t) => t.name))}
          onClose={() => setAiDialog(null)}
          onAdd={(types) => {
            setAiDialog(null);
            commit((p) => ({ ...p, types: [...p.types, ...types] }), 'Type library');
            setActiveTypeId(types[0].id);
            setToast({ text: `Added ${types.length} type${types.length === 1 ? '' : 's'}. Select one to change its materials.`, undo: true });
          }}
        />
      )}
      {aiDialog === 'finishes' && (
        <RoomFinishesDialog
          project={project}
          palette={PALETTE}
          getPage={async (s) => (await pdfs.get(s.docId)?.getPage(s.page)) ?? null}
          onApply={({ types, finishes }) =>
            commit(
              (p) => ({
                ...p,
                types: [...p.types, ...types],
                measurements: p.measurements.map((m) => (finishes.has(m.id) ? { ...m, finishes: finishes.get(m.id) } : m)),
              }),
              'Room finishes',
            )
          }
          onFindRooms={page && sheet?.metersPerPoint ? () => setAiDialog('rooms') : undefined}
          onClose={() => setAiDialog(null)}
        />
      )}
      {aiDialog === 'assemblies' && page && sheet && (
        <AiAssembliesDialog
          page={page}
          sheet={sheet}
          units={project.units}
          existingTypes={project.types}
          onApply={(incoming) =>
            commit((p) => {
              const byId = new Map(incoming.map((t) => [t.id, t]));
              const kept = p.types.map((t) => byId.get(t.id) ?? t);
              const added = incoming.filter((t) => !p.types.some((x) => x.id === t.id));
              return { ...p, types: [...kept, ...added] };
            }, 'Assembly types')
          }
          onSaveResult={(result) => updateSheet(sheet.id, { aiAssemblies: result }, 'Assembly types')}
          onClose={() => setAiDialog(null)}
          onOpenSettings={() => setAiDialog('settings')}
        />
      )}
      {aiDialog === 'settings' && <AiSettingsDialog onClose={() => setAiDialog(null)} />}
      {aiDialog === 'shortcuts' && <ShortcutsDialog onClose={() => setAiDialog(null)} />}
      {aiDialog === 'help' && <QuickStartDialog onClose={() => setAiDialog(null)} />}
      {comparison && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setComparison(null);
          }}
        >
          <div className="modal compare" role="dialog" aria-label="Compare revisions" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>{comparison.name}: what changed</h3>
              <div className="button-row">
                <button onClick={() => void saveFile(`${comparison.name} - changes.png`, comparison.blob)}>Save image</button>
                <button
                  onClick={() => setComparison(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <p className="muted">
              <span className="swatch removed" /> Only on the previous revision <span className="swatch added" /> Only on this one{' '}
              <span className="swatch same" /> On both
            </p>
            <div className="compare-image">
              <img src={comparison.url} alt={`Changes on ${comparison.name}`} />
            </div>
          </div>
        </div>
      )}
      {sheetNumbers && (
        <SheetNumbersDialog
          rows={sheetNumbers.rows}
          hasTitle={sheetNumbers.hasTitle}
          onClose={() => setSheetNumbers(null)}
          onPickTitle={() => {
            setSheetNumbers(null);
            startNumberPick('title');
          }}
          onApply={(rows) => {
            setSheetNumbers(null);
            const byId = new Map(rows.map((r) => [r.sheetId, r]));
            commit(
              (p) => ({
                ...p,
                sheets: p.sheets.map((s) => {
                  const r = byId.get(s.id);
                  return r ? { ...s, name: r.number.trim(), ...(r.title?.trim() ? { title: r.title.trim() } : {}) } : s;
                }),
              }),
              'Number sheets',
            );
            setToast({ text: `Renamed ${rows.length} sheet${rows.length === 1 ? '' : 's'}`, undo: true });
          }}
        />
      )}
      {folderSetup && (
        <div className="modal-backdrop">
          <div className="modal folder-setup" role="dialog" aria-label="Projects folder">
            <div className="welcome-icon">
              <Icon name="doc" size={28} />
            </div>
            <h3>{folderSetup.missing ? 'Your projects folder can’t be found' : 'Where should your projects live?'}</h3>
            {folderSetup.missing ? (
              <p className="muted">
                {folderLabel(folderSetup.missing)} isn’t there. If it’s in iCloud Drive, check iCloud is signed in on this computer, then quit and
                reopen Takeoff AI. Or choose the folder again.
              </p>
            ) : (
              <p className="muted">
                Each project gets its own folder there, holding its drawings and takeoffs, saved as you work. Use iCloud Drive to open the same
                projects on your other computer.
              </p>
            )}
            <div className="folder-setup-actions">
              <button className="primary large" onClick={() => void chooseProjectsFolder(true)}>
                Use {folderLabel(folderSetup.suggested)}
              </button>
              <button onClick={() => void chooseProjectsFolder()}>Choose another folder…</button>
            </div>
            {!folderSetup.iCloud && (
              <p className="field-hint">iCloud Drive isn’t set up on this computer, so the default is your Documents folder.</p>
            )}
          </div>
        </div>
      )}
      <DialogHost />
    </div>
  );
}

/** What a selection holds, by type: "DOWNLIGHT ×8 · W1 ×4", the largest first. */
function pickedSummary(picked: Measurement[], types: TakeoffType[]): string {
  const n = new Map<string, number>();
  for (const m of picked) n.set(m.typeId, (n.get(m.typeId) ?? 0) + 1);
  const parts = [...n]
    .sort((a, b) => b[1] - a[1])
    .map(([id, k]) => `${(types.find((t) => t.id === id)?.name ?? 'Unknown').split(' – ')[0]} ×${k}`);
  return parts.length > 3 ? `${parts.slice(0, 3).join(' · ')} · +${parts.length - 3} more` : parts.join(' · ');
}

function toolHint(tool: Tool, type: TakeoffType | null, sheet: Sheet | null): string {
  if (sheet && !sheet.metersPerPoint && tool !== 'calibrate' && tool !== 'box') return 'Set this sheet’s scale before measuring';
  switch (tool) {
    case 'select':
      return 'Click a takeoff to select it · Delete removes it';
    case 'box':
      return 'Drag left to right for what’s inside, right to left for what it touches';
    case 'measure':
      if (!type) return 'Choose a takeoff type on the left';
      if (type.kind === 'count') return `Click each ${type.name.split(' – ')[0]} to count it`;
      return 'Click points · Double-click or Return to finish · Shift keeps lines straight · Esc cancels';
    case 'calibrate':
      return 'Click both ends of a dimension you know, then type its length';
    case 'trace':
      if (type?.kind !== 'linear') return 'Choose a length type on the left';
      return 'Click a drawn line · its whole run in that pen is measured, round corners and across dash gaps';
    case 'symbol':
      if (type?.kind !== 'count') return 'Choose a count type on the left';
      return 'Drag a box around one symbol · every copy on this sheet is counted, turned or not';
    case 'cutout':
      return 'Draw the hole inside the selected area · Double-click or Return to finish';
    case 'fill':
      if (type?.kind !== 'area') return 'Choose an area type on the left';
      return 'Click inside a room · Shift-click the next space to join it';
  }
}
