import { diffSummary, primaryText, type Model, type ModelDiff } from '@openarch/core';
import { useTranslation } from '../i18n';

interface ImportPreviewProps {
  diff: ModelDiff;
  incoming: Model;
  current: Model;
  onReplace: () => void;
  onAddAsNew: () => void;
  onMerge?: () => void;
  onCancel: () => void;
}

interface DiffEntry {
  badge?: string;
  tone?: string;
  main: string;
  detail?: string;
}

const LIST_LIMIT = 25;

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function DiffSection({ title, entries }: { title: string; entries: DiffEntry[] }) {
  const t = useTranslation();
  const shown = entries.slice(0, LIST_LIMIT);
  const more = entries.length - shown.length;
  return (
    <section className="preview-section">
      <h4>
        {title} <span className="muted">({entries.length})</span>
      </h4>
      {entries.length === 0 ? (
        <p className="empty muted">{t('none')}</p>
      ) : (
        <ul className="preview-list">
          {shown.map((entry, index) => (
            <li key={index} className="preview-item">
              {entry.badge && <span className={`issue-badge ${entry.tone ?? ''}`}>{entry.badge}</span>}
              <span className="preview-item-main">{entry.main}</span>
              {entry.detail && <span className="preview-item-detail">{entry.detail}</span>}
            </li>
          ))}
          {more > 0 && <li className="preview-more muted">…and {more} more</li>}
        </ul>
      )}
    </section>
  );
}

export default function ImportPreview(props: ImportPreviewProps) {
  const t = useTranslation();
  const { diff, incoming, current, onReplace, onAddAsNew, onMerge, onCancel } = props;

  const addedElements: DiffEntry[] = diff.addedElements.map((item) => ({ badge: '+', tone: 'info', main: item }));
  const removedElements: DiffEntry[] = diff.removedElements.map((item) => ({ badge: '−', tone: 'error', main: item }));
  const changedElements: DiffEntry[] = diff.changedElements.map((change) => ({
    main: `${change.field} (${change.entityId})`,
    detail: `${truncate(change.from)} → ${truncate(change.to)}`,
  }));
  const addedRelationships: DiffEntry[] = diff.addedRelationships.map((item) => ({ badge: '+', tone: 'info', main: item }));
  const removedRelationships: DiffEntry[] = diff.removedRelationships.map((item) => ({ badge: '−', tone: 'error', main: item }));
  const views: DiffEntry[] = [
    ...diff.addedViews.map((id) => ({ badge: '+', tone: 'info', main: id })),
    ...diff.removedViews.map((id) => ({ badge: '−', tone: 'error', main: id })),
  ];

  return (
    <div className="import-overlay">
      <div
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-preview-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        <header className="import-dialog-header">
          <h2 id="import-preview-title">{t('importPreview')}</h2>
          <p className="muted">
            {primaryText(current.name) || current.id} → <strong>{primaryText(incoming.name) || incoming.id}</strong>
            {' · '}
            {incoming.elements.length} elements, {incoming.relationships.length} relationships, {incoming.views.length} views
          </p>
        </header>

        <p className="import-summary">{diffSummary(diff)}</p>

        <div className="import-dialog-body">
          <DiffSection title="Added elements" entries={addedElements} />
          <DiffSection title="Removed elements" entries={removedElements} />
          <DiffSection title="Changed elements" entries={changedElements} />
          <DiffSection title="Added relationships" entries={addedRelationships} />
          <DiffSection title="Removed relationships" entries={removedRelationships} />
          <DiffSection title="Added/removed views" entries={views} />
        </div>

        <footer className="import-dialog-footer">
          <button className="primary-button" onClick={onReplace}>{t('replaceCurrent')}</button>
          {onMerge && (
            <button className="small-button" onClick={onMerge} title={t('mergeTitle')}>
              Merge into current
            </button>
          )}
          <button className="small-button" onClick={onAddAsNew}>{t('addAsNew')}</button>
          <button className="link-button" onClick={onCancel}>{t('cancel')}</button>
        </footer>
      </div>
    </div>
  );
}
