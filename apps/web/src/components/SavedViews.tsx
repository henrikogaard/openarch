import { useState } from 'react';

export interface SavedView {
  id: string;
  name: string;
  modelId: string;
  kind: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

interface SavedViewsProps {
  views: SavedView[];
  onSave: (name: string) => void;
  onLoad: (view: SavedView) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function describeFilters(filters: Record<string, unknown>): string {
  const parts = Object.entries(filters).map(([key, value]) => {
    if (Array.isArray(value)) return `${value.length} ${key}`;
    if (value !== null && typeof value === 'object') return `${key}: ${Object.keys(value as object).length} fields`;
    if (value === undefined || value === null) return `${key}: —`;
    return `${key}: ${String(value)}`;
  });
  return parts.length > 0 ? parts.join(' · ') : 'No filters';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function SavedViews(props: SavedViewsProps) {
  const { views, onSave, onLoad, onDelete, onClose } = props;
  const [name, setName] = useState('');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
  };

  return (
    <div className="saved-views-panel" role="dialog" aria-modal="true" aria-label="Saved views">
      <header className="saved-views-header">
        <h2>Saved views</h2>
        <button className="link-button" aria-label="Close saved views" onClick={onClose}>×</button>
      </header>

      <div className="saved-views-save">
        <input
          className="form-input"
          value={name}
          placeholder="Name this view…"
          aria-label="View name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
        <button className="small-button" onClick={save} disabled={!name.trim()}>Save current view</button>
      </div>

      {views.length === 0 ? (
        <p className="empty muted">No saved views yet. Save the current filters to reuse them later.</p>
      ) : (
        <ul className="saved-views-list">
          {views.map((view) => (
            <li key={view.id} className="saved-view-item">
              <div className="saved-view-meta">
                <strong>{view.name}</strong>
                <span className="chip saved-view-kind">{view.kind}</span>
                <time className="muted">{formatDate(view.createdAt)}</time>
              </div>
              <p className="saved-view-filters muted">{describeFilters(view.filters)}</p>
              <div className="saved-view-actions">
                <button className="small-button" onClick={() => onLoad(view)}>Load</button>
                <button className="small-button" onClick={() => onDelete(view.id)}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
