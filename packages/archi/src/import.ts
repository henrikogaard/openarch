import type {
  ArchiElement,
  Bounds,
  Domain,
  LocalizedText,
  Model,
  Property,
  Relationship,
  View,
  ViewEdge,
  ViewNode,
} from '@openarch/core';
import { createModel, getElementType, getRelationshipType, primaryText } from '@openarch/core';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { ArchiImportResult } from './types';

/**
 * Reader for Archi's native `.archimate` archive.
 *
 * The archive is a ZIP with a `model.xml` entry. Archi's XML is close to
 * ArchiMate, but uses its own namespace and a folder tree instead of the AOEF
 * `<elements>` / `<relationships>` containers.
 */

const ARCHIMATE_NS = 'http://www.archimatetool.com/archimate';
const RELATIONSHIP_SUFFIX = 'Relationship';

/** Archi folders that are containers, not architecture domains. */
const NON_DOMAIN_FOLDER_TYPES = new Set(['relations', 'diagrams', 'derived']);

/** Fixed palette used for domains derived from top-level Archi folders. */
const DOMAIN_PALETTE = [
  '#f7dc6f',
  '#8ec3e8',
  '#a9d8a9',
  '#f0d5dc',
  '#c9b3e0',
  '#e8c39e',
  '#c8e0d4',
  '#e2e2e2',
];

const ARRAY_TAGS = new Set([
  'folder',
  'element',
  'view',
  'child',
  'connection',
  'bounds',
  'property',
  'documentation',
  'name',
]);

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (tagName: string) => ARRAY_TAGS.has(tagName),
});

