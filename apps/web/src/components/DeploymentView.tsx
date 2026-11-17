import { getElementType, primaryText, type Model } from '@openarch/core';
import { useMemo } from 'react';

interface DeploymentViewProps {
  model: Model;
  environment: string;
  onSelect: (id: string) => void;
}

const DEPLOYMENT_TYPES = [
  'CommunicationNetwork',
  'Node',
  'Device',
  'SystemSoftware',
  'Artifact',
  'ApplicationComponent',
];

const BOX_W = 200;
const BOX_H = 74;
const GAP_X = 70;
const GAP_Y = 90;
const COLUMNS = 4;

export default function DeploymentView({ model, environment, onSelect }: DeploymentViewProps) {
  const elements = useMemo(
    () =>
      model.elements.filter(
        (element) =>
          DEPLOYMENT_TYPES.includes(element.type) &&
          (environment === 'all' || !element.environment || element.environment === environment),
      ),
    [model, environment],
  );

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    elements.forEach((element, index) => {
      map.set(element.id, {
        x: 40 + (index % COLUMNS) * (BOX_W + GAP_X),
        y: 40 + Math.floor(index / COLUMNS) * (BOX_H + GAP_Y),
      });
    });
    return map;
  }, [elements]);

  const ids = new Set(elements.map((element) => element.id));
  const edges = model.relationships.filter(
    (relationship) => ids.has(relationship.source) && ids.has(relationship.target),
  );

  const width = Math.max(900, 40 + COLUMNS * (BOX_W + GAP_X));
  const height = Math.max(420, 80 + Math.ceil(elements.length / COLUMNS) * (BOX_H + GAP_Y));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Deployment view</h2>
          <p>
            Runtime topology generated from the model: networks, nodes, system software, artifacts,
            and the applications they host.
          </p>
        </div>
        <div className="stat-inline">
          <span className="chip">{elements.length} deployment elements</span>
          <span className="chip">{edges.length} links</span>
          <span className="chip">{environment === 'all' ? 'All environments' : environment}</span>
        </div>
      </header>

      {elements.length === 0 ? (
        <div className="panel-card empty">
          <p className="muted">
            No deployment elements for this environment. Add Nodes, Devices, System Software, or
            Artifacts, and tag them with an environment.
          </p>
        </div>
      ) : (
        <div className="panel-card">
          <svg
            className="domain-map"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Deployment topology"
          >
            <defs>
              <marker id="deploy-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
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
                  x1={from.x + BOX_W / 2}
                  y1={from.y + BOX_H / 2}
                  x2={to.x + BOX_W / 2}
                  y2={to.y + BOX_H / 2}
                  stroke="#475569"
                  strokeWidth={1.4}
                  strokeDasharray={relationship.type === 'Realization' ? '5 4' : undefined}
                  markerEnd="url(#deploy-arrow)"
                />
              );
            })}
            {elements.map((element) => {
              const position = positions.get(element.id);
              if (!position) return null;
              const definition = getElementType(element.type);
              return (
                <g key={element.id} className="graph-node" onClick={() => onSelect(element.id)}>
                  <rect
                    x={position.x}
                    y={position.y}
                    width={BOX_W}
                    height={BOX_H}
                    rx={6}
                    fill={definition?.color ?? '#e2e2e2'}
                    stroke="#475569"
                  />
                  <text x={position.x + 10} y={position.y + 20} fontSize={9} fontWeight={700}>
                    {definition?.label ?? element.type}
                  </text>
                  <text x={position.x + 10} y={position.y + 42} fontSize={12} fontWeight={700}>
                    {(primaryText(element.name) || element.id).slice(0, 26)}
                  </text>
                  {element.environment && (
                    <text x={position.x + 10} y={position.y + 62} fontSize={9} fill="#475569">
                      env: {element.environment}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
