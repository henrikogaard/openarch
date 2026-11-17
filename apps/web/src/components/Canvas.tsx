import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  ELEMENT_TYPES,
  elementAttributes,
  elementsByLayer,
  getElementType,
  getRelationshipType,
  LAYER_LABELS,
  primaryText,
  type ArchiElement,
  type Bounds,
  type Domain,
  type Layer,
  type Relationship,
  type View,
} from '@openarch/core';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../i18n';

interface ArchiNodeData extends Record<string, unknown> {
  label: string;
  typeId: string;
  elementId: string;
  dimmed: boolean;
  attributes: Array<{ key: string; value: string }>;
}

interface LabelNodeData extends Record<string, unknown> {
  label: string;
}

function ArchiShape({ data, selected }: NodeProps) {
  const nodeData = data as ArchiNodeData;
  const definition = getElementType(nodeData.typeId);
  return (
    <div
      className={`archi-node shape-${definition?.shape ?? 'square'} ${selected ? 'is-selected' : ''} ${nodeData.dimmed ? 'is-dimmed' : ''}`}
      style={{ background: definition?.color ?? '#eee' }}
      title={definition?.label}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Top} id="top" />
      <span className="archi-node-badge">{definition?.letter ?? '?'}</span>
      <span className="archi-node-icon">{definition?.icon ?? ''}</span>
      <span className="archi-node-label">{nodeData.label}</span>
      <span className="archi-node-type">{definition?.label ?? nodeData.typeId}</span>
      {nodeData.attributes.length > 0 && (
        <span className="archi-node-attributes">
          {nodeData.attributes.map((attribute) => (
            <span key={attribute.key}>
              {attribute.key}: {attribute.value}
            </span>
          ))}
        </span>
      )}
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

function LabelShape({ data }: NodeProps) {
  const nodeData = data as LabelNodeData;
  return <div className="archi-group-label">{nodeData.label}</div>;
}

const nodeTypes = { archi: ArchiShape, label: LabelShape };

function toFlowNodes(
  view: View,
  elements: ArchiElement[],
  domains: Domain[],
  visibleLayers: Set<Layer>,
  environmentFilter: string,
): Node[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return view.nodes.map((node) => {
    if (!node.elementRef) {
      return {
        id: node.id,
        type: 'label',
        position: { x: node.bounds.x, y: node.bounds.y },
        style: { width: node.bounds.w, height: node.bounds.h },
        data: { label: primaryText(node.label) } as LabelNodeData,
        selectable: false,
        draggable: false,
        connectable: false,
      };
    }
    const element = byId.get(node.elementRef);
    const layer = getElementType(element?.type ?? '')?.layer;
    const hiddenLayer = Boolean(layer && !visibleLayers.has(layer));
    const hiddenEnvironment = Boolean(
      environmentFilter !== 'all' &&
        element?.environment &&
        element.environment !== environmentFilter,
    );
    const attributes =
      element && view.config?.attributes?.length
        ? elementAttributes(domains, element, view.config.attributes)
        : [];
    const data: ArchiNodeData = {
      label: primaryText(element?.name ?? []) || 'Unnamed element',
      typeId: element?.type ?? 'BusinessActor',
      elementId: node.elementRef,
      dimmed: hiddenLayer || hiddenEnvironment,
      attributes,
    };
    return {
      id: node.id,
      type: 'archi',
      position: { x: node.bounds.x, y: node.bounds.y },
      style: { width: node.bounds.w, height: node.bounds.h },
      data,
    };
  });
}

function toFlowEdges(view: View, relationships: Relationship[]): Edge[] {
  const byId = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  return view.edges.map((edge) => {
    const relationship = byId.get(edge.relationshipRef);
    const definition = relationship ? getRelationshipType(relationship.type) : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: relationship?.type ?? '',
      type: 'smoothstep',
      style: {
        stroke: '#475569',
        strokeWidth: 1.6,
        strokeDasharray: definition?.lineStyle === 'dashed' ? '6 4' : undefined,
      },
      labelStyle: { fill: '#475569', fontSize: 10 },
      labelBgStyle: { fill: '#ffffffcc' },
      markerEnd: {
        type: definition?.arrow === 'filled' ? MarkerType.ArrowClosed : MarkerType.Arrow,
        width: 16,
        height: 16,
        color: '#475569',
      },
    };
  });
}

interface CanvasProps {
  view: View;
  elements: ArchiElement[];
  relationships: Relationship[];
  domains: Domain[];
  visibleLayers: Set<Layer>;
  environmentFilter: string;
  onSelectElement: (id: string) => void;
  onNodeMove: (nodeId: string, bounds: Bounds) => void;
  onAddElement: (type: string) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onNodesDelete: (nodeIds: string[]) => void;
  onEdgesDelete: (edgeIds: string[]) => void;
  onBulkAssign: (elementIds: string[], patch: { domain?: string; environment?: string }) => void;
}

