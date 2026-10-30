import { lazy, Suspense, useEffect, useState } from "react";
import { loadCurrentProject, loadPdf } from "../storage";
import { measurementVars, primaryOf } from "../quantities";
import { loadBuild } from "../build/client";
import { openPdf, type PDFDocumentProxy } from "../pdf";
import { segmentsOf } from "../fill/sheetWalls";
import type { DrawingLines } from "../build/roof";
import { pageTexts } from "../pageText";
import type { DrawingTexts } from "../build/building";
import type { Project, Sheet } from "../model";
import type { ExploreWorkspaceProps } from "./ExploreWorkspace";
import "./explore.css";
const Workspace = lazy(() =>
  import("./ExploreWorkspace").then((m) => ({ default: m.ExploreWorkspace })),
);
/** Additive launcher. No edits to the shared viewer/model or writes to project storage. */
export function ExploreHost({
  liveProject,
  onOpenTakeoff,
  onBuild,
}: {
  liveProject?: Project;
  onOpenTakeoff?: (sheet: Sheet) => void;
  onBuild?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<Omit<ExploreWorkspaceProps, "onClose"> | null>(
      null,
    ),
    [error, setError] = useState(""),
    [stamp, setStamp] = useState("");
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const changed = new Map<HTMLElement, boolean>();
    const isolate = () => {
      document.querySelectorAll<HTMLElement>(".app > *").forEach((node) => {
        if (node.matches(".ex-shell, .ex-snapshot")) return;
        if (!changed.has(node)) changed.set(node, node.inert);
        node.inert = true;
      });
    };
    isolate();
    const observer = new MutationObserver(isolate);
    const app = document.querySelector(".app");
    if (app) observer.observe(app, { childList: true });
    return () => {
      observer.disconnect();
      changed.forEach((value, node) => {
        node.inert = value;
      });
      previous?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const docs = new Map<string, Promise<PDFDocumentProxy>>();
    setData(null);
    setError("");
    (async () => {
      const project = liveProject ?? (await loadCurrentProject());
      if (!project?.id) throw new Error("Open a project in Takeoff AI first.");
      const saved = await loadBuild(project.id);
      if (!saved)
        throw new Error(
          "Open Build It and generate the building model first, then return to Explore Drawing.",
        );
      // Reject changed measured records rather than quietly showing stale quantities.
      const els = saved.output.model.elements.filter(
        (e) => e.origin === "takeoff",
      );
      if (
        els.length !== project.measurements.length ||
        project.measurements.some((m) => {
          const e = els.find((e) => e.measurementId === m.id),
            type = project.types.find((t) => t.id === m.typeId),
            sheet = project.sheets.find((s) => s.id === m.sheetId);
          if (
            !e ||
            !type ||
            !sheet ||
            e.typeId !== m.typeId ||
            e.typeName !== type.name
          )
            return true;
          const vars = measurementVars(m, type, sheet, project.units),
            quantity = vars ? primaryOf(type.kind, vars) : 0;
          if (Math.abs(e.quantity - quantity) > 1e-7) return true;
          const box = e.sources.find((s) => s.id === m.sheetId)?.box,
            actual = [
              Math.min(...m.points.map((p) => p[0])),
              Math.min(...m.points.map((p) => p[1])),
              Math.max(...m.points.map((p) => p[0])),
              Math.max(...m.points.map((p) => p[1])),
            ];
          return !box || box.some((v, i) => Math.abs(v - actual[i]) > 0.001);
        })
      )
        throw new Error(
          "The takeoff has changed since this model was built. Rebuild in Build It before exploring.",
        );
      const getPdf = async (s: Sheet) => {
        if (!docs.has(s.docId))
          docs.set(
            s.docId,
            (async () => {
              const bytes = await loadPdf(s.docId);
              if (!bytes)
                throw new Error(
                  "The original PDF is unavailable on this device.",
                );
              return openPdf(bytes);
            })(),
          );
        return await docs.get(s.docId)!;
      };
      const renderPage = async (s: Sheet) => {
        const pdf = await getPdf(s),
          page = await pdf.getPage(s.page),
          original = page.getViewport({ scale: 1 }),
          scale = Math.min(2, 3500 / Math.max(original.width, original.height)),
          viewport = page.getViewport({ scale }),
          canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        return canvas;
      };
      if (!cancelled) {
        setStamp(saved.savedAt);
        setData({
          project,
          model: saved.output.model,
          renderPage,
          indexing: true,
        });
        // Read local vector text once, progressively; no drawing upload or model mutation.
        const drawingTexts: DrawingTexts = {};
        const drawingLines: DrawingLines = {};
        for (const sheet of project.sheets) {
          if (cancelled) break;
          if (sheet.superseded) continue;
          try {
            const page = await (await getPdf(sheet)).getPage(sheet.page);
            drawingTexts[sheet.id] = await pageTexts(page);
            if (
              (/^S/.test(sheet.name) &&
                project.measurements.some((m) => m.sheetId === sheet.id)) ||
              /WINDOW ELEVATION|WINDOW SCHEDULE/i.test(sheet.title ?? "")
            ) {
              drawingLines[sheet.id] = await segmentsOf(page);
            }
          } catch {
            /* unavailable PDFs stay explicit sources */
          }
        }
        if (!cancelled)
          setData({
            project,
            model: saved.output.model,
            renderPage,
            drawingTexts,
            drawingLines,
            indexing: false,
          });
      }
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      for (const doc of docs.values())
        void doc.then((d) => d.destroy()).catch(() => {});
    };
  }, [open, liveProject]);
  if (!open)
    return (
      <button className="ex-launch" onClick={() => setOpen(true)}>
        ⌗ Explore drawing <span aria-hidden="true">↗</span>
      </button>
    );
  return (
    <Suspense
      fallback={
        <div className="ex-shell">
          <div className="ex-empty" role="status">
            Opening Explore Drawing…
          </div>
        </div>
      }
    >
      {data ? (
        <>
          <Workspace
            {...data}
            onClose={() => setOpen(false)}
            onOpenTakeoff={
              onOpenTakeoff
                ? (sheet) => {
                    setOpen(false);
                    onOpenTakeoff(sheet);
                  }
                : undefined
            }
          />
          <div
            className="ex-snapshot"
            title="Rebuild in Build It to refresh geometry. This is a saved model, not a live geometry calculation."
          >
            Model snapshot · {new Date(stamp).toLocaleString()}
          </div>
        </>
      ) : (
        <div className="ex-shell">
          <div className="ex-empty">
            <p className="ex-kicker">Explore Drawing</p>
            <h1>
              {error ? "A measured starting point." : "Opening your project…"}
            </h1>
            <p role={error ? "alert" : "status"}>
              {error ||
                "Reading the saved model and its original drawing references."}
            </p>
            <button onClick={() => setOpen(false)}>Back to takeoff</button>
            {error && onBuild && (
              <button
                onClick={() => {
                  setOpen(false);
                  onBuild();
                }}
              >
                Open Build It to refresh model
              </button>
            )}
          </div>
        </div>
      )}
    </Suspense>
  );
}
