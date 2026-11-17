import { getElementType, primaryText, type ArchiElement } from '@openarch/core';
import { useState } from 'react';

interface CatalogProps {
  elements: ArchiElement[];
  selectedElementId: string | null;
  onSelect: (id: string) => void;
}

export default function Catalog({ elements, selectedElementId, onSelect }: CatalogProps) {
  const [query, setQuery] = useState('');
  const filtered = elements.filter((element) =>
    `${primaryText(element.name)} ${element.type}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Element catalogue</h2>
          <p>Every element in the model, searchable and linked to the canvas.</p>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search elements…"
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
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((element) => {
              const definition = getElementType(element.type);
              return (
                <tr
                  key={element.id}
                  className={element.id === selectedElementId ? 'selected' : ''}
                  onClick={() => onSelect(element.id)}
                >
                  <td>{primaryText(element.name) || <em>Unnamed</em>}</td>
                  <td>{definition?.label ?? element.type}</td>
                  <td>
                    <span className="layer-pill">{definition?.layer ?? 'unknown'}</span>
                  </td>
                  <td className="mono">{element.id}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