export default function Canvas({
  view,
  elements,
  relationships,
  domains,
  visibleLayers,
  environmentFilter,
  onSelectElement,
  onNodeMove,
  onAddElement,
  onConnect,
  onNodesDelete,
  onEdgesDelete,
  onBulkAssign,
}: CanvasProps) {
  const t = useTranslation();
  const initialNodes = useMemo(
    () => toFlowNodes(view, elements, domains, visibleLayers, environmentFilter),
    [view, elements, domains, visibleLayers, environmentFilter],
  );
  const initialEdges = useMemo(() => toFlowEdges(view, relationships), [view, relationships]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);

  useEffect(() => setNodes(initialNodes), [initialNodes, setNodes]);
  useEffect(() => setEdges(initialEdges), [initialEdges, setEdges]);

  const matches = ELEMENT_TYPES.filter((type) =>
    `${type.label} ${type.id}`.toLowerCase().includes(query.toLowerCase()),
  );

  const selectedElementIds = useMemo(
    () =>
      nodes
        .filter((node) => selectedNodeIds.includes(node.id))
        .map((node) => (node.data as ArchiNodeData).elementId)
        .filter((id): id is string => Boolean(id)),
    [nodes, selectedNodeIds],
  );
  const selectionCount = selectedNodeIds.length + selectedEdgeIds.length;

  const deleteSelection = () => {
    if (selectedNodeIds.length) onNodesDelete(selectedNodeIds);
    if (selectedEdgeIds.length) onEdgesDelete(selectedEdgeIds);
  };

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
          // Reference-stable updates: React Flow re-emits selection on store
          // changes, and a fresh array every time would loop renders.
          const nextNodeIds = selectedNodes.map((node) => node.id);
          const nextEdgeIds = selectedEdges.map((edge) => edge.id);
          setSelectedNodeIds((prev) =>
            prev.length === nextNodeIds.length && prev.every((id, i) => id === nextNodeIds[i])
              ? prev
              : nextNodeIds,
          );
          setSelectedEdgeIds((prev) =>
            prev.length === nextEdgeIds.length && prev.every((id, i) => id === nextEdgeIds[i])
              ? prev
              : nextEdgeIds,
          );
        }}
        onNodesDelete={(deleted) => onNodesDelete(deleted.map((node) => node.id))}
        onEdgesDelete={(deleted) => onEdgesDelete(deleted.map((edge) => edge.id))}
        onConnect={(connection: Connection) => {
          if (connection.source && connection.target) onConnect(connection.source, connection.target);
        }}
        onNodeClick={(_, node) => onSelectElement((node.data as ArchiNodeData).elementId)}
        onNodeDragStop={(_, node) =>
          onNodeMove(node.id, {
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
            w: Math.round(node.measured?.width ?? node.width ?? 170),
            h: Math.round(node.measured?.height ?? node.height ?? 64),
          })
        }
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#d8dee9" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => getElementType((node.data as ArchiNodeData).typeId)?.color ?? '#ddd'}
        />
        <Panel position="top-left" className="canvas-palette">
          <button onClick={() => setPaletteOpen((open) => !open)}>{t('addElement')} ▾</button>
          {paletteOpen && (
            <div className="palette-popover">
              <input
                autoFocus
                type="search"
                placeholder="Search element types…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="palette-groups">
                {elementsByLayer().map(({ layer, types }) => {
                  const visible = types.filter((type) => matches.includes(type));
                  if (!visible.length) return null;
                  return (
                    <div key={layer}>
                      <strong>{LAYER_LABELS[layer]}</strong>
                      <div className="palette-items">
                        {visible.map((type) => (
                          <button
                            key={type.id}
                            onClick={() => {
                              onAddElement(type.id);
                              setPaletteOpen(false);
                              setQuery('');
                            }}
                          >
                            <span className="swatch" style={{ background: type.color }} />
                            {type.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>
        <Panel position="top-right" className="canvas-hint">
          Drag a handle between elements to connect · valid relationship types are suggested · Shift-click to
          multi-select · Delete removes the selection from the model
        </Panel>
        {selectionCount > 0 && (
          <Panel position="bottom-center" className="selection-bar">
            <strong>
              {selectionCount} {t('selected')}
            </strong>
            <button onClick={deleteSelection}>{t('delete')}</button>
            {selectedElementIds.length > 0 && (
              <>
                <label>
                  {t('domain')}
                  <select
                    value=""
                    aria-label={`Set domain for ${selectedElementIds.length} elements`}
                    onChange={(event) => {
                      const value = event.target.value;
                      onBulkAssign(selectedElementIds, { domain: value || undefined });
                    }}
                  >
                    <option value="">{t('noDomain')}</option>
                    {domains.map((domain) => (
                      <option key={domain.id} value={domain.id}>
                        {domain.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('environment')}
                  <select
                    value=""
                    aria-label={`Set environment for ${selectedElementIds.length} elements`}
                    onChange={(event) => {
                      const value = event.target.value;
                      onBulkAssign(selectedElementIds, { environment: value || undefined });
                    }}
                  >
                    <option value="">{t('noEnvironment')}</option>
                    <option value="dev">dev</option>
                    <option value="staging">staging</option>
                    <option value="prod">prod</option>
                  </select>
                </label>
              </>
            )}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
