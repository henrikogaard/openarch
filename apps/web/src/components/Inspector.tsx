import {
  getElementType,
  getRelationshipType,
  primaryText,
  type ArchiElement,
  type Domain,
  type Property,
  type Relationship,
} from '@openarch/core';
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import {
  confluencePageUrl,
  jiraIssueUrl,
  linksOfElement,
  linkPropertyKey,
  type ConnectorConfig,
} from '@openarch/connectors';

type LinkSystem = 'jira' | 'confluence' | 'servicenow';

interface InspectorProps {
  element?: ArchiElement;
  elements: ArchiElement[];
  relationships: Relationship[];
  domains?: Domain[];
  connectors?: ConnectorConfig;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<ArchiElement>) => void;
}

export default function Inspector({
  element,
  elements,
  relationships,
  domains = [],
  connectors,
  onSelect,
  onUpdate,
}: InspectorProps) {
  const t = useTranslation();
  const [name, setName] = useState('');
  const [documentation, setDocumentation] = useState('');
  const [linkSystem, setLinkSystem] = useState<LinkSystem>('jira');
  const [linkValue, setLinkValue] = useState('');

  useEffect(() => {
    setName(primaryText(element?.name ?? []));
    setDocumentation(primaryText(element?.documentation ?? []));
  }, [element?.id, element?.name, element?.documentation]);

  if (!element) {
    return (
      <aside className="inspector empty-inspector">
        <h3>{t('inspector')}</h3>
        <p>{t('inspectorHint')}</p>
      </aside>
    );
  }

  const definition = getElementType(element.type);
  const names = new Map(elements.map((item) => [item.id, primaryText(item.name)]));
  const connected = relationships.filter(
    (relationship) => relationship.source === element.id || relationship.target === element.id,
  );

  const updateProperties = (properties: Property[]) => onUpdate(element.id, { properties });

  return (
    <aside className="inspector">
      <h3>{t('inspector')}</h3>
      <div className="inspector-hero" style={{ borderLeftColor: definition?.color }}>
        <span className="inspector-type">{definition?.label ?? element.type}</span>
        <h4>{primaryText(element.name) || 'Unnamed element'}</h4>
        <span className="layer-pill">{definition?.layer ?? 'unknown'}</span>
      </div>

      <section>
        <h4>Name</h4>
        <input
          className="form-input full"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name !== primaryText(element.name)) {
              onUpdate(element.id, { name: [{ lang: 'en', value: name }] });
            }
          }}
        />
      </section>

      <section>
        <h4>{t('externalLinks')}</h4>
        <ul className="relation-list">
          {linksOfElement(element).map((link) => {
            const url =
              link.system === 'jira'
                ? jiraIssueUrl(connectors ?? {}, link.value)
                : link.system === 'confluence'
                  ? confluencePageUrl(connectors ?? {}, link.value)
                  : undefined;
            return (
              <li key={link.system + link.value}>
                <span className="chip">{link.system}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">{link.value}</a>
                ) : (
                  <span className="mono">{link.value}</span>
                )}
                <button
                  className="small-button"
                  onClick={() =>
                    onUpdate(element.id, {
                      properties: element.properties.filter(
                        (property) => property.key !== linkPropertyKey(link.system as LinkSystem),
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            );
          })}
          {linksOfElement(element).length === 0 && (
            <li className="empty">{t('noLinks')}</li>
          )}
        </ul>
        <div className="field-row">
          <select value={linkSystem} onChange={(event) => setLinkSystem(event.target.value as LinkSystem)}>
            <option value="jira">{t('jiraIssue')}</option>
            <option value="confluence">{t('confluencePage')}</option>
            <option value="servicenow">{t('serviceNowCi')}</option>
          </select>
          <input
            className="form-input"
            placeholder={linkSystem === 'jira' ? 'PROJ-123' : linkSystem === 'confluence' ? 'page id' : 'CI name'}
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
          />
          <button
            className="small-button"
            disabled={!linkValue.trim()}
            onClick={() => {
              onUpdate(element.id, {
                properties: [
                  ...element.properties.filter((property) => property.key !== linkPropertyKey(linkSystem)),
                  { key: linkPropertyKey(linkSystem), value: linkValue.trim() },
                ],
              });
              setLinkValue('');
            }}
          >
            Link
          </button>
        </div>
      </section>

      <section>
        <h4>{t('placement')}</h4>
        <div className="field-row">
          <label className="field">
            Domain
            <select
              value={element.domain ?? ''}
              onChange={(event) => onUpdate(element.id, { domain: event.target.value || undefined })}
            >
              <option value="">Unassigned</option>
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Environment
            <select
              value={element.environment ?? ''}
              onChange={(event) => onUpdate(element.id, { environment: event.target.value || undefined })}
            >
              <option value="">Unassigned</option>
              <option value="dev">dev</option>
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
          </label>
        </div>
      </section>

      <section>
        <h4>{t('documentation')}</h4>
        <textarea
          className="form-input full"
          rows={3}
          value={documentation}
          onChange={(event) => setDocumentation(event.target.value)}
          onBlur={() => {
            if (documentation !== primaryText(element.documentation)) {
              onUpdate(element.id, { documentation: documentation ? [{ lang: 'en', value: documentation }] : [] });
            }
          }}
        />
      </section>

      <section>
        <h4>{t('properties')}</h4>
        <dl className="property-list">
          {element.properties.map((property, index) => (
            <div key={`${property.key}-${index}`}>
              <input
                className="property-key"
                value={property.key}
                onChange={(event) => {
                  const next = [...element.properties];
                  next[index] = { ...property, key: event.target.value };
                  updateProperties(next);
                }}
              />
              <input
                className="property-value"
                value={property.value}
                onChange={(event) => {
                  const next = [...element.properties];
                  next[index] = { ...property, value: event.target.value };
                  updateProperties(next);
                }}
              />
              <button
                className="icon-button"
                title={t('removeProperty')}
                onClick={() => updateProperties(element.properties.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </dl>
        <button
          className="small-button"
          onClick={() => updateProperties([...element.properties, { key: '', value: '' }])}
        >
          + Add property
        </button>
      </section>

      <section>
        <h4>{t('relationships')} ({connected.length})</h4>
        <ul className="relation-list">
          {connected.map((relationship) => {
            const outgoing = relationship.source === element.id;
            const otherId = outgoing ? relationship.target : relationship.source;
            return (
              <li key={relationship.id}>
                <span className="relation-kind">
                  {getRelationshipType(relationship.type)?.label ?? relationship.type}
                </span>
                <span className="relation-direction">{outgoing ? '→' : '←'}</span>
                <button onClick={() => onSelect(otherId)}>{names.get(otherId) ?? otherId}</button>
              </li>
            );
          })}
          {connected.length === 0 && <li className="empty">No relationships</li>}
        </ul>
      </section>

      <section className="mono inspector-id">
        <h4>{t('identifier')}</h4>
        {element.id}
      </section>
    </aside>
  );
}
