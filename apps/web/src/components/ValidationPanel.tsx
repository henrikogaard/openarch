import { primaryText, validateModel, type Model } from '@openarch/core';
import { useMemo, useState } from 'react';

interface ValidationPanelProps {
  model: Model;
  onSelect: (id: string) => void;
}

export default function ValidationPanel({ model, onSelect }: ValidationPanelProps) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const issues = useMemo(() => validateModel(model), [model]);
  const shown = issues.filter((issue) => filter === 'all' || issue.severity === filter);
  const counts = {
    error: issues.filter((issue) => issue.severity === 'error').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Validation</h2>
          <p>Structural and notation checks shared with the CLI and server.</p>
        </div>
        <div className="stat-inline">
          <span className="issue-badge error">{counts.error} errors</span>
          <span className="issue-badge warning">{counts.warning} warnings</span>
          <span className="issue-badge info">{counts.info} info</span>
        </div>
      </header>

      <div className="filter-row">
        {(['all', 'error', 'warning', 'info'] as const).map((option) => (
          <button
            key={option}
            className={filter === option ? 'active' : ''}
            onClick={() => setFilter(option)}
          >
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="panel-card ok">No findings for this filter.</div>
      ) : (
        <div className="panel-card">
          <ul className="issue-list detailed">
            {shown.map((issue, index) => {
              const element = model.elements.find((item) => item.id === issue.entityId);
              return (
                <li key={`${issue.rule}-${issue.entityId ?? index}`}>
                  <span className={`issue-badge ${issue.severity}`}>{issue.severity}</span>
                  <div>
                    <div>{issue.message}</div>
                    {element && (
                      <button className="link-button" onClick={() => onSelect(element.id)}>
                        Go to {primaryText(element.name) || element.id} →
                      </button>
                    )}
                  </div>
                  <code>{issue.rule}</code>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
