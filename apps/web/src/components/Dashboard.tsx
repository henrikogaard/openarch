import { getElementType, validateModel, type Model } from '@openarch/core';

interface DashboardProps {
  model: Model;
}

export default function Dashboard({ model }: DashboardProps) {
  const byLayer = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const element of model.elements) {
    const definition = getElementType(element.type);
    const layer = definition?.layer ?? 'other';
    byLayer.set(layer, (byLayer.get(layer) ?? 0) + 1);
    byType.set(element.type, (byType.get(element.type) ?? 0) + 1);
  }
  const maxLayer = Math.max(1, ...byLayer.values());
  const issues = validateModel(model);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Model dashboard</h2>
          <p>Live statistics computed from the same repository the editor uses.</p>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-value">{model.elements.length}</span>
          <span className="stat-label">Elements</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{model.relationships.length}</span>
          <span className="stat-label">Relationships</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{model.views.length}</span>
          <span className="stat-label">Views</span>
        </div>
        <div className={`stat-card ${errors.length ? 'danger' : ''}`}>
          <span className="stat-value">{errors.length}</span>
          <span className="stat-label">Validation errors</span>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel-card">
          <h3>Elements by layer</h3>
          {[...byLayer.entries()].sort((a, b) => b[1] - a[1]).map(([layer, count]) => (
            <div className="bar-row" key={layer}>
              <span className="bar-label">{layer}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / maxLayer) * 100}%` }} />
              </div>
              <span className="bar-count">{count}</span>
            </div>
          ))}
        </section>

        <section className="panel-card">
          <h3>Element types</h3>
          <div className="chip-cloud">
            {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <span className="chip" key={type}>
                {type} <b>{count}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="panel-card wide">
          <h3>Validation</h3>
          {issues.length === 0 ? (
            <p className="ok">No issues found.</p>
          ) : (
            <ul className="issue-list">
              {issues.slice(0, 20).map((issue, index) => (
                <li key={`${issue.rule}-${index}`}>
                  <span className={`issue-badge ${issue.severity}`}>{issue.severity}</span>
                  <span>{issue.message}</span>
                  <code>{issue.rule}</code>
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 20 && <small>…and more warnings</small>}
        </section>
      </div>
    </div>
  );
}
