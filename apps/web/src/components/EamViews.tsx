import {
  getElementType,
  primaryText,
  type ArchiElement,
  type Model,
  type Relationship,
} from '@openarch/core';
import { type ReactElement, useMemo, useState } from 'react';

interface EamViewsProps {
  model: Model;
  onSelect: (id: string) => void;
}

type ViewId = 'capabilities' | 'applications' | 'technology' | 'dependencies';

function label(element: { id: string; name: Array<{ value: string }> }): string {
  return primaryText(element.name) || element.id;
}

function relationshipsOf(model: Model, elementId: string): Relationship[] {
  return model.relationships.filter(
    (relationship) => relationship.source === elementId || relationship.target === elementId,
  );
}

function CapabilityTree({ model, onSelect }: EamViewsProps) {
  const capabilities = model.elements.filter((element) => element.type === 'Capability');
  const parents = new Map<string, string>();
  for (const relationship of model.relationships) {
    if (
      relationship.type === 'Composition' &&
      capabilities.some((item) => item.id === relationship.target) &&
      capabilities.some((item) => item.id === relationship.source)
    ) {
      parents.set(relationship.target, relationship.source);
    }
  }
  const roots = capabilities.filter((element) => !parents.has(element.id));

  const render = (element: ArchiElement, depth: number): ReactElement => {
    const children = capabilities.filter((item) => parents.get(item.id) === element.id);
    return (
      <li key={element.id} style={{ marginLeft: depth * 18 }}>
        <button className="link-button" onClick={() => onSelect(element.id)}>
          {label(element)}
        </button>
        <span className="muted">({relationshipsOf(model, element.id).length} relations)</span>
        {children.length > 0 && (
          <ul>{children.map((child) => render(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="panel-card">
      <h3>Capability tree ({capabilities.length})</h3>
      {roots.length ? (
        <ul className="tree-list">{roots.map((root) => render(root, 0))}</ul>
      ) : (
        <p className="muted empty">No Capability elements. Add some in the editor to build the tree.</p>
      )}
    </div>
  );
}

function Catalog({
  model,
  onSelect,
  types,
  title,
}: EamViewsProps & { types: string[]; title: string }) {
  const elements = model.elements.filter((element) => types.includes(element.type));
  const byId = new Map(model.elements.map((element) => [element.id, element]));

  const consumers = (element: ArchiElement): string[] =>
    model.relationships
      .filter((relationship) => relationship.target === element.id && ['Serving', 'Realization'].includes(relationship.type))
      .map((relationship) => label(byId.get(relationship.source) ?? { id: relationship.source, name: [] }));

  const supporters = (element: ArchiElement): string[] =>
    model.relationships
      .filter((relationship) => relationship.source === element.id && ['Realization', 'Assignment', 'Serving'].includes(relationship.type))
      .map((relationship) => label(byId.get(relationship.target) ?? { id: relationship.target, name: [] }));

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Layer</th>
            <th>Relations</th>
            <th>{types.some((type) => type.startsWith('Application')) ? 'Supported by' : 'Supports'}</th>
          </tr>
        </thead>
        <tbody>
          {elements.map((element) => (
            <tr key={element.id} onClick={() => onSelect(element.id)}>
              <td>{label(element)}</td>
              <td>{getElementType(element.type)?.label ?? element.type}</td>
              <td><span className="layer-pill">{getElementType(element.type)?.layer ?? 'other'}</span></td>
              <td>{relationshipsOf(model, element.id).length}</td>
              <td>{(types.some((type) => type.startsWith('Application')) ? supporters(element) : consumers(element)).slice(0, 4).join(', ') || '—'}</td>
            </tr>
          ))}
          {elements.length === 0 && (
            <tr><td colSpan={5} className="empty">No elements of this type in the model.</td></tr>
          )}
        </tbody>
      </table>
      <p className="muted table-caption">{title} — {elements.length} elements</p>
    </div>
  );
}

function DependencyGraph({ model, onSelect }: EamViewsProps) {
  const apps = model.elements.filter((element) =>
    ['ApplicationComponent', 'ApplicationService'].includes(element.type),
  );
  const ids = new Set(apps.map((element) => element.id));
  const edges = model.relationships.filter(
    (relationship) =>
      ids.has(relationship.source) && ids.has(relationship.target) &&
      ['Serving', 'Flow', 'Realization'].includes(relationship.type),
  );

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    apps.forEach((element, index) => {
      const viewNode = model.views[0]?.nodes.find((node) => node.elementRef === element.id);
      map.set(element.id, viewNode
        ? { x: viewNode.bounds.x, y: viewNode.bounds.y }
        : { x: 60 + (index % 5) * 190, y: 60 + Math.floor(index / 5) * 110 });
    });
    return map;
  }, [apps, model.views]);

  const width = 900;
  const height = 520;

  return (
    <div className="panel-card">
      <h3>Application dependency graph ({apps.length} nodes, {edges.length} edges)</h3>
      {apps.length === 0 ? (
        <p className="muted empty">Add application elements to see dependencies.</p>
      ) : (
        <svg className="dependency-graph" viewBox={`-40 -40 ${width} ${height}`} role="img" aria-label="Application dependency graph">
          <defs>
            <marker id="dep-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#475569" />
            </marker>
          </defs>
          {edges.map((relationship) => {
            const from = positions.get(relationship.source);
            const to = positions.get(relationship.target);
            if (!from || !to) return null;
            return (
              <line
                key={relationship.id}
                x1={from.x + 60} y1={from.y + 24}
                x2={to.x + 60} y2={to.y + 24}
                stroke="#475569" strokeWidth={1.4} strokeDasharray={relationship.type === 'Realization' ? '5 4' : undefined}
                markerEnd="url(#dep-arrow)"
              />
            );
          })}
          {apps.map((element) => {
            const position = positions.get(element.id)!;
            return (
              <g key={element.id} onClick={() => onSelect(element.id)} className="graph-node">
                <rect x={position.x} y={position.y} width={120} height={48} rx={6}
                  fill={getElementType(element.type)?.color ?? '#eee'} stroke="#475569" />
                <text x={position.x + 60} y={position.y + 20} textAnchor="middle" fontSize={10} fontWeight={700}>
                  {label(element).slice(0, 18)}
                </text>
                <text x={position.x + 60} y={position.y + 35} textAnchor="middle" fontSize={8} fill="#475569">
                  {getElementType(element.type)?.label ?? element.type}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export default function EamViews({ model, onSelect }: EamViewsProps) {
  const [view, setView] = useState<ViewId>('capabilities');
  const views: Array<{ id: ViewId; label: string }> = [
    { id: 'capabilities', label: 'Capability tree' },
    { id: 'applications', label: 'Application catalogue' },
    { id: 'technology', label: 'Technology catalogue' },
    { id: 'dependencies', label: 'Dependency graph' },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>EAM views</h2>
          <p>Portfolio views generated from the same model you author — no separate repository.</p>
        </div>
      </header>
      <div className="filter-row">
        {views.map((item) => (
          <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {view === 'capabilities' ? (
        <CapabilityTree model={model} onSelect={onSelect} />
      ) : view === 'applications' ? (
        <Catalog
          model={model} onSelect={onSelect}
          types={['ApplicationComponent', 'ApplicationService']}
          title="Application catalogue"
        />
      ) : view === 'technology' ? (
        <Catalog
          model={model} onSelect={onSelect}
          types={['Node', 'Device', 'SystemSoftware', 'Artifact']}
          title="Technology catalogue"
        />
      ) : (
        <DependencyGraph model={model} onSelect={onSelect} />
      )}
    </div>
  );
}
