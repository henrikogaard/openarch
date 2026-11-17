import {
  domainStats,
  elementsWithoutDomain,
  type Model,
} from '@openarch/core';
import { useMemo } from 'react';

interface DomainMapProps {
  model: Model;
  onSelectDomain: (domainId: string) => void;
}

const BOX_W = 210;
const BOX_H = 96;
const GAP_X = 90;
const GAP_Y = 110;
const COLUMNS = 3;

export default function DomainMap({ model, onSelectDomain }: DomainMapProps) {
  const stats = useMemo(() => domainStats(model), [model]);
  const unassigned = elementsWithoutDomain(model).length;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    stats.forEach((stat, index) => {
      map.set(stat.domain.id, {
        x: 40 + (index % COLUMNS) * (BOX_W + GAP_X),
        y: 40 + Math.floor(index / COLUMNS) * (BOX_H + GAP_Y),
      });
    });
    return map;
  }, [stats]);

  const width = Math.max(900, 40 + COLUMNS * (BOX_W + GAP_X));
  const height = Math.max(420, 80 + Math.ceil(stats.length / COLUMNS) * (BOX_H + GAP_Y));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Domain map</h2>
          <p>
            How the areas of this workspace relate. Line thickness reflects cross-domain
            relationships; click a domain to filter the editor.
          </p>
        </div>
        <div className="stat-inline">
          <span className="chip">{stats.length} domains</span>
          <span className="chip">{unassigned} unassigned</span>
        </div>
      </header>

      {stats.length === 0 ? (
        <div className="panel-card empty">
          <p className="muted">
            No domains yet. Add them in workspace settings, then assign elements in the inspector.
          </p>
        </div>
      ) : (
        <div className="panel-card">
          <svg
            className="domain-map"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Domain dependency map"
          >
            {stats.map((stat) => {
              const from = positions.get(stat.domain.id);
              if (!from) return null;
              return stats
                .filter((other) => other.domain.id !== stat.domain.id)
                .map((other) => {
                  const to = positions.get(other.domain.id);
                  if (!to) return null;
                  // Draw each pair once.
                  if (stat.domain.id > other.domain.id) return null;
                  const count = Math.min(stat.crossDomainCount, other.crossDomainCount);
                  if (count === 0) return null;
                  return (
                    <line
                      key={`${stat.domain.id}-${other.domain.id}`}
                      x1={from.x + BOX_W / 2}
                      y1={from.y + BOX_H / 2}
                      x2={to.x + BOX_W / 2}
                      y2={to.y + BOX_H / 2}
                      stroke="#94a3b8"
                      strokeWidth={Math.min(6, 1 + count / 4)}
                      strokeDasharray="4 4"
                    />
                  );
                });
            })}
            {stats.map((stat) => {
              const position = positions.get(stat.domain.id);
              if (!position) return null;
              return (
                <g
                  key={stat.domain.id}
                  className="graph-node"
                  onClick={() => onSelectDomain(stat.domain.id)}
                >
                  <rect
                    x={position.x}
                    y={position.y}
                    width={BOX_W}
                    height={BOX_H}
                    rx={10}
                    fill="#ffffff"
                    stroke={stat.domain.color ?? '#2563eb'}
                    strokeWidth={2}
                  />
                  <rect
                    x={position.x}
                    y={position.y}
                    width={8}
                    height={BOX_H}
                    rx={4}
                    fill={stat.domain.color ?? '#2563eb'}
                  />
                  <text x={position.x + 22} y={position.y + 28} fontSize={14} fontWeight={700}>
                    {stat.domain.name}
                  </text>
                  <text x={position.x + 22} y={position.y + 50} fontSize={11} fill="#64748b">
                    {stat.elementCount} elements · {stat.relationshipCount} internal
                  </text>
                  <text x={position.x + 22} y={position.y + 68} fontSize={11} fill="#64748b">
                    {stat.crossDomainCount} cross-domain links
                  </text>
                  {stat.domain.owner && (
                    <text x={position.x + 22} y={position.y + 86} fontSize={10} fill="#94a3b8">
                      Owner: {stat.domain.owner}
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
