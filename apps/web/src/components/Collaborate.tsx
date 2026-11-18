import { diffModels, primaryText, type AuditEvent, type Comment, type Model, type ModelDiff } from '@openarch/core';
import { type ServerRepository } from '@openarch/repository';
import { useCallback, useEffect, useState } from 'react';

interface CollaborateProps {
  modelId: string;
  model: Model;
  repository: ServerRepository | null;
  onRestore: (model: Model) => void;
}

interface SnapshotMeta {
  id: string;
  version: number;
  createdAt: string;
  label: string;
}

export default function Collaborate({ modelId, model, repository, onRestore }: CollaborateProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [diff, setDiff] = useState<Record<string, unknown> | null>(null);
  const [snapshotDiffs, setSnapshotDiffs] = useState<Record<string, ModelDiff>>({});
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    if (!repository) return;
    try {
      const [nextComments, nextAudit, nextSnapshots, nextDiff] = await Promise.all([
        repository.listComments(modelId),
        repository.listAudit(modelId),
        repository.listSnapshots(modelId),
        repository.getDiff(modelId),
      ]);
      setComments(nextComments as Comment[]);
      setAudit(nextAudit as AuditEvent[]);
      setSnapshots(nextSnapshots as SnapshotMeta[]);
      setDiff(nextDiff as Record<string, unknown>);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [repository, modelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!repository) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h2>Collaborate</h2>
            <p>Comments, baselines, and audit are available when using the self-hosted server.</p>
          </div>
        </header>
        <div className="panel-card">Switch to <strong>Server</strong> mode in the sidebar to enable collaboration features.</div>
      </div>
    );
  }

  const addComment = async () => {
    if (!draft.trim()) return;
    await repository.addComment(modelId, draft);
    setDraft('');
    await refresh();
  };

  const createSnapshot = async () => {
    await repository.createSnapshot(modelId, `Snapshot ${new Date().toLocaleString()}`);
    await refresh();
  };

  const showDiff = async (snapshot: SnapshotMeta) => {
    if (snapshotDiffs[snapshot.id]) {
      setSnapshotDiffs((current) => {
        const next = { ...current };
        delete next[snapshot.id];
        return next;
      });
      return;
    }
    setBusy(snapshot.id);
    try {
      const snapshotModel = await repository.getSnapshot(modelId, snapshot.id);
      setSnapshotDiffs((current) => ({ ...current, [snapshot.id]: diffModels(model, snapshotModel) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };

  const restore = async (snapshot: SnapshotMeta) => {
    if (!window.confirm(`Restore "${snapshot.label}"? Your current unsaved view of the model is replaced.`)) return;
    setBusy(snapshot.id);
    try {
      const restored = await repository.restoreSnapshot(modelId, snapshot.id);
      onRestore(restored);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Collaborate</h2>
          <p>Optimistic locking, comments, baselines, and audit history.</p>
        </div>
        <button onClick={createSnapshot}>Create baseline</button>
      </header>
      {error && <div className="panel-card danger">{error}</div>}

      <div className="dashboard-grid">
        <section className="panel-card">
          <h3>Comments</h3>
          <div className="comment-compose">
            <textarea
              value={draft}
              placeholder="Leave a comment…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button onClick={addComment} disabled={!draft.trim()}>
              Post
            </button>
          </div>
          <ul className="comment-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <strong>{comment.author}</strong>
                <time>{new Date(comment.createdAt).toLocaleString()}</time>
                <p>{comment.body}</p>
              </li>
            ))}
            {comments.length === 0 && <li className="empty">No comments yet.</li>}
          </ul>
        </section>

        <section className="panel-card">
          <h3>Version history & baselines</h3>
          <ul className="relation-list">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <span className="chip">{snapshot.label}</span>
                <span className="muted">
                  v{snapshot.version} · {new Date(snapshot.createdAt).toLocaleString()}
                </span>
                <button className="small-button" disabled={busy === snapshot.id} onClick={() => void showDiff(snapshot)}>
                  {snapshotDiffs[snapshot.id] ? 'Hide diff' : 'Diff vs current'}
                </button>
                <button className="small-button" disabled={busy === snapshot.id} onClick={() => void restore(snapshot)}>
                  Restore
                </button>
                {snapshotDiffs[snapshot.id] && (
                  <pre className="diff-block">
                    {Object.entries(snapshotDiffs[snapshot.id])
                      .filter(([, value]) => Array.isArray(value))
                      .map(([key, value]) => `${key}: ${(value as unknown[]).length}`)
                      .join('\n')}
                  </pre>
                )}
              </li>
            ))}
            {snapshots.length === 0 && <li className="empty">No snapshots yet — every server save creates a revision.</li>}
          </ul>
          {diff && (
            <pre className="diff-block">
              {Object.entries(diff)
                .filter(([, value]) => Array.isArray(value))
                .map(([key, value]) => `${key}: ${(value as unknown[]).length}`)
                .join('\n')}
            </pre>
          )}
        </section>

        <section className="panel-card wide">
          <h3>Audit log</h3>
          <ul className="audit-list">
            {audit.map((event) => (
              <li key={event.id}>
                <span className="chip">{event.action}</span>
                <strong>{event.actor}</strong>
                <span>{event.summary}</span>
                <time>{new Date(event.createdAt).toLocaleString()}</time>
              </li>
            ))}
            {audit.length === 0 && <li className="empty">No activity recorded.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

// Used by the model selector in the parent app.
export function modelLabel(model: { name: Array<{ value: string }> }): string {
  return primaryText(model.name) || 'Untitled';
}
