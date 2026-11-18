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
 * Apply a (possibly filtered) drift to the model: removed elements are deleted
 * (with their relationships and view nodes), added/changed elements are upserted
 * by their stable iac id, and iac-sourced relationships are replaced by the
 * incoming import's relationships.
 */
export function applyIacDrift(model: Model, drift: IacDrift, incomingRelationships: Relationship[]): Model {
  const removedIds = drift.removed.map((element) => element.id);
  const next = removedIds.length ? removeElements(model, removedIds) : model;

  const upsert = [...drift.added, ...drift.changed.map((change) => change.incoming)];
  const elementsById = new Map(next.elements.map((element) => [element.id, element]));
  for (const element of upsert) elementsById.set(element.id, element);

  const iacIds = new Set([
    ...model.elements.filter((element) => iacAddressOf(element)).map((element) => element.id),
    ...removedIds,
  ]);
  const incomingById = new Map(incomingRelationships.map((relationship) => [relationship.id, relationship]));
  const relationships = [
    ...next.relationships.filter(
      (relationship) => !iacIds.has(relationship.source) && !iacIds.has(relationship.target),
    ),
    ...incomingById.values(),
  ];
  return { ...next, elements: [...elementsById.values()], relationships };
}
