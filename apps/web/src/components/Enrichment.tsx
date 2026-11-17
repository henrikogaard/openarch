import { type ArchiElement, type Model, type Relationship } from '@openarch/core';
import {
  filesToResources,
  parseCsvResources,
  proposeElements,
  proposeRelationships,
  proposalsToElements,
  type Proposal,
  type RawResource,
} from '@openarch/enrichment';
import {
  mapResources,
  parseDockerCompose,
  parseKubernetes,
  parseTerraformPlan,
  type IacImport,
} from '@openarch/iac';
import { useMemo, useState } from 'react';

interface EnrichmentProps {
  model: Model;
  onApply: (elements: ArchiElement[], relationships: Relationship[]) => void;
}

type InputMode = 'csv' | 'files' | 'iac';
type IacKind = 'terraform' | 'kubernetes' | 'compose';

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => (item !== null && typeof item === 'object' && 'value' in item ? String((item as { value: unknown }).value) : ''))
      .join(' | ');
  }
  return value === undefined || value === null ? '' : String(value);
}

function confidencePercent(value: unknown): string {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return '—';
  const percent = num > 0 && num <= 1 ? Math.round(num * 100) : Math.round(num);
  return `${percent}%`;
}

const IAC_LABEL: Record<IacKind, string> = {
  terraform: 'Terraform plan JSON',
  kubernetes: 'Kubernetes YAML',
  compose: 'docker-compose YAML',
};

