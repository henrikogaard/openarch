import {
  artefactMarkdown,
  createArtefact,
  primaryText,
  type Artefact,
  type ArtefactKind,
  type Model,
} from '@openarch/core';
import { useMemo, useState } from 'react';

interface ArtefactsProps {
  model: Model;
  onUpdate: (artefacts: Artefact[]) => void;
  onSelectElement: (id: string) => void;
}

const KIND_LABEL: Record<ArtefactKind, string> = {
  adr: 'Decision record',
  requirement: 'Requirement',
  principle: 'Principle',
  assessment: 'Assessment',
};

const STATUSES: Record<ArtefactKind, string[]> = {
  adr: ['proposed', 'accepted', 'rejected', 'superseded'],
  requirement: ['open', 'met', 'at-risk', 'waived'],
  principle: ['proposed', 'accepted', 'retired'],
  assessment: ['draft', 'complete'],
};

export default function Artefacts({ model, onUpdate, onSelectElement }: ArtefactsProps) {
  const artefacts = model.artefacts ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(artefacts[0]?.id);
  const [kindFilter, setKindFilter] = useState<'all' | ArtefactKind>('all');

  const filtered = useMemo(
    () => artefacts.filter((artefact) => kindFilter === 'all' || artefact.kind === kindFilter),
    [artefacts, kindFilter],
  );
  const selected = artefacts.find((artefact) => artefact.id === selectedId) ?? filtered[0];

  const update = (id: string, patch: Partial<Artefact>) => {
    onUpdate(
      artefacts.map((artefact) =>
        artefact.id === id ? { ...artefact, ...patch, updatedAt: new Date().toISOString() } : artefact,
      ),
    );
  };

  const add = (kind: ArtefactKind) => {
    const artefact = createArtefact(
      kind,
      kind === 'adr' ? 'ADR-001 Untitled decision' : `New ${KIND_LABEL[kind].toLowerCase()}`,
      kind === 'adr'
        ? '## Context\n\nWhat is the situation?\n\n## Decision\n\nWhat did we decide?\n\n## Consequences\n\nWhat follows from it?'
        : '',
    );
    onUpdate([...artefacts, artefact]);
    setSelectedId(artefact.id);
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this artefact?')) return;
    onUpdate(artefacts.filter((artefact) => artefact.id !== id));
    if (selectedId === id) setSelectedId(undefined);
  };

  const exportMarkdown = () => {
    const text = artefacts.map(artefactMarkdown).join('\n---\n\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${primaryText(model.name) || 'workspace'}-artefacts.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Artefacts</h2>
          <p>Decision records, requirements, principles, and assessments that live with the model.</p>
        </div>
        <div className="ai-actions">
          <button onClick={() => add('adr')}>+ Decision record</button>
          <button onClick={() => add('requirement')}>+ Requirement</button>
          <button onClick={() => add('principle')}>+ Principle</button>
          <button onClick={exportMarkdown} disabled={artefacts.length === 0}>
            Export .md
          </button>
        </div>
      </header>

      <div className="filter-row">
        <button className={kindFilter === 'all' ? 'active' : ''} onClick={() => setKindFilter('all')}>
          All ({artefacts.length})
        </button>
        {(Object.keys(KIND_LABEL) as ArtefactKind[]).map((kind) => (
          <button
            key={kind}
            className={kindFilter === kind ? 'active' : ''}
            onClick={() => setKindFilter(kind)}
          >
            {KIND_LABEL[kind]} ({artefacts.filter((artefact) => artefact.kind === kind).length})
          </button>
        ))}
      </div>

      <div className="artefact-layout">
        <aside className="artefact-list">
          {filtered.map((artefact) => (
            <button
              key={artefact.id}
              className={artefact.id === selected?.id ? 'active' : ''}
              onClick={() => setSelectedId(artefact.id)}
            >
              <strong>{artefact.title}</strong>
              <small>
                {KIND_LABEL[artefact.kind]} · {artefact.status}
              </small>
            </button>
          ))}
          {filtered.length === 0 && <p className="muted empty">No artefacts in this filter.</p>}
        </aside>

        {selected ? (
          <section className="panel-card artefact-editor">
            <label className="field">
              Title
              <input
                className="form-input full"
                value={selected.title}
                onChange={(event) => update(selected.id, { title: event.target.value })}
              />
            </label>
            <div className="field-row">
              <label className="field">
                Kind
                <select
                  value={selected.kind}
                  onChange={(event) => update(selected.id, { kind: event.target.value as ArtefactKind })}
                >
                  {(Object.keys(KIND_LABEL) as ArtefactKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Status
                <select
                  value={selected.status}
                  onChange={(event) => update(selected.id, { status: event.target.value })}
                >
                  {(STATUSES[selected.kind] ?? ['open']).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              Body (Markdown)
              <textarea
                className="form-input full artefact-body"
                rows={14}
                value={selected.body}
                onChange={(event) => update(selected.id, { body: event.target.value })}
              />
            </label>
            <label className="field">
              Linked elements
              <select
                multiple
                className="form-input full"
                size={6}
                value={selected.elementIds}
                onChange={(event) =>
                  update(selected.id, {
                    elementIds: Array.from(event.target.selectedOptions).map((option) => option.value),
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
            <div className="ai-actions">
              {selected.elementIds.slice(0, 4).map((id) => {
                const element = model.elements.find((candidate) => candidate.id === id);
                return (
                  <button key={id} className="chip" onClick={() => onSelectElement(id)}>
                    {element ? primaryText(element.name) || element.id : id}
                  </button>
                );
              })}
              <button className="danger-link" onClick={() => remove(selected.id)}>
                Delete artefact
              </button>
            </div>
          </section>
        ) : (
          <section className="panel-card empty">
            <p className="muted">Select or create an artefact to start.</p>
          </section>
        )}
      </div>
    </div>
  );
}
