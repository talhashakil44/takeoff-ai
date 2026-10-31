import { sourceRegion, type SourceBox } from "./sourceRegion";
import { lazy, Suspense, useEffect, useState } from "react";
import { loadCurrentProject, loadPdf } from "../storage";
import { measurementVars, primaryOf } from "../quantities";
import { loadBuild } from "../build/client";
import { openPdf, type PDFDocumentProxy } from "../pdf";
import { segmentsOf } from "../fill/sheetWalls";
import { loadDrawingSources, markPolylineArcs } from "../build/sources";
import { titleBlockWords } from "../build/extract";
import { pageTexts } from "../pageText";
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
    [stamp, setStamp] = useState(""),
    [progress, setProgress] = useState("");
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
    setProgress("");
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
      const getPdf = async (s: Pick<Sheet, "docId">) => {
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
      const renderDetail = async (s: Sheet, box: SourceBox) => {
        const page = await (await getPdf(s)).getPage(s.page);
        const original = page.getViewport({ scale: 1 });
        const region = sourceRegion(box, original.width, original.height);
        if (!region) throw new Error("The evidence region is outside this original page.");
        const viewport = page.getViewport({ scale: region.scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(region.width * region.scale);
        canvas.height = Math.ceil(region.height * region.scale);
        await page.render({ canvas, viewport,
          transform: [1, 0, 0, 1, -region.left * region.scale, -region.top * region.scale],
        }).promise;
        return canvas;
      };
      if (!cancelled) {
        setStamp(saved.savedAt);
        // Use the same source selection/cache as Build. Do not display saved
        // structural solids until the current source evidence is available.
        const revisionReaders = {
          pages: async (docId: string) => {
            if (!cancelled) setProgress(`Checking revised drawings in ${project.specs?.find(s => s.id === docId)?.name ?? "addendum"}…`);
            return (await getPdf({ docId })).numPages;
          },
          size: async (docId: string, pageNumber: number) => {
            const page = await (await getPdf({ docId })).getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            return { width: viewport.width, height: viewport.height };
          },
          text: async (docId: string, pageNumber: number) =>
            pageTexts(await (await getPdf({ docId })).getPage(pageNumber)),
          lines: async (docId: string, pageNumber: number) =>
            segmentsOf(await (await getPdf({ docId })).getPage(pageNumber)),
        };
        const source = await loadDrawingSources({
          project,
          revisions: revisionReaders,
          sheetText: async id => {
            const sheet=project.sheets.find(s=>s.id===id)!;
            return pageTexts(await (await getPdf(sheet)).getPage(sheet.page));
          },
          sheetLines: async id => {
            const sheet=project.sheets.find(s=>s.id===id)!;
            return segmentsOf(await (await getPdf(sheet)).getPage(sheet.page));
          },
          titleWords:titleBlockWords,
          cancelled:()=>cancelled,
          progress:(done,total)=>{if(!cancelled)setProgress(`Reading drawing evidence ${done} of ${total}…`);},
        });
        const drawingTexts=source.texts, drawingLines=source.lines;
        // Architectural grid leaders constrain offset canopy grids even when
        // the floor has no door counts and so was not a shared linework plan.
        for(const sheet of project.sheets.filter(s=>!s.superseded &&
          ((/^A/.test(s.name)&&/FLOOR PLAN/i.test(s.title??'')&&!/CEILING|ENLARG|FIRE/i.test(s.title??''))||/WINDOW SCHEDULE/i.test(s.title??'')))) {
          if(cancelled)break;
          if(drawingLines[sheet.id]?.length)continue;
          try {drawingLines[sheet.id]=markPolylineArcs(await segmentsOf(await (await getPdf(sheet)).getPage(sheet.page)));}
          catch { /* Missing source geometry stays unresolved. */ }
        }
        if (!cancelled)
          setData({
            project,
            model: saved.output.model,
            renderPage,
            renderDetail,
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
            title="Saved takeoff model with geometry connected to the current local drawing evidence. Rebuild in Build It after changing takeoffs."
          >
            Takeoff snapshot · {new Date(stamp).toLocaleString()}
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
              {error || progress ||
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