export default function Enrichment(props: EnrichmentProps) {
  const { model, onApply } = props;
  const [mode, setMode] = useState<InputMode>('csv');
  const [csvText, setCsvText] = useState('');
  const [filesText, setFilesText] = useState('');
  const [iacKind, setIacKind] = useState<IacKind>('terraform');
  const [iacText, setIacText] = useState('');
  const [iacResult, setIacResult] = useState<IacImport | null>(null);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedProposals = useMemo(
    () => (proposals ?? []).filter((proposal) => selectedIds.has(String(proposal.id))),
    [proposals, selectedIds],
  );
  const elements = useMemo(() => proposalsToElements(selectedProposals), [selectedProposals]);
  const relationships = useMemo(
    () => proposeRelationships(model, selectedProposals, elements),
    [model, selectedProposals, elements],
  );

  const preview = () => {
    setError('');
    setIacResult(null);
    try {
      let resources: RawResource[];
      if (mode === 'csv') {
        if (!csvText.trim()) {
          setError('Paste CSV data first.');
          return;
        }
        resources = parseCsvResources(csvText);
      } else {
        if (!filesText.trim()) {
          setError('Paste the file scan JSON first.');
          return;
        }
        const parsed: unknown = JSON.parse(filesText);
        if (!Array.isArray(parsed)) {
          throw new Error('Expected a JSON array of { path, content } objects.');
        }
        const files = parsed.map((item, index) => {
          if (item === null || typeof item !== 'object') {
            throw new Error(`Item ${index + 1} must be a { path, content } object.`);
          }
          const record = item as Record<string, unknown>;
          if (typeof record.path !== 'string' || typeof record.content !== 'string') {
            throw new Error(`Item ${index + 1} needs string "path" and "content" fields.`);
          }
          return { path: record.path, content: record.content };
        });
        resources = filesToResources(files);
      }

      const next = proposeElements(model, resources);
      setProposals(next);
      setSelectedIds(new Set(next.map((proposal) => String(proposal.id))));
    } catch (cause) {
      setProposals(null);
      setSelectedIds(new Set());
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const previewIac = () => {
    setError('');
    setProposals(null);
    try {
      if (!iacText.trim()) {
        setError(`Paste ${IAC_LABEL[iacKind]} first.`);
        return;
      }
      const resources =
        iacKind === 'terraform'
          ? parseTerraformPlan(iacText)
          : iacKind === 'kubernetes'
            ? parseKubernetes(iacText)
            : parseDockerCompose(iacText);
      if (resources.length === 0) {
        setError(`No resources found in this ${IAC_LABEL[iacKind]} input.`);
        return;
      }
      setIacResult(mapResources(resources, { domain: model.domains?.[0]?.id }));
    } catch (cause) {
      setIacResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setMode('csv');
    setCsvText('');
    setFilesText('');
    setIacText('');
    setError('');
    setProposals(null);
    setIacResult(null);
    setSelectedIds(new Set());
  };

  return (
    <div className="page enrichment-page">
      <header className="page-header">
        <div>
          <h2>Enrichment & infrastructure import</h2>
          <p>
            Deterministic adapters — no LLM, no network calls. Preview every proposal before applying
            it to the current workspace.
          </p>
        </div>
        <div className="filter-row">
          <button className={mode === 'csv' ? 'active' : ''} onClick={() => setMode('csv')}>CSV</button>
          <button className={mode === 'files' ? 'active' : ''} onClick={() => setMode('files')}>Files</button>
          <button className={mode === 'iac' ? 'active' : ''} onClick={() => setMode('iac')}>Infrastructure</button>
        </div>
      </header>

      {error && <div className="panel-card danger">{error}</div>}

      <div className="dashboard-grid">
        <section className="panel-card">
          {mode === 'iac' ? (
            <>
              <h3>Import infrastructure as code</h3>
              <p className="muted">
                Paste a Terraform plan, Kubernetes manifests, or docker-compose file. Resources map to
                ArchiMate Nodes, System Software, Artifacts, and networks. Re-importing the same input
                produces stable ids, so you can update rather than duplicate.
              </p>
              <label className="field">
                Source
                <select value={iacKind} onChange={(event) => setIacKind(event.target.value as IacKind)}>
                  {(Object.keys(IAC_LABEL) as IacKind[]).map((kind) => (
                    <option key={kind} value={kind}>{IAC_LABEL[kind]}</option>
                  ))}
                </select>
              </label>
              <textarea
                className="form-input full"
                rows={12}
                value={iacText}
                placeholder={
                  iacKind === 'terraform'
                    ? 'Paste the output of: terraform show -json'
                    : iacKind === 'kubernetes'
                      ? 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: claims-api'
                      : 'services:\n  api:\n    image: claims:latest\n  db:\n    image: postgres:17'
                }
                onChange={(event) => setIacText(event.target.value)}
              />
              <div className="enrichment-actions">
                <button className="small-button" onClick={previewIac}>Preview infrastructure</button>
                <button className="link-button" onClick={reset}>Reset</button>
              </div>
            </>
          ) : (
            <>
              <h3>{mode === 'csv' ? 'Paste CSV resources' : 'Git-repo file scan'}</h3>
              <p className="muted">
                {mode === 'csv'
                  ? 'One resource per row. Headers are used as properties on the proposed elements.'
                  : 'Paste a JSON array of { path, content } objects from a repository scan. Text files are inspected for named resources.'}
              </p>
              <textarea
                className="form-input full"
                rows={12}
                value={mode === 'csv' ? csvText : filesText}
                placeholder={mode === 'csv' ? 'name,type,description\nClaim portal,application,Customer claims portal' : '[ { "path": "src/portal.ts", "content": "..." } ]'}
                onChange={(event) => (mode === 'csv' ? setCsvText(event.target.value) : setFilesText(event.target.value))}
              />
              <div className="enrichment-actions">
                <button className="small-button" onClick={preview}>
                  {mode === 'csv' ? 'Preview resources' : 'Preview files'}
                </button>
                <button className="link-button" onClick={reset}>Reset</button>
              </div>
            </>
          )}
        </section>

        <section className="panel-card wide">
          <h3>Proposed changes</h3>
          {mode === 'iac' ? (
            iacResult === null ? (
              <p className="empty muted">Preview infrastructure to see the proposed topology.</p>
            ) : (
              <>
                <div className="stat-inline">
                  <span className="issue-badge info">{iacResult.elements.length} elements</span>
                  <span className="issue-badge info">{iacResult.relationships.length} relationships</span>
                  {iacResult.warnings.length > 0 && (
                    <span className="issue-badge warning">{iacResult.warnings.length} warnings</span>
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Environment</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {iacResult.elements.map((element) => (
                        <tr key={element.id}>
                          <td>{element.type}</td>
                          <td>{textOf(element.name)}</td>
                          <td>{element.environment ?? '—'}</td>
                          <td className="mono">
                            {element.properties.find((property) => property.key === 'iacAddress')?.value ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {iacResult.warnings.length > 0 && (
                  <ul className="issue-list">
                    {iacResult.warnings.slice(0, 10).map((warning, index) => (
                      <li key={index}>
                        <span className="issue-badge warning">warning</span>
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="enrichment-actions">
                  <button
                    className="primary-button"
                    onClick={() => onApply(iacResult.elements, iacResult.relationships)}
                  >
                    Apply {iacResult.elements.length} elements
                  </button>
                </div>
              </>
            )
          ) : proposals === null ? (
            <p className="empty muted">Preview resources to see proposed elements and relationships.</p>
          ) : proposals.length === 0 ? (
            <p className="empty">No proposals came from these resources.</p>
          ) : (
            <>
              <div className="stat-inline">
                <span className="issue-badge info">{proposals.length} proposed elements</span>
                <span className="issue-badge info">{relationships.length} proposed relationships</span>
                <span className="issue-badge info">{selectedIds.size} selected</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th aria-label="Select" />
                      <th>Type</th>
                      <th>Name</th>
                      <th>Source</th>
                      <th>Confidence</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((proposal, index) => {
                      const id = String(proposal.id);
                      return (
                        <tr key={id || index}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${textOf(proposal.name) || id}`}
                              checked={selectedIds.has(id)}
                              onChange={() => toggle(id)}
                            />
                          </td>
                          <td>{textOf(proposal.type)}</td>
                          <td>{textOf(proposal.name)}</td>
                          <td className="muted">{textOf(proposal.source)}</td>
                          <td>{confidencePercent(proposal.confidence)}</td>
                          <td className="muted">{textOf(proposal.reason)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted">Existing elements with the same name are skipped.</p>
              <div className="enrichment-actions">
                <button
                  className="primary-button"
                  disabled={selectedIds.size === 0}
                  onClick={() => onApply(elements, relationships)}
                >
                  Apply {elements.length} elements
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
