import { suppressCoincidentStructure } from "../build/coincidentStructure";
import { canopyRegistrations } from "../build/canopyRegistration";
import { useEffect, useMemo, useState } from "react";
import type { Project, Sheet, Pt } from "../model";
import type { BuildModel, BuildElement } from "../build/types";
import { measurementVars } from "../quantities";
import { ExploreScene, type ExploreMode } from "./ExploreScene";
import { inside, roomStops, sheetFrame, worldPoint } from "./spatial";
import "./explore.css";
import { disciplines, drawingLayers, floorPlans, layerElement } from "./layers";
import { gridAxes, type DrawingTexts } from "../build/building";
import { AlignmentEditor } from "./AlignmentEditor";
import type { SheetFrame } from "./spatial";
import { StructuralEditor } from "./StructuralEditor";
import {
  structuralEvidence,
  applyStructuralReviews,
  structuralFingerprint,
  type StructuralPlacement,
} from "../build/structural";
import type { DrawingLines } from "../build/roof";
import { connectStructure } from "../build/connectStructure";
import { roofViewportRegistrations } from "../build/roofRegistration";
import type { SourceBox } from "./sourceRegion";
import { SourceViewer } from "./SourceViewer";
import { structuralRevisionContext } from "../build/structuralRevisions";
export interface ExploreWorkspaceProps {
  project: Project;
  model: BuildModel;
  renderPage: (sheet: Sheet) => Promise<HTMLCanvasElement>;
  renderDetail?: (sheet: Sheet, box: SourceBox) => Promise<HTMLCanvasElement>;
  onClose: () => void;
  drawingTexts?: DrawingTexts;
  drawingLines?: DrawingLines;
  indexing?: boolean;
  onOpenTakeoff?: (sheet: Sheet) => void;
}
const num = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const emptyTexts: DrawingTexts = {};
const emptyLines: DrawingLines = {};
type ScopedStructuralPlacement = StructuralPlacement & { reviewFrame?: SheetFrame; reviewBaseId?: string };
export function ExploreWorkspace({
  project,
  model,
  renderPage,
  renderDetail,
  onClose,
  drawingTexts = emptyTexts,
  drawingLines = emptyLines,
  indexing = false,
  onOpenTakeoff,
}: ExploreWorkspaceProps) {
  const revisedLayers = useMemo(() => {
    const context = structuralRevisionContext(project, drawingTexts, drawingLines);
    return Object.fromEntries(Object.entries(context.replacements).flatMap(([id, ref]) => {
      const original = project.sheets.find(s => s.id === id);
      return original ? [[id, { ...original, id: ref.key, docId: ref.docId, page: ref.page,
        title: `${original.title ?? "Drawing"} · ${project.specs?.find(s => s.id === ref.docId)?.name ?? "revised issue"}` } as Sheet]] : [];
    }));
  }, [project, drawingTexts, drawingLines]);
  const quantityPending = (e: BuildElement) => e.origin === "takeoff" && e.quantity === 0 &&
    project.types.find(t=>t.id===e.typeId)?.kind === "linear" &&
    !project.sheets.find(s=>s.id===e.sheetId)?.metersPerPoint;
  const sheets = useMemo(() => floorPlans(project, model), [project, model]);
  const [sid, setSid] = useState(
    () =>
      sheets.find((s) =>
        project.measurements.some(
          (m) => m.sheetId === s.id && m.source === "rooms",
        ),
      )?.id ??
      sheets[0]?.id ??
      "",
  );
  const sheet = sheets.find((s) => s.id === sid) ?? sheets[0],
    frame = useMemo(
      () => (sheet ? sheetFrame(project, model, sheet) : null),
      [project, model, sheet],
    );
  const rooms = useMemo(
    () => (sheet && frame ? roomStops(project, model, sheet, frame) : []),
    [project, model, sheet, frame],
  );
  const [libraryQuery, setLibraryQuery] = useState("");
  const [resetView, setResetView] = useState(0);
  const [mode, setMode] = useState<ExploreMode>("sheet"),
    [roomId, setRoomId] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [focus, setFocus] = useState<Pt | null>(null),
    [query, setQuery] = useState(""),
    [page, setPage] = useState<HTMLCanvasElement | null>(null),
    [pageError, setPageError] = useState(""),
    [pose, setPose] = useState<{ at: Pt; yaw: number } | null>(null),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const [enabled, setEnabled] = useState<Set<string>>(new Set()),
    [layerPanel, setLayerPanel] = useState(false),
    [opacity, setOpacity] = useState(0.65),
    [showBase, setShowBase] = useState(true),
    [showAllowances, setShowAllowances] = useState(false),
    [showDrawingGeometry, setShowDrawingGeometry] = useState(true),
    [showFootprints, setShowFootprints] = useState(true),
    [showUnplaced, setShowUnplaced] = useState(false),
    [showGrids, setShowGrids] = useState(false),
    [sourceView, setSourceView] = useState<(Sheet & { evidenceBox?: SourceBox }) | null>(null),
    [overlayPages, setOverlayPages] = useState<
      Record<string, HTMLCanvasElement>
    >({}),
    [layerError, setLayerError] = useState("");
  const alignmentKey = `explore-alignments:${project.id}:${model.sourceHash}`;
  const [manual, setManual] = useState<
      Record<string, { baseId: string; frame: SheetFrame }>
    >(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(alignmentKey) || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          return {};
        return Object.fromEntries(
          Object.entries(parsed).filter(([, value]) => {
            const v = value as { baseId?: unknown; frame?: SheetFrame };
            const f = v?.frame;
            return (
              typeof v?.baseId === "string" &&
              f &&
              [f.a, f.b, f.tx, f.ty, f.residual].every(Number.isFinite) &&
              f.a * f.a + f.b * f.b > 0 &&
              f.residual >= 0 &&
              f.residual <= 0.15
            );
          }),
        ) as Record<string, { baseId: string; frame: SheetFrame }>;
      } catch {
        return {};
      }
    }),
    [aligning, setAligning] = useState<Sheet | null>(null);
  // All floor registrations share the model's world coordinates. Cache their
  // presentation layers up front; selecting a floor must not rerun extraction.
  const layersByFloor = useMemo(() => new Map(sheets.map(base => [base.id,
    drawingLayers(project, model, base, drawingTexts, drawingLines),
  ])), [project, model, sheets, drawingTexts, drawingLines]);
  const layers = useMemo(() => (layersByFloor.get(sid) ?? []).map(l =>
    manual[`${sid}:${l.sheet.id}`]?.baseId === sid ? {
      ...l, frame: manual[`${sid}:${l.sheet.id}`].frame,
      level: model.elements.find(e => e.sheetId === sid && e.level)?.level ?? null,
      reason: "User-reviewed control points",
    } : l), [layersByFloor, manual, sid, model]);
  const level =
    model.levels.find((l) => l.sheets.includes(sid))?.id ??
    model.elements.find((e) => e.sheetId === sid && e.level)?.level;
  const available = useMemo(
    () => layers.filter((l) => (l.level === level || l.discipline === "Structure" || sheets.some(p=>p.id===l.sheet.id)) && l.sheet.id !== sid),
    [layers, level, sid, sheets],
  );
  const visibleSheets = useMemo(
    () => new Set([sid, ...enabled]),
    [sid, enabled],
  );
  const [scope, setScope] = useState<"rooms" | "structure" | "drawings">("rooms");
  const [structureOnly, setStructureOnly] = useState(false);
  const structuralKey = `explore-structure:${project.id}:${model.sourceHash}`;
  const [structuralReviews, setStructuralReviews] = useState<
    Record<string, ScopedStructuralPlacement>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem(structuralKey) || "{}");
    } catch {
      return {};
    }
  });
  const [editingStructural, setEditingStructural] =
    useState<BuildElement | null>(null);
  const frames = useMemo(
    () =>
      Object.fromEntries(
        layers.filter((l) => l.frame).map((l) => [l.sheet.id, l.frame!]),
      ),
    [layers],
  );
  const canonicalFrames = useMemo(() => {
    const out: Record<string, SheetFrame> = {};
    for (const base of sheets) {
      const baseFrame = sheetFrame(project, model, base);
      if (baseFrame) out[base.id] = baseFrame;
      for (const layer of layersByFloor.get(base.id) ?? [])
        if (layer.frame && !layer.geometryOnly && !out[layer.sheet.id]) out[layer.sheet.id] = layer.frame;
    }
    return out;
  }, [project, model, sheets, layersByFloor]);
  const canonicalModel = useMemo(() => connectStructure(project, model, drawingTexts, drawingLines),
    [project, model, drawingTexts, drawingLines]);
  // Editor evidence is needed only for the selected member, not every floor switch.
  const recoveredStructure = useMemo(() => editingStructural
    ? structuralEvidence(project, {...model, elements: [editingStructural]}, drawingTexts, drawingLines, canonicalFrames)
    : {}, [project, model, drawingTexts, drawingLines, canonicalFrames, editingStructural]);
  const roofRegistrations = useMemo(() => ({...roofViewportRegistrations(project, model, drawingTexts), ...canopyRegistrations(project, model, drawingTexts, drawingLines)}), [project, model, drawingTexts, drawingLines]);
  const memberFrames = useMemo(() => Object.fromEntries(model.elements.flatMap(e => {
    const frame = roofRegistrations[e.measurementId]?.frame ??
      (layers.find(l => l.sheet.id === e.sheetId)?.geometryOnly ? undefined : frames[e.sheetId] ?? canonicalFrames[e.sheetId]);
    return frame ? [[e.id, frame]] : [];
  })), [model, roofRegistrations, layers, frames, canonicalFrames]);
  const structuralModel = useMemo(() => {
    if (!Object.keys(structuralReviews).length) return canonicalModel;
    // New reviews retain the exact world frame used in their editor. Legacy
    // reviews retain the previous scoped manual-frame behaviour until resaved.
    const reviewFrames = {...memberFrames};
    for (const [id, review] of Object.entries(structuralReviews))
      if (review.reviewFrame) reviewFrames[id] = review.reviewFrame;
    return suppressCoincidentStructure(applyStructuralReviews(project, canonicalModel, structuralReviews, reviewFrames));
  }, [project, canonicalModel, structuralReviews, memberFrames]);
  const originalFrames = useMemo(() => new Map(project.sheets.map(source =>
    [source.id, sheetFrame(project, model, source)])), [project, model]);
  const editingReview = editingStructural && structuralReviews[editingStructural.id]?.fingerprint === structuralFingerprint(editingStructural, project)
    ? structuralReviews[editingStructural.id] : undefined;
  const editingFrame = editingStructural ? editingReview?.reviewFrame ?? memberFrames[editingStructural.id] : undefined;
  const coordinatedModel = useMemo(
    () => ({
      ...model,
      drawingGeometry: structuralModel.drawingGeometry,
      elements: structuralModel.elements.flatMap((e) => {
        // Source-built structural solids and accepted member reviews are already
        // in the canonical world frame. A selected-floor overlay is not a new
        // geometry registration and must never move/re-extrude those members.
        if (e.origin === "building" || e.trade === "structure" || e.measurementSource === "foundations" || e.sheetId === sid || (roofRegistrations[e.measurementId] && e.shape)) return [e];
        const l = available.find((l) => l.sheet.id === e.sheetId);
        if (!l?.frame) return [];
        const review = structuralReviews[e.id];
        const hasRecovered = review && review.fingerprint === structuralFingerprint(e, project) && e.shape;
        if (hasRecovered) return [e];
        const placed = layerElement(
          e,
          originalFrames.get(l.sheet.id) ?? null,
          l.frame,
        );
        if (!placed?.shape) return [];
        const dz =
          (model.levels.find((v) => v.id === l.level)?.elevation ?? 0) -
          (model.levels.find((v) => v.id === e.level)?.elevation ?? 0);
        const shape = placed.shape;
        return [
          {
            ...placed,
            level: l.level,
            shape:
              shape.type === "run"
                ? { ...shape, z0: shape.z0 + dz }
                : { ...shape, z: shape.z + dz },
          },
        ];
      }),
    }),
    [
      project,
      model,
      structuralModel,
      originalFrames,
      structuralReviews,
      roofRegistrations,
      sid,
      available,
    ],
  );
  const pins = useMemo(
    () =>
      available.flatMap((l) =>
        !l.frame
          ? []
          : l.elements
              .filter(
                (e) =>
                  (!l.geometryOnly || !!roofRegistrations[e.measurementId]) &&
                  !structuralModel.elements.find((v) => v.id === e.id)?.shape,
              )
              .flatMap((e) => {
                const ref = e.sources.find((s) => s.id === l.sheet.id && s.box);
                if (!ref?.box) return [];
                return [
                  {
                    id: e.id,
                    sheetId: l.sheet.id,
                    label: e.typeName,
                    at: worldPoint(
                      [
                        (ref.box[0] + ref.box[2]) / 2,
                        (ref.box[1] + ref.box[3]) / 2,
                      ],
                      roofRegistrations[e.measurementId]?.frame ?? l.frame!,
                    ),
                  },
                ];
              }),
      ),
    [available, structuralModel, roofRegistrations],
  );
  const grids = useMemo(() => {
    if (!sheet || !frame) return [];
    const axes = gridAxes(
        drawingTexts[sheet.id] ?? [],
        sheet.width,
        sheet.height,
      ),
      ps = project.measurements
        .filter((m) => m.sheetId === sid)
        .flatMap((m) => m.points);
    if (!ps.length) return [];
    const x0 = Math.min(...ps.map((p) => p[0])) - 25,
      x1 = Math.max(...ps.map((p) => p[0])) + 25,
      y0 = Math.min(...ps.map((p) => p[1])) - 25,
      y1 = Math.max(...ps.map((p) => p[1])) + 25;
    return Object.entries(axes)
      .filter(
        ([key, v]) =>
          !Object.entries(axes).some(
            ([other, w]) =>
              other !== key && v.axis === w.axis && Math.abs(v.at - w.at) < 3,
          ),
      )
      .filter(
        ([, v]) =>
          v.at >= (v.axis === "x" ? x0 : y0) &&
          v.at <= (v.axis === "x" ? x1 : y1),
      )
      .map(([label, v]) => ({
        label,
        a: worldPoint(v.axis === "x" ? [v.at, y0] : [x0, v.at], frame),
        b: worldPoint(v.axis === "x" ? [v.at, y1] : [x1, v.at], frame),
      }));
  }, [drawingTexts, project, sheet, frame, sid]);
  const overlays = useMemo(
    () =>
      available.flatMap((l) =>
        enabled.has(l.sheet.id) && !l.geometryOnly && l.frame && overlayPages[l.sheet.id]
          ? [
              {
                sheet: l.sheet,
                frame: l.frame,
                page: overlayPages[l.sheet.id],
                opacity,
              },
            ]
          : [],
      ),
    [available, enabled, overlayPages, opacity],
  );
  useEffect(() => {
    setEnabled(new Set());
    setOverlayPages({});
    setLayerError("");
  }, [sid]);
  useEffect(() => {
    let gone = false;
    setOverlayPages((old) =>
      Object.fromEntries(Object.entries(old).filter(([id]) => enabled.has(id))),
    );
    (async () => {
      for (const id of enabled) {
        if (overlayPages[id] || available.find(l => l.sheet.id === id)?.geometryOnly) continue;
        const l = available.find((l) => l.sheet.id === id);
        if (!l?.frame) continue;
        try {
          const full = await renderPage(revisedLayers[l.sheet.id] ?? l.sheet);
          // Match the base drawing budget: do not discard already-rendered
          // source detail before the user zooms into a structural overlay.
          const ratio = Math.min(1, 3500 / Math.max(full.width, full.height));
          if (ratio === 1) {
            if (!gone) setOverlayPages((p) => ({ ...p, [id]: full }));
            continue;
          }
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(full.width * ratio);
          canvas.height = Math.ceil(full.height * ratio);
          canvas
            .getContext("2d")!
            .drawImage(full, 0, 0, canvas.width, canvas.height);
          if (!gone) setOverlayPages((p) => ({ ...p, [id]: canvas }));
        } catch (e) {
          if (!gone) setLayerError(`${l.sheet.name}: ${String(e)}`);
        }
      }
    })();
    return () => {
      gone = true;
    };
  }, [enabled, available, renderPage, revisedLayers]);
  const toggleLayer = (id: string) => {
    if (!enabled.has(id) && enabled.size >= 4) {
      setLayerError(
        "Four drawing overlays are active. Turn one off before adding another.",
      );
      return;
    }
    setLayerError("");
    setEnabled((old) => {
      const n = new Set(old);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const sheetUrl = useMemo(() => page?.toDataURL("image/png"), [page]);
  const drawingGeometry = structuralModel.drawingGeometry ?? [];
  const room = rooms.find((r) => r.id === roomId) ?? null,
    element = structuralModel.elements.find((e) => e.id === selected) ?? drawingGeometry.find(e => e.id === selected) ?? null;
  const measurements = useMemo(
    () => new Map(project.measurements.map((m) => [m.id, m])),
    [project],
  );
  const m = element ? measurements.get(element.measurementId) : undefined,
    t = m ? project.types.find((t) => t.id === m.typeId) : undefined;
  const sourceSheet = m
    ? project.sheets.find((s) => s.id === m.sheetId)
    : element ? project.sheets.find(s => s.id === element.sheetId) : undefined;
  const vars =
    m && t && sourceSheet
      ? measurementVars(m, t, sourceSheet, project.units)
      : null;
  const source = element?.sources.find(
    (s) => s.kind === "sheet" && s.id === sheet?.id,
  );
  const revisionEvidence = [...new Set(element?.sources.filter(s => s.kind === "spec" && !s.section).map(s => s.id) ?? [])].map(id => {
    const doc = project.specs?.find(s => s.id === id);
    const pages = [...new Set(element!.sources.filter(s => s.kind === "spec" && !s.section && s.id === id).map(s => s.page).filter((p): p is number => p !== undefined))].sort((a, b) => a - b);
    return `${doc?.book?.addendum ? `Addendum ${doc.book.addendum}` : doc?.name ?? "Revised document"} · ${pages.length === 1 ? "page" : "pages"} ${pages.join(", ")}`;
  });
  const allSheetElements = structuralModel.elements.filter(
    (e) => visibleSheets.has(e.sheetId) && e.origin === "takeoff",
  );
  const structuralElements = structuralModel.elements.filter(
    (e) =>
      e.origin === "takeoff" &&
      e.trade === "structure" &&
      (e.sheetId === sid || available.some((l) => l.sheet.id === e.sheetId)),
  );
  const candidates =
    query || scope !== "rooms"
      ? (scope === "drawings" ? drawingGeometry : scope === "structure" ? structuralElements : allSheetElements).filter(
          (e) => e.name.toLowerCase().includes(query.toLowerCase()) ||
            (!!query.replace(/[^a-z0-9]/gi, "") && e.name.replace(/[^a-z0-9]/gi, "").toLowerCase().includes(query.replace(/[^a-z0-9]/gi, "").toLowerCase())),
        )
      : [];
  const selectedShape = element?.shape;
  const memberSpan =
    (selectedShape?.type === "run" || selectedShape?.type === "axis")
      ? selectedShape.points
          .slice(1)
          .reduce(
            (sum, p, i) =>
              sum +
              Math.hypot(
                p[0] - selectedShape.points[i][0],
                p[1] - selectedShape.points[i][1],
              ),
            0,
          )
      : null;
  const totalArea = rooms.reduce((sum, r) => sum + r.element.quantity, 0);
  const lengthUnit = project.units === "metric" ? "m" : "ft",
    areaUnit = project.units === "metric" ? "m²" : "SF";
  useEffect(() => {
    if (!sheet) return;
    let stale = false;
    setPage(null);
    setPageError("");
    renderPage(sheet)
      .then((p) => {
        if (!stale) setPage(p);
      })
      .catch((e) => {
        if (!stale) setPageError(String(e));
      });
    return () => {
      stale = true;
    };
  }, [sheet, renderPage]);
  useEffect(() => {
    setMode("sheet");
    setSelected(null);
    setRoomId("");
    setFocus(null);
    setPose(null);
  }, [sid]);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)"),
      change = () => setReduced(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMode("sheet");
        setFocus(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const selectRoom = (id: string) => {
    setRoomId(id);
    setSelected(id);
  };
  const viewSource = () => {
    if (!element) return;
    const ref = element.sources.find(
      (s) => s.kind === "sheet" && s.id === sid && s.box,
    );
    if (ref?.box && frame) {
      setFocus(
        worldPoint(
          [(ref.box[0] + ref.box[2]) / 2, (ref.box[1] + ref.box[3]) / 2],
          frame,
        ),
      );
      setMode("sheet");
    }
  };
  const svgPoints = (ps: Pt[]) => ps.map((p) => p.join(",")).join(" ");
  const mapBounds = useMemo(() => {
    const ps = rooms.flatMap((r) => r.ring);
    if (!ps.length) return [0, 0, 1, 1];
    const x = Math.min(...ps.map((p) => p[0])),
      y = Math.min(...ps.map((p) => p[1]));
    return [
      x - 1,
      y - 1,
      Math.max(...ps.map((p) => p[0])) - x + 2,
      Math.max(...ps.map((p) => p[1])) - y + 2,
    ];
  }, [rooms]);
  if (!sheet || !frame)
    return (
      <div className="ex-shell">
        <header className="ex-top">
          <b>Explore Drawing</b>
          <button onClick={onClose}>Back to takeoff</button>
        </header>
        <div className="ex-empty">
          <p className="ex-kicker">A measured starting point</p>
          <h1>Bring a floor plan to life.</h1>
          <p>
            This project needs a calibrated plan with placed wall or area
            measurements. No compatible drawing-to-model alignment was found.
          </p>
          <button onClick={onClose}>Return to takeoff</button>
        </div>
      </div>
    );

  const crop = source?.box
    ? (() => {
        const b = source.box,
          pad = Math.max(25, (b[2] - b[0]) * 0.15, (b[3] - b[1]) * 0.15);
        return [
          b[0] - pad,
          b[1] - pad,
          Math.max(50, b[2] - b[0] + pad * 2),
          Math.max(50, b[3] - b[1] + pad * 2),
        ];
      })()
    : null;
  return (
    <div className="ex-shell">
      <header className="ex-top">
        <a
          className="ex-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode("sheet");
            setFocus(null);
          }}
        >
          <span className="ex-brand-icon">⌗</span> TAKEOFF{" "}
          <span className="ex-brand-muted">/ EXPLORE</span>
        </a>
        <div className="ex-project">
          {project.name}
          <span>Takeoff and drawing evidence · read only</span>
        </div>
        <button className="ex-close" onClick={onClose}>
          Back to takeoff <span>↗</span>
        </button>
      </header>
      <div className="ex-body">
        <aside className="ex-left">
          <p className="ex-kicker">Your drawings. In depth.</p>
          <h1>
            Step inside
            <br />
            the <em>scope.</em>
          </h1>
          <p className="ex-intro">
            The drawing, the space and the measured work. One connected view.
          </p>
          <label className="ex-label" htmlFor="ex-sheet">
            FLOOR PLAN
          </label>
          <select
            id="ex-sheet"
            value={sid}
            onChange={(e) => setSid(e.target.value)}
          >
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.title}
              </option>
            ))}
          </select>
          <div className="ex-stats">
            <div>
              <strong>{rooms.length}</strong>
              <span>measured spaces</span>
            </div>
            <div>
              <strong>
                {num(totalArea)}
                <small> {areaUnit}</small>
              </strong>
              <span>room takeoff total</span>
            </div>
          </div>
          <div className="ex-scope-tabs">
            <button
              aria-pressed={scope === "rooms"}
              onClick={() => {
                setScope("rooms");
                setQuery("");
                setStructureOnly(false);
              }}
            >
              Spaces
            </button>
            <button
              aria-pressed={scope === "structure"}
              onClick={() => {
                setScope("structure");
                setQuery("");
              }}
            >
              Structure
            </button>
            {drawingGeometry.length > 0 && <button
              aria-pressed={scope === "drawings"}
              onClick={() => { setScope("drawings"); setQuery(""); }}
            >From drawings</button>}
          </div>
          <div className="ex-section-heading">
            <h2>{scope === "drawings" ? "Drawing-derived geometry" : scope === "structure" ? "Structural takeoffs" : "Spaces"}</h2>
            <span>
              {(scope === "drawings" ? drawingGeometry.length : scope === "structure"
                ? structuralElements.length
                : rooms.length
              )
                .toString()
                .padStart(2, "0")}
            </span>
          </div>
          {scope === "structure" && (
            <p className="ex-coverage">
              {structuralElements.filter(e => e.shape && e.shape.type !== "axis" && e.shape.type !== "locator").length} of {structuralElements.length} records have solid geometry. Remaining records need placement, section or elevation evidence.
            </p>
          )}
          {scope === "drawings" && <p className="ex-coverage">Source-backed shapes without accepted takeoffs. Excluded from quantities and schedule.</p>}
          <input
            className="ex-search"
            aria-label="Find a measured room or element"
            placeholder="Find a room, wall or opening…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ex-room-list">
            {query || scope !== "rooms"
              ? candidates.slice(0, 60).map((e) => (
                  <button
                    key={e.id}
                    className={`ex-element-row${selected === e.id ? " active" : ""}`}
                    onClick={() => {
                      setSelected(e.id);
                      if (e.origin === "drawing") setShowDrawingGeometry(true);
                      if (e.sheetId !== sid && !enabled.has(e.sheetId)) {
                        if (enabled.size < 4)
                          setEnabled((old) => new Set([...old, e.sheetId]));
                        else
                          setLayerError(
                            "Turn off a source layer before showing this member.",
                          );
                      }
                    }}
                  >
                    <span>{e.name}</span>
                    <small>
                      {e.origin === "drawing" ? "No accepted takeoff" : quantityPending(e) ? "Quantity uncalibrated" : `${num(e.quantity)} ${e.unit}`}
                      {!e.shape ? " · unplaced" : e.shape.type === "axis" ? " · plan axis" : e.shape.type === "locator" ? " · grid locator" : ""}
                    </small>
                  </button>
                ))
              : rooms.map((r, i) => (
                  <button
                    key={r.id}
                    className={roomId === r.id ? "active" : ""}
                    onClick={() => selectRoom(r.id)}
                  >
                    <span className="ex-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      {r.name}
                      <small>
                        {num(r.element.quantity)} {r.element.unit}
                      </small>
                    </span>
                    <span className="ex-arrow">↗</span>
                  </button>
                ))}
            {!rooms.length && (
              <p className="ex-muted">
                No room takeoffs on this sheet. Explore the measured elements
                using search.
              </p>
            )}
            {query && !candidates.length && (
              <p className="ex-muted">No matching records in this view.</p>
            )}
          </div>
          <div className="ex-trust">
            <i /> Original quantities preserved
            <span>Geometry is inferred and needs review.</span>
          </div>
        </aside>
        <main className="ex-stage" aria-label="Drawing exploration">
          <div className="ex-stage-head">
            <span className="ex-kicker">
              {sheet.name} /{" "}
              {mode === "sheet"
                ? "DRAWING"
                : mode === "assembly"
                  ? "ASSEMBLY"
                  : mode === "room"
                    ? "ROOM VIEW"
                    : "SPATIAL VIEW"}
            </span>
            <span className="ex-coordinate">
              {frame.residual < 0.001
                ? "Aligned to takeoff"
                : "Alignment checked"}{" "}
              · {sheet.scaleLabel || "Calibrated scale"}
            </span>
          </div>
          {page ? (
            <ExploreScene
              model={coordinatedModel}
              structureOnly={structureOnly}
              visibleSheets={visibleSheets}
              overlays={overlays}
              showBase={showBase}
              showDrawingGeometry={showDrawingGeometry}
              showAllowances={showAllowances}
              showFootprints={showFootprints}
              resetView={resetView}
              showGrids={showGrids}
              grids={grids}
              pins={showUnplaced ? pins : []}
              sheet={sheet}
              frame={frame}
              page={page}
              mode={mode}
              room={room}
              selected={selected}
              focus={focus}
              onSelect={(id) => {
                setSelected(id);
                if (rooms.some((r) => r.id === id)) setRoomId(id!);
              }}
              onSheetPoint={(p) => {
                const w = worldPoint(p, frame);
                const hit = rooms
                  .filter(
                    (r) =>
                      inside(w, r.ring) && !r.holes.some((h) => inside(w, h)),
                  )
                  .sort((a, b) => a.element.quantity - b.element.quantity)[0];
                if (hit) selectRoom(hit.id);
              }}
              onPose={(at, yaw) => setPose({ at, yaw })}
              onExitRoom={() => setMode("sheet")}
              reduced={reduced}
            />
          ) : (
            <div className="ex-loading" role={pageError ? "alert" : "status"}>
              {pageError || "Preparing the original drawing…"}
            </div>
          )}
          <button
            className="ex-fit"
            onClick={() => {
              setFocus(null);
              setResetView((n) => n + 1);
            }}
          >
            Fit drawing
          </button>
          <button
            className="ex-layers-toggle"
            aria-expanded={layerPanel}
            onClick={() => setLayerPanel((v) => !v)}
          >
            Layers & sources · {indexing ? "Reading geometry…" : enabled.size}
          </button>
          {layerPanel && (
            <section className="ex-layers" aria-label="Drawing layers">
              <header>
                <b>Coordinate this floor</b>
                <button
                  onClick={() => setLayerPanel(false)}
                  aria-label="Close layers"
                >
                  ×
                </button>
              </header>
              <label>
                <input
                  type="checkbox"
                  checked={showBase}
                  onChange={(e) => setShowBase(e.target.checked)}
                />{" "}
                Original floor plan
              </label>
              <label>
                <input type="checkbox" checked={showUnplaced} onChange={e => setShowUnplaced(e.target.checked)} />{" "}
                Unplaced count markers · source positions only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showGrids}
                  onChange={(e) => setShowGrids(e.target.checked)}
                />{" "}
                Drawing grids · inferred labels
              </label>
              <label>
                <input type="checkbox" checked={showFootprints} onChange={e => setShowFootprints(e.target.checked)} />{" "}
                Takeoff footprints · drawing view
              </label>
              {drawingGeometry.length > 0 && <label>
                <input type="checkbox" checked={showDrawingGeometry} onChange={e => setShowDrawingGeometry(e.target.checked)} />{" "}
                Drawing-derived geometry · no accepted takeoff
              </label>}
              <label>
                <input type="checkbox" checked={showAllowances} onChange={e => setShowAllowances(e.target.checked)} />{" "}
                Guessed shell &amp; slab · translucent context only
              </label>
              <p>
                Amber tags are measured counts, not physical members. Overlay
                alignment is inferred; check the original before relying on it.
              </p>
              <label>
                Overlay opacity{" "}
                <input
                  type="range"
                  min=".15"
                  max="1"
                  step=".05"
                  value={opacity}
                  onChange={(e) => setOpacity(+e.target.value)}
                />
              </label>
              {disciplines.map((d) => {
                const ls = available.filter((l) => l.discipline === d);
                return (
                  <details key={d} open={ls.length > 0}>
                    <summary>
                      {d} <small>{ls.length} sheets</small>
                    </summary>
                    {ls.length ? (
                      ls.map((l) => (
                        <div className="ex-layer-row" key={l.sheet.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={enabled.has(l.sheet.id)}
                              disabled={!l.frame}
                              onChange={() => toggleLayer(l.sheet.id)}
                            />
                            <b>{l.sheet.name}</b> {l.sheet.title}
                          </label>
                          <small>
                            {l.reason} ·{" "}
                            {
                              l.elements.filter(
                                (e) => {
                                  const shape = structuralModel.elements.find(v => v.id === e.id)?.shape;
                                  return shape && shape.type !== "axis" && shape.type !== "locator";
                                },
                              ).length
                            }
                            /{l.elements.length} physical shapes
                          </small>
                          {revisedLayers[l.sheet.id] && <small>Revised drawing · page {revisedLayers[l.sheet.id].page}. Takeoffs retain their original issue.</small>}
                          <button onClick={() => setSourceView(revisedLayers[l.sheet.id] ?? l.sheet)}>
                            {revisedLayers[l.sheet.id] ? "Open revised drawing ↗" : "Open original ↗"}
                          </button>
                          <button
                            disabled={!l.sheet.metersPerPoint}
                            onClick={() => setAligning(l.sheet)}
                          >
                            Align to this floor
                          </button>
                          {manual[`${sid}:${l.sheet.id}`] && (
                            <button
                              onClick={() => {
                                const next = { ...manual };
                                delete next[`${sid}:${l.sheet.id}`];
                                setManual(next);
                                try {
                                  localStorage.setItem(
                                    alignmentKey,
                                    JSON.stringify(next),
                                  );
                                } catch {}
                                setEnabled((old) => {
                                  const n = new Set(old);
                                  n.delete(l.sheet.id);
                                  return n;
                                });
                              }}
                            >
                              Reset alignment
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p>
                        No drawing assigned to this floor. Use “All project
                        drawings” below to open and align a source.
                      </p>
                    )}
                  </details>
                );
              })}
              {layerError && <p role="alert">{layerError}</p>}
              <details>
                <summary>All project drawings · {layers.length}</summary>
                <input
                  className="ex-search"
                  aria-label="Search all source drawings"
                  placeholder="Sheet number or title…"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                />
                <p>
                  Sections, elevations and unassigned drawings remain source
                  evidence. They are not flattened onto a floor without
                  alignment.
                </p>
                {layers
                  .filter((l) =>
                    `${l.sheet.name} ${l.sheet.title ?? ""}`
                      .toLowerCase()
                      .includes(libraryQuery.toLowerCase()),
                  )
                  .map((l) => (
                    <div className="ex-layer-row" key={l.sheet.id}>
                      <button onClick={() => setSourceView(l.sheet)}>
                        {l.sheet.name} · {l.sheet.title || "Untitled drawing"} ↗
                      </button>
                      <small>
                        {l.elements.length} extracted elements ·{" "}
                        {l.level || "floor not assigned"}
                      </small>
                      <button
                        disabled={!l.sheet.metersPerPoint}
                        onClick={() => setAligning(l.sheet)}
                      >
                        Align to this floor
                      </button>
                    </div>
                  ))}
              </details>
            </section>
          )}
          <nav className="ex-modes" aria-label="Explore view">
            <button
              aria-pressed={mode === "sheet"}
              onClick={() => {
                setMode("sheet");
                setFocus(null);
              }}
            >
              01 <span>Drawing</span>
            </button>
            <button
              aria-pressed={mode === "lift"}
              onClick={() => setMode("lift")}
            >
              02 <span>Lift into 3D</span>
            </button>
            <button
              aria-pressed={mode === "assembly"}
              onClick={() => setMode("assembly")}
            >
              03 <span>Assembly</span>
            </button>
            <button
              aria-pressed={mode === "room"}
              disabled={!room}
              title={
                room
                  ? "Enter selected measured room"
                  : "Select a measured room first"
              }
              onClick={() => {
                setMode("room");
                setFocus(null);
              }}
            >
              04 <span>Enter room</span>
            </button>
          </nav>
          {mode === "room" && room && (
            <div className="ex-room-caption">
              <span className="ex-kicker">INSIDE THE TAKEOFF</span>
              <h2>{room.name}</h2>
              <p>W A S D / arrows move · Q / E or drag to look · Esc returns</p>
              <small>
                Movement limited to this room · height: {room.heightBasis}
              </small>
            </div>
          )}
          <div className="ex-map">
            <div>
              <span>LOCATION / {sheet.name}</span>
              <span>{mode === "room" ? "● INSIDE" : "PLAN"}</span>
            </div>
            <svg
              role="img"
              aria-label="Floor mini-map with selected room and camera position"
              viewBox={mapBounds.join(" ")}
            >
              {rooms.map((r) => (
                <polygon
                  key={r.id}
                  points={svgPoints(r.ring)}
                  className={r.id === roomId ? "selected" : ""}
                />
              ))}
              {room && <circle cx={room.at[0]} cy={room.at[1]} r=".25" />}
              {mode === "room" && pose && (
                <g
                  transform={`translate(${pose.at[0]} ${pose.at[1]}) rotate(${(-pose.yaw * 180) / Math.PI})`}
                >
                  <path d="M 0 0 L -1 2 L 1 2 Z" />
                  <circle r=".2" />
                </g>
              )}
            </svg>
            <p>{room ? room.name : "Select a measured space"}</p>
          </div>
          <div className="ex-stage-foot">
            <span>{showAllowances ? "GUESSED SHELL VISIBLE · NOT DRAWING GEOMETRY" : mode === "sheet" ? (showFootprints ? "TEAL = MODEL FOOTPRINTS · AMBER = DRAWING-ONLY / UNRESOLVED" : "ORIGINAL DRAWING · TAKEOFF FOOTPRINTS HIDDEN") : "MEASURED FOOTPRINTS · INFERRED HEIGHTS · SHELL HIDDEN"}</span>
            <label>
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />{" "}
              Reduce motion
            </label>
          </div>
        </main>
        <aside className="ex-right" aria-label="Takeoff evidence">
          <p className="ex-kicker">The work behind the view</p>
          <h2>{element ? "Selected scope" : "Select something real."}</h2>
          {element ? (
            <>
              <p className="ex-element-title">{element.name}</p>
              <div className="ex-quantity">
                <strong>{element.origin === "drawing" ? "No takeoff" : quantityPending(element) ? "Uncalibrated" : num(element.quantity)}</strong>
                <span>{element.origin === "drawing" || quantityPending(element) ? "" : element.unit}</span>
                <small>
                  {element.origin === "drawing" ? "Drawing-derived geometry. No accepted quantity; excluded from estimate and schedule." : quantityPending(element) ? "Saved quantity is unresolved. Drawing-derived span is shown separately below." : element.origin === "takeoff"
                    ? "Original takeoff quantity"
                    : "Derived building allowance"}
                </small>
              </div>
              <dl className="ex-facts">
                <div>
                  <dt>Geometry</dt>
                  <dd>{element.shape?.type === "axis" ? (element.origin === "drawing" ? "Plan outline only · elevation unverified" : "Plan axis · section and height unverified") : element.shape?.type === "locator" ? "Grid locator · not a physical member" : element.shape ? element.placement : "Unplaced"}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {sourceSheet?.name ??
                      element.sources[0]?.label ??
                      "Unknown"}
                  </dd>
                </div>
                {revisionEvidence.length > 0 && (
                  <div>
                    <dt>Revision evidence</dt>
                    <dd>{revisionEvidence.join("; ")}</dd>
                  </div>
                )}
                {vars && t?.kind === "area" && (
                  <>
                    <div>
                      <dt>Net area</dt>
                      <dd>
                        {num(vars.A)} {areaUnit}
                      </dd>
                    </div>
                    <div>
                      <dt>Perimeter</dt>
                      <dd>
                        {num(vars.P)} {lengthUnit}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>{element.origin === "drawing" ? "Source discipline" : "Takeoff trade"}</dt>
                  <dd>{element.division || element.trade}</dd>
                </div>
              </dl>
              {element.issues.filter(issue => /revision|supersed|discrepancy|^Roof framing detail:|^Roof cantilever elevation unresolved:/i.test(issue)).map((issue, index) => (
                <p className="ex-revision-note" key={index}>{issue}</p>
              ))}
              {element?.trade === "structure" && (
                <section
                  className="ex-structural-proof"
                  aria-label="Structural geometry evidence"
                >
                  <h3>{element.origin === "drawing" && selectedShape?.type === "axis" ? "DRAWING COVERAGE" : "STRUCTURAL GEOMETRY"}</h3>
                  {(selectedShape?.type === "run" || selectedShape?.type === "point") && (
                    (["sheet", "lift"] as const).map(view => <button
                      key={view}
                      onClick={() => {
                        if (selectedShape.type === "point") setFocus(selectedShape.at);
                        else {
                          const points = selectedShape.points;
                          setFocus([
                            (points[0][0] + points.at(-1)![0]) / 2,
                            (points[0][1] + points.at(-1)![1]) / 2,
                          ]);
                        }
                        setStructureOnly(true);
                        setMode(view);
                        if (view === "sheet") setShowFootprints(true);
                      }}
                    >
                      {view === "sheet" ? "Locate member on drawing" : "Focus member in 3D"}
                    </button>)
                  )}
                  {selectedShape?.type === "run" && (
                    <dl>
                      <dt>Drawn span</dt>
                      <dd>{num(memberSpan!)} m</dd>
                      <dt>Width × vertical depth</dt>
                      <dd>
                        {num(selectedShape.thickness * 1000)} ×{" "}
                        {num(selectedShape.height * 1000)} mm
                      </dd>
                      <dt>Bottom datum</dt>
                      <dd>{selectedShape.bottomPlane ? selectedShape.points.map(p => (selectedShape.bottomPlane![0]*p[0]+selectedShape.bottomPlane![1]*p[1]+selectedShape.bottomPlane![2]).toFixed(3)).filter((v,i,a)=>a.indexOf(v)===i).join(" → ") : selectedShape.z0.toFixed(3)} m</dd>
                      <dt>Top datum</dt>
                      <dd>{selectedShape.topPlane ? selectedShape.points.map(p => (selectedShape.topPlane![0]*p[0]+selectedShape.topPlane![1]*p[1]+selectedShape.topPlane![2]).toFixed(3)).filter((v,i,a)=>a.indexOf(v)===i).join(" → ") : (selectedShape.z0+selectedShape.height).toFixed(3)} m</dd>
                    </dl>
                  )}
                  {selectedShape?.type === "point" && (
                    <dl>
                      <dt>Section width × depth</dt>
                      <dd>{num(selectedShape.size[0] * 1000)} × {num(selectedShape.size[1] * 1000)} mm</dd>
                      <dt>Drawn height</dt>
                      <dd>{selectedShape.size[2].toFixed(3)} m</dd>
                      <dt>Bottom datum</dt>
                      <dd>{selectedShape.z.toFixed(3)} m</dd>
                      <dt>Top datum</dt>
                      <dd>{(selectedShape.z + selectedShape.size[2]).toFixed(3)} m</dd>
                    </dl>
                  )}
                  {structuralReviews?.[element.id]?.fingerprint ===
                    structuralFingerprint(element, project) && (
                    <p>
                      Reviewed locally · {structuralReviews[element.id].note}
                    </p>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={structureOnly}
                      onChange={(e) => {
                        setStructureOnly(e.target.checked);
                        setMode("lift");
                      }}
                    />{" "}
                    Isolate structural members
                  </label>
                  <p>
                    {element.origin === "drawing" ? "Drawing-derived geometry · not accepted into takeoff" : element.shape?.type === "axis" ? "Measured span only — framing elevation and section still need evidence"
                      : element.shape?.type === "locator" ? "Inferred grid location only — physical dimensions still need evidence"
                      : element.shape
                      ? "Connected to measured takeoff"
                      : "Placement needs review"}
                  </p>
                  {recoveredStructure[element.id]?.section && (
                    <p>
                      <b>Schedule member size</b>
                      <br />
                      {recoveredStructure[element.id].section!.description}
                      <br />
                      Posts:{" "}
                      {recoveredStructure[element.id].section!.posts ??
                        "See schedule"}
                    </p>
                  )}
                  {recoveredStructure[element.id]?.opening && (
                    <p>
                      Head linked to {recoveredStructure[element.id].opening} ·{" "}
                      {num(recoveredStructure[element.id].head!)} m datum
                    </p>
                  )}
                  <ul>
                    {(element.origin === "drawing" ? element.issues : element.issues.some(i=>i.startsWith("Physical ")) ? element.issues.filter(i=>i.startsWith("Physical ")) : recoveredStructure[element.id]?.issues ?? []).map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                  {element.sources
                    .filter((s) => s.kind === "sheet")
                    .map((ref, i) => (
                      <button
                        key={i}
                        title={ref.quote}
                        onClick={() => {
                          const sheet = project.sheets.find((s) => s.id === ref.id);
                          setSourceView(sheet ? { ...sheet, evidenceBox: ref.box } : null);
                        }}
                      >
                        {ref.label} · {ref.quote?.split(":")[0]} ↗
                      </button>
                    ))}
                  {element.origin !== "drawing" && <button
                    disabled={!memberFrames[element.id]}
                    onClick={() => setEditingStructural(element)}
                  >
                    Review / connect geometry
                  </button>}
                  {element.origin !== "drawing" && !memberFrames[element.id] && (
                    <p>Align this source to the floor first.</p>
                  )}
                  {structuralReviews?.[element.id] && (
                    <button
                      onClick={() => {
                        const next = { ...structuralReviews };
                        delete next[element.id];
                        setStructuralReviews(next);
                        try {
                          localStorage.setItem(
                            structuralKey,
                            JSON.stringify(next),
                          );
                        } catch {
                          setLayerError("Review reset for this session only.");
                        }
                      }}
                    >
                      Reset geometry review
                    </button>
                  )}
                </section>
              )}

              {crop && sheetUrl && (
                <div className="ex-source">
                  <svg
                    viewBox={crop.join(" ")}
                    role="img"
                    aria-label={`Original ${sheet.name} drawing at selected takeoff`}
                  >
                    <image
                      href={sheetUrl}
                      width={sheet.width}
                      height={sheet.height}
                    />
                    {m && m.sheetId === sheet.id && (
                      <polygon
                        points={svgPoints(m.points)}
                        fill="#bd703824"
                        stroke="#b36534"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                  <button onClick={viewSource}>
                    Locate on original drawing <span>↗</span>
                  </button>
                </div>
              )}
              {t && t.items.length > 0 && (
                <section className="ex-details">
                  <h3>Assembly / formulas</h3>
                  {t.items.map((item, i) => (
                    <div key={i}>
                      <b>{item.name}</b>
                      <code>{item.formula}</code>
                    </div>
                  ))}
                </section>
              )}
              {m?.finishes && (
                <section className="ex-details">
                  <h3>Room finishes</h3>
                  {Object.entries(m.finishes).map(([role, id]) => (
                    <div key={role}>
                      <b>{role}</b>
                      <span>
                        {project.types.find((t) => t.id === id)?.name ??
                          "Unlinked"}
                      </span>
                    </div>
                  ))}
                </section>
              )}
              <section className="ex-details">
                <h3>Drawing sources</h3>
                {element.sources
                  .filter((s) => s.kind === "sheet" || (s.kind === "spec" && !s.section))
                  .map((s, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        const sh = s.kind === "sheet"
                          ? project.sheets.find((x) => x.id === s.id)
                          : { id: `spec:${s.id}:${s.page}`, docId: s.id,
                              page: s.page, name: s.label,
                              title: "Addendum drawing evidence", width: 0, height: 0 } as Sheet;
                        if (sh) setSourceView({ ...sh, evidenceBox: s.box });
                      }}
                      title={s.quote}
                    >
                      {s.label} · page {s.page} ↗
                    </button>
                  ))}
                <h3>Specification links</h3>
                {element.specs.length ? (
                  element.specs.map((s) => (
                    <div key={s.key}>
                      <b>
                        {project.specs
                          ?.flatMap((s) => s.book?.sections ?? [])
                          .find((sec) => sec.key === s.key)?.title ?? s.key}
                      </b>
                      <span>{s.basis} link</span>
                      {element.sources
                        .filter(
                          (ref) => ref.kind === "spec" && ref.section === s.key,
                        )
                        .map((ref, i) => (
                          <button
                            key={i}
                            onClick={() =>
                              setSourceView({
                                id: ref.id,
                                docId: ref.id,
                                page: ref.page,
                                name: ref.label,
                                title: "Specification source",
                                evidenceBox: ref.box,
                                metersPerPoint: null, scaleLabel: "", scaleSource: null, scaleHints: [],
                                width: 0,
                                height: 0,
                              })
                            }
                          >
                            Open spec page {ref.page} ↗
                          </button>
                        ))}
                    </div>
                  ))
                ) : (
                  <p>{element.origin === "drawing" ? "No specification section linked to this drawing geometry." : "No specification linked to this takeoff."}</p>
                )}
              </section>
              {element.issues.length > 0 && (
                <details className="ex-issues">
                  <summary>
                    {element.issues.length} geometry review note
                    {element.issues.length === 1 ? "" : "s"}
                  </summary>
                  {element.issues.map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </details>
              )}
            </>
          ) : (
            <div className="ex-empty-selection">
              <span>↖</span>
              <p>
                Choose a room or click a model element to inspect the measured
                quantity and its drawing evidence.
              </p>
              <ul>
                <li>Measured areas & lengths</li>
                <li>Assembly formulas & finishes</li>
                <li>Original drawing references</li>
              </ul>
            </div>
          )}
          <div className="ex-prototype">
            EXPLORE / PROTOTYPE 01
            <br />
            <span>Read-only. No takeoff edits or fabricated quantities.</span>
          </div>
        </aside>
      </div>
      {aligning && page && (
        <AlignmentEditor
          base={sheet}
          basePage={page}
          baseFrame={frame}
          source={aligning}
          renderPage={renderPage}
          onClose={() => setAligning(null)}
          onSave={(f) => {
            const next = {
              ...manual,
              [`${sid}:${aligning.id}`]: { baseId: sid, frame: f },
            };
            setManual(next);
            try {
              localStorage.setItem(alignmentKey, JSON.stringify(next));
            } catch {
              setLayerError(
                "Alignment applies for this session; browser storage unavailable.",
              );
            }
            if (enabled.size < 4)
              setEnabled((old) => new Set([...old, aligning.id]));
            else
              setLayerError(
                "Alignment saved. Turn off a layer before enabling this drawing.",
              );
            setAligning(null);
          }}
        />
      )}
      {editingStructural && editingFrame && (
        <StructuralEditor
          element={editingStructural}
          existing={editingReview}
          evidence={recoveredStructure[editingStructural.id]}
          project={project}
          sheet={project.sheets.find(
            (s) => s.id === editingStructural.sheetId,
          )!}
          frame={editingFrame}
          renderPage={renderPage}
          onClose={() => setEditingStructural(null)}
          onSave={(placement) => {
            const next = {
              ...structuralReviews,
              [editingStructural.id]: {...placement, reviewFrame: {...editingFrame}, reviewBaseId: editingReview?.reviewBaseId ?? sid},
            };
            setStructuralReviews(next);
            try {
              localStorage.setItem(structuralKey, JSON.stringify(next));
            } catch {
              setLayerError(
                "Geometry is applied for this session; local storage is unavailable.",
              );
            }
            setEditingStructural(null);
          }}
        />
      )}
      {sourceView && (
        <SourceViewer
          sheet={sourceView}
          box={sourceView.evidenceBox}
          renderDetail={renderDetail}
          renderPage={renderPage}
          onClose={() => setSourceView(null)}
          onOpenTakeoff={project.sheets.some(s => s.id === sourceView.id) ? onOpenTakeoff : undefined}
        />
      )}
    </div>
  );
}
