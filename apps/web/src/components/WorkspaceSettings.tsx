import {
  createDomain,
  DOMAIN_COLORS,
  elementsInDomain,
  primaryText,
  WORKSPACE_STATUSES,
  type Domain,
  type Model,
  type ModelPurpose,
  type WorkspaceStatus,
} from '@openarch/core';
import { useState } from 'react';
import type { ConnectorConfig } from '@openarch/connectors';

interface WorkspaceSettingsProps {
  model: Model;
  connectors?: ConnectorConfig;
  onConnectorsChange?: (config: ConnectorConfig) => void;
  onUpdate: (patch: Partial<Model>) => void;
  onBack: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

const PURPOSE_LABEL: Record<ModelPurpose, string> = {
  'as-is': 'AS-IS',
  'to-be': 'TO-BE',
  migration: 'Migration',
};

export default function WorkspaceSettings({
  model,
  connectors = {},
  onConnectorsChange,
  onUpdate,
  onBack,
  onDuplicate,
  onArchive,
  onDelete,
}: WorkspaceSettingsProps) {
  const [name, setName] = useState(primaryText(model.name));
  const [description, setDescription] = useState(primaryText(model.documentation));
  const [owner, setOwner] = useState(model.owner ?? '');
  const [tagText, setTagText] = useState((model.tags ?? []).join(', '));

  const domains = model.domains ?? [];
  const unassigned = model.elements.filter((element) => !element.domain);

  const updateDomain = (id: string, patch: Partial<Domain>) => {
    onUpdate({ domains: domains.map((domain) => (domain.id === id ? { ...domain, ...patch } : domain)) });
  };

  const addDomain = () => {
    const next = createDomain(`Domain ${domains.length + 1}`, {
      color: DOMAIN_COLORS[domains.length % DOMAIN_COLORS.length],
    });
    onUpdate({ domains: [...domains, next] });
  };

  const removeDomain = (id: string) => {
    if (!window.confirm('Remove this domain? Elements stay in the model but become unassigned.')) return;
    onUpdate({
      domains: domains.filter((domain) => domain.id !== id),
      elements: model.elements.map((element) =>
        element.domain === id ? { ...element, domain: undefined } : element,
      ),
    });
  };

  const assignUnassigned = (domainId: string) => {
    if (!domainId) return;
    onUpdate({
      elements: model.elements.map((element) =>
        element.domain ? element : { ...element, domain: domainId },
      ),
    });
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <button className="link-button" onClick={onBack}>
            ← All workspaces
          </button>
          <h2>Workspace settings</h2>
          <p>Metadata, domains, and lifecycle for this workspace.</p>
        </div>
        <div className="stat-inline">
          <span className="chip">{model.elements.length} elements</span>
          <span className="chip">{domains.length} domains</span>
          <span className="chip">{model.artefacts?.length ?? 0} artefacts</span>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="panel-card">
          <h3>Identity</h3>
          <label className="field">
            Name
            <input
              className="form-input full"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() && name !== primaryText(model.name)) {
                  onUpdate({ name: [{ lang: 'en', value: name.trim() }] });
                }
              }}
            />
          </label>
          <label className="field">
            Description
            <textarea
              className="form-input full"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => onUpdate({ documentation: description ? [{ lang: 'en', value: description }] : [] })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              Purpose
              <select
                value={model.purpose ?? 'as-is'}
                onChange={(event) => onUpdate({ purpose: event.target.value as ModelPurpose })}
              >
                {(Object.keys(PURPOSE_LABEL) as ModelPurpose[]).map((value) => (
                  <option key={value} value={value}>
                    {PURPOSE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status
              <select
                value={model.status ?? 'draft'}
                onChange={(event) => onUpdate({ status: event.target.value as WorkspaceStatus })}
              >
                {WORKSPACE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              Owner
              <input
                className="form-input full"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                onBlur={() => onUpdate({ owner: owner.trim() })}
                placeholder="Accountable person"
              />
            </label>
            <label className="field">
              Tags
              <input
                className="form-input full"
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                onBlur={() =>
                  onUpdate({
                    tags: tagText
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="cloud, payments"
              />
            </label>
          </div>
        </section>

        <section className="panel-card">
          <div className="section-heading">
            <h3>Domains</h3>
            <button className="small-button" onClick={addDomain}>
              + Add domain
            </button>
          </div>
          <p className="muted">
            Domains partition the model by area. Assign elements in the inspector, or bulk-assign the
            unassigned ones below.
          </p>
          <ul className="domain-list">
            {domains.map((domain) => (
              <li key={domain.id}>
                <input
                  type="color"
                  aria-label={`${domain.name} colour`}
                  value={domain.color ?? '#2563eb'}
                  onChange={(event) => updateDomain(domain.id, { color: event.target.value })}
                />
                <input
                  className="form-input"
                  value={domain.name}
                  onChange={(event) => updateDomain(domain.id, { name: event.target.value })}
                />
                <input
                  className="form-input"
                  value={domain.owner ?? ''}
                  placeholder="Owner"
                  onChange={(event) => updateDomain(domain.id, { owner: event.target.value })}
                />
                <span className="chip">{elementsInDomain(model, domain.id).length}</span>
                <button className="icon-button" onClick={() => removeDomain(domain.id)} title="Remove domain">
                  ×
                </button>
              </li>
            ))}
            {domains.length === 0 && <li className="empty">No domains yet.</li>}
          </ul>
          {unassigned.length > 0 && (
            <label className="field">
              Assign {unassigned.length} unassigned element(s) to
              <select defaultValue="" onChange={(event) => assignUnassigned(event.target.value)}>
                <option value="" disabled>
                  Choose a domain…
                </option>
                {domains.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="panel-card wide">
          <h3>Connectors</h3>
          <p className="muted">
            Link elements to Jira issues, Confluence pages, and ServiceNow CIs; publish views to
            Confluence. The token is kept in this browser session only.
          </p>
          <div className="field-row">
            <label className="field">
              Jira base URL
              <input
                className="form-input full"
                placeholder="https://company.atlassian.net"
                value={connectors.jiraBaseUrl ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, jiraBaseUrl: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              Confluence base URL
              <input
                className="form-input full"
                placeholder="https://company.atlassian.net/wiki"
                value={connectors.confluenceBaseUrl ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, confluenceBaseUrl: event.target.value || undefined })}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              ServiceNow instance URL
              <input
                className="form-input full"
                placeholder="https://company.service-now.com"
                value={connectors.serviceNowUrl ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, serviceNowUrl: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              API token (session only)
              <input
                className="form-input full"
                type="password"
                autoComplete="off"
                value={connectors.token ?? ''}
                onChange={(event) => onConnectorsChange?.({ ...connectors, token: event.target.value || undefined })}
              />
            </label>
          </div>
        </section>

        <section className="panel-card wide">
          <h3>Lifecycle</h3>
          <div className="settings-actions">
            <button onClick={onDuplicate}>Duplicate workspace</button>
            <button onClick={onArchive} disabled={model.status === 'archived'}>
              Archive workspace
            </button>
            <button className="danger-link" onClick={onDelete}>
              Delete workspace
            </button>
          </div>
          <p className="muted">
            Duplicating copies the whole model, domains, and artefacts. Archiving keeps the data but
            hides it from the default list. Deleting cannot be undone.
          </p>
        </section>
      </div>
    </div>
  );
}
