import { primaryText, type ArchiElement, type Model, type Relationship } from './types';
import { getElementType } from './metamodel';

/** Realization coverage for requirements: which are realized, and by what. */
export interface RequirementCoverage {
  requirement: ArchiElement;
  realizingElements: ArchiElement[];
}

export function requirementCoverage(model: Model): RequirementCoverage[] {
  const requirements = model.elements.filter((element) => element.type === 'Requirement' || element.type === 'Constraint' || element.type === 'Principle');
  return requirements.map((requirement) => {
    const realizing = model.relationships
      .filter(
        (relationship) =>
          (relationship.target === requirement.id || relationship.source === requirement.id) &&
          ['Realization', 'Association', 'Influence'].includes(relationship.type),
      )
      .map((relationship) =>
        relationship.target === requirement.id ? relationship.source : relationship.target,
      )
      .map(
        (id) => model.elements.find((element) => element.id === id),
      )
      .filter((element): element is ArchiElement => Boolean(element));
    return { requirement, realizingElements: realizing };
  });
}

/** Migration timeline entries derived from Plateau / WorkPackage / Deliverable semantics. */
export interface Milestone {
  id: string;
  label: string;
  kind: 'plateau' | 'workpackage' | 'deliverable';
  date?: string;
  relatedTo: string[];
}

const MIGRATION_KINDS = new Set(['Plateau', 'WorkPackage', 'Deliverable']);
const DATE_KEYS = ['date', 'startDate', 'endDate', 'moment', 'milestoneDate'];

function dateOf(element: ArchiElement): string | undefined {
  for (const key of DATE_KEYS) {
    const value = element.properties.find((property) => property.key.toLowerCase() === key.toLowerCase())?.value;
    if (value) return value;
  }
  return undefined;
}

export function migrationTimeline(model: Model): Milestone[] {
  const milestones: Milestone[] = model.elements
    .filter((element) => MIGRATION_KINDS.has(element.type))
    .map((element) => ({
      id: element.id,
      label: primaryText(element.name) || element.id,
      kind: (element.type.toLowerCase() as Milestone['kind']),
      date: dateOf(element),
      relatedTo: model.relationships
        .filter((relationship) => relationship.source === element.id || relationship.target === element.id)
        .map((relationship) => (relationship.source === element.id ? relationship.target : relationship.source))
        .filter((id) => model.elements.some((candidate) => candidate.id === id)),
    }));
  // Chronological when dates exist (ISO-sortable), otherwise stable by label.
  return milestones.sort((a, b) => {
    const dateA = a.date ?? '9999';
    const dateB = b.date ?? '9999';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export interface ScenarioDiff {
  score: number;
  changedElementIds: string[];
  addedElementIds: string[];
  removedElementIds: string[];
}

/** Compare two scenarios (as-is vs to-be) by element identity — same ids score overlapping. */
export function scenarioCompare(
  baseline: Model,
  target: Model,
  relationshipsA: Relationship[],
  relationshipsB: Relationship[],
): ScenarioDiff {
  const byIdA = new Map(baseline.elements.map((element) => [element.id, element]));
  const changedElementIds: string[] = [];
  for (const targetElement of target.elements) {
    const baseElement = byIdA.get(targetElement.id);
    if (!baseElement) continue;
    if (baseElement.type !== targetElement.type || primaryText(baseElement.name) !== primaryText(targetElement.name)) {
      changedElementIds.push(targetElement.id);
    }
  }
  const idsA = new Set(baseline.elements.map((element) => element.id));
  const idsB = new Set(target.elements.map((element) => element.id));
  const added = [...idsB].filter((id) => !idsA.has(id));
  const removed = [...idsA].filter((id) => !idsB.has(id));
  const totals = baseline.elements.length + target.elements.length || 1;
  const divergence =
    (changedElementIds.length + added.length + removed.length) / Math.max(1, baseline.elements.length + target.elements.length);
  void relationshipsA;
  void relationshipsB;
  return {
    score: Math.round((1 - divergence * 2) * 100) / 100,
    changedElementIds,
    addedElementIds: added,
    removedElementIds: removed,
  };
  void totals;
  void getElementType;
}
