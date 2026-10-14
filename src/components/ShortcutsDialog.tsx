import { useEffect } from 'react';

const SHORTCUTS: [string, string][] = [
  ['V', 'Select'],
  ['B, or Shift-drag in Select', 'Box select: drag over several takeoffs, then Delete removes them all'],
  ['M', 'Measure with the chosen type'],
  ['R', 'Fill a room'],
  ['C', 'Cut a hole out of the selected area'],
  ['T', 'Trace line: click a drawn line to measure its whole run'],
  ['S', 'Count symbols: drag a box around one symbol to count every copy'],
  ['Return or double-click', 'Finish a line or area'],
  ['Shift', 'Keep lines straight while measuring; join spaces when filling'],
  ['Backspace', 'Remove the last point while measuring'],
  ['Delete', 'Delete the selected takeoff'],
  ['Option-click a point', 'Remove that point from the selected takeoff'],
  ['Esc', 'Cancel, or deselect'],
  ['⌘Z', 'Undo'],
  ['⇧⌘Z', 'Redo'],
  ['⌘F', 'Search sheets and drawing text'],
  ['F', 'Fit the sheet in the window'],
  ['[ and ]', 'Previous and next sheet'],
  ['Mouse wheel', 'Zoom (Windows mouse)'],
  ['Swipe the mouse or trackpad', 'Move around the sheet (Magic Mouse); ⌘ + swipe or pinch to zoom'],
  ['Drag, middle-drag or Space-drag', 'Move around the sheet, in any tool (a click still places a point)'],
  ['Point near the edge', 'While drawing a line or area, the sheet scrolls that way'],
  ['Option-click an eye', 'Show only that takeoff type (or group); again shows all'],
  ['?', 'Show these shortcuts'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Keyboard shortcuts</h3>
          <button onClick={onClose} autoFocus>
            Done
          </button>
        </div>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
