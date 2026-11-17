import { buildPresetMatrix, MATRIX_PRESETS, primaryText, type Model } from '@openarch/core';
import { useState } from 'react';

interface MatrixViewProps {
  model: Model;
}

export default function MatrixView({ model }: MatrixViewProps) {
  const [presetId, setPresetId] = useState<string>(MATRIX_PRESETS[0].id);
  const matrix = buildPresetMatrix(model, presetId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Matrix views</h2>
          <p>Cross-cutting views generated from relationships in the model.</p>
        </div>
        <select value={presetId} onChange={(event) => setPresetId(event.target.value)}>
          {MATRIX_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.title}
            </option>
          ))}
        </select>
      </header>

      {!matrix || matrix.rows.length === 0 || matrix.columns.length === 0 ? (
        <div className="panel-card empty">This matrix needs elements on both axes. Add them in the editor first.</div>
      ) : (
        <div className="table-wrap matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th rowSpan={2}>{matrix.rows[0] ? 'Row \\ Column' : ''}</th>
                {matrix.columns.map((column) => (
                  <th key={column.id} title={column.type}>
                    {primaryText(column.name) || column.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.id}>
                  <th>{primaryText(row.name) || row.id}</th>
                  {matrix.columns.map((column) => {
                    const cell = matrix.cells.find(
                      (item) => item.rowId === row.id && item.columnId === column.id,
                    );
                    return (
                      <td key={column.id} className={cell ? 'filled' : ''}>
                        {cell ? cell.relationships.map((relationship) => relationship.type).join(', ') : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
