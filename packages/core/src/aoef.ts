import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type {
  ArchiElement,
  Bounds,
  LocalizedText,
  Model,
  Point,
  Property,
  PropertyDefinition,
  RawXml,
  Relationship,
  View,
  ViewEdge,
  ViewNode,
} from './types';
import { primaryText } from './types';

/**
 * ArchiMate Open Exchange Format (AOEF) codec, written against
 * `archimate3_Diagram.xsd` (which includes the View and Model schemas).
 *
 * Two rules keep the output conformant:
 *
 * 1. Unknown XML is preserved through the `raw` passthrough, but known
 *    containers are rebuilt in the order the schema requires. The schema
 *    sequences are strict, so spreading `raw` and appending would put
 *    `<properties>` after `<style>` and fail validation.
 * 2. Properties are emitted as `<property propertyDefinitionRef="…"><value>`
 *    with a matching `<propertyDefinition>`. Ad-hoc keys get a generated
 *    definition so the file stays valid.
 */

const ARCHIMATE_NS = 'http://www.opengroup.org/xsd/archimate/3.0/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const SCHEMA_LOCATION = `${ARCHIMATE_NS} ${ARCHIMATE_NS}archimate3_Diagram.xsd`;

const XML_ARRAY_TAGS = [
  'element',
  'relationship',
  'property',
  'propertyDefinition',
  'view',
  'node',
  'connection',
  'bendpoint',
  'label',
  'documentation',
  'name',
  'viewRef',
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: false,
  isArray: (name: string) => XML_ARRAY_TAGS.includes(name),
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && '#text' in (value as RawXml)) {
    return str((value as RawXml)['#text']);
  }
  return String(value);
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `xs:nonNegativeInteger` — clamp so dragging a node left/up stays schema-valid. */
function nonNegative(value: number): number {
  return Math.max(0, Math.round(value));
}

function localizedFromXml(value: unknown): LocalizedText[] {
  return asArray<RawXml | string>(value as RawXml | string | Array<RawXml | string>).map(
    (item) =>
      typeof item === 'object' && item !== null
        ? { lang: str(item['@_xml:lang']) || undefined, value: str(item['#text']) }
        : { value: str(item) },
  );
}

function localizedToXml(values: LocalizedText[]): RawXml[] | undefined {
  if (!values.length) return undefined;
  return values.map((item) => ({
    ...(item.lang ? { '@_xml:lang': item.lang } : {}),
    '#text': item.value,
  }));
}

