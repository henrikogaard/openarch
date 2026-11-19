import { primaryText, requirementCoverage, migrationTimeline, type Model } from '@openarch/core';
import type { Milestone, RequirementCoverage } from '@openarch/core';

/** Requirement traceability report: coverage matrix + uncovered list. */
export function TraceabilityPanel({ model, onSelect }: { model: Model; onSelect: (id: string) => void }) {
  const coverage: RequirementCoverage[] = requirementCoverage(model);
  const uncovered = coverage.filter((entry) => entry.realizingElements.length === 0);
  if (coverage.length === 0) {
    return (
      <div className="panel-card empty">
        No Requirement/Constraint/Principle elements — add them and link Realization
        relationships to see coverage.
      </div>
    );
  }
  return (
    <div className="dashboard-grid">
      <section className="panel-card wide">
        <h3>Requirements coverage ({coverage.length})</h3>
        <table className="relation-list">
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Realized by</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((entry) => (
              <tr key={entry.requirement.id}>
                <td>
                  <button className="link-button" onClick={() => onSelect(entry.requirement.id)}>
                    {primaryText(entry.requirement.name) || entry.requirement.id}
                  </button>
                </td>
                <td>
                  {entry.realizingElements.length === 0 ? (
                    <em className="muted">uncovered</em>
                  ) : (
                    entry.realizingElements.map((element) => (
                      <button key={element.id} className="chip" onClick={() => onSelect(element.id)}>
                        {primaryText(element.name) || element.id}
                      </button>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel-card">
        <h3>Uncovered ({uncovered.length})</h3>
        <ul className="relation-list">
          {uncovered.map((entry) => (
            <li key={entry.requirement.id}>
              <button className="link-button" onClick={() => onSelect(entry.requirement.id)}>
                {primaryText(entry.requirement.name) || entry.requirement.id}
              </button>
            </li>
          ))}
          {uncovered.length === 0 && <li className="empty">Every requirement has a realization.</li>}
        </ul>
      </section>
    </div>
  );
}

/** Migration timeline: Plateau / WorkPackage / Deliverable milestones. */
export function MigrationTimelinePanel({ model, onSelect }: { model: Model; onSelect: (id: string) => void }) {
  const timeline: Milestone[] = migrationTimeline(model);
  if (timeline.length === 0) {
    return (
      <div className="panel-card empty">
        No Plateau/WorkPackage/Deliverable elements — add them (with `date` properties) to build a
        migration timeline.
      </div>
    );
  }
  return (
    <section className="panel-card wide">
      <h3>Migration timeline ({timeline.length} milestones)</h3>
      <ol className="milestone-list">
        {timeline.map((milestone) => (
          <li key={milestone.id} className={`milestone milestone-${milestone.kind}`}>
            <button className="link-button" onClick={() => onSelect(milestone.id)}>
              {milestone.label}
            </button>
            <span className="muted">{milestone.kind}</span>
            {milestone.date && <span className="chip">{milestone.date}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
