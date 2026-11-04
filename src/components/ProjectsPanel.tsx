import { useEffect, useState } from 'react';
import { listProjects, storageEstimate, type ProjectSummary } from '../storage';
import { Icon } from './Icons';

interface Props {
  currentId: string | undefined;
  persisted: boolean;
  /** Desktop app: the shared projects folder, e.g. "iCloud Drive › Takeoff AI". */
  folder?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** Copies the open project, drawings included, and opens the copy. */
  onDuplicate: () => void;
  onSaveFile: () => void;
  onOpenFile: () => void;
  onBackupAll: () => void;
  /** Opens sample project #1 or #2 (a finished 3D model and a tour). */
  onSample?: (n: 1 | 2) => void;
  /** Desktop app: opens a project from a shared or local folder. */
  onOpenFolder?: () => void;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

const size = (bytes: number) =>
  bytes > 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes > 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

/** Every project saved in this browser, with new, open, delete and project files. */
export function ProjectsPanel({ currentId, persisted, folder, onOpen, onNew, onDelete, onDuplicate, onSaveFile, onOpenFile, onBackupAll, onSample, onOpenFolder }: Props) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void listProjects().then((l) => setProjects([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
    void storageEstimate().then(setSpace);
  }, []);

  return (
    <div className="projects-panel">
      <div className="pop-head">
        <div className="pop-title">Projects</div>
        <div className="pop-sub">
          {folder ? `Saved on this computer and in ${folder}, for your other computer.` : `Saved in this browser on this computer${persisted ? ', kept until you delete them' : ''}.`}
        </div>
      </div>
      <ul className="project-list">
        {projects === null && <li className="muted project-empty">Loading…</li>}
        {projects?.length === 0 && <li className="muted project-empty">No saved projects yet.</li>}
        {projects?.map((p) => (
          <li key={p.id} className={p.id === currentId ? 'current' : ''}>
            <button className="project-row" onClick={() => onOpen(p.id)} disabled={p.id === currentId}>
              <span className="project-name-cell">
                <span className="project-title">{p.name || 'Untitled project'}</span>
                <span className="project-meta">
                  {when(p.updatedAt)} · {p.sheets} sheet{p.sheets === 1 ? '' : 's'} · {p.takeoffs} takeoff{p.takeoffs === 1 ? '' : 's'} ·{' '}
                  {p.units === 'metric' ? 'metric' : 'imperial'}
                </span>
              </span>
              {p.id === currentId ? (
                <span className="open-badge">
                  <Icon name="check" size={13} /> Current
                </span>
              ) : (
                <span className="open-hint">Open</span>
              )}
            </button>
            <button className="icon-button small danger" title="Delete project" aria-label={`Delete ${p.name}`} onClick={() => onDelete(p.id)}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="pop-section">
        <div className="button-row">
          <button className="on" onClick={onNew}>
            <Icon name="plus" size={14} /> New project
          </button>
        </div>
        <div className="button-row">
          <button onClick={onDuplicate} title="A copy of this project, with its drawings, to change separately (an alternate or option)">
            <Icon name="plus" size={14} /> Duplicate this project
          </button>
        </div>
        {onSample && (
          <div className="button-row">
            <button onClick={() => onSample(1)} title="A finished 3D model Claude built from a tender drawing set, with a short tour">
              Sample #1: ski lodge
            </button>
            <button onClick={() => onSample(2)} title="A finished 3D model Claude built from a tender drawing set, with a short tour">
              Sample #2: shop
            </button>
          </div>
        )}
        {onOpenFolder && (
          <div className="button-row">
            <button onClick={onOpenFolder} title="Open a project from a shared folder (OneDrive, Dropbox, Google Drive, a network drive) or anywhere on this computer">
              Open a project from a folder…
            </button>
          </div>
        )}
      </div>
      <div className="pop-section">
        <div className="pop-label">Project files</div>
        <div className="button-row">
          <button onClick={onSaveFile} title="Save this project, its history and drawings as one file">
            <Icon name="download" size={14} /> Save to file…
          </button>
          <button onClick={onOpenFile} title="Open a .takeoff file as a new project">
            <Icon name="upload" size={14} /> Open file…
          </button>
        </div>
        <p className="field-hint">A .takeoff file holds the whole project with its drawings: use it for backups or to move a takeoff to another computer.</p>
        <div className="button-row">
          <button onClick={onBackupAll} title="Every project, with its history and drawings, in one file">
            <Icon name="download" size={14} /> Back up all projects…
          </button>
        </div>
        <p className="field-hint">Open a backup with Open file… to restore every project in it.</p>
      </div>
      {space && (
        <div className="pop-actions storage-line">
          <span>
            Using {size(space.usage)} of {size(space.quota)}
          </span>
        </div>
      )}
    </div>
  );
}
