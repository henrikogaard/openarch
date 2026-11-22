import { primaryText, scenarioCompare, type Model } from '@openarch/core';

interface ScenarioPanelProps {
  baseline: Model;
  target: Model;
  onOpenElement?: (id: string, which: Model) => void;
}

/** Side-by-side scenario (as-is vs to-be) comparison derived from core scoring. */
export default function ScenarioPanel({ baseline, target, onOpenElement }: ScenarioPanelProps) {
  const result = scenarioCompare(baseline, target, baseline.relationships, target.relationships);
  const toLabel = (model: Model, id: string) => {
    const element = model.elements.find((index) => index.id === id);
    return element ? primaryText(element.name) || element.type : id;
  };
  return (
    <div className="dashboard-grid">
      <section className="panel-card wide">
        <h3>
          Scenario comparison — {primaryText(baseline.name)} vs {primaryText(target.name)}
        </h3>
        <div className="stat-inline">
          <span className="issue-badge info">Overlap {Math.max(0, Math.round(result.score * 100))}%</span>
          <span className="issue-badge warning">~{result.changedElementIds.length} changed</span>
          <span className="issue-badge info">+{result.addedElementIds.length} new in target</span>
          <span className="issue-badge error">−{result.removedElementIds.length} dropped</span>
        </div>
        <div className="scenario-columns">
          <div className="scenario-column">
            <h4>Changed ({result.changedElementIds.length})</h4>
            <ul className="relation-list">
              {result.changedElementIds.slice(0, 40).map((id) => (
                <li key={id}>
                  <span className="chip">{id}</span>
                  <span>
                    {toLabel(baseline, id)} → {toLabel(target, id)}
                  </span>
                  {onOpenElement && (
                    <button className="small-button" onClick={() => onOpenElement(id, target)}>
                      Open
                    </button>
                  )}
                </li>
              ))}
              {result.changedElementIds.length === 0 && <li className="empty">No changed elements.</li>}
            </ul>
          </div>
          <div className="scenario-column">
            <h4>Census</h4>
            <ul className="relation-list">
              {result.addedElementIds.slice(0, 20).map((id) => (
                <li key={id}>
                  <span className="issue-badge info">+</span> {toLabel(target, id)}
                </li>
              ))}
              {result.removedElementIds.slice(0, 20).map((id) => (
                <li key={`r-${id}`}>
                  <span className="issue-badge error">−</span> {toLabel(baseline, id)}
                </li>
              ))}
              {result.addedElementIds.length + result.removedElementIds.length === 0 && (
                <li className="empty">Same element census.</li>
              )}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
