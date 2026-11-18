import {
  WORKSPACE_TEMPLATES,
  type ModelPurpose,
  type ModelSummary,
  type WorkspaceStatus,
} from '@openarch/core';
import { useMemo, useRef, useState } from 'react';

export interface CreateWorkspaceInput {
  name: string;
  description: string;
  purpose: ModelPurpose;
  templateId: string;
  owner: string;
  tags: string[];
}

interface WorkspaceHomeProps {
  workspaces: ModelSummary[];
  onCreate: (input: CreateWorkspaceInput) => void;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onOpenPortfolio: () => void;
  onExportAll: () => void;
  onImportBackup: (file: File) => void;
}

const PURPOSE_LABEL: Record<ModelPurpose, string> = {
  'as-is': 'AS-IS',
  'to-be': 'TO-BE',
  migration: 'MIGRATION',
};

const STATUS_LABEL: Record<WorkspaceStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  approved: 'Approved',
  archived: 'Archived',
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatDate(value?: string): string {
  if (!value) return 'Never saved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `Updated ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

const EMPTY_DRAFT: CreateWorkspaceInput = {
  name: '',
  description: '',
  purpose: 'as-is',
  templateId: 'blank',
  owner: '',
  tags: [],
};

export default function WorkspaceHome({
  workspaces,
  onCreate,
  onOpen,
  onDuplicate,
  onArchive,
  onDelete,
  onImport,
  onOpenPortfolio,
  onExportAll,
  onImportBackup,
}: WorkspaceHomeProps) {
  const backupInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | WorkspaceStatus>('all');
  const [purpose, setPurpose] = useState<'all' | ModelPurpose>('all');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateWorkspaceInput>(EMPTY_DRAFT);
  const [tagText, setTagText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspaces
      .filter((workspace) => status === 'all' || workspace.status === status)
      .filter((workspace) => purpose === 'all' || workspace.purpose === purpose)
      .filter((workspace) => {
        if (!needle) return true;
        return (
          workspace.name.toLowerCase().includes(needle) ||
          workspace.description.toLowerCase().includes(needle) ||
          workspace.owner.toLowerCase().includes(needle) ||
          workspace.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
      });
  }, [workspaces, query, status, purpose, sort]);

  const totals = useMemo(
    () => ({
      workspaces: workspaces.length,
      elements: workspaces.reduce((sum, workspace) => sum + workspace.elementCount, 0),
      domains: workspaces.reduce((sum, workspace) => sum + workspace.domainCount, 0),
      artefacts: workspaces.reduce((sum, workspace) => sum + workspace.artefactCount, 0),
    }),
    [workspaces],
  );

  const submit = () => {
    if (!draft.name.trim()) return;
    onCreate({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      tags: tagText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setDraft(EMPTY_DRAFT);
    setTagText('');
    setCreating(false);
  };

  return (
    <div className="home">
      <header className="home-topbar">
        <div className="brand">
          <span className="brand-mark">OA</span>
          <div>
            <strong>OpenArch</strong>
            <small>Workspaces</small>
          </div>
        </div>
        <div className="home-topbar-actions">
          <input
            ref={fileInput}
            type="file"
            accept=".xml,.json,.archimate,application/xml,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.target.value = '';
            }}
          />
          <button onClick={() => fileInput.current?.click()}>Import model</button>
          <button onClick={onOpenPortfolio}>Portfolio</button>
          <button className="primary-button" onClick={() => setCreating(true)}>
            + New workspace
          </button>
        </div>
      </header>

      <main className="home-main">
        <div className="home-heading">
          <div>
            <h1>Workspaces</h1>
            <p className="muted">
              {plural(totals.workspaces, 'workspace')} · {plural(totals.elements, 'element')} ·{' '}
              {plural(totals.domains, 'domain')} · {plural(totals.artefacts, 'artefact')}
            </p>
          </div>
        </div>

        <div className="home-toolbar">
          <input
            className="search"
            type="search"
            placeholder="Search workspaces…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="all">All statuses</option>
            {(['draft', 'active', 'approved', 'archived'] as WorkspaceStatus[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
          <select value={purpose} onChange={(event) => setPurpose(event.target.value as typeof purpose)}>
            <option value="all">All purposes</option>
            <option value="as-is">AS-IS</option>
            <option value="to-be">TO-BE</option>
            <option value="migration">Migration</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="recent">Recently updated</option>
            <option value="name">Name</option>
          </select>
          <button className="small-button" onClick={onExportAll} title="Download every workspace as one JSON archive">
            Export all
          </button>
          <button className="small-button" onClick={() => backupInput.current?.click()} title="Restore workspaces from an Export-all archive">
            Import backup
          </button>
          <input
            ref={backupInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportBackup(file);
              event.target.value = '';
            }}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="home-empty">
            <h2>{workspaces.length === 0 ? 'No workspaces yet' : 'No matches'}</h2>
            <p className="muted">
              {workspaces.length === 0
                ? 'Create a workspace from a template, or import an AOEF, JSON, or .archimate file.'
                : 'Try a different search or filter.'}
            </p>
            {workspaces.length === 0 && (
              <button className="primary-button" onClick={() => setCreating(true)}>
                + New workspace
              </button>
            )}
          </div>
        ) : (
          <div className="workspace-grid">
            {filtered.map((workspace) => (
              <article
                key={workspace.id}
                className={`workspace-card ${workspace.status === 'archived' ? 'is-archived' : ''}`}
                onClick={() => onOpen(workspace.id)}
              >
                <div className="workspace-card-head">
                  <h3>{workspace.name}</h3>
                  <span className={`purpose-badge purpose-${workspace.purpose}`}>
                    {PURPOSE_LABEL[workspace.purpose]}
                  </span>
                </div>
                <p className="workspace-description">
                  {workspace.description || 'No description'}
                </p>
                <div className="workspace-meta">
                  <span>{plural(workspace.elementCount, 'element')}</span>
                  <span>{plural(workspace.domainCount, 'domain')}</span>
                  <span>{plural(workspace.artefactCount, 'artefact')}</span>
                </div>
                <footer className="workspace-card-foot">
                  <span>{formatDate(workspace.updatedAt)}</span>
                  <span className={`status-pill status-${workspace.status}`}>
                    {STATUS_LABEL[workspace.status]}
                  </span>
                </footer>
                <div className="workspace-actions" onClick={(event) => event.stopPropagation()}>
                  <button onClick={() => onDuplicate(workspace.id)}>Duplicate</button>
                  {workspace.status !== 'archived' && (
                    <button onClick={() => onArchive(workspace.id)}>Archive</button>
                  )}
                  <button className="danger-link" onClick={() => onDelete(workspace.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="New workspace">
          <div className="modal">
            <header className="modal-header">
              <h2>New workspace</h2>
              <button className="icon-button" onClick={() => setCreating(false)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="modal-body">
              <label className="field">
                Name
                <input
                  autoFocus
                  className="form-input full"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Claims platform 2027"
                />
              </label>
              <label className="field">
                Description
                <textarea
                  className="form-input full"
                  rows={2}
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="What this architecture covers"
                />
              </label>
              <div className="field-row">
                <label className="field">
                  Purpose
                  <select
                    value={draft.purpose}
                    onChange={(event) =>
                      setDraft({ ...draft, purpose: event.target.value as ModelPurpose })
                    }
                  >
                    <option value="as-is">AS-IS</option>
                    <option value="to-be">TO-BE</option>
                    <option value="migration">Migration</option>
                  </select>
                </label>
                <label className="field">
                  Owner
                  <input
                    className="form-input full"
                    value={draft.owner}
                    onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                    placeholder="Accountable person"
                  />
                </label>
              </div>
              <label className="field">
                Template
                <select
                  value={draft.templateId}
                  onChange={(event) => setDraft({ ...draft, templateId: event.target.value })}
                >
                  {WORKSPACE_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} — {template.description}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Tags
                <input
                  className="form-input full"
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  placeholder="cloud, payments, 2027"
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary-button" onClick={submit} disabled={!draft.name.trim()}>
                Create workspace
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
