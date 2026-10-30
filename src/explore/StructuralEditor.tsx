import { useEffect, useMemo, useState } from "react";
import type { Project, Sheet, Pt } from "../model";
import type { BuildElement, SourceRef } from "../build/types";
import type { SheetFrame } from "./spatial";
import {
  structuralFingerprint,
  reviewedShape,
  type StructuralEvidence,
  type StructuralPlacement,
} from "../build/structural";
import { useDialogKeys } from "./useDialogKeys";
export function StructuralEditor({
  element,
  evidence,
  existing,
  project,
  sheet,
  frame,
  renderPage,
  onClose,
  onSave,
}: {
  element: BuildElement;
  evidence?: StructuralEvidence;
  existing?: StructuralPlacement;
  project: Project;
  sheet: Sheet;
  frame: SheetFrame;
  renderPage: (s: Sheet) => Promise<HTMLCanvasElement>;
  onClose: () => void;
  onSave: (p: StructuralPlacement) => void;
}) {
  const dialog = useDialogKeys(onClose),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [kind, setKind] = useState<StructuralPlacement["kind"]>(
      existing?.kind ?? "run",
    ),
    [points, setPoints] = useState<Pt[]>(
      existing?.points ?? evidence?.span ?? [],
    ),
    [width, setWidth] = useState(
      existing
        ? String(existing.width)
        : evidence?.section
          ? String(evidence.section.width)
          : "",
    ),
    [depth, setDepth] = useState(
      existing
        ? String(existing.depth)
        : evidence?.section
          ? String(evidence.section.depth)
          : "",
    ),
    [bottom, setBottom] = useState(
      existing
        ? String(existing.bottom)
        : evidence?.head !== undefined
          ? String(evidence.head)
          : "",
    ),
    [note, setNote] = useState(existing?.note ?? ""),
    [zoom, setZoom] = useState(1),
    [sourceId, setSourceId] = useState(
      evidence?.sources.find((s) => s.id !== sheet.id)?.id ?? sheet.id,
    ),
    [sourceUrl, setSourceUrl] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const source = project.sheets.find((s) => s.id === sourceId) ?? sheet;
  useEffect(() => {
    let gone = false;
    renderPage(sheet)
      .then((c) => {
        if (!gone) setUrl(c.toDataURL());
      })
      .catch((e) => {
        if (!gone) setError(String(e));
      });
    return () => {
      gone = true;
    };
  }, [sheet, renderPage]);
  useEffect(() => {
    let gone = false;
    setSourceUrl("");
    renderPage(source)
      .then((c) => {
        if (!gone) setSourceUrl(c.toDataURL());
      })
      .catch((e) => {
        if (!gone) setError(String(e));
      });
    return () => {
      gone = true;
    };
  }, [source, renderPage]);
  const sources: SourceRef[] = useMemo(
    () => [
      ...(evidence?.sources ?? []),
      {
        kind: "sheet",
        id: source.id,
        page: source.page,
        label: source.name,
        quote: note,
      },
    ],
    [evidence, source, note],
  );
  const placement: StructuralPlacement = {
    sheetId: sheet.id,
    kind,
    points,
    width: Number(width),
    depth: Number(depth),
    bottom: Number(bottom),
    evidence: sources,
    note,
    fingerprint: structuralFingerprint(element, project),
  };
  const valid =
    width !== "" &&
    depth !== "" &&
    bottom !== "" &&
    confirmed &&
    !!reviewedShape(placement, frame);
  const pick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (
      (kind === "run" && points.length >= 2) ||
      (kind === "point" && points.length >= 1)
    )
      return;
    const r = e.currentTarget.getBoundingClientRect();
    setPoints((old) => [
      ...old,
      [
        ((e.clientX - r.left) / r.width) * sheet.width,
        ((e.clientY - r.top) / r.height) * sheet.height,
      ],
    ]);
  };
  return (
    <div
      className="ex-source-dialog ex-structural-editor"
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Review structural geometry"
    >
      <header>
        <div>
          <b>Connect structural geometry</b>
          <span>
            {element.name} · {element.quantity} {element.unit} retained
          </span>
        </div>
        <button onClick={onClose}>Cancel</button>
        <button disabled={!valid} onClick={() => valid && onSave(placement)}>
          Save reviewed geometry
        </button>
      </header>
      <div className="ex-structural-fields">
        <label>
          Geometry
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setPoints([]);
              setConfirmed(false);
            }}
          >
            <option value="run">Member / wall run</option>
            <option value="surface">Panel / slab boundary</option>
            <option value="point">Square post</option>
          </select>
        </label>
        <label>
          Width (m)
          <input
            type="number"
            min=".001"
            step=".001"
            value={width}
            onChange={(e) => {
              setWidth(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          {kind === "surface" ? "Thickness" : "Depth / height"} (m)
          <input
            type="number"
            min=".001"
            step=".001"
            value={depth}
            onChange={(e) => {
              setDepth(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          Bottom elevation (m)
          <input
            type="number"
            step=".001"
            value={bottom}
            onChange={(e) => {
              setBottom(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
        <label>
          Drawing zoom
          <input
            type="range"
            min="1"
            max="5"
            step=".5"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            setPoints([]);
            setConfirmed(false);
          }}
        >
          Reset points
        </button>
      </div>
      <p className="ex-structural-help">
        {kind === "run"
          ? "Pick both member endpoints"
          : kind === "surface"
            ? "Trace the full panel boundary in order"
            : "Pick the post centre"}{" "}
        on {sheet.name}. Coordinates use its calibrated scale and reviewed floor
        alignment. Elevation is relative to the model datum, not the sheet.{" "}
        {points.length} points.
      </p>
      <div className="ex-structural-fields">
        <label className="ex-evidence-note">
          Source and dimension explanation
          <input
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setConfirmed(false);
            }}
            placeholder="Detail / dimension / datum used; include bearing or rough-opening allowance"
          />
        </label>
        <label>
          Reference drawing
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setConfirmed(false);
            }}
          >
            {project.sheets
              .filter((s) => !s.superseded)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.title}
                </option>
              ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="ex-align-panes">
        <section>
          <b>{sheet.name} · place geometry</b>
          <div className="ex-align-scroll">
            <div style={{ position: "relative", width: `${zoom * 100}%` }}>
              {url ? (
                <>
                  <img
                    src={url}
                    alt={`Pick structural points on ${sheet.name}`}
                    onClick={(e) => {
                      setConfirmed(false);
                      pick(e);
                    }}
                    style={{
                      width: "100%",
                      display: "block",
                      cursor: "crosshair",
                    }}
                  />
                  <svg
                    viewBox={`0 0 ${sheet.width} ${sheet.height}`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      pointerEvents: "none",
                    }}
                  >
                    {points.length > 1 && (
                      <polyline
                        points={[
                          ...points,
                          ...(kind === "surface" ? [points[0]] : []),
                        ]
                          .map((p) => p.join(","))
                          .join(" ")}
                        fill={kind === "surface" ? "#cf792744" : "none"}
                        stroke="#a84d18"
                        strokeWidth="3"
                      />
                    )}
                    {points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p[0]}
                        cy={p[1]}
                        r="7"
                        fill="#a84d18"
                      />
                    ))}
                  </svg>
                </>
              ) : (
                <p>Loading original plan…</p>
              )}
            </div>
          </div>
        </section>
        <section>
          <b>{source.name} · dimension / elevation evidence</b>
          <div className="ex-align-scroll">
            {sourceUrl ? (
              <img
                src={sourceUrl}
                alt={`Structural reference ${source.name}`}
                style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              />
            ) : (
              <p>Loading reference…</p>
            )}
          </div>
        </section>
      </div>
      <label className="ex-structural-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I checked the endpoints, section and elevation against the cited
        sources. This changes reviewed model geometry only; takeoff quantities
        remain unchanged.
      </label>
    </div>
  );
}
