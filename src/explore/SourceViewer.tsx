import { useDialogKeys } from "./useDialogKeys";
import { useEffect, useState } from "react";
import type { Sheet } from "../model";
export function SourceViewer({
  sheet,
  renderPage,
  onClose,
  onOpenTakeoff,
}: {
  sheet: Sheet;
  renderPage: (s: Sheet) => Promise<HTMLCanvasElement>;
  onClose: () => void;
  onOpenTakeoff?: (sheet: Sheet) => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1);
  useEffect(() => {
    let gone = false;
    setUrl("");
    setError("");
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
            {sheet.title} · page {sheet.page}
          </span>
        </div>
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
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
            src={url}
            alt={`${sheet.name} original document page ${sheet.page}`}
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
