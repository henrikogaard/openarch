import {
  buildConfiguredView,
  defaultConfigFor,
  ELEMENT_TYPES,
  getElementType,
  getRelationshipType,
  GRANULATION_LEVELS,
  primaryText,
  RELATIONSHIP_TYPES,
  STAKEHOLDERS,
  VIEWPOINT_CATALOG,
  type GranulationLevel,
  type Model,
  type View,
  type ViewConfig,
} from '@openarch/core';
import { useMemo, useState } from 'react';
import ViewPreview from './ViewPreview';

interface ViewDesignerProps {
  model: Model;
  activeViewIndex: number;
  initialViewpointId?: string;
  onCreateView: (view: View) => void;
  onUpdateView: (index: number, view: View) => void;
  onDeleteView: (index: number) => void;
  onOpenView: (index: number) => void;
}

const BUILT_IN_ATTRIBUTES = ['type', 'domain', 'environment'];

export default function ViewDesigner({
  model,
  activeViewIndex,
  initialViewpointId,
  onCreateView,
  onUpdateView,
  onDeleteView,
  onOpenView,
}: ViewDesignerProps) {
  const activeView = model.views[activeViewIndex];
  const [config, setConfig] = useState<ViewConfig>(() =>
    activeView?.config ?? defaultConfigFor(initialViewpointId ?? VIEWPOINT_CATALOG[0].id),
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(
    activeView?.config ? activeViewIndex : null,
  );

  const preview = useMemo(() => buildConfiguredView(model, config), [model, config]);
  const viewpoint = VIEWPOINT_CATALOG.find((item) => item.id === config.viewpointId);
  const granulation = GRANULATION_LEVELS.find((item) => item.id === config.granulation);

  const propertyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const element of model.elements) {
      for (const property of element.properties) if (property.key) keys.add(property.key);
    }
    return [...keys].sort();
  }, [model]);
  const attributeOptions = [...new Set([...BUILT_IN_ATTRIBUTES, ...propertyKeys])];

  const generatedViews = model.views
    .map((view, index) => ({ view, index }))
    .filter((item) => item.view.config);

  const applyViewpoint = (id: string) => {
    setConfig(defaultConfigFor(id));
    setEditingIndex(null);
  };

  const applyGranulation = (level: GranulationLevel) => {
    const definition = GRANULATION_LEVELS.find((item) => item.id === level);
    if (!definition) return;
    setConfig({
      ...config,
      granulation: level,
      elementTypes: [...definition.elementTypes],
      relationshipTypes: [...definition.relationshipTypes],
      attributes: [...definition.attributes],
    });
  };

  const toggleRelationship = (type: string) => {
    setConfig({
      ...config,
      relationshipTypes: config.relationshipTypes.includes(type)
        ? config.relationshipTypes.filter((item) => item !== type)
        : [...config.relationshipTypes, type],
    });
  };

  const toggleAttribute = (key: string) => {
    setConfig({
      ...config,
      attributes: config.attributes.includes(key)
        ? config.attributes.filter((item) => item !== key)
        : [...config.attributes, key],
    });
  };

  const addElementType = (type: string) => {
    if (!type || config.elementTypes.includes(type)) return;
    setConfig({ ...config, elementTypes: [...config.elementTypes, type] });
  };

  const removeElementType = (type: string) => {
    setConfig({ ...config, elementTypes: config.elementTypes.filter((item) => item !== type) });
  };

  const loadView = (index: number) => {
    const view = model.views[index];
    if (!view?.config) return;
    setConfig(view.config);
    setEditingIndex(index);
  };

  const create = () => {
    onCreateView(preview.view);
    setEditingIndex(null);
  };

  const update = () => {
    if (editingIndex === null) return;
    const existing = model.views[editingIndex];
    onUpdateView(editingIndex, {
      ...preview.view,
      id: existing.id,
      name: existing.name,
    });
  };

  return (
    <div className="page view-designer-page">
      <header className="page-header">
        <div>
          <h2>View designer</h2>
          <p>
            Generate a view for a stakeholder and a granulation level. The recipe is stored with the
            view, so it can be regenerated when the model changes.
          </p>
        </div>
        <div className="ai-actions">
          <button className="primary-button" onClick={create}>
            Create view
          </button>
          {editingIndex !== null && (
            <>
              <button onClick={update}>Update view</button>
              <button className="danger-link" onClick={() => onDeleteView(editingIndex)}>
                Delete view
              </button>
            </>
          )}
        </div>
      </header>

      <div className="view-designer-grid">
        <section className="panel-card view-config">
          <h3>Viewpoint</h3>
          <label className="field">
            Stakeholder viewpoint
            <select value={config.viewpointId} onChange={(event) => applyViewpoint(event.target.value)}>
              {STAKEHOLDERS.map((stakeholder) => {
                const viewpoints = VIEWPOINT_CATALOG.filter(
                  (item) => item.stakeholderId === stakeholder.id,
                );
                if (viewpoints.length === 0) return null;
                return (
                  <optgroup key={stakeholder.id} label={stakeholder.name}>
                    {viewpoints.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
          {viewpoint && (
            <>
              <p className="muted">{viewpoint.description}</p>
              <div className="chip-cloud">
                {viewpoint.concerns.map((concern) => (
                  <span className="chip" key={concern}>
                    {concern}
                  </span>
                ))}
              </div>
            </>
          )}

          <h3>Granulation</h3>
          <label className="field">
            Detail level
            <select
              value={config.granulation}
              onChange={(event) => applyGranulation(event.target.value as GranulationLevel)}
            >
              {GRANULATION_LEVELS.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          {granulation && <p className="muted">{granulation.description}</p>}

          <h3>Scope</h3>
          <div className="field-row">
            <label className="field">
              Domain
              <select
                value={config.domainFilter ?? 'all'}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    domainFilter:
                      event.target.value === 'all' ? undefined : event.target.value,
                  })
                }
              >
                <option value="all">All domains</option>
                {(model.domains ?? []).map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Environment
              <select
                value={config.environmentFilter ?? 'all'}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    environmentFilter:
                      event.target.value === 'all' ? undefined : event.target.value,
                  })
                }
              >
                <option value="all">All environments</option>
                <option value="dev">dev</option>
                <option value="staging">staging</option>
                <option value="prod">prod</option>
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              Group by
              <select
                value={config.groupBy}
                onChange={(event) =>
                  setConfig({ ...config, groupBy: event.target.value as ViewConfig['groupBy'] })
                }
              >
                <option value="domain">Domain</option>
                <option value="layer">Layer</option>
                <option value="none">No grouping</option>
              </select>
            </label>
            <label className="field">
              Dependency depth
              <input
                type="number"
                min={1}
                max={4}
                value={config.depth}
                onChange={(event) => setConfig({ ...config, depth: Number(event.target.value) })}
              />
            </label>
          </div>

          <h3>Element types</h3>
          <div className="chip-cloud">
            {config.elementTypes.map((type) => (
              <button key={type} className="chip" onClick={() => removeElementType(type)} title="Remove">
                {getElementType(type)?.label ?? type} ×
              </button>
            ))}
          </div>
          <select value="" onChange={(event) => addElementType(event.target.value)}>
            <option value="">Add element type…</option>
            {ELEMENT_TYPES.filter((type) => !config.elementTypes.includes(type.id)).map((type) => (
              <option key={type.id} value={type.id}>
                {type.label}
              </option>
            ))}
          </select>

          <h3>Relationships</h3>
          <div className="checkbox-grid">
            {RELATIONSHIP_TYPES.map((relationship) => (
              <label key={relationship.id}>
                <input
                  type="checkbox"
                  checked={config.relationshipTypes.includes(relationship.id)}
                  onChange={() => toggleRelationship(relationship.id)}
                />
                {getRelationshipType(relationship.id)?.label ?? relationship.id}
              </label>
            ))}
          </div>

          <h3>Displayed attributes</h3>
          <div className="checkbox-grid">
            {attributeOptions.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={config.attributes.includes(key)}
                  onChange={() => toggleAttribute(key)}
                />
                {key}
              </label>
            ))}
          </div>

          <h3>Focus & drill-down</h3>
          <label className="field">
            Focus on elements (dependency neighbourhood)
            <select
              multiple
              size={5}
              value={config.rootElementIds ?? []}
              onChange={(event) =>
                setConfig({
                  ...config,
                  rootElementIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                })
              }
            >
              {model.elements.map((element) => (
                <option key={element.id} value={element.id}>
                  {primaryText(element.name) || element.id} ({element.type})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Expand these elements with lower-level detail
            <select
              multiple
              size={5}
              value={config.expandElementIds ?? []}
              onChange={(event) =>
                setConfig({
                  ...config,
                  expandElementIds: Array.from(event.target.selectedOptions).map(
                    (option) => option.value,
                  ),
                })
              }
            >
              {model.elements
                .filter((element) => config.elementTypes.includes(element.type))
                .map((element) => (
                  <option key={element.id} value={element.id}>
                    {primaryText(element.name) || element.id} ({element.type})
                  </option>
                ))}
            </select>
          </label>

          {generatedViews.length > 0 && (
            <>
              <h3>Generated views</h3>
              <ul className="generated-view-list">
                {generatedViews.map(({ view, index }) => (
                  <li key={view.id}>
                    <button className="link-button" onClick={() => loadView(index)}>
                      {primaryText(view.name)}
                    </button>
                    <span className="muted">
                      {view.config?.granulation} · {view.config?.viewpointId}
                    </span>
                    <button className="small-button" onClick={() => onOpenView(index)}>
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="panel-card view-preview-panel">
          <div className="section-heading">
            <h3>Preview</h3>
            <div className="stat-inline">
              <span className="chip">{preview.stats.elements} elements</span>
              <span className="chip">{preview.stats.relationships} relationships</span>
              <span className="chip">{preview.stats.groups} groups</span>
              {preview.stats.expanded > 0 && (
                <span className="chip">{preview.stats.expanded} expanded</span>
              )}
            </div>
          </div>
          <p className="muted">
            {preview.stats.hiddenElements} element(s) hidden by this viewpoint and granulation.
          </p>
          <ViewPreview view={preview.view} model={model} />
        </section>
      </div>
    </div>
  );
}
