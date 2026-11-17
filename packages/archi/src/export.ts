import type {
  ArchiElement,
  Layer,
  LocalizedText,
  Model,
  Property,
  Relationship,
  View,
  ViewEdge,
  ViewNode,
} from '@openarch/core';
import { getElementType, primaryText } from '@openarch/core';
import { strToU8, zipSync } from 'fflate';
import { XMLBuilder } from 'fast-xml-parser';

/**
 * Writer for Archi's native `.archimate` archive.
 *
 * Archi stores concepts in a folder tree and diagrams as `<view>` elements
 * whose `<child>` nodes reference model elements by `href`. The archive is a
 * ZIP containing `model.xml`; images and custom icons are not emitted.
 */

const ARCHIMATE_NS = 'http://www.archimatetool.com/archimate';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const RELATIONSHIP_SUFFIX = 'Relationship';

type XmlNode = Record<string, unknown>;

const LAYER_FOLDERS: Array<{ layer: Layer; name: string }> = [
  { layer: 'business', name: 'Business' },
  { layer: 'application', name: 'Application' },
  { layer: 'technology', name: 'Technology' },
  { layer: 'physical', name: 'Physical' },
  { layer: 'motivation', name: 'Motivation' },
  { layer: 'strategy', name: 'Strategy' },
  { layer: 'implementation', name: 'Implementation & Migration' },
  { layer: 'other', name: 'Other' },
];

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
});

function coord(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

function documentationText(values: LocalizedText[]): string {
  return values
    .map((item) => item.value)
    .filter((value) => value.trim().length > 0)
    .join('\n\n');
}

function serializeProperty(property: Property): XmlNode {
  return {
    '@_key': property.key,
    '@_value': property.value,
  };
}

function serializeProperties(properties: Property[]): XmlNode | undefined {
  if (!properties.length) return undefined;
  return { property: properties.map(serializeProperty) };
}

function serializeElement(element: ArchiElement): XmlNode {
  const out: XmlNode = {
    '@_id': element.id,
    '@_name': primaryText(element.name),
    '@_type': element.type,
  };

  const documentation = documentationText(element.documentation);
  if (documentation) out.documentation = documentation;

  const properties = serializeProperties(element.properties);
  if (properties) out.properties = properties;
  return out;
}

function archiRelationshipType(type: string): string {
  return type.endsWith(RELATIONSHIP_SUFFIX) ? type : `${type}${RELATIONSHIP_SUFFIX}`;
}

function serializeRelationship(relationship: Relationship): XmlNode {
  const out: XmlNode = {
    '@_id': relationship.id,
    '@_name': primaryText(relationship.name),
    '@_type': archiRelationshipType(relationship.type),
    '@_source': relationship.source,
    '@_target': relationship.target,
  };

  if (relationship.accessType) out['@_accessType'] = relationship.accessType;

  const documentation = documentationText(relationship.documentation);
  if (documentation) out.documentation = documentation;

  const properties = serializeProperties(relationship.properties);
  if (properties) out.properties = properties;
  return out;
}

function serializeNode(
  node: ViewNode,
  elementsById: Map<string, ArchiElement>,
): XmlNode {
  const label = primaryText(node.label);
  const hasElement = Boolean(node.elementRef);

  const out: XmlNode = {
    '@_xsi:type': hasElement
      ? 'archimate:DiagramModelArchimateObject'
      : 'archimate:DiagramModelNote',
    '@_id': node.id,
  };
  if (label) out['@_name'] = label;

  out.bounds = {
    '@_x': coord(node.bounds.x),
    '@_y': coord(node.bounds.y),
    '@_width': coord(node.bounds.w),
    '@_height': coord(node.bounds.h),
  };

  if (node.elementRef) {
    const element = elementsById.get(node.elementRef);
    out.archimateElement = {
      '@_xsi:type': `archimate:${element?.type ?? 'Grouping'}`,
      '@_href': node.elementRef,
    };
  }

  return out;
}

function serializeEdge(
  edge: ViewEdge,
  relationshipsById: Map<string, Relationship>,
): XmlNode {
  const out: XmlNode = {
    '@_xsi:type': 'archimate:DiagramModelArchimateConnection',
    '@_id': edge.id,
    '@_source': edge.source,
    '@_target': edge.target,
  };

  const relationship = relationshipsById.get(edge.relationshipRef);
  const reference: XmlNode = {};
  if (relationship) {
    reference['@_xsi:type'] = `archimate:${archiRelationshipType(relationship.type)}`;
  }
  reference['@_href'] = edge.relationshipRef;
  out.archimateRelationship = reference;

  if (edge.bendpoints.length) {
    out.bendpoint = edge.bendpoints.map((point) => ({
      '@_x': coord(point.x),
      '@_y': coord(point.y),
    }));
  }

  return out;
}

function serializeView(
  view: View,
  elementsById: Map<string, ArchiElement>,
  relationshipsById: Map<string, Relationship>,
): XmlNode {
  const out: XmlNode = {
    '@_id': view.id,
    '@_name': primaryText(view.name),
  };

  if (view.nodes.length) {
    out.child = view.nodes.map((node) => serializeNode(node, elementsById));
  }
  if (view.edges.length) {
    out.connection = view.edges.map((edge) => serializeEdge(edge, relationshipsById));
  }

  return out;
}

export function exportArchi(model: Model): Uint8Array {
  const elementsById = new Map(
    model.elements.map((element) => [element.id, element] as const),
  );
  const relationshipsById = new Map(
    model.relationships.map((relationship) => [relationship.id, relationship] as const),
  );

  const elementsByLayer = new Map<Layer, ArchiElement[]>();
  for (const element of model.elements) {
    const layer = getElementType(element.type)?.layer ?? 'other';
    const bucket = elementsByLayer.get(layer) ?? [];
    bucket.push(element);
    elementsByLayer.set(layer, bucket);
  }

  const folders: XmlNode[] = [];
  for (const { layer, name } of LAYER_FOLDERS) {
    const elements = elementsByLayer.get(layer);
    if (!elements?.length) continue;
    folders.push({
      '@_name': name,
      '@_id': `folder-${layer}`,
      '@_type': layer,
      element: elements.map(serializeElement),
    });
  }

  if (model.relationships.length) {
    folders.push({
      '@_name': 'Relations',
      '@_id': 'folder-relations',
      '@_type': 'relations',
      element: model.relationships.map(serializeRelationship),
    });
  }

  if (model.views.length) {
    folders.push({
      '@_name': 'Views',
      '@_id': 'folder-diagrams',
      '@_type': 'diagrams',
      view: model.views.map((view) => serializeView(view, elementsById, relationshipsById)),
    });
  }

  const root: XmlNode = {
    '@_xmlns:archimate': ARCHIMATE_NS,
    '@_xmlns:xsi': XSI_NS,
    '@_name': primaryText(model.name),
    '@_id': model.id,
  };

  const documentation = documentationText(model.documentation);
  if (documentation) root.documentation = documentation;

  const properties = serializeProperties(model.properties);
  if (properties) root.properties = properties;

  if (folders.length) root.folder = folders;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({
    'archimate:model': root,
  })}`;

  return zipSync({ 'model.xml': strToU8(xml) });
}
