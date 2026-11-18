import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
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
  type NodeAlignment,
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

/**
 * React Flow only auto-fits on mount, when the pane can still measure 0×0
 * (the workspace route is just mounting), which leaves the initial view at
 * max zoom with nodes under the inspector. Re-fit shortly after the view id
 * changes, once layout has settled.
 */
function FitViewOnChange({ viewId }: { viewId: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 60);
    return () => window.clearTimeout(timer);
  }, [viewId, fitView]);
  return null;
}

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
  onAlign: (alignment: NodeAlignment) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  snapToGrid: boolean;
  onSelectionChange?: (nodeIds: string[], edgeIds: string[]) => void;
  onRenameElement: (elementId: string, name: string) => void;
  onDuplicateNodes: (nodeIds: string[]) => void;
  onPaste: () => void;
  hasClipboard: boolean;
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
  onAlign,
  onDistribute,
  snapToGrid,
  onSelectionChange,
  onRenameElement,
  onDuplicateNodes,
  onPaste,
  hasClipboard,
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
  const [editing, setEditing] = useState<{ nodeId: string; x: number; y: number; w: number; value: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);

  const startRename = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const elementId = node?.data ? (node.data as ArchiNodeData).elementId : undefined;
    if (!elementId) return;
    const dom = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
    const box = dom?.getBoundingClientRect();
    setEditing({
      nodeId,
      x: box?.x ?? 0,
      y: box?.y ?? 0,
      w: box?.width ?? 170,
      value: (node?.data as ArchiNodeData).label ?? '',
    });
  };

  const commitRename = () => {
    if (!editing) return;
    const node = nodes.find((candidate) => candidate.id === editing.nodeId);
    const elementId = node?.data ? (node.data as ArchiNodeData).elementId : undefined;
    if (elementId && editing.value.trim()) onRenameElement(elementId, editing.value.trim());
    setEditing(null);
  };

  // Sync from the model, but keep React Flow's own selection flags so that
  // model commits (align, bulk-assign, …) do not clear the user's selection.
  useEffect(() => {
    setNodes((current) =>
      initialNodes.map((node) => {
        const existing = current.find((candidate) => candidate.id === node.id);
        return existing ? { ...node, selected: existing.selected } : node;
      }),
    );
  }, [initialNodes, setNodes]);
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
    <div className="canvas-wrap" onClick={() => setContextMenu(null)}>
      <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
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
          onSelectionChange?.(nextNodeIds, nextEdgeIds);
        }}
        onNodesDelete={(deleted) => onNodesDelete(deleted.map((node) => node.id))}
        onEdgesDelete={(deleted) => onEdgesDelete(deleted.map((edge) => edge.id))}
        onConnect={(connection: Connection) => {
          if (connection.source && connection.target) onConnect(connection.source, connection.target);
        }}
        onNodeClick={(_, node) => onSelectElement((node.data as ArchiNodeData).elementId)}
        onNodeDoubleClick={(_, node) => startRename(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY, nodeId: null });
        }}
        onPaneClick={() => setContextMenu(null)}
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
          Drag a handle between elements to connect · Shift-click to multi-select · double-click to rename ·
          right-click for the context menu · ⌘/Ctrl+C/V/D copy, paste, duplicate · Delete removes the selection
        </Panel>
        {selectionCount > 0 && (
          <Panel position="bottom-center" className="selection-bar">
            <strong>
              {selectionCount} {t('selected')}
            </strong>
            <button onClick={deleteSelection}>{t('delete')}</button>
            {selectedNodeIds.length >= 2 && (
              <>
                <select
                  value=""
                  aria-label="Align selection"
                  onChange={(event) => {
                    if (event.target.value) onAlign(event.target.value as NodeAlignment);
                  }}
                >
                  <option value="">Align…</option>
                  <option value="left">Left</option>
                  <option value="center-x">Center</option>
                  <option value="right">Right</option>
                  <option value="top">Top</option>
                  <option value="center-y">Middle</option>
                  <option value="bottom">Bottom</option>
                </select>
                <select
                  value=""
                  aria-label="Distribute selection"
                  onChange={(event) => {
                    if (event.target.value) onDistribute(event.target.value as 'x' | 'y');
                  }}
                >
                  <option value="">Distribute…</option>
                  <option value="x">Horizontally</option>
                  <option value="y">Vertically</option>
                </select>
              </>
            )}
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
        <FitViewOnChange viewId={view.id} />
      </ReactFlow>
      {editing && (
        <input
          className="node-rename-input"
          style={{ left: editing.x, top: editing.y, width: editing.w }}
          autoFocus
          value={editing.value}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitRename();
            if (event.key === 'Escape') setEditing(null);
          }}
        />
      )}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.nodeId ? (
            <>
              <button
                onClick={() => {
                  startRename(contextMenu.nodeId!);
                  setContextMenu(null);
                }}
              >
                Rename…
              </button>
              <button
                onClick={() => {
                  onDuplicateNodes([contextMenu.nodeId!]);
                  setContextMenu(null);
                }}
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  onNodesDelete([contextMenu.nodeId!]);
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              disabled={!hasClipboard}
              onClick={() => {
                onPaste();
                setContextMenu(null);
              }}
            >
              Paste
            </button>
          )}
        </div>
      )}
      </ReactFlowProvider>
    </div>
  );
}
