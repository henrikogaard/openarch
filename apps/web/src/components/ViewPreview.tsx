import {
  elementAttributes,
  getElementType,
  getRelationshipType,
  primaryText,
  type Model,
  type View,
} from '@openarch/core';

interface ViewPreviewProps {
  view: View;
  model: Model;
}

export default function ViewPreview({ view, model }: ViewPreviewProps) {
  const nodes = view.nodes;
  const bounds = nodes.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, node.bounds.x),
      minY: Math.min(acc.minY, node.bounds.y),
      maxX: Math.max(acc.maxX, node.bounds.x + node.bounds.w),
      maxY: Math.max(acc.maxY, node.bounds.y + node.bounds.h),
    }),
    { minX: 0, minY: 0, maxX: 800, maxY: 400 },
  );
  const padding = 30;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;
  const offsetX = padding - bounds.minX;
  const offsetY = padding - bounds.minY;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const elementById = new Map(model.elements.map((element) => [element.id, element]));
  const relationshipById = new Map(
    model.relationships.map((relationship) => [relationship.id, relationship]),
  );

  return (
    <svg
      className="view-preview"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={primaryText(view.name)}
    >
      <defs>
        <marker id="preview-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" fill="#475569" />
        </marker>
      </defs>

      {view.edges.map((edge) => {
        const from = nodeById.get(edge.source);
        const to = nodeById.get(edge.target);
        if (!from || !to) return null;
        const relationship = relationshipById.get(edge.relationshipRef);
        return (
          <g key={edge.id}>
            <line
              x1={from.bounds.x + offsetX + from.bounds.w / 2}
              y1={from.bounds.y + offsetY + from.bounds.h / 2}
              x2={to.bounds.x + offsetX + to.bounds.w / 2}
              y2={to.bounds.y + offsetY + to.bounds.h / 2}
              stroke="#475569"
              strokeWidth={1.3}
              strokeDasharray={relationship?.type === 'Realization' ? '5 4' : undefined}
              markerEnd="url(#preview-arrow)"
            />
            {relationship && (
              <text
                x={(from.bounds.x + to.bounds.x) / 2 + offsetX + from.bounds.w / 2}
                y={(from.bounds.y + to.bounds.y) / 2 + offsetY + from.bounds.h / 2 - 4}
                fontSize={9}
                fill="#64748b"
                textAnchor="middle"
              >
                {getRelationshipType(relationship.type)?.label ?? relationship.type}
              </text>
            )}
          </g>
        );
      })}

      {nodes.map((node) => {
        const x = node.bounds.x + offsetX;
        const y = node.bounds.y + offsetY;
        if (!node.elementRef) {
          return (
            <text key={node.id} x={x} y={y + 16} fontSize={13} fontWeight={700} fill="#334155">
              {primaryText(node.label)}
            </text>
          );
        }
        const element = elementById.get(node.elementRef);
        if (!element) return null;
        const definition = getElementType(element.type);
        const attributes = view.config?.attributes?.length
          ? elementAttributes(model.domains, element, view.config.attributes)
          : [];
        return (
          <g key={node.id}>
            <rect
              x={x}
              y={y}
              width={node.bounds.w}
              height={node.bounds.h}
              rx={definition?.shape === 'rounded' ? 16 : 3}
              fill={definition?.color ?? '#e2e2e2'}
              stroke="#475569"
            />
            <text x={x + 8} y={y + 16} fontSize={9} fontWeight={700} fill="#334155">
              {definition?.label ?? element.type}
            </text>
            <text x={x + node.bounds.w / 2} y={y + 36} fontSize={12} fontWeight={700} textAnchor="middle">
              {(primaryText(element.name) || element.id).slice(0, 26)}
            </text>
            {attributes.slice(0, 3).map((attribute, index) => (
              <text
                key={attribute.key}
                x={x + node.bounds.w / 2}
                y={y + 52 + index * 11}
                fontSize={9}
                fill="#475569"
                textAnchor="middle"
              >
                {attribute.key}: {attribute.value}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