interface ImportCollections {
  elements: ArchiElement[];
  relationships: Relationship[];
  views: View[];
  warnings: string[];
  /** Archi 5+ property definitions map (id → name) for property resolution. */
  definitionNames: Map<string, string>;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

function nodes(value: unknown): XmlNode[] {
  return asArray(value)
    .map((item) => asNode(item))
    .filter((node): node is XmlNode => node !== undefined);
}

function attr(node: XmlNode | undefined, name: string): string {
  if (!node) return '';
  const value = node[`@_${name}`];
  return value == null ? '' : String(value);
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter((item) => item.length > 0)
      .join('\n');
  }
  if (typeof value === 'object') return text((value as XmlNode)['#text']);
  return '';
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localized(value: string): LocalizedText[] {
  const trimmed = value.trim();
  return trimmed ? [{ value: trimmed }] : [];
}

function nameOf(node: XmlNode): LocalizedText[] {
  return localized(attr(node, 'name') || text(node.name));
}

function documentationOf(node: XmlNode): LocalizedText[] {
  return localized(text(node.documentation));
}

/**
 * Read a model.xml entry by its identifier: either classic `<property
 * key="…" value="…"/>` or Archi 5+ `<property propertyDefinitionRef="…">
 * <value>…</value></property>` resolved against the model's
 * `<propertyDefinitions>`.
 */
function parseProperties(node: XmlNode, definitionNames?: Map<string, string>): Property[] {
  const properties: Property[] = [];
  for (const container of nodes(node.properties)) {
    for (const raw of nodes(container.property)) {
      const key = attr(raw, 'key');
      const value = attr(raw, 'value');
      if (key && value !== undefined) {
        properties.push({ key, value });
        continue;
      }
      if (key) {
        properties.push({ key, value });
        continue;
      }
      // Archi 5+ shape: resolve the definition reference.
      const reference = attr(raw, 'propertyDefinitionRef');
      if (reference) {
        const name = definitionNames?.get(reference) ?? reference;
        const value5 = text(raw.value);
        properties.push({ key: name, value: value5 });
      }
    }
  }
  return properties;
}

function parseBounds(node: XmlNode | undefined): Bounds {
  return {
    x: num(attr(node, 'x')),
    y: num(attr(node, 'y')),
    w: num(attr(node, 'width') || attr(node, 'w')),
    h: num(attr(node, 'height') || attr(node, 'h')),
  };
}

function isRelationshipType(type: string): boolean {
  return type.endsWith(RELATIONSHIP_SUFFIX);
}

function parseElement(
  raw: XmlNode,
  domainId: string | undefined,
  warnings: string[],
  definitionNames?: Map<string, string>,
): ArchiElement {
  const id = attr(raw, 'id');
  const type = attr(raw, 'type');
  const name = nameOf(raw);
  if (!getElementType(type)) {
    warnings.push(
      `Unknown ArchiMate element type "${type}" for element "${primaryText(name) || id}" (${id})`,
    );
  }

  const element: ArchiElement = {
    id,
    type,
    name,
    documentation: documentationOf(raw),
    properties: parseProperties(raw, definitionNames),
  };
  if (domainId) element.domain = domainId;
  return element;
}

function parseRelationship(
  raw: XmlNode,
  archiType: string,
  warnings: string[],
  definitionNames?: Map<string, string>,
): Relationship {
  const id = attr(raw, 'id');
  const type = archiType.slice(0, -RELATIONSHIP_SUFFIX.length);
  const name = nameOf(raw);
  if (!getRelationshipType(type)) {
    warnings.push(
      `Unknown ArchiMate relationship type "${archiType}" for relationship "${
        primaryText(name) || id
      }" (${id})`,
    );
  }

  const relationship: Relationship = {
    id,
    type,
    source: attr(raw, 'source'),
    target: attr(raw, 'target'),
    name,
    documentation: documentationOf(raw),
    properties: parseProperties(raw, definitionNames),
  };
  const accessType = attr(raw, 'accessType');
  if (accessType) relationship.accessType = accessType;
  return relationship;
}

function addConcept(
  raw: XmlNode,
  domainId: string | undefined,
  out: ImportCollections,
): void {
  const type = attr(raw, 'type');
  if (isRelationshipType(type)) {
    out.relationships.push(parseRelationship(raw, type, out.warnings, out.definitionNames));
  } else {
    out.elements.push(parseElement(raw, domainId, out.warnings, out.definitionNames));
  }
}

function parseView(raw: XmlNode, warnings: string[]): View {
  const viewId = attr(raw, 'id');
  const viewName = attr(raw, 'name') || text(raw.name);
  const viewNodes: ViewNode[] = [];
  const childIds = new Set<string>();

  const collectChildren = (children: unknown): void => {
    for (const child of nodes(children)) {
      const id = attr(child, 'id');
      const label = attr(child, 'name') || text(child.name);
      const element = asNode(asArray(child.archimateElement)[0]);
      const href = attr(element, 'href');
      const bounds = parseBounds(asNode(asArray(child.bounds)[0]));

      if (href) {
        viewNodes.push({
          id,
          type: 'Element',
          elementRef: href,
          label: localized(label),
          bounds,
        });
      } else {
        viewNodes.push({
          id,
          type: 'Label',
          label: localized(label),
          bounds,
        });
      }

      if (id) childIds.add(id);
      collectChildren(child.child);
    }
  };

  collectChildren(raw.child);

  const edges: ViewEdge[] = [];
  for (const connection of nodes(raw.connection)) {
    const source = attr(connection, 'source');
    const target = attr(connection, 'target');
    if (!childIds.has(source) || !childIds.has(target)) {
      const missing = [
        childIds.has(source) ? '' : `source "${source}"`,
        childIds.has(target) ? '' : `target "${target}"`,
      ]
        .filter(Boolean)
        .join(' and ');
      warnings.push(
        `Skipping connection "${attr(connection, 'id')}" in view "${
          viewName || viewId
        }": ${missing} is missing`,
      );
      continue;
    }

    const relationship = asNode(asArray(connection.archimateRelationship)[0]);
    edges.push({
      id: attr(connection, 'id'),
      type: 'Relationship',
      relationshipRef: attr(relationship, 'href'),
      source,
      target,
      bendpoints: nodes(connection.bendpoint).map((point) => ({
        x: num(attr(point, 'x')),
        y: num(attr(point, 'y')),
      })),
    });
  }

  return {
    id: viewId,
    type: 'Diagram',
    name: localized(viewName),
    nodes: viewNodes,
    edges,
  };
}

function walkFolder(
  folder: XmlNode,
  domainId: string | undefined,
  out: ImportCollections,
): void {
  for (const element of nodes(folder.element)) addConcept(element, domainId, out);
  for (const view of nodes(folder.view)) out.views.push(parseView(view, out.warnings));
  for (const nested of nodes(folder.folder)) walkFolder(nested, domainId, out);
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'domain';
}

function uniqueDomainId(name: string, used: Set<string>): string {
  const base = `domain-${slug(name)}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Defensive caps for untrusted archives (zip bombs decompress into memory). */
const MAX_ARCHIVE_INPUT_BYTES = 50 * 1024 * 1024; // 50 MB input
const MAX_ARCHIVE_ENTRIES = 2000;
const MAX_ARCHIVE_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MB

function readArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_ARCHIVE_INPUT_BYTES) {
    throw new Error('Invalid Archi archive: input larger than 50 MB');
  }
  try {
    // fflate's filter receives each entry BEFORE it is inflated; refusing an
    // entry there keeps oversized bombs from ever touching memory.
    let totalOriginal = 0;
    let entries = 0;
    const files = unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        totalOriginal += file.originalSize ?? 0;
        if (entries > MAX_ARCHIVE_ENTRIES) {
          throw new Error('Invalid Archi archive: too many entries');
        }
        if (totalOriginal > MAX_ARCHIVE_TOTAL_UNCOMPRESSED) {
          throw new Error('Invalid Archi archive: decompressed size exceeds 200 MB');
        }
        return true;
      },
    });
    return files;
  } catch (error) {
    throw new Error(`Invalid Archi archive: ${errorMessage(error)}`);
  }
}

function findModelXml(files: Record<string, Uint8Array>): Uint8Array {
  const direct = files['model.xml'] ?? files['model/model.xml'];
  if (direct) return direct;

  const nested = Object.entries(files).find(([path]) => path.endsWith('/model.xml'));
  if (nested) return nested[1];

  throw new Error('Invalid Archi archive: model.xml not found');
}

function findModelRoot(document: XmlNode): XmlNode | undefined {
  const direct = asNode(document['archimate:model']) ?? asNode(document.model);
  if (direct) return direct;

  for (const [key, value] of Object.entries(document)) {
    if (!key.endsWith(':model')) continue;
    const node = asNode(value);
    if (node) return node;
  }
  return undefined;
}

export function importArchi(bytes: Uint8Array): ArchiImportResult {
  const files = readArchive(bytes);
  const xml = strFromU8(findModelXml(files));

  let document: XmlNode;
  try {
    document = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new Error(`Invalid Archi model.xml: ${errorMessage(error)}`);
  }

  const root = findModelRoot(document);
  if (!root) {
    throw new Error(
      `Invalid Archi model: missing <archimate:model> root element (namespace ${ARCHIMATE_NS})`,
    );
  }

  const domains: Domain[] = [];
  const domainByFolder = new Map<XmlNode, string>();
  const usedDomainIds = new Set<string>();
  let paletteIndex = 0;

  for (const folder of nodes(root.folder)) {
    const type = attr(folder, 'type');
    if (NON_DOMAIN_FOLDER_TYPES.has(type)) continue;

    const name = attr(folder, 'name') || type || 'Domain';
    const id = uniqueDomainId(name, usedDomainIds);
    domains.push({
      id,
      name,
      color: DOMAIN_PALETTE[paletteIndex % DOMAIN_PALETTE.length],
    });
    paletteIndex += 1;
    domainByFolder.set(folder, id);
  }

  const out: ImportCollections = {
    elements: [],
    relationships: [],
    views: [],
    warnings: [],
    definitionNames: new Map(
      nodes(root.propertyDefinitions).flatMap((container) =>
        nodes(container.propertyDefinition).map((definition) => [
          attr(definition, 'id'),
          attr(definition, 'name'),
        ] as [string, string]),
      ),
    ),
  };

  for (const folder of nodes(root.folder)) {
    walkFolder(folder, domainByFolder.get(folder), out);
  }
  for (const element of nodes(root.element)) addConcept(element, undefined, out);
  for (const view of nodes(root.view)) out.views.push(parseView(view, out.warnings));

  const name = nameOf(root);
  const model: Model = createModel({
    id: attr(root, 'id') || undefined,
    name: name.length ? name : undefined,
    documentation: documentationOf(root),
    properties: parseProperties(root, out.definitionNames),
    elements: out.elements,
    relationships: out.relationships,
    views: out.views,
    domains,
  });

  return { model, warnings: out.warnings };
}
