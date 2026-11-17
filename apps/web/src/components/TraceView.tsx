import { getElementType, impactAnalysis, primaryText, traceElements, type Model } from '@openarch/core';
import { useMemo, useState } from 'react';

interface TraceViewProps {
  model: Model;
  selectedElementId: string | null;
  onSelect: (id: string) => void;
}

export default function TraceView({ model, selectedElementId, onSelect }: TraceViewProps) {
  const [elementId, setElementId] = useState(selectedElementId ?? model.elements[0]?.id ?? '');
  const [direction, setDirection] = useState<'both' | 'in' | 'out'>('both');
  const [depth, setDepth] = useState(2);
  const [impactOnly, setImpactOnly] = useState(false);

  const traces = useMemo(() => {
    if (!elementId) return [];
    return impactOnly
      ? impactAnalysis(model, elementId, depth)
      : traceElements(model, elementId, {
          directions: direction === 'both' ? ['in', 'out'] : [direction],
          maxDepth: depth,
        });
  }, [model, elementId, direction, depth, impactOnly]);

  const source = model.elements.find((element) => element.id === elementId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Traceability</h2>
          <p>Follow realization, serving, and dependency chains through the model.</p>
        </div>
      </header>

      <div className="panel-card controls">
        <label>
          Element
          <select value={elementId} onChange={(event) => setElementId(event.target.value)}>
            {model.elements.map((element) => (
              <option key={element.id} value={element.id}>
                {primaryText(element.name) || element.id} ({element.type})
              </option>
            ))}
          </select>
        </label>
        <label>
          Directions
          <select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)} disabled={impactOnly}>
            <option value="both">Both</option>
            <option value="in">Incoming</option>
            <option value="out">Outgoing</option>
          </select>
        </label>
        <label>
          Depth
          <input type="number" min={1} max={6} value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={impactOnly} onChange={(event) => setImpactOnly(event.target.checked)} />
          Impact only
        </label>
      </div>

      {source && (
        <div className="panel-card">
          <h3>{primaryText(source.name)}</h3>
          <p className="muted">{getElementType(source.type)?.label ?? source.type}</p>
        </div>
      )}

      <div className="panel-card">
        <h3>Reachable elements ({traces.length})</h3>
        <ul className="trace-list">
          {traces.map((trace, index) => (
            <li key={`${trace.element.id}-${index}`}>
              <span className="depth-pill">depth {trace.depth}</span>
              <span className="relation-direction">{trace.direction === 'in' ? '←' : '→'}</span>
              <button className="link-button" onClick={() => onSelect(trace.element.id)}>
                {primaryText(trace.element.name) || trace.element.id}
              </button>
              <span className="chip">{trace.relationship.type}</span>
              <span className="muted">{getElementType(trace.element.type)?.label ?? trace.element.type}</span>
            </li>
          ))}
          {traces.length === 0 && <li className="empty">No reachable elements found.</li>}
        </ul>
      </div>
    </div>
  );
}
