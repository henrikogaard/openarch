import { primaryText, removeElements, type ArchiElement, type Model, type Relationship } from '@openarch/core';
import type { IacImport } from './types';

export interface IacDriftChange {
  current: ArchiElement;
  incoming: ArchiElement;
}

/** Diff a fresh IaC import against the iac-sourced elements already in the model. */
export interface IacDrift {
  /** In the import, not in the model. */
  added: ArchiElement[];
  /** In the model (iac-sourced), not in the import. */
  removed: ArchiElement[];
  /** Same iacAddress, but type/name/properties differ. */
  changed: IacDriftChange[];
}

export function iacAddressOf(element: ArchiElement): string | undefined {
  return element.properties.find((property) => property.key === 'iacAddress')?.value;
}

export function diffIacImport(model: Model, imported: IacImport): IacDrift {
  const current = new Map<string, ArchiElement>();
  for (const element of model.elements) {
    const address = iacAddressOf(element);
    if (address) current.set(address, element);
  }
  const incoming = new Map<string, ArchiElement>();
  for (const element of imported.elements) {
    const address = iacAddressOf(element);
    if (address) incoming.set(address, element);
  }

  const added = imported.elements.filter((element) => {
    const address = iacAddressOf(element);
    return Boolean(address) && !current.has(address!);
  });
  const removed = [...current.entries()]
    .filter(([address]) => !incoming.has(address))
    .map(([, element]) => element);
  const changed: IacDriftChange[] = [];
  for (const [address, incomingElement] of incoming) {
    const currentElement = current.get(address);
    if (
      currentElement &&
      (currentElement.type !== incomingElement.type ||
        primaryText(currentElement.name) !== primaryText(incomingElement.name) ||
        JSON.stringify(currentElement.properties) !== JSON.stringify(incomingElement.properties))
    ) {
      changed.push({ current: currentElement, incoming: incomingElement });
    }
  }
  return { added, removed, changed };
}

/**
 * Apply a (possibly filtered) drift to the model.
 *
 * Semantics (the point of drift is to update imports WITHOUT destroying user
 * work layered on top):
 * - `removed` elements are deleted via removeElements (views, groupings,
 *   artefact links pruned);
 * - `changed` elements update only iac-owned fields (type + iac metadata
 *   properties); user fields — name, domain, environment, documentation —
 *   are preserved even when the importer wants them changed;
 * - `added` elements are upserted by their stable iac id;
 * - relationships are replaced ONLY where BOTH the existing relationship is
 *   iac-sourced (property source=iac) — a user-drawn edge between imported
 *   elements is never touched;
 * - incoming relationships that reference an element not present after the
 *   apply (typically an ignored "added" resource) are dropped instead of
 *   written as dangling references.
 */
export function applyIacDrift(model: Model, drift: IacDrift, incomingRelationships: Relationship[]): Model {
  const removedIds = drift.removed.map((element) => element.id);
  const next = removedIds.length ? removeElements(model, removedIds) : model;

  const upsert = [...drift.added, ...drift.changed.map((change) => change.incoming)];
  const elementsById = new Map(next.elements.map((element) => [element.id, element]));
  for (const incoming of upsert) {
    const existing = elementsById.get(incoming.id);
    if (existing) {
      // Preserve user-owned fields; adopt importer-owned metadata.
      const iacProperties = incoming.properties.filter(
        (property) => property.key !== 'environment' || property.key.startsWith('iac'),
      );
      elementsById.set(incoming.id, {
        ...existing,
        type: incoming.type,
        properties: iacProperties,
        environment: existing.environment ?? incoming.environment,
      });
    } else {
      elementsById.set(incoming.id, incoming);
    }
  }

  const finalElementIds = new Set(elementsById.keys());
  // Only iac-sourced existing relationships are replaceable; user edges stay.
  const keptRelationships = next.relationships.filter(
    (relationship) => !isIacRelationship(relationship),
  );
  const incomingById = new Map<string, Relationship>();
  for (const relationship of incomingRelationships) {
    // Cross-validate: never persist a dangling reference for an ignored add.
    if (finalElementIds.has(relationship.source) && finalElementIds.has(relationship.target)) {
      incomingById.set(relationship.id, relationship);
    }
  }
  return {
    ...next,
    elements: [...elementsById.values()],
    relationships: [...keptRelationships, ...incomingById.values()],
  };
}

function isIacRelationship(relationship: Relationship): boolean {
  return relationship.properties.some(
    (property) => property.key === 'source' && property.value === 'iac',
  );
}
