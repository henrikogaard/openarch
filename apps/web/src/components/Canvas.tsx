import {
  Background,
  BaseEdge,
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
  type EdgeProps,
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
  type Point,
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

interface BendableEdgeData extends Record<string, unknown> {
  bendpoints: Point[];
  onBendpointDrag: (index: number, point: Point) => void;
}

function ArchiShape({ data, selected }: NodeProps) {
  const nodeData = data as ArchiNodeData;
  const definition = getElementType(nodeData.typeId);
  const isGroup = nodeData.typeId === 'Grouping';
  return (
    <div
      className={`archi-node shape-${definition?.shape ?? 'square'} ${isGroup ? 'is-group' : ''} ${selected ? 'is-selected' : ''} ${nodeData.dimmed ? 'is-dimmed' : ''}`}
      style={{ background: isGroup ? 'transparent' : definition?.color ?? '#eee' }}
      title={definition?.label}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Top} id="top" />
      {!isGroup && <span className="archi-node-badge">{definition?.letter ?? '?'}</span>}
      {!isGroup && <span className="archi-node-icon">{definition?.icon ?? ''}</span>}
      <span className="archi-node-label">{nodeData.label}</span>
      {!isGroup && <span className="archi-node-type">{definition?.label ?? nodeData.typeId}</span>}
      {!isGroup && nodeData.attributes.length > 0 && (
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

/** Edge rendered as a polyline through its bendpoints; bendpoints are draggable. */
function BendableEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, style }: EdgeProps) {
  const edgeData = data as BendableEdgeData;
  const { screenToFlowPosition } = useReactFlow();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const bendpoints = (edgeData.bendpoints ?? []).map((point, index) =>
    dragIndex === index && dragPos ? dragPos : point,
  );
  const d = `M ${sourceX},${sourceY} ${bendpoints.map((point) => `L ${point.x},${point.y}`).join(' ')} L ${targetX},${targetY}`;
  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd} style={style} interactionWidth={14} />
      {bendpoints.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={5}
          className={`edge-bendpoint${dragIndex === index ? ' dragging' : ''}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            setDragIndex(index);
            const move = (moveEvent: PointerEvent) =>
              setDragPos(screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY }));
            const up = (upEvent: PointerEvent) => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              const finalPos = screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
              edgeData.onBendpointDrag(index, { x: Math.round(finalPos.x), y: Math.round(finalPos.y) });
              setDragIndex(null);
              setDragPos(null);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
      ))}
    </>
  );
}

const nodeTypes = { archi: ArchiShape, label: LabelShape };
const edgeTypes = { bendable: BendableEdge };

/**
 * React Flow only auto-fits on mount, when the pane can still measure 0×0
 * (the workspace route is just mounting), which leaves the initial view at
 * max zoom with nodes under the inspector. Re-fit shortly after the view id
 * or the fit signal changes, once layout has settled.
 */
function FitViewOnChange({ viewId, signal }: { viewId: string; signal: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const timer = window.setTimeout(() => fitView({ padding: 0.2, maxZoom: 1 }), 60);
    return () => window.clearTimeout(timer);
  }, [viewId, signal, fitView]);
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
  const boundsById = new Map(view.nodes.map((node) => [node.id, node.bounds]));
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
    // React Flow positions child nodes relative to their parent.
    const parent = node.parentId ? boundsById.get(node.parentId) : undefined;
    const position = parent
      ? { x: node.bounds.x - parent.x, y: node.bounds.y - parent.y }
      : { x: node.bounds.x, y: node.bounds.y };
    return {
      id: node.id,
      type: 'archi',
      position,
      style: {
        width: node.bounds.w,
        height: node.bounds.h,
        ...(node.zIndex !== undefined ? { zIndex: node.zIndex } : {}),
      },
      data,
      ...(node.parentId ? { parentId: node.parentId } : {}),
    };
  });
}

function toFlowEdges(
  view: View,
  relationships: Relationship[],
  onBendpointDrag: (edgeId: string, index: number, point: Point) => void,
): Edge[] {
  const byId = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  return view.edges.map((edge) => {
    const relationship = byId.get(edge.relationshipRef);
    const definition = relationship ? getRelationshipType(relationship.type) : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: relationship?.type ?? '',
      type: 'bendable',
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
      data: {
        bendpoints: edge.bendpoints,
        onBendpointDrag: (index: number, point: Point) => onBendpointDrag(edge.id, index, point),
      } as BendableEdgeData,
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
  onAddElementAt: (type: string, position: Point) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onReconnectEdge: (edgeId: string, sourceNodeId: string, targetNodeId: string) => void;
  onAddBendpoint: (edgeId: string, point: Point) => void;
  onMoveBendpoint: (edgeId: string, index: number, point: Point) => void;
  onNodesDelete: (nodeIds: string[]) => void;
  onEdgesDelete: (edgeIds: string[]) => void;
  onBulkAssign: (elementIds: string[], patch: { domain?: string; environment?: string }) => void;
  onAlign: (alignment: NodeAlignment) => void;
  onDistribute: (axis: 'x' | 'y') => void;
  onGroup: () => void;
  onUngroup: () => void;
  onZOrder: (position: 'front' | 'back') => void;
  snapToGrid: boolean;
  fitSignal: number;
  colorMode: 'light' | 'dark';
  onSelectionChange?: (nodeIds: string[], edgeIds: string[]) => void;
  onRenameElement: (elementId: string, name: string) => void;
  onDuplicateNodes: (nodeIds: string[]) => void;
  onPaste: () => void;
  hasClipboard: boolean;
}

export default function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  );
}

function CanvasFlow({
  view,
  elements,
  relationships,
  domains,
  visibleLayers,
  environmentFilter,
  onSelectElement,
  onNodeMove,
  onAddElement,
  onAddElementAt,
  onConnect,
  onReconnectEdge,
  onAddBendpoint,
  onMoveBendpoint,
  onNodesDelete,
  onEdgesDelete,
  onBulkAssign,
  onAlign,
  onDistribute,
  onGroup,
  onUngroup,
  onZOrder,
  snapToGrid,
  fitSignal,
  colorMode,
  onSelectionChange,
  onRenameElement,
  onDuplicateNodes,
  onPaste,
  hasClipboard,
}: CanvasProps) {
  const t = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const initialNodes = useMemo(
    () => toFlowNodes(view, elements, domains, visibleLayers, environmentFilter),
    [view, elements, domains, visibleLayers, environmentFilter],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const initialEdges = useMemo(
    () => toFlowEdges(view, relationships, onMoveBendpoint),
    [view, relationships, onMoveBendpoint],
  );
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
  const selectionHasParent = nodes.some(
    (node) => selectedNodeIds.includes(node.id) && node.parentId,
  );

  const deleteSelection = () => {
    if (selectedNodeIds.length) onNodesDelete(selectedNodeIds);
    if (selectedEdgeIds.length) onEdgesDelete(selectedEdgeIds);
  };

  return (
    <div className="canvas-wrap" onClick={() => setContextMenu(null)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode="Shift"
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
        edgesReconnectable
        onReconnect={(oldEdge, newConnection) => {
          if (newConnection.source && newConnection.target) {
            onReconnectEdge(oldEdge.id, newConnection.source, newConnection.target);
          }
        }}
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
        onEdgeDoubleClick={(event, edge) => {
          event.stopPropagation();
          onAddBendpoint(edge.id, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          const type = event.dataTransfer.getData('application/x-openarch-element');
          if (type) {
            onAddElementAt(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }
        }}
        onNodeDragStop={(_, node) => {
          // Child node positions are parent-relative in React Flow; store
          // absolute canvas coordinates in the model.
          const parent = node.parentId ? view.nodes.find((candidate) => candidate.id === node.parentId) : undefined;
          onNodeMove(node.id, {
            x: Math.round(node.position.x + (parent?.bounds.x ?? 0)),
            y: Math.round(node.position.y + (parent?.bounds.y ?? 0)),
            w: Math.round(node.measured?.width ?? node.width ?? 170),
            h: Math.round(node.measured?.height ?? node.height ?? 64),
          });
        }}
        fitView
        colorMode={colorMode}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color={colorMode === 'dark' ? '#334155' : '#d8dee9'} />
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
                placeholder={t('searchElementTypes')}
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
                            draggable
                            title={`Drag onto the canvas or click to add ${type.label}`}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('application/x-openarch-element', type.id);
                              event.dataTransfer.effectAllowed = 'copy';
                            }}
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
          {t('canvasHint')}
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
                  aria-label={t('alignSelection')}
                  onChange={(event) => {
                    if (event.target.value) onAlign(event.target.value as NodeAlignment);
                  }}
                >
                  <option value="">{t('align')}</option>
                  <option value="left">{t('alignLeft')}</option>
                  <option value="center-x">{t('alignCenter')}</option>
                  <option value="right">{t('alignRight')}</option>
                  <option value="top">{t('alignTop')}</option>
                  <option value="center-y">{t('alignMiddle')}</option>
                  <option value="bottom">{t('alignBottom')}</option>
                </select>
                <select
                  value=""
                  aria-label={t('distributeSelection')}
                  onChange={(event) => {
                    if (event.target.value) onDistribute(event.target.value as 'x' | 'y');
                  }}
                >
                  <option value="">{t('distribute')}</option>
                  <option value="x">{t('distributeHorizontal')}</option>
                  <option value="y">{t('distributeVertical')}</option>
                </select>
                {!selectionHasParent && <button onClick={onGroup}>{t('group')}</button>}
                {selectionHasParent && <button onClick={onUngroup}>{t('ungroup')}</button>}
              </>
            )}
            {selectedNodeIds.length > 0 && (
              <>
                <button onClick={() => onZOrder('front')} title={t('bringToFront')}>
                  {t('front')}
                </button>
                <button onClick={() => onZOrder('back')} title={t('sendToBack')}>
                  {t('back')}
                </button>
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
        <FitViewOnChange viewId={view.id} signal={fitSignal} />
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
                {t('renameEllipsis')}
              </button>
              <button
                onClick={() => {
                  onDuplicateNodes([contextMenu.nodeId!]);
                  setContextMenu(null);
                }}
              >
                {t('duplicate')}
              </button>
              <button
                onClick={() => {
                  onNodesDelete([contextMenu.nodeId!]);
                  setContextMenu(null);
                }}
              >
                {t('delete')}
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
              {t('paste')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
