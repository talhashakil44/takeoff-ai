import type { SourceBox } from "./sourceRegion";
import { useDialogKeys } from "./useDialogKeys";
import { useEffect, useState } from "react";
import type { Sheet } from "../model";
export function SourceViewer({
  sheet,
  box,
  renderDetail,
  renderPage,
  onClose,
  onOpenTakeoff,
}: {
  sheet: Sheet;
  box?: SourceBox;
  renderDetail?: (sheet: Sheet, box: SourceBox) => Promise<HTMLCanvasElement>;
  renderPage: (s: Sheet) => Promise<HTMLCanvasElement>;
  onClose: () => void;
  onOpenTakeoff?: (sheet: Sheet) => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [ratio, setRatio] = useState(1),
    [zoom, setZoom] = useState(1),
    [detail, setDetail] = useState(!!box && !!renderDetail);
  useEffect(() => { setDetail(!!box && !!renderDetail); setZoom(1); }, [sheet, box, renderDetail]);
  useEffect(() => {
    let gone = false;
    setUrl("");
    setError("");
    (detail && box && renderDetail ? renderDetail(sheet, box) : renderPage(sheet))
      .then((c) => {
        if (!gone) { setRatio(c.width / c.height); setUrl(c.toDataURL()); }
      })
      .catch((e) => {
        if (!gone) setError(String(e));
      });
    return () => {
      gone = true;
    };
  }, [sheet, renderPage, renderDetail, box, detail]);
  const dialog = useDialogKeys(onClose);
  return (
    <div
      className="ex-source-dialog"
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={`Source ${sheet.name}`}
    >
      <header>
        <div>
          <b>{sheet.name}</b>
          <span>
            {sheet.title} · page {sheet.page}{detail ? " · evidence detail with context" : ""}
          </span>
        </div>
        {box && renderDetail && <button onClick={() => { setDetail(!detail); setZoom(1); }}>
          {detail ? "Show whole page" : "Focus evidence"}
        </button>}
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
          aria-label="Zoom source out"
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
          aria-label="Zoom source in"
        >
          +
        </button>
        {onOpenTakeoff && sheet.width > 0 && (
          <button onClick={() => onOpenTakeoff(sheet)}>
            Extract in takeoff ↗
          </button>
        )}
        <button autoFocus onClick={onClose}>
          Close source ×
        </button>
      </header>
      <div className="ex-source-scroll">
        {url ? (
          <img
            style={{ width: detail ? `${zoom * Math.min(window.innerWidth - 80, (window.innerHeight - 180) * ratio)}px` : `${zoom * 100}%`, maxWidth: "none" }}
            src={url}
            alt={`${sheet.name} original document page ${sheet.page}${detail ? " evidence detail" : ""}`}
          />
        ) : (
          <p role={error ? "alert" : "status"}>
            {error || "Loading original source…"}
          </p>
        )}
      </div>
    </div>
  );
}
