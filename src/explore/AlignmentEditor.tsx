import { useDialogKeys } from "./useDialogKeys";
import { useEffect, useMemo, useState } from "react";
import type { Pt, Sheet } from "../model";
import { alignControlPoints } from "./layers";
import { worldPoint, type SheetFrame } from "./spatial";
export function AlignmentEditor({
  base,
  basePage,
  baseFrame,
  source,
  renderPage,
  onSave,
  onClose,
}: {
  base: Sheet;
  basePage: HTMLCanvasElement;
  baseFrame: SheetFrame;
  source: Sheet;
  renderPage: (s: Sheet) => Promise<HTMLCanvasElement>;
  onSave: (f: SheetFrame) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [pairs, setPairs] = useState<[Pt[], Pt[]]>([[], []]),
    [zoom, setZoom] = useState(2);
  const baseUrl = useMemo(() => basePage.toDataURL(), [basePage]);
  useEffect(() => {
    let gone = false;
    renderPage(source)
      .then((c) => {
        if (!gone) setUrl(c.toDataURL());
      })
      .catch((e) => {
        if (!gone) setError(String(e));
      });
    return () => {
      gone = true;
    };
  }, [source, renderPage]);
  const dialog = useDialogKeys(onClose);
  const fit = alignControlPoints(
    pairs[1],
    pairs[0].map((p) => worldPoint(p, baseFrame)),
    source.metersPerPoint,
  );
  const click = (side: 0 | 1, e: React.MouseEvent<HTMLImageElement>) => {
    if (pairs[side].length >= 3) return;
    const r = e.currentTarget.getBoundingClientRect(),
      sheet = side === 0 ? base : source;
    const p: Pt = [
      ((e.clientX - r.left) / r.width) * sheet.width,
      ((e.clientY - r.top) / r.height) * sheet.height,
    ];
    setPairs((old) => {
      const next: [Pt[], Pt[]] = [[...old[0]], [...old[1]]];
      next[side].push(p);
      return next;
    });
  };
  return (
    <div
      className="ex-source-dialog"
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Align drawing to floor"
    >
      <header>
        <div>
          <b>
            Align {source.name} to {base.name}
          </b>
          <span>
            Pick the same three grid intersections on each drawing, in the same
            order. Use widely separated points within one plan viewport.
          </span>
        </div>
        <button onClick={() => setPairs([[], []])}>Reset points</button>
        <button onClick={onClose}>Cancel</button>
      </header>
      <div className="ex-align-tools">
        <label>
          Drawing zoom{" "}
          <input
            type="range"
            min="1"
            max="5"
            step=".5"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <span>
          {pairs[0].length}/3 floor points · {pairs[1].length}/3 overlay points
        </span>
        <button disabled={!fit} onClick={() => fit && onSave(fit)}>
          Use reviewed alignment
        </button>
        <span>
          {fit
            ? `Maximum residual ${(fit.residual * 1000).toFixed(0)} mm`
            : pairs.every((p) => p.length === 3)
              ? "Mismatch: check point order, scale and selected plan. Maximum residual is 150 mm; scale must match within 2%."
              : "Pick corresponding points, not sheet corners."}
        </span>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="ex-align-panes">
          {([0, 1] as const).map((side) => (
            <section key={side}>
              <b>{side === 0 ? base.name : source.name}</b>
              <div className="ex-align-scroll">
                <div style={{ position: "relative", width: `${zoom * 100}%` }}>
                  {(side === 0 ? baseUrl : url) ? (
                    <img
                      draggable={false}
                      src={side === 0 ? baseUrl : url}
                      onClick={(e) => click(side, e)}
                      style={{
                        width: "100%",
                        display: "block",
                        cursor: "crosshair",
                      }}
                      alt={`Pick points on ${side === 0 ? base.name : source.name}`}
                    />
                  ) : (
                    <p>Loading original drawing…</p>
                  )}
                  {pairs[side].map((p, i) => (
                    <span
                      className="ex-control-point"
                      key={i}
                      style={{
                        left: `${(p[0] / (side === 0 ? base.width : source.width)) * 100}%`,
                        top: `${(p[1] / (side === 0 ? base.height : source.height)) * 100}%`,
                      }}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
