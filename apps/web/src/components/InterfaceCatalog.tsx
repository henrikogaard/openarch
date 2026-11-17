import { getElementType, primaryText, type Model } from '@openarch/core';
import { useMemo, useState } from 'react';

interface InterfaceCatalogProps {
  model: Model;
  onSelect: (id: string) => void;
}

const INTERFACE_TYPES = [
  'ApplicationInterface',
  'TechnologyInterface',
  'BusinessInterface',
  'ApplicationService',
  'TechnologyService',
  'BusinessService',
];

function property(element: { properties: Array<{ key: string; value: string }> }, key: string): string {
  return element.properties.find((item) => item.key.toLowerCase() === key)?.value ?? '';
}

export default function InterfaceCatalog({ model, onSelect }: InterfaceCatalogProps) {
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(model.elements.map((element) => [element.id, element])), [model]);

  const rows = useMemo(() => {
    return model.elements
      .filter((element) => INTERFACE_TYPES.includes(element.type))
      .map((element) => {
        const providers = model.relationships
          .filter(
            (relationship) =>
              relationship.target === element.id &&
              ['Realization', 'Serving', 'Composition'].includes(relationship.type),
          )
          .map((relationship) => byId.get(relationship.source))
          .filter(Boolean);
        const consumers = model.relationships
          .filter((relationship) => relationship.source === element.id && relationship.type === 'Serving')
          .map((relationship) => byId.get(relationship.target))
          .filter(Boolean);
        return {
          element,
          providers,
          consumers,
          protocol: property(element, 'protocol') || property(element, 'technology') || '—',
          owner: property(element, 'owner') || '—',
        };
      })
      .filter((row) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return true;
        return (
          primaryText(row.element.name).toLowerCase().includes(needle) ||
          row.element.type.toLowerCase().includes(needle) ||
          row.providers.some((provider) => provider && primaryText(provider.name).toLowerCase().includes(needle)) ||
          row.consumers.some((consumer) => consumer && primaryText(consumer.name).toLowerCase().includes(needle))
        );
      });
  }, [model, byId, query]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Interface & integration catalogue</h2>
          <p>
            Interfaces and services with their provider, consumers, protocol, and owner. Protocol and
            owner come from element properties.
          </p>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search interfaces…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Layer</th>
              <th>Provider</th>
              <th>Consumers</th>
              <th>Protocol</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.element.id} onClick={() => onSelect(row.element.id)}>
                <td>{primaryText(row.element.name) || row.element.id}</td>
                <td>{getElementType(row.element.type)?.label ?? row.element.type}</td>
                <td>
                  <span className="layer-pill">{getElementType(row.element.type)?.layer ?? 'other'}</span>
                </td>
                <td>
                  {row.providers.length
                    ? row.providers.map((provider) => (provider ? primaryText(provider.name) : '')).join(', ')
                    : '—'}
                </td>
                <td>
                  {row.consumers.length
                    ? row.consumers.map((consumer) => (consumer ? primaryText(consumer.name) : '')).join(', ')
                    : '—'}
                </td>
                <td>{row.protocol}</td>
                <td>{row.owner}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No interfaces or services in this model.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
