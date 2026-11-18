import {
  alignNodes,
  allowedRelationships,
  assignElements,
  buildConfiguredView,
  createFromTemplate,
  createModel,
  createSampleModel,
  diffModels,
  distributeNodes,
  duplicateElements,
  elementRefsForNodes,
  filterModelByDomain,
  getElementType,
  LAYER_LABELS,
  LAYER_ORDER,
  parseAoef,
  primaryText,
  relationshipRefsForEdges,
  removeElements,
  removeRelationships,
  serializeAoef,
  type ArchiElement,
  type Artefact,
  type Bounds,
  type Layer,
  type Model,
  type ModelDiff,
  type ModelSummary,
  type NodeAlignment,
  type RelationshipTypeDefinition,
  type View,
} from '@openarch/core';
import {
  LocalRepository,
  parseNativeModel,
  readShareHash,
  serializeNativeModel,
  ServerRepository,
  shareUrl,
  type ModelRepository,
} from '@openarch/repository';
import {
  exportElementsCsv,
  exportMermaid,
  exportViewPng,
  exportViewSvg,
} from '@openarch/exporters';
import { exportArchi, importArchi } from '@openarch/archi';
import { exportWorkspaceMarkdown } from '@openarch/reporting';
import { LanguageContext, type Language, useTranslation } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AiPanel from './components/AiPanel';
import Artefacts from './components/Artefacts';
import Canvas from './components/Canvas';
import Catalog from './components/Catalog';
import Collaborate from './components/Collaborate';
import Dashboard from './components/Dashboard';
import DeploymentView from './components/DeploymentView';
import ErrorBoundary from './components/ErrorBoundary';
import DomainMap from './components/DomainMap';
import EamViews from './components/EamViews';
import Enrichment from './components/Enrichment';
import ImportPreview from './components/ImportPreview';
import Inspector from './components/Inspector';
import InterfaceCatalog from './components/InterfaceCatalog';
import MatrixView from './components/MatrixView';
import Portfolio from './components/Portfolio';
import SavedViews, { type SavedView } from './components/SavedViews';
import Sidebar from './components/Sidebar';
import TraceView from './components/TraceView';
import ValidationPanel from './components/ValidationPanel';
import ViewDesigner from './components/ViewDesigner';
import WorkspaceHome, { type CreateWorkspaceInput } from './components/WorkspaceHome';
import WorkspaceSettings from './components/WorkspaceSettings';

type Route = 'home' | 'workspace' | 'portfolio';
type Tab = 'editor' | 'catalog' | 'analysis' | 'views' | 'enrichment' | 'artefacts' | 'collaborate' | 'ai' | 'settings';
type AnalysisTab = 'dashboard' | 'eam' | 'validation' | 'trace' | 'matrices' | 'deployment' | 'interfaces' | 'domains';
type Mode = 'local' | 'server';

interface MagicConnection {
  sourceNodeId: string;
  targetNodeId: string;
  sourceElementId: string;
  targetElementId: string;
  choices: RelationshipTypeDefinition[];
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api';

const PRIMARY_TABS: Tab[] = [
  'editor',
  'catalog',
  'analysis',
  'views',
  'enrichment',
  'artefacts',
  'collaborate',
  'ai',
  'settings',
];

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
}

function downloadFile(name: string, content: string | Blob, type: string): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function hasShareHash(): boolean {
  return window.location.hash.startsWith('#share=');
}

