import { useMemo } from 'react';

export interface UndoEntry {
  index: number;
  model: unknown;
  summary: string;
}

interface UndoTimelineProps {
  entries: UndoEntry[];
  currentIndex: number; // -1 = present
  onJump: (index: number) => void;
  onClose: () => void;
}

/**
 * Undo/redo timeline: a labelled scrubber over the model history. Clicking a
 * past snapshot restores it (as a redo-able state), present is always kept.
 */
export default function UndoTimeline({ entries, currentIndex, onJump, onClose }: UndoTimelineProps) {
  const visible = useMemo(() => entries.slice(-15), [entries]);
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="History" onClick={onClose}>
      <div className="undo-timeline" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>History</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <ol className="timeline-list">
            <li className={currentIndex === -1 ? 'active' : ''}>
              <button
                className="small-button"
                onClick={() => {
                  onJump(-1);
                  onClose();
                }}
                title="Current model"
              >
                Present
              </button>
            </li>
            {visible.map((entry, reverseIndex) => {
              const absolute = entries.length - visible.length + reverseIndex;
              return (
                <li key={absolute}>
                  <button
                    className={`small-button ${currentIndex === absolute ? 'active' : ''}`}
                    onClick={() => {
                      onJump(absolute);
                      onClose();
                    }}
                    title={`Restore step ${absolute + 1}`}
                  >
                    {entry.summary}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
