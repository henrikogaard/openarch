import { useMemo, useState } from 'react';
import { applyResolutions, conflictEntries, primaryText, type Model } from '@openarch/core';

interface ConflictReviewProps {
  yours: Model;
  theirs: Model;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onMerge: (merged: Model) => void;
  onCancel: () => void;
}

/**
 * Three-way conflict review: per-entity list of yours/theirs/merged with a
 * one-click semantic merge (core mergeModels — incoming wins conflicts,
 * nothing deleted, lying edges pruned).
 */
export default function ConflictReview({ yours, theirs, onKeepMine, onTakeTheirs, onMerge, onCancel }: ConflictReviewProps) {
  const entries = useMemo(() => conflictEntries(yours, theirs), [yours, theirs]);
  const [resolutions, setResolutions] = useState<Map<string, 'mine' | 'theirs'>>(new Map());
  const merged = useMemo(() => applyResolutions(yours, theirs, resolutions), [yours, theirs, resolutions]);
  const changed = entries.filter((entry) => entry.status === 'changed');
  const yoursOnly = entries.filter((entry) => entry.status === 'yours-only');
  const theirsOnly = entries.filter((entry) => entry.status === 'theirs-only');

  const resolve = (id: string, direction: 'mine' | 'theirs') => {
    setResolutions((current) => {
      const next = new Map(current);
      next.set(id, direction);
      return next;
    });
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Resolve save conflict" onClick={onCancel}>
      <div className="conflict-review" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Save conflict — resolve before continuing</h2>
          <button className="icon-button" onClick={onCancel} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="muted">
            {`The server has a newer copy of "${primaryText(theirs.name) || theirs.id}". ${
              changed.length
            } changed, ${yoursOnly.length} only-yours, ${theirsOnly.length} only-theirs. Semantic merge keeps
            everything: incoming values win conflicts, nothing is deleted, and view edges are reconciled.`}
          </p>
          <div className="conflict-columns">
            <section className="conflict-column">
              <h4>Changed ({changed.length})</h4>
              <ul className="relation-list">
                {changed.slice(0, 40).map((entry) => (
                  <li key={entry.id}>
                    <span className="chip">{entry.label}</span>
                    <span className="muted">yours: {entry.yours ?? '—'}</span>
                    <span className="muted">theirs: {entry.theirs ?? '—'}</span>
                    <div className="conflict-resolve">
                      <button
                        className={`small-button ${resolutions.get(entry.id) === 'mine' ? 'active' : ''}`}
                        onClick={() => resolve(entry.id, 'mine')}
                        title="Keep my version of this entity"
                      >
                        Mine
                      </button>
                      <button
                        className={`small-button ${resolutions.get(entry.id) === 'theirs' ? 'active' : ''}`}
                        onClick={() => resolve(entry.id, 'theirs')}
                        title="Take their version of this entity"
                      >
                        Theirs
                      </button>
                    </div>
                  </li>
                ))}
                {changed.length === 0 && <li className="empty">No changed entities.</li>}
              </ul>
              <h4>Only on server — incoming additions</h4>
              <ul className="relation-list">
                {theirsOnly.slice(0, 40).map((entry) => (
                  <li key={entry.id}>
                    <span className="chip">{entry.label}</span>
                    <div className="conflict-resolve">
                      <button
                        className={`small-button ${resolutions.get(entry.id) === 'mine' ? 'active' : ''}`}
                        onClick={() => resolve(entry.id, 'mine')}
                        title="Do not add this entity"
                      >
                        Skip
                      </button>
                    </div>
                  </li>
                ))}
                {theirsOnly.length === 0 && <li className="empty">Nothing incoming.</li>}
              </ul>
            </section>
            <section className="conflict-column">
              <h4>Only in yours (never deleted by merge: {yoursOnly.length})</h4>
              <ul className="relation-list">
                {yoursOnly.slice(0, 40).map((entry) => (
                  <li key={entry.id}>
                    <span className="chip">{entry.label}</span>
                    <span className="muted">kept by merge</span>
                  </li>
                ))}
                {yoursOnly.length === 0 && <li className="empty">Nothing.</li>}
              </ul>
            </section>
          </div>
        </div>
        <footer className="modal-footer">
          <button onClick={onCancel}>Review later</button>
          <button onClick={onKeepMine}>Overwrite with mine</button>
          <button onClick={onTakeTheirs}>Load their version</button>
          <button className="primary-button" onClick={() => onMerge(merged)}>
            Merge (apply resolutions)
          </button>
        </footer>
      </div>
    </div>
  );
}