export default function App() {
  const t = useTranslation();
  const [route, setRoute] = useState<Route>('home');
  const [tab, setTab] = useState<Tab>('editor');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('dashboard');
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'server' ? 'server' : 'local',
  );
  const [language, setLanguage] = useState<Language>('en');
  const [workspaces, setWorkspaces] = useState<ModelSummary[]>([]);
  const [model, setModel] = useState<Model | null>(null);
  const [portfolioModels, setPortfolioModels] = useState<Model[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [magic, setMagic] = useState<MagicConnection | null>(null);
  const [status, setStatus] = useState('Ready');
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  const [visibleLayers, setVisibleLayers] = useState<Set<Layer>>(new Set(LAYER_ORDER));
  const [domainFilter, setDomainFilter] = useState('all');
  const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [past, setPast] = useState<Model[]>([]);
  const [future, setFuture] = useState<Model[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ incoming: Model; diff: ModelDiff } | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showSavedViews, setShowSavedViews] = useState(false);
  const [modelVersion, setModelVersion] = useState<number | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const modelRef = useRef<Model | null>(null);
  const clipboardRef = useRef<string[]>([]);
  const [clipboardCount, setClipboardCount] = useState(0);
  const pasteCountRef = useRef(0);

  const repository = useMemo<ModelRepository>(
    () => (mode === 'local' ? new LocalRepository() : new ServerRepository(apiUrl)),
    [mode],
  );

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const notify = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus('Ready'), 5000);
  }, []);

  const commit = useCallback((updater: (current: Model) => Model) => {
    const current = modelRef.current;
    if (!current) return;
    setPast((history) => [...history, current].slice(-60));
    setFuture([]);
    const next = updater(current);
    modelRef.current = next;
    setModel(next);
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const previous = past.at(-1);
    const current = modelRef.current;
    if (!previous || !current) return;
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [current, ...history].slice(0, 60));
    modelRef.current = previous;
    setModel(previous);
    setDirty(true);
  }, [past]);

  const redo = useCallback(() => {
    const next = future[0];
    const current = modelRef.current;
    if (!next || !current) return;
    setFuture((history) => history.slice(1));
    setPast((history) => [...history, current].slice(-60));
    modelRef.current = next;
    setModel(next);
    setDirty(true);
  }, [future]);

  // Report canvas selection up with a reference-stable update: re-rendering App
  // mid-drag would cancel an in-progress connection.
  const handleCanvasSelection = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds((prev) =>
      prev.length === nodeIds.length && prev.every((id, i) => id === nodeIds[i]) ? prev : nodeIds,
    );
  }, []);

  // Copy/paste/duplicate of the selected canvas subgraph (in-memory clipboard).
  const duplicateSelection = useCallback(
    (elementIds: string[]) => {
      const current = modelRef.current;
      if (!current || !elementIds.length) return;
      const view = current.views[activeViewIndex];
      if (!view) return;
      pasteCountRef.current += 1;
      const step = 40 * pasteCountRef.current;
      commit((model) => duplicateElements(model, elementIds, view.id, { x: step, y: step }));
      notify(`Duplicated ${elementIds.length} element${elementIds.length === 1 ? '' : 's'}`);
    },
    [activeViewIndex, commit, notify],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      const current = modelRef.current;
      const elementIds = current ? elementRefsForNodes(current, selectedNodeIds) : [];
      if (key === 'c' && elementIds.length) {
        event.preventDefault();
        clipboardRef.current = elementIds;
        setClipboardCount(elementIds.length);
        pasteCountRef.current = 0;
        notify(`Copied ${elementIds.length} element${elementIds.length === 1 ? '' : 's'}`);
      } else if (key === 'v' && clipboardRef.current.length) {
        event.preventDefault();
        duplicateSelection(clipboardRef.current);
      } else if (key === 'd' && elementIds.length) {
        event.preventDefault();
        duplicateSelection(elementIds);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, selectedNodeIds, duplicateSelection, notify]);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await repository.listModels();
      setWorkspaces(list);
      return list;
    } catch (error) {
      notify(`Could not reach repository: ${String(error)}`);
      return [];
    }
  }, [repository, notify]);

  const syncVersion = useCallback(
    async (id: string) => {
      if (!(repository instanceof ServerRepository)) {
        setModelVersion(undefined);
        return;
      }
      try {
        const meta = await repository.getModelMeta(id);
        setModelVersion(meta.version);
      } catch {
        setModelVersion(undefined);
      }
    },
    [repository],
  );

  // Seed a sample workspace on first local run so the app is never empty.
  useEffect(() => {
    if (hasShareHash()) return;
    let cancelled = false;
    (async () => {
      const list = await refreshWorkspaces();
      if (cancelled) return;
      if (list.length === 0 && mode === 'local') {
        const sample = createSampleModel();
        sample.purpose = 'as-is';
        sample.status = 'active';
        sample.owner = 'You';
        sample.tags = ['sample'];
        await repository.saveModel(sample);
        if (!cancelled) await refreshWorkspaces();
      }
      // Deep link: /?workspace=<id> opens that workspace once it exists.
      const requested = new URLSearchParams(window.location.search).get('workspace');
      if (requested && !cancelled) {
        const target = await repository.getModel(requested);
        if (target && !cancelled) {
          setModel(target);
          modelRef.current = target;
          await syncVersion(requested);
          setRoute('workspace');
          setReadOnly(false);
          setDirty(false);
          setLastSavedAt(target.updatedAt ?? null);
          const requestedTab = new URLSearchParams(window.location.search).get('tab');
          if (requestedTab && PRIMARY_TABS.includes(requestedTab as Tab)) {
            setTab(requestedTab as Tab);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, refreshWorkspaces, mode, syncVersion]);

  // Share links open a read-only snapshot instead of the workspace list.
  useEffect(() => {
    if (!hasShareHash()) return;
    let cancelled = false;
    (async () => {
      const shared = await readShareHash(window.location.hash);
      if (cancelled) return;
      if (shared) {
        setModel(shared);
        modelRef.current = shared;
        setReadOnly(true);
        setRoute('workspace');
        notify('Opened a read-only shared model');
      } else {
        notify('This share link is invalid or was truncated in transit');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const openWorkspace = async (id: string) => {
    const next = await repository.getModel(id);
    if (!next) {
      notify('Workspace not found');
      return;
    }
    setModel(next);
    modelRef.current = next;
    await syncVersion(id);
    setRoute('workspace');
    setTab('editor');
    setSelectedElementId(null);
    setActiveViewIndex(0);
    setDomainFilter('all');
    setEnvironmentFilter('all');
    setMagic(null);
    setPast([]);
    setFuture([]);
    setReadOnly(false);
    setDirty(false);
    setLastSavedAt(next.updatedAt ?? null);
    setSelectedNodeIds([]);
    clipboardRef.current = [];
    setClipboardCount(0);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}?workspace=${encodeURIComponent(id)}`,
    );
  };

  const goHome = () => {
    setRoute('home');
    setModel(null);
    modelRef.current = null;
    setSelectedElementId(null);
    setPendingImport(null);
    setDirty(false);
    setLastSavedAt(null);
    window.history.replaceState(null, '', window.location.pathname);
    void refreshWorkspaces();
  };

  const openPortfolio = async () => {
    const list = await refreshWorkspaces();
    const loaded = await Promise.all(list.map((workspace) => repository.getModel(workspace.id)));
    setPortfolioModels(loaded.filter((item): item is Model => Boolean(item)));
    setRoute('portfolio');
  };

  const createWorkspace = async (input: CreateWorkspaceInput) => {
    const next = createFromTemplate(input.templateId, { name: input.name, owner: input.owner });
    next.purpose = input.purpose;
    next.documentation = input.description ? [{ lang: 'en', value: input.description }] : [];
    next.tags = input.tags;
    next.status = 'active';
    await repository.saveModel(next);
    await refreshWorkspaces();
    await openWorkspace(next.id);
    notify(`Created ${input.name}`);
  };

  const duplicateWorkspace = async (id: string) => {
    const source = await repository.getModel(id);
    if (!source) return;
    const copy: Model = {
      ...structuredClone(source),
      id: `model-${crypto.randomUUID()}`,
      name: [{ lang: 'en', value: `${primaryText(source.name)} (copy)` }],
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    await repository.saveModel(copy);
    await refreshWorkspaces();
    notify(`Duplicated ${primaryText(source.name)}`);
  };

  const archiveWorkspace = async (id: string) => {
    const source = await repository.getModel(id);
    if (!source) return;
    await repository.saveModel({ ...source, status: 'archived' });
    await refreshWorkspaces();
    notify('Workspace archived');
  };

  const deleteWorkspace = async (id: string) => {
    if (!window.confirm('Delete this workspace permanently? This cannot be undone.')) return;
    await repository.deleteModel(id);
    await refreshWorkspaces();
    if (model?.id === id) goHome();
    notify('Workspace deleted');
  };

  const save = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const current = modelRef.current;
      if (!current || readOnly) return;
      try {
        await repository.saveModel(current, modelVersion);
        await syncVersion(current.id);
        await refreshWorkspaces();
        setDirty(false);
        setLastSavedAt(new Date().toISOString());
        if (!options.silent) notify('Workspace saved');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/conflict/i.test(message)) {
          notify('Save rejected: someone else changed this workspace. Reload to get their changes.');
        } else {
          notify(`Save failed: ${message}`);
        }
      }
    },
    [readOnly, repository, modelVersion, syncVersion, refreshWorkspaces, notify],
  );

  // Autosave: debounced save a moment after the last edit, so a crash or a
  // closed tab no longer loses work.
  useEffect(() => {
    if (!dirty || readOnly || !modelRef.current) return;
    const timer = window.setTimeout(() => {
      void save({ silent: true });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, model, readOnly, save]);

  const importFile = async (file: File) => {
    try {
      let imported: Model;
      if (file.name.toLowerCase().endsWith('.archimate')) {
        const result = importArchi(new Uint8Array(await file.arrayBuffer()));
        imported = result.model;
        if (result.warnings.length) {
          notify(`Imported with ${result.warnings.length} warning(s)`);
        }
      } else {
        const text = await file.text();
        imported = file.name.toLowerCase().endsWith('.json')
          ? parseNativeModel(text)
          : parseAoef(text);
      }
      if (route === 'workspace' && model) {
        setPendingImport({ incoming: imported, diff: diffModels(model, imported) });
      } else {
        await repository.saveModel(imported);
        await refreshWorkspaces();
        await openWorkspace(imported.id);
        notify(`Imported ${file.name}`);
      }
    } catch (error) {
      notify(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const confirmImport = async (mode: 'replace' | 'add') => {
    if (!pendingImport) return;
    const imported = pendingImport.incoming;
    try {
      await repository.saveModel(imported);
      await refreshWorkspaces();
      await openWorkspace(imported.id);
      notify(`Imported ${primaryText(imported.name)}`);
    } catch (error) {
      notify(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setPendingImport(null);
    void mode;
  };

  const currentView = model?.views[activeViewIndex];
  const scopedModel = useMemo(
    () => (model ? filterModelByDomain(model, domainFilter) : null),
    [model, domainFilter],
  );
  const scopedView = scopedModel?.views[activeViewIndex];

  const refreshSavedViews = useCallback(async () => {
    if (!model || !repository.listSavedViews) return;
    try {
      setSavedViews(await repository.listSavedViews(model.id));
    } catch {
      setSavedViews([]);
    }
  }, [model, repository]);

  useEffect(() => {
    void refreshSavedViews();
  }, [refreshSavedViews]);

  const saveCurrentView = async (name: string) => {
    if (!model || !repository.saveSavedView) return;
    await repository.saveSavedView({
      id: `savedview-${crypto.randomUUID()}`,
      name,
      modelId: model.id,
      kind: tab,
      filters: { tab, analysisTab, domainFilter, environmentFilter, activeViewIndex },
      createdAt: new Date().toISOString(),
    });
    await refreshSavedViews();
    notify(`Saved view "${name}"`);
  };

  const loadSavedView = (view: SavedView) => {
    if (typeof view.filters.domainFilter === 'string') setDomainFilter(view.filters.domainFilter);
    if (typeof view.filters.environmentFilter === 'string') setEnvironmentFilter(view.filters.environmentFilter);
    if (typeof view.filters.activeViewIndex === 'number') {
      setActiveViewIndex(Math.min(view.filters.activeViewIndex, (model?.views.length ?? 1) - 1));
    }
    if (typeof view.filters.tab === 'string') setTab(view.filters.tab as Tab);
    if (typeof view.filters.analysisTab === 'string') setAnalysisTab(view.filters.analysisTab as AnalysisTab);
    setShowSavedViews(false);
  };

  const exportAoef = () => {
    if (!model) return;
    downloadFile(`${slug(primaryText(model.name))}.xml`, serializeAoef(model), 'application/xml');
    notify('Exported AOEF');
  };

  const exportJson = () => {
    if (!model) return;
    downloadFile(`${slug(primaryText(model.name))}.json`, serializeNativeModel(model), 'application/json');
    notify('Exported native JSON');
  };

  const exportSvg = () => {
    if (!model || !currentView) return;
    downloadFile(`${slug(primaryText(currentView.name))}.svg`, exportViewSvg(model, currentView.id), 'image/svg+xml');
    notify('Exported SVG');
  };

  const exportPng = async () => {
    if (!model || !currentView) return;
    const blob = await exportViewPng(model, currentView.id, 2);
    downloadFile(`${slug(primaryText(currentView.name))}.png`, blob, 'image/png');
    notify('Exported PNG');
  };

  const exportCsv = () => {
    if (!model) return;
    downloadFile(`${slug(primaryText(model.name))}-elements.csv`, exportElementsCsv(model), 'text/csv');
    notify('Exported CSV');
  };

  const exportMermaidFile = () => {
    if (!model || !currentView) return;
    downloadFile(`${slug(primaryText(currentView.name))}.mermaid`, exportMermaid(model, currentView.id), 'text/plain');
    notify('Exported Mermaid');
  };

  const exportArchiFile = () => {
    if (!model) return;
    const bytes = exportArchi(model);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    downloadFile(
      `${slug(primaryText(model.name))}.archimate`,
      new Blob([buffer], { type: 'application/zip' }),
      'application/zip',
    );
    notify('Exported .archimate');
  };

  const exportReport = () => {
    if (!model) return;
    downloadFile(
      `${slug(primaryText(model.name))}-report.md`,
      exportWorkspaceMarkdown(model),
      'text/markdown',
    );
    notify('Exported workspace report');
  };

  const share = async () => {
    if (!model || !currentView) return;
    try {
      const url = await shareUrl(model, currentView.id);
      await navigator.clipboard.writeText(url);
      notify('Share link copied to clipboard');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };

  const updateView = (updater: (view: View) => View) => {
    commit((current) => ({
      ...current,
      views: current.views.map((view, index) => (index === activeViewIndex ? updater(view) : view)),
    }));
  };

  const moveNode = (nodeId: string, bounds: Bounds) => {
    updateView((view) => ({
      ...view,
      nodes: view.nodes.map((node) => (node.id === nodeId ? { ...node, bounds } : node)),
    }));
  };

  const addElement = (type: string) => {
    const elementId = `el-${crypto.randomUUID()}`;
    const nodeId = `node-${crypto.randomUUID()}`;
    commit((current) => {
      const index = current.elements.length;
      const element: ArchiElement = {
        id: elementId,
        type,
        name: [{ lang: 'en', value: `${getElementType(type)?.label ?? type} ${index + 1}` }],
        documentation: [],
        properties: [],
        domain: domainFilter === 'all' ? undefined : domainFilter,
        environment: environmentFilter === 'all' ? undefined : environmentFilter,
      };
      return {
        ...current,
        elements: [...current.elements, element],
        views: current.views.map((view, viewIndex) =>
          viewIndex === activeViewIndex
            ? {
                ...view,
                nodes: [
                  ...view.nodes,
                  {
                    id: nodeId,
                    type: 'Element',
                    elementRef: elementId,
                    label: [],
                    bounds: { x: 120 + (index % 4) * 200, y: 100 + Math.floor(index / 4) * 130, w: 170, h: 64 },
                  },
                ],
              }
            : view,
        ),
      };
    });
    setSelectedElementId(elementId);
  };

  const updateElement = (id: string, patch: Partial<ArchiElement>) => {
    commit((current) => ({
      ...current,
      elements: current.elements.map((element) => (element.id === id ? { ...element, ...patch } : element)),
    }));
  };

  // Canvas delete: node/edge ids are resolved to element/relationship refs and
  // removed from the canonical model, so deletions survive re-renders.
  const deleteNodes = (nodeIds: string[]) => {
    const current = modelRef.current;
    if (!current) return;
    const elementIds = elementRefsForNodes(current, nodeIds);
    if (!elementIds.length) return;
    commit((model) => removeElements(model, elementIds));
    setSelectedElementId((selected) => (selected && elementIds.includes(selected) ? null : selected));
    notify(`Deleted ${elementIds.length} element${elementIds.length === 1 ? '' : 's'}`);
  };

  const deleteEdges = (edgeIds: string[]) => {
    const current = modelRef.current;
    if (!current) return;
    const relationshipIds = relationshipRefsForEdges(current, edgeIds);
    if (!relationshipIds.length) return;
    commit((model) => removeRelationships(model, relationshipIds));
    notify(`Deleted ${relationshipIds.length} relationship${relationshipIds.length === 1 ? '' : 's'}`);
  };

  const bulkAssign = (elementIds: string[], patch: { domain?: string; environment?: string }) => {
    commit((model) => assignElements(model, elementIds, patch));
    notify(`Updated ${elementIds.length} element${elementIds.length === 1 ? '' : 's'}`);
  };

  const alignSelection = (alignment: NodeAlignment) => {
    const current = modelRef.current;
    if (!current || selectedNodeIds.length < 2) return;
    const view = current.views[activeViewIndex];
    if (!view) return;
    commit((model) => alignNodes(model, view.id, selectedNodeIds, alignment));
  };

  const distributeSelection = (axis: 'x' | 'y') => {
    const current = modelRef.current;
    if (!current || selectedNodeIds.length < 3) return;
    const view = current.views[activeViewIndex];
    if (!view) return;
    commit((model) => distributeNodes(model, view.id, selectedNodeIds, axis));
  };

  const renameElement = (id: string, name: string) => {
    commit((model) => ({
      ...model,
      elements: model.elements.map((element) =>
        element.id === id ? { ...element, name: [{ lang: 'en', value: name }] } : element,
      ),
    }));
  };

  const duplicateNodes = (nodeIds: string[]) => {
    const current = modelRef.current;
    if (!current) return;
    duplicateSelection(elementRefsForNodes(current, nodeIds));
  };

  const pasteClipboard = () => {
    if (clipboardRef.current.length) duplicateSelection(clipboardRef.current);
  };

  const updateModelMeta = (patch: Partial<Model>) => {
    commit((current) => ({ ...current, ...patch }));
  };

  const updateArtefacts = (artefacts: Artefact[]) => {
    commit((current) => ({ ...current, artefacts }));
  };

  const requestConnection = (sourceNodeId: string, targetNodeId: string) => {
    const view = scopedView;
    const sourceElementId = view?.nodes.find((node) => node.id === sourceNodeId)?.elementRef;
    const targetElementId = view?.nodes.find((node) => node.id === targetNodeId)?.elementRef;
    const source = model?.elements.find((element) => element.id === sourceElementId);
    const target = model?.elements.find((element) => element.id === targetElementId);
    if (!source || !target || source.id === target.id) return;
    const choices = allowedRelationships(source.type, target.type);
    if (choices.length === 0) {
      notify('No valid relationship for these element types');
      return;
    }
    setMagic({ sourceNodeId, targetNodeId, sourceElementId: source.id, targetElementId: target.id, choices });
  };

  const confirmConnection = (type: string) => {
    if (!magic) return;
    const relationshipId = `rel-${crypto.randomUUID()}`;
    const edgeId = `edge-${crypto.randomUUID()}`;
    commit((current) => ({
      ...current,
      relationships: [
        ...current.relationships,
        {
          id: relationshipId,
          type,
          source: magic.sourceElementId,
          target: magic.targetElementId,
          name: [],
          documentation: [],
          properties: [],
        },
      ],
      views: current.views.map((view, index) =>
        index === activeViewIndex
          ? {
              ...view,
              edges: [
                ...view.edges,
                {
                  id: edgeId,
                  type: 'Relationship',
                  relationshipRef: relationshipId,
                  source: magic.sourceNodeId,
                  target: magic.targetNodeId,
                  bendpoints: [],
                },
              ],
            }
          : view,
      ),
    }));
    setMagic(null);
    notify(`Created ${type} relationship — remember to save`);
  };

  const addView = () => {
    const id = `view-${crypto.randomUUID()}`;
    commit((current) => ({
      ...current,
      views: [...current.views, { id, type: 'Diagram', name: [{ lang: 'en', value: `View ${current.views.length + 1}` }], nodes: [], edges: [] }],
    }));
    setActiveViewIndex(model?.views.length ?? 0);
  };

  const renameView = (index: number) => {
    const view = model?.views[index];
    if (!view) return;
    const name = window.prompt('View name', primaryText(view.name));
    if (name === null) return;
    commit((current) => ({
      ...current,
      views: current.views.map((item, i) =>
        i === index ? { ...item, name: [{ lang: 'en', value: name }] } : item,
      ),
    }));
  };

  const deleteView = (index: number) => {
    if ((model?.views.length ?? 0) <= 1) {
      notify('A workspace needs at least one view');
      return;
    }
    if (!window.confirm('Delete this view? Elements are kept in the model.')) return;
    commit((current) => ({ ...current, views: current.views.filter((_, i) => i !== index) }));
    setActiveViewIndex((current) => Math.max(0, Math.min(current, (model?.views.length ?? 2) - 2)));
  };

  const regenerateCurrentView = () => {
    if (!model || !currentView?.config) return;
    const result = buildConfiguredView(model, currentView.config, {
      id: currentView.id,
      name: primaryText(currentView.name),
    });
    commit((current) => ({
      ...current,
      views: current.views.map((view, index) =>
        index === activeViewIndex ? result.view : view,
      ),
    }));
    notify('View regenerated from its recipe');
  };

  const selectedElement = model?.elements.find((element) => element.id === selectedElementId);
  const primaryTabs = PRIMARY_TABS;
  const analysisTabs: AnalysisTab[] = ['dashboard', 'eam', 'validation', 'trace', 'matrices', 'deployment', 'interfaces', 'domains'];

  if (route === 'home') {
    return (
      <LanguageContext.Provider value={language}>
        <WorkspaceHome
          workspaces={workspaces}
          onCreate={createWorkspace}
          onOpen={openWorkspace}
          onDuplicate={duplicateWorkspace}
          onArchive={archiveWorkspace}
          onDelete={deleteWorkspace}
          onImport={importFile}
          onOpenPortfolio={openPortfolio}
        />
      </LanguageContext.Provider>
    );
  }

  if (route === 'portfolio') {
    return (
      <LanguageContext.Provider value={language}>
        <Portfolio models={portfolioModels} onOpen={openWorkspace} onBack={goHome} />
      </LanguageContext.Provider>
    );
  }

  return (
    <LanguageContext.Provider value={language}>
      <div className="app">
        <Sidebar
          workspaceName={model ? primaryText(model.name) : ''}
          mode={mode}
          language={language}
          onLanguageChange={setLanguage}
          onModeChange={setMode}
          onHome={goHome}
          onImport={importFile}
          onExportAoef={exportAoef}
          onExportJson={exportJson}
          onExportSvg={exportSvg}
          onExportPng={exportPng}
          onExportCsv={exportCsv}
          onExportMermaid={exportMermaidFile}
          onExportArchi={exportArchiFile}
          onExportReport={exportReport}
          onShare={share}
          onSave={() => void save()}
        />

        <main className="main">
          <header className="topbar">
            <nav className="tabs" aria-label="Workspace views">
              {primaryTabs.map((name) => (
                <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
                  {t(name)}
                </button>
              ))}
            </nav>
            <div className="topbar-right">
              <button onClick={() => setShowSavedViews(true)} title="Saved views">☆ Views</button>
              <button onClick={undo} disabled={past.length === 0} title={t('undo')}>↶</button>
              <button onClick={redo} disabled={future.length === 0} title={t('redo')}>↷</button>
              <span className="model-title">{model ? primaryText(model.name) : 'No workspace'}</span>
              {readOnly && <span className="mode-badge">read-only</span>}
              <span className="mode-badge">{mode}</span>
              {!readOnly && model && (
                <span className={`save-badge ${dirty ? 'dirty' : ''}`} title={lastSavedAt ?? undefined}>
                  {dirty
                    ? '● Unsaved changes'
                    : lastSavedAt
                      ? `✓ Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
                      : '✓ Saved'}
                </span>
              )}
              <span className="status" title={status}>{status}</span>
            </div>
          </header>

          <div className="content">
            <div className="workspace">
              <ErrorBoundary key={tab} name={tab}>
              {!model ? (
                <div className="placeholder">
                  <h2>No workspace open</h2>
                  <p>Return to the workspace list to open or create one.</p>
                </div>
              ) : tab === 'editor' && scopedView ? (
                <>
                  <div className="view-bar">
                    {model.views.map((view, index) => (
                      <span key={view.id} className={`view-tab ${index === activeViewIndex ? 'active' : ''}`}>
                        <button onClick={() => setActiveViewIndex(index)}>{primaryText(view.name) || view.id}</button>
                        <button className="view-tab-action" onClick={() => renameView(index)} title="Rename view">✎</button>
                        <button className="view-tab-action" onClick={() => deleteView(index)} title="Delete view">×</button>
                      </span>
                    ))}
                    <button className="small-button" onClick={addView}>+ View</button>
                    {currentView?.config && (
                      <span className="generated-badge">
                        Generated · {currentView.config.granulation}
                        <button className="small-button" onClick={regenerateCurrentView}>
                          Regenerate
                        </button>
                      </span>
                    )}
                    <div className="layer-filters">
                      <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}>
                        <option value="all">{t('allDomains')}</option>
                        {(model.domains ?? []).map((domain) => (
                          <option key={domain.id} value={domain.id}>{domain.name}</option>
                        ))}
                      </select>
                      <select value={environmentFilter} onChange={(event) => setEnvironmentFilter(event.target.value)}>
                        <option value="all">{t('allEnvironments')}</option>
                        <option value="dev">dev</option>
                        <option value="staging">staging</option>
                        <option value="prod">prod</option>
                      </select>
                      <label title="Snap nodes to the 20 px grid while dragging">
                        <input
                          type="checkbox"
                          checked={snapToGrid}
                          onChange={(event) => setSnapToGrid(event.target.checked)}
                        />
                        Snap
                      </label>
                      {LAYER_ORDER.filter((layer) => model.elements.some((element) => getElementType(element.type)?.layer === layer)).map((layer) => (
                        <label key={layer}>
                          <input
                            type="checkbox"
                            checked={visibleLayers.has(layer)}
                            onChange={() =>
                              setVisibleLayers((current) => {
                                const next = new Set(current);
                                if (next.has(layer)) next.delete(layer);
                                else next.add(layer);
                                return next;
                              })
                            }
                          />
                          {LAYER_LABELS[layer]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="editor-area">
                    <Canvas
                      view={scopedView}
                      elements={scopedModel?.elements ?? []}
                      relationships={scopedModel?.relationships ?? []}
                      domains={model.domains ?? []}
                      visibleLayers={visibleLayers}
                      environmentFilter={environmentFilter}
                      onSelectElement={setSelectedElementId}
                      onNodeMove={moveNode}
                      onAddElement={addElement}
                      onConnect={requestConnection}
                      onNodesDelete={deleteNodes}
                      onEdgesDelete={deleteEdges}
                      onBulkAssign={bulkAssign}
                      onAlign={alignSelection}
                      onDistribute={distributeSelection}
                      snapToGrid={snapToGrid}
                      onSelectionChange={handleCanvasSelection}
                      onRenameElement={renameElement}
                      onDuplicateNodes={duplicateNodes}
                      onPaste={pasteClipboard}
                      hasClipboard={clipboardCount > 0}
                    />
                  </div>
                  {magic && (
                    <div className="magic-menu">
                      <strong>Choose relationship</strong>
                      <span>
                        {primaryText(model.elements.find((element) => element.id === magic.sourceElementId)?.name ?? [])} →{' '}
                        {primaryText(model.elements.find((element) => element.id === magic.targetElementId)?.name ?? [])}
                      </span>
                      <div className="magic-choices">
                        {magic.choices.map((choice) => (
                          <button key={choice.id} onClick={() => confirmConnection(choice.id)}>
                            {choice.label}
                          </button>
                        ))}
                      </div>
                      <button className="link-button" onClick={() => setMagic(null)}>Cancel</button>
                    </div>
                  )}
                </>
              ) : tab === 'catalog' ? (
                <Catalog
                  elements={scopedModel?.elements ?? []}
                  selectedElementId={selectedElementId}
                  onSelect={setSelectedElementId}
                />
              ) : tab === 'analysis' ? (
                <>
                  <div className="subnav">
                    {analysisTabs.map((name) => (
                      <button key={name} className={analysisTab === name ? 'active' : ''} onClick={() => setAnalysisTab(name)}>
                        {t(name)}
                      </button>
                    ))}
                  </div>
                  {analysisTab === 'dashboard' ? (
                    <Dashboard model={scopedModel ?? model} />
                  ) : analysisTab === 'eam' ? (
                    <EamViews model={scopedModel ?? model} onSelect={(id) => { setSelectedElementId(id); setTab('editor'); }} />
                  ) : analysisTab === 'validation' ? (
                    <ValidationPanel model={model} onSelect={(id) => { setSelectedElementId(id); setTab('editor'); }} />
                  ) : analysisTab === 'trace' ? (
                    <TraceView model={model} selectedElementId={selectedElementId} onSelect={setSelectedElementId} />
                  ) : analysisTab === 'matrices' ? (
                    <MatrixView model={scopedModel ?? model} />
                  ) : analysisTab === 'deployment' ? (
                    <DeploymentView model={model} environment={environmentFilter} onSelect={(id) => { setSelectedElementId(id); setTab('editor'); }} />
                  ) : analysisTab === 'interfaces' ? (
                    <InterfaceCatalog model={model} onSelect={(id) => { setSelectedElementId(id); setTab('editor'); }} />
                  ) : (
                    <DomainMap model={model} onSelectDomain={(id) => { setDomainFilter(id); setTab('editor'); }} />
                  )}
                </>
              ) : tab === 'views' ? (
                <ViewDesigner
                  model={model}
                  activeViewIndex={activeViewIndex}
                  initialViewpointId={
                    new URLSearchParams(window.location.search).get('viewpoint') ?? undefined
                  }
                  onCreateView={(view) => {
                    commit((current) => ({ ...current, views: [...current.views, view] }));
                    setActiveViewIndex(model.views.length);
                    setTab('editor');
                    notify(`Created view "${primaryText(view.name)}"`);
                  }}
                  onUpdateView={(index, view) => {
                    commit((current) => ({
                      ...current,
                      views: current.views.map((item, i) => (i === index ? view : item)),
                    }));
                    notify('View regenerated');
                  }}
                  onDeleteView={(index) => {
                    commit((current) => ({
                      ...current,
                      views: current.views.filter((_, i) => i !== index),
                    }));
                    setActiveViewIndex(0);
                    notify('View deleted');
                  }}
                  onOpenView={(index) => {
                    setActiveViewIndex(index);
                    setTab('editor');
                  }}
                />
              ) : tab === 'enrichment' ? (
                <Enrichment
                  model={model}
                  onApply={(elements, relationships) => {
                    commit((current) => ({
                      ...current,
                      elements: [...current.elements, ...elements],
                      relationships: [...current.relationships, ...relationships],
                    }));
                    notify(`Added ${elements.length} enriched elements — remember to save`);
                  }}
                />
              ) : tab === 'artefacts' ? (
                <Artefacts
                  model={model}
                  onUpdate={updateArtefacts}
                  onSelectElement={(id) => { setSelectedElementId(id); setTab('editor'); }}
                />
              ) : tab === 'ai' ? (
                <AiPanel
                  model={model}
                  onReplaceModel={(next) => {
                    commit(() => next);
                    setSelectedElementId(null);
                    setActiveViewIndex(0);
                  }}
                  onAddModel={async (next) => {
                    const existing = await repository.listModels();
                    const collision = existing.some((item) => item.id === next.id);
                    const toSave = collision ? { ...next, id: `model-${crypto.randomUUID()}` } : next;
                    await repository.saveModel(toSave);
                    await refreshWorkspaces();
                    await openWorkspace(toSave.id);
                  }}
                />
              ) : tab === 'settings' ? (
                <WorkspaceSettings
                  model={model}
                  onUpdate={updateModelMeta}
                  onBack={goHome}
                  onDuplicate={() => duplicateWorkspace(model.id)}
                  onArchive={() => archiveWorkspace(model.id)}
                  onDelete={() => deleteWorkspace(model.id)}
                />
              ) : (
                <Collaborate
                  modelId={model.id}
                  repository={repository instanceof ServerRepository ? repository : null}
                />
              )}
              </ErrorBoundary>
            </div>

            {model && (tab === 'editor' || tab === 'catalog' || tab === 'analysis') && (
              <Inspector
                element={selectedElement}
                elements={model.elements}
                relationships={model.relationships}
                domains={model.domains ?? []}
                onSelect={setSelectedElementId}
                onUpdate={updateElement}
              />
            )}
          </div>
        </main>

        {pendingImport && model && (
          <ImportPreview
            diff={pendingImport.diff}
            incoming={pendingImport.incoming}
            current={model}
            onReplace={() => void confirmImport('replace')}
            onAddAsNew={() => void confirmImport('add')}
            onCancel={() => setPendingImport(null)}
          />
        )}

        {showSavedViews && (
          <SavedViews
            views={savedViews}
            onSave={(name) => void saveCurrentView(name)}
            onLoad={loadSavedView}
            onDelete={(id) => {
              if (repository.deleteSavedView && model) {
                void repository.deleteSavedView(model.id, id).then(refreshSavedViews);
              }
            }}
            onClose={() => setShowSavedViews(false)}
          />
        )}
      </div>
    </LanguageContext.Provider>
  );
}
