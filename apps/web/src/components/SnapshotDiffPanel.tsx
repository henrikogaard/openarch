import { diffSnapshots, type SnapshotVisualDiff } from '@openarch/exporters';
import type { Model } from '@openarch/core';
import { useMemo, useState } from 'react';

interface SnapshotDiffPanelProps {
  model: Model;
  snapshotModel: Model;
  onClose: () => void;
}

/**
 * 5/7 UI: Collaborate's "visual diff" renders two exported SVGs side-by-side
 * with an added/removed census; the SVGs come from the exporter pipeline
 * (which escapes model text), so nothing here re-implements rendering.
 */
export default function SnapshotDiffPanel({ model, snapshotModel, onClose }: SnapshotDiffPanelProps) {
  const [viewIndex, setViewIndex] = useState(0);
  const viewId = model.views[viewIndex]?.id ?? model.views[0]?.id ?? '';
  const diff: SnapshotVisualDiff = useMemo(
    () => diffSnapshots(snapshotModel, model, viewId),
    [snapshotModel, model, viewId],
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Snapshot visual diff" onClick={onClose}>
      <div className="snapshot-diff" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Visual diff</h2>
          <select
            value={viewIndex}
            onChange={(event) => setViewIndex(Number(event.target.value))}
            aria-label="View"
          >
            {model.views.map((view, index) => (
              <option key={view.id} value={index}>
                {view.name?.[0]?.value ?? view.id}
              </option>
            ))}
          </select>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">
          <div className="snapshot-diff-columns">
            <figure>
              <figcaption>Snapshot</figcaption>
              <div
                className="snapshot-diff-svg"
                role="img"
                aria-label="Snapshot rendering"
                dangerouslySetInnerHTML={{ __html: diff.beforeSvg }}
              />
            </figure>
            <figure>
              <figcaption>Current</figcaption>
              <div
                className="snapshot-diff-svg"
                role="img"
                aria-label="Current rendering"
                dangerouslySetInnerHTML={{ __html: diff.afterSvg }}
              />
            </figure>
          </div>
          <div className="stat-inline">
            <span className="issue-badge info">+{diff.counts.added}</span>
            <span className="issue-badge error">−{diff.counts.removed}</span>
            <span className="issue-badge info">{diff.counts.unchanged} unchanged</span>
          </div>
          <details>
            <summary>{diff.elements.length} view element(s)</summary>
            <ul className="relation-list">
              {diff.elements.map((entry) => (
                <li key={entry.id}>
                  <span className={`issue-badge ${entry.status === 'added' ? 'info' : entry.status === 'removed' ? 'error' : ''}`}>
                    {entry.status === 'added' ? '+' : entry.status === 'removed' ? '−' : '='}
                  </span>
                  {entry.label}
                </li>
              ))}
            </ul>
          </details>
          {diff.relationships.length > 0 && (
            <details>
              <summary>{diff.relationships.length} relationship change(s)</summary>
              <ul className="relation-list">
                {diff.relationships.map((entry) => (
                  <li key={entry.id}>
                    <span className={`issue-badge ${entry.status === 'added' ? 'info' : 'error'}`}>
                      {entry.status === 'added' ? '+' : '−'}
                    </span>
                    {entry.label} ({entry.id})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
