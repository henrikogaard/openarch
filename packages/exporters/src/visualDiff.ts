import { primaryText, type Model, type View } from '@openarch/core';
import { exportViewSvg } from './svg';


/**
 * 5/7 — snapshot visual diff: render the same view at two moments as two
 * exported SVGs, and classify per-element/relationship presence so the
 * side-by-side panel can outline additions/removals.
 */
export interface SnapshotDiffEntry {
  id: string;
  label: string;
  status: 'added' | 'removed' | 'unchanged';
}

export interface SnapshotVisualDiff {
  beforeSvg: string;
  afterSvg: string;
  elements: SnapshotDiffEntry[];
  relationships: SnapshotDiffEntry[];
  counts: { added: number; removed: number; unchanged: number };
}

export function diffSnapshots(
  before: Model,
  after: Model,
  viewId: string,
): SnapshotVisualDiff {
  const inView = (model: Model) => {
    const view = model.views.find((candidate) => candidate.id === viewId) ?? model.views[0];
    const elementIds = new Set(
      view?.nodes.map((node) => node.elementRef).filter((id): id is string => Boolean(id)) ?? [],
    );
    const relationshipIds = new Set(
      view?.edges
        .map((edge) => edge.relationshipRef)
        .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index) ?? [],
    );
    return elementsOf(model).filter((meta) => elementIds.has(meta.id))
      .concat(
        [...relationshipIds]
          .map((id) => model.relationships.find((relationship) => relationship.id === id))
          .filter((relationship): relationship is NonNullable<typeof relationship> => Boolean(relationship))
          .map((relationship) => ({ id: relationship.id, label: relationship.type })),
      );
  };

  function elementsOf(model: Model): Array<{ id: string; label: string }> {
    return model.elements.map((element) => ({
      id: element.id,
      label: primaryText(element.name) || element.id,
    }));
  }

  const beforeSet = new Map(inView(before).map((item) => [item.id, item]));
  const afterSet = new Map(inView(after).map((item) => [item.id, item]));

  const elements: SnapshotDiffEntry[] = [];
  const relationships: SnapshotDiffEntry[] = [];

  for (const [id, item] of beforeSet) {
    if (!afterSet.has(id)) elements.push({ id, label: item.label, status: 'removed' });
    else elements.push({ id, label: item.label, status: 'unchanged' });
  }
  for (const [id, item] of afterSet) {
    if (!beforeSet.has(id)) elements.push({ id, label: item.label, status: 'added' });
  }

  const beforeRel = new Set(before.relationships.map((relationship) => relationship.id));
  const afterRel = new Set(after.relationships.map((relationship) => relationship.id));
  for (const id of beforeRel) {
    if (!afterRel.has(id)) relationships.push({ id, label: relationshipLabel(before, id), status: 'removed' });
  }
  for (const id of afterRel) {
    if (!beforeRel.has(id)) relationships.push({ id, label: relationshipLabel(after, id), status: 'added' });
  }

  return {
    beforeSvg: viewSvg(before, viewId),
    afterSvg: viewSvg(after, viewId),
    elements: elements.sort((a, b) => a.label.localeCompare(b.label)),
    relationships,
    counts: {
      added: elements.filter((entry) => entry.status === 'added').length + relationships.filter((entry) => entry.status === 'added').length,
      removed: elements.filter((entry) => entry.status === 'removed').length + relationships.filter((entry) => entry.status === 'removed').length,
      unchanged: elements.filter((entry) => entry.status === 'unchanged').length,
    },
  };
}

function relationshipLabel(model: Model, id: string): string {
  return model.relationships.find((relationship) => relationship.id === id)?.type ?? id;
}

function viewSvg(model: Model, viewId: string): string {
  const view: View | undefined =
    model.views.find((candidate) => candidate.id === viewId) ?? model.views[0];
  if (!view) return '';
  try {
    return exportViewSvg(model, view.id);
  } catch {
    return '';
  }
}