/** Copy attributes from a raw fragment, optionally excluding keys we overwrite. */
function copyAttributes(raw: RawXml | undefined, exclude: string[] = []): RawXml {
  const out: RawXml = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!key.startsWith('@_')) continue;
    if (exclude.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Copy child elements we do not model explicitly, preserving their order. */
function copyUnknownChildren(
  raw: RawXml | undefined,
  known: string[],
): Array<[string, unknown]> {
  if (!raw) return [];
  return Object.entries(raw).filter(
    ([key]) => !key.startsWith('@_') && key !== '#text' && !known.includes(key),
  );
}

interface DefinitionRegistry {
  definitions: PropertyDefinition[];
  refFor: (property: Property) => string | undefined;
}

/**
 * Build the property-definition set for a model. Existing definitions are
 * reused by identifier and by name; ad-hoc keys get a generated definition so
 * every `<property>` has the required `propertyDefinitionRef`.
 */
function buildDefinitionRegistry(model: Model): DefinitionRegistry {
  const definitions = model.propertyDefinitions.map((definition) => ({ ...definition }));
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const byName = new Map(
    definitions.map((definition) => [definition.name.trim().toLowerCase(), definition]),
  );
  let counter = definitions.length;

  const ensure = (name: string): PropertyDefinition => {
    const key = name.trim().toLowerCase();
    const existing = byName.get(key);
    if (existing) return existing;
    counter += 1;
    // Ids are document-global xs:ID values — guarantee uniqueness even
    // against hand-edited files with sparse propdef ids.
    let id = `propdef-${counter}`;
    while (byId.has(id)) {
      counter += 1;
      id = `propdef-${counter}`;
    }
    const definition: PropertyDefinition = {
      id,
      name: name.trim() || 'Property',
      type: 'string',
    };
    definitions.push(definition);
    byId.set(definition.id, definition);
    byName.set(key, definition);
    return definition;
  };

  // Reserve existing definitions by id so a property that already points at
  // one keeps its reference even if the name was edited.
  for (const definition of definitions) byId.set(definition.id, definition);

  const refFor = (property: Property): string | undefined => {
    if (property.definitionRef && byId.has(property.definitionRef)) {
      return property.definitionRef;
    }
    if (property.key.trim()) return ensure(property.key).id;
    if (property.value.trim()) return ensure('Property').id;
    return undefined;
  };

  return { definitions, refFor };
}

function parseProperties(
  wrapper: unknown,
  definitions: Map<string, PropertyDefinition>,
): Property[] {
  return asArray<RawXml>(wrapper as RawXml | RawXml[] | undefined).map((raw) => {
    const definitionRef = str(raw['@_propertyDefinitionRef']) || undefined;
    const definition = definitionRef ? definitions.get(definitionRef) : undefined;
    return {
      key: definition?.name ?? definitionRef ?? '',
      value: primaryText(localizedFromXml(raw.value)),
      definitionRef,
      raw,
    };
  });
}

function serializeProperties(
  properties: Property[],
  refFor: (property: Property) => string | undefined,
): RawXml | undefined {
  const emitted = properties
    .map((property) => {
      const ref = refFor(property);
      if (!ref) return undefined;
      const lang = property.raw ? str((property.raw.value as RawXml)?.['@_xml:lang']) : '';
      return {
        '@_propertyDefinitionRef': ref,
        value: [{ ...(lang ? { '@_xml:lang': lang } : {}), '#text': property.value }],
      } as RawXml;
    })
    .filter((value): value is RawXml => Boolean(value));

  if (!emitted.length) return undefined;
  return { property: emitted };
}

function parseElement(
  raw: RawXml,
  definitions: Map<string, PropertyDefinition>,
): ArchiElement {
  return {
    id: str(raw['@_identifier']),
    type: str(raw['@_xsi:type']),
    name: localizedFromXml(raw.name),
    documentation: localizedFromXml(raw.documentation),
    properties: parseProperties(raw.properties?.property, definitions),
    raw,
  };
}

function serializeElement(
  element: ArchiElement,
  refFor: (property: Property) => string | undefined,
): RawXml {
  const out = copyAttributes(element.raw, [
    '@_identifier',
    '@_xsi:type',
    '@_elementRef',
  ]);
  out['@_identifier'] = element.id;
  out['@_xsi:type'] = element.type;

  const name = localizedToXml(element.name);
  if (name) out.name = name;
  const documentation = localizedToXml(element.documentation);
  if (documentation) out.documentation = documentation;

  // Extension elements belong before <properties> in the ConceptType sequence.
  for (const [key, value] of copyUnknownChildren(element.raw, [
    'name',
    'documentation',
    'properties',
  ])) {
    out[key] = value;
  }

  const properties = serializeProperties(element.properties, refFor);
  if (properties) out.properties = properties;
  return out;
}

function parseRelationship(
  raw: RawXml,
  definitions: Map<string, PropertyDefinition>,
): Relationship {
  return {
    id: str(raw['@_identifier']),
    type: str(raw['@_xsi:type']),
    source: str(raw['@_source']),
    target: str(raw['@_target']),
    accessType: str(raw['@_accessType']) || undefined,
    name: localizedFromXml(raw.name),
    documentation: localizedFromXml(raw.documentation),
    properties: parseProperties(raw.properties?.property, definitions),
    raw,
  };
}

function serializeRelationship(
  relationship: Relationship,
  refFor: (property: Property) => string | undefined,
): RawXml {
  const out = copyAttributes(relationship.raw, [
    '@_identifier',
    '@_xsi:type',
    '@_source',
    '@_target',
    '@_accessType',
  ]);
  out['@_identifier'] = relationship.id;
  out['@_xsi:type'] = relationship.type;
  out['@_source'] = relationship.source;
  out['@_target'] = relationship.target;
  if (relationship.accessType) out['@_accessType'] = relationship.accessType;

  const name = localizedToXml(relationship.name);
  if (name) out.name = name;
  const documentation = localizedToXml(relationship.documentation);
  if (documentation) out.documentation = documentation;

  for (const [key, value] of copyUnknownChildren(relationship.raw, [
    'name',
    'documentation',
    'properties',
  ])) {
    out[key] = value;
  }

  const properties = serializeProperties(relationship.properties, refFor);
  if (properties) out.properties = properties;
  return out;
}

function boundsFromXml(raw: RawXml): Bounds {
  return {
    x: num(raw['@_x']),
    y: num(raw['@_y']),
    w: num(raw['@_w']),
    h: num(raw['@_h']),
  };
}

function parseViewNode(raw: RawXml): ViewNode {
  return {
    id: str(raw['@_identifier']),
    type: str(raw['@_xsi:type']),
    elementRef: str(raw['@_elementRef']) || undefined,
    viewRef: asArray<RawXml>(raw.viewRef)[0]
      ? str(asArray<RawXml>(raw.viewRef)[0]['@_ref'])
      : undefined,
    label: localizedFromXml(raw.label),
    bounds: boundsFromXml(raw),
    raw,
  };
}

/**
 * Parse a view node and flatten container children into the same list.
 *
 * AOEF container nodes carry children as nested `<node>` elements whose
 * bounds are RELATIVE to their container; the model stores bounds as
 * absolute canvas coordinates and keeps the parent link in `parentId`
 * (native-only, invisible to AOEF). Nested children therefore become real
 * model nodes — visible to editing, deletion, and validation — instead of
 * opaque `raw` passthrough that nothing could see or prune.
 */
function parseViewNodeTree(raw: RawXml, offset: Point, parentId: string | undefined, into: ViewNode[]): ViewNode {
  const bounds = boundsFromXml(raw);
  const node: ViewNode = {
    id: str(raw['@_identifier']),
    type: str(raw['@_xsi:type']),
    elementRef: str(raw['@_elementRef']) || undefined,
    viewRef: asArray<RawXml>(raw.viewRef)[0]
      ? str(asArray<RawXml>(raw.viewRef)[0]['@_ref'])
      : undefined,
    label: localizedFromXml(raw.label),
    bounds: offset ? { x: offset.x + bounds.x, y: offset.y + bounds.y, w: bounds.w, h: bounds.h } : bounds,
    ...(parentId ? { parentId } : {}),
  };
  // Keep the raw fragment (minus nested nodes, which we now model explicitly)
  // so prior fidelity — documentation, style, unknown attributes — survives.
  const { node: _children, ...rawWithoutChildren } = raw;
  void _children;
  node.raw = rawWithoutChildren as RawXml;
  into.push(node);
  for (const child of asArray<RawXml>(raw.node)) {
    parseViewNodeTree(child, { x: node.bounds.x, y: node.bounds.y }, node.id, into);
  }
  return node;
}

function serializeViewNode(node: ViewNode, parent: Point, childrenOf: Map<string, ViewNode[]>): RawXml {
  const out = copyAttributes(node.raw, [
    '@_identifier',
    '@_xsi:type',
    '@_elementRef',
    '@_x',
    '@_y',
    '@_w',
    '@_h',
  ]);
  out['@_identifier'] = node.id;
  out['@_xsi:type'] = node.type;
  // Coordinates are relative to this node's container.
  out['@_x'] = String(nonNegative(Math.round(node.bounds.x - parent.x)));
  out['@_y'] = String(nonNegative(Math.round(node.bounds.y - parent.y)));
  out['@_w'] = String(Math.max(1, nonNegative(Math.round(node.bounds.w))));
  out['@_h'] = String(Math.max(1, nonNegative(Math.round(node.bounds.h))));
  if (node.elementRef) out['@_elementRef'] = node.elementRef;

  // ViewConceptType sequence: label*, documentation*, style?, viewRef*
  const label = localizedToXml(node.label);
  if (label) out.label = label;
  if (node.raw?.documentation) out.documentation = node.raw.documentation;
  if (node.raw?.style) out.style = node.raw.style;
  if (node.viewRef) out.viewRef = [{ '@_ref': node.viewRef }];

  // Container nodes carry their children after the base sequence.
  const children = childrenOf.get(node.id);
  if (children?.length) {
    out.node = children.map((child) => serializeViewNode(child, node.bounds, childrenOf));
  }
  return out;
}

function parseViewEdge(raw: RawXml): ViewEdge {
  return {
    id: str(raw['@_identifier']),
    type: str(raw['@_xsi:type']),
    relationshipRef: str(raw['@_relationshipRef']),
    source: str(raw['@_source']),
    target: str(raw['@_target']),
    bendpoints: asArray<RawXml>(raw.bendpoint).map((bendpoint) => ({
      x: num(bendpoint['@_x']),
      y: num(bendpoint['@_y']),
    })),
    raw,
  };
}

function serializeViewEdge(edge: ViewEdge): RawXml {
  const out = copyAttributes(edge.raw, [
    '@_identifier',
    '@_xsi:type',
    '@_relationshipRef',
    '@_source',
    '@_target',
  ]);
  out['@_identifier'] = edge.id;
  out['@_xsi:type'] = edge.type;
  out['@_relationshipRef'] = edge.relationshipRef;
  out['@_source'] = edge.source;
  out['@_target'] = edge.target;

  // ViewConceptType children, then ConnectionType attachments and bendpoints.
  if (edge.raw?.label) out.label = edge.raw.label;
  if (edge.raw?.documentation) out.documentation = edge.raw.documentation;
  if (edge.raw?.style) out.style = edge.raw.style;
  if (edge.raw?.viewRef) out.viewRef = edge.raw.viewRef;
  if (edge.raw?.sourceAttachment) out.sourceAttachment = edge.raw.sourceAttachment;
  if (edge.bendpoints.length) {
    out.bendpoint = edge.bendpoints.map((point: Point) => ({
      '@_x': String(nonNegative(point.x)),
      '@_y': String(nonNegative(point.y)),
    }));
  }
  if (edge.raw?.targetAttachment) out.targetAttachment = edge.raw.targetAttachment;
  return out;
}

function parseView(raw: RawXml): View {
  const nodes: ViewNode[] = [];
  for (const nodeRaw of asArray<RawXml>(raw.node)) {
    parseViewNodeTree(nodeRaw, { x: 0, y: 0 }, undefined, nodes);
  }
  return {
    id: str(raw['@_identifier']),
    type: str(raw['@_xsi:type']),
    name: localizedFromXml(raw.name),
    nodes,
    edges: asArray<RawXml>(raw.connection).map(parseViewEdge),
    raw,
  };
}

function serializeView(view: View): RawXml {
  const out = copyAttributes(view.raw, ['@_identifier', '@_xsi:type']);
  out['@_identifier'] = view.id;
  out['@_xsi:type'] = view.type;

  const name = localizedToXml(view.name);
  if (name) out.name = name;
  if (view.raw?.documentation) out.documentation = view.raw.documentation;
  if (view.raw?.properties) out.properties = view.raw.properties;

  // Always overwrite the containers so deletions are honoured. `Diagram`
  // allows zero nodes and zero connections, so an empty array is valid.
  // Container children are emitted nested under their parent (with bounds
  // relative to it); only container roots appear at the top level.
  const childrenOf = new Map<string, ViewNode[]>();
  for (const node of view.nodes) {
    if (!node.parentId) continue;
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
  }
  const origin: Point = { x: 0, y: 0 };
  out.node = view.nodes
    .filter((node) => !node.parentId)
    .map((node) => serializeViewNode(node, origin, childrenOf));
  out.connection = view.edges.map(serializeViewEdge);
  return out;
}

function parsePropertyDefinition(raw: RawXml): PropertyDefinition {
  return {
    id: str(raw['@_identifier']),
    name: str(raw.name),
    type: str(raw['@_type']),
    raw,
  };
}

function serializePropertyDefinition(definition: PropertyDefinition): RawXml {
  const out = copyAttributes(definition.raw, ['@_identifier', '@_type']);
  out['@_identifier'] = definition.id;
  out['@_type'] = definition.type || 'string';
  out.name = definition.name;
  return out;
}

export function parseAoef(xml: string): Model {
  const document = parser.parse(xml) as RawXml;
  const root = document?.model as RawXml | undefined;
  if (!root || typeof root !== 'object') {
    throw new Error('Not an ArchiMate Open Exchange Format document');
  }

  const propertyDefinitions = asArray<RawXml>(
    root.propertyDefinitions?.propertyDefinition,
  ).map(parsePropertyDefinition);
  const definitions = new Map(propertyDefinitions.map((item) => [item.id, item]));

  return {
    id: str(root['@_identifier']),
    name: localizedFromXml(root.name),
    documentation: localizedFromXml(root.documentation),
    properties: parseProperties(root.properties?.property, definitions),
    propertyDefinitions,
    elements: asArray<RawXml>(root.elements?.element).map((element) =>
      parseElement(element, definitions),
    ),
    relationships: asArray<RawXml>(root.relationships?.relationship).map((relationship) =>
      parseRelationship(relationship, definitions),
    ),
    views: asArray<RawXml>(root.views?.diagrams?.view).map(parseView),
    raw: root,
  };
}

export function serializeAoef(model: Model): string {
  const { definitions, refFor } = buildDefinitionRegistry(model);

  const root = copyAttributes(model.raw, ['@_identifier']);
  root['@_identifier'] = model.id;
  // Always declare the namespaces: a model created in the app has no `raw`
  // fragment to inherit them from, and `xsi:type` is used throughout.
  root['@_xmlns'] = ARCHIMATE_NS;
  root['@_xmlns:xsi'] = XSI_NS;
  root['@_xsi:schemaLocation'] = SCHEMA_LOCATION;

  const name = localizedToXml(model.name);
  if (name) root.name = name;
  const documentation = localizedToXml(model.documentation);
  if (documentation) root.documentation = documentation;

  const properties = serializeProperties(model.properties, refFor);
  if (properties) root.properties = properties;

  if (model.raw?.metadata) root.metadata = model.raw.metadata;

  // Containers are optional in the schema; omit them when empty.
  if (model.elements.length) {
    root.elements = { element: model.elements.map((element) => serializeElement(element, refFor)) };
  }
  if (model.relationships.length) {
    root.relationships = {
      relationship: model.relationships.map((relationship) =>
        serializeRelationship(relationship, refFor),
      ),
    };
  }

  if (model.raw?.organizations) root.organizations = model.raw.organizations;
  if (definitions.length) {
    root.propertyDefinitions = {
      propertyDefinition: definitions.map(serializePropertyDefinition),
    };
  }
  if (model.views.length) {
    root.views = { diagrams: { view: model.views.map(serializeView) } };
  }

  // Preserve any remaining top-level extension elements in schema order.
  for (const [key, value] of copyUnknownChildren(model.raw, [
    'name',
    'documentation',
    'properties',
    'metadata',
    'elements',
    'relationships',
    'organizations',
    'propertyDefinitions',
    'views',
  ])) {
    root[key] = value;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ model: root })}`;
}
