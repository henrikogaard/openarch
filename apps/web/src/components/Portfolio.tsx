import {
  getElementType,
  portfolioStats,
  primaryText,
  timeClassification,
  type Model,
  type TimeClassification,
} from '@openarch/core';
import { useMemo, useState } from 'react';
import ScenarioPanel from './ScenarioPanel';

interface PortfolioProps {
  models: Model[];
  onOpen: (id: string) => void;
  onBack: () => void;
}

const TIME_LABEL: Record<TimeClassification, string> = {
  invest: 'Invest',
  tolerate: 'Tolerate',
  migrate: 'Migrate',
  eliminate: 'Eliminate',
};

const TIME_HINT: Record<TimeClassification, string> = {
  invest: 'Strategic, keep and grow',
  tolerate: 'Keep for now, low change',
  migrate: 'Replace or modernise',
  eliminate: 'Retire',
};

export default function Portfolio({ models, onOpen, onBack }: PortfolioProps) {
  const stats = useMemo(() => portfolioStats(models), [models]);
  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const baseline = models.find((model) => model.id === compareA);
  const target = models.find((model) => model.id === compareB);
  const compareReady = Boolean(baseline && target && baseline.id !== target.id);
  const applications = useMemo(
    () =>
      models.flatMap((model) =>
        model.elements
          .filter((element) => getElementType(element.type)?.layer === 'application')
          .map((element) => ({
            model,
            element,
            classification: timeClassification(model, element.id),
          })),
      ),
    [models],
  );

  const maxStatus = Math.max(1, ...Object.values(stats.byStatus));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <button className="link-button" onClick={onBack}>
            ← All workspaces
          </button>
          <h2>Portfolio</h2>
          <p>Cross-workspace view of the architecture landscape.</p>
        </div>
      </header>

      {models.length >= 2 && (
        <section className="panel-card wide">
          <h3>Compare scenarios</h3>
          <p className="muted">
            Pick two workspaces to compare as-is vs to-be: overlap score plus changed, added, and
            dropped elements (same element ids across workspaces align).
          </p>
          <div className="field-row">
            <label className="field">
              Baseline (as-is)
              <select value={compareA} onChange={(event) => setCompareA(event.target.value)}>
                <option value="">Select a workspace…</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {primaryText(model.name) || model.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Target (to-be)
              <select value={compareB} onChange={(event) => setCompareB(event.target.value)}>
                <option value="">Select a workspace…</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {primaryText(model.name) || model.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {compareReady && (
        <ScenarioPanel
          baseline={baseline!}
          target={target!}
          onOpenElement={(_id, which) => onOpen(which.id)}
        />
      )}

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-value">{stats.workspaces}</span>
          <span className="stat-label">Workspaces</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.elements}</span>
          <span className="stat-label">Elements</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.domains}</span>
          <span className="stat-label">Domains</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.artefacts}</span>
          <span className="stat-label">Artefacts</span>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel-card">
          <h3>Workspaces by status</h3>
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div className="bar-row" key={status}>
              <span className="bar-label">{status}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / maxStatus) * 100}%` }} />
              </div>
              <span className="bar-count">{count}</span>
            </div>
          ))}
        </section>

        <section className="panel-card">
          <h3>Workspaces by purpose</h3>
          <div className="chip-cloud">
            {Object.entries(stats.byPurpose).map(([purpose, count]) => (
              <span className="chip" key={purpose}>
                {purpose.toUpperCase()} <b>{count}</b>
              </span>
            ))}
          </div>
          <h3 style={{ marginTop: 18 }}>Application portfolio</h3>
          <p className="muted">
            TIME classification is derived from the <code>lifecycle</code> and{' '}
            <code>criticality</code> properties on application elements.
          </p>
        </section>

        <section className="panel-card wide">
          <h3>TIME quadrant</h3>
          <div className="time-grid">
            {(['invest', 'tolerate', 'migrate', 'eliminate'] as TimeClassification[]).map((key) => (
              <div className={`time-cell time-${key}`} key={key}>
                <div className="time-head">
                  <strong>{TIME_LABEL[key]}</strong>
                  <span className="time-count">{stats.time[key]}</span>
                </div>
                <p className="muted">{TIME_HINT[key]}</p>
                <ul>
                  {applications
                    .filter((item) => item.classification === key)
                    .slice(0, 6)
                    .map((item) => (
                      <li key={`${item.model.id}-${item.element.id}`}>
                        <button
                          className="link-button"
                          onClick={() => onOpen(item.model.id)}
                          title={`${primaryText(item.model.name)} · ${item.element.type}`}
                        >
                          {primaryText(item.element.name) || item.element.id}
                        </button>
                      </li>
                    ))}
                  {applications.filter((item) => item.classification === key).length > 6 && (
                    <li className="muted">
                      +{applications.filter((item) => item.classification === key).length - 6} more
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-card wide">
          <h3>All workspaces</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Elements</th>
                  <th>Domains</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.id} onClick={() => onOpen(model.id)}>
                    <td>{primaryText(model.name) || model.id}</td>
                    <td>{(model.purpose ?? 'as-is').toUpperCase()}</td>
                    <td>{model.status ?? 'draft'}</td>
                    <td>{model.owner || '—'}</td>
                    <td>{model.elements.length}</td>
                    <td>{model.domains?.length ?? 0}</td>
                    <td>{model.updatedAt ? new Date(model.updatedAt).toLocaleDateString() : '—'}</td>
                    <td>
                      <button className="small-button" onClick={() => onOpen(model.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
                      No workspaces yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
