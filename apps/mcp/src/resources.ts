import {
  ELEMENT_TYPES,
  RELATIONSHIP_TYPES,
  VIEWPOINTS,
  allowedRelationships,
  primaryText,
  type Model,
} from '@openarch/core';
import { modelToMarkdown, sanitizeAiText } from '@openarch/ai';
import type { ModelStore } from './store';

/** A complete, practical guide for models that want to emit AOEF XML. */
export const AOEF_FORMAT_GUIDE = `# ArchiMate Open Exchange Format (AOEF) guide

AOEF is the XML interchange format used by ArchiMate® tools and by OpenArch.
Generate a single root \`<model>\` element with \`<elements>\`, \`<relationships>\`
and (optionally) \`<views>\` children. OpenArch's \`parseAoef\` codec accepts this
shape; \`serializeAoef\` writes it back. Call \`preview_aoef\` before
\`apply_aoef\` so you can inspect validation issues and the diff first.

## Root element and namespaces

\`\`\`xml
<model identifier="my-model"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns="http://www.opengroup.org/xsd/archimate/3.0/">
\`\`\`

- \`identifier\` must be a unique, stable id for the model.
- The \`xsi\` namespace is required because element and relationship types are
  given through the \`xsi:type\` attribute.
- \`<name xml:lang="en">…</name>\` gives the model its display name; repeat the
  element with a different \`xml:lang\` for translations.

## Elements

\`\`\`xml
<elements>
  <element identifier="e-customer" xsi:type="BusinessActor">
    <name xml:lang="en">Customer</name>
    <documentation xml:lang="en">A person or organisation buying cover.</documentation>
    <properties>
      <property key="owner" value="sales" />
    </properties>
  </element>
</elements>
\`\`\`

- \`identifier\` is the stable id used by relationships, views and all OpenArch
  tools. Use lowercase, hyphenated ids such as \`e-claims-portal\`.
- \`xsi:type\` is the exact ArchiMate 3.2 element type: \`BusinessActor\`,
  \`BusinessProcess\`, \`BusinessService\`, \`ApplicationComponent\`,
  \`ApplicationService\`, \`DataObject\`, \`Node\`, \`Artifact\`, \`Capability\`,
  \`Goal\`, \`WorkPackage\`, … Call \`get_metamodel\` or
  \`list_element_types\` for the full list; never invent a type.
- Every element needs a \`<name>\`; documentation and properties are optional.

## Relationships

\`\`\`xml
<relationships>
  <relationship identifier="r-1" source="e-portal" target="e-insurance" xsi:type="Realization">
    <name xml:lang="en">realizes</name>
  </relationship>
</relationships>
\`\`\`

- \`source\` and \`target\` are element \`identifier\` values, not names.
- \`xsi:type\` is an ArchiMate relationship type: \`Composition\`,
  \`Aggregation\`, \`Assignment\`, \`Realization\`, \`Serving\`, \`Access\`,
  \`Influence\`, \`Triggering\`, \`Flow\`, \`Association\`, \`Specialization\`,
  \`Junction\`. Call \`list_relationship_types\` for details.
- Relationships must obey the metamodel: \`Assignment\` goes from active
  structure to behaviour, \`Access\` from behaviour/active structure to passive
  structure, \`Triggering\` between behaviour, \`Realization\` from concrete to
  abstract. OpenArch reports illegal combinations as errors in
  \`preview_aoef\` / \`validate_model\`.

## Views (diagrams)

\`\`\`xml
<views>
  <diagrams>
    <view identifier="view-overview" xsi:type="Diagram">
      <name xml:lang="en">Overview</name>
      <node identifier="n1" xsi:type="Element" elementRef="e-customer" x="40" y="80" w="170" h="64" />
      <node identifier="n2" xsi:type="Element" elementRef="e-claim" x="260" y="80" w="170" h="64" />
      <connection identifier="ed1" xsi:type="Relationship" relationshipRef="r-1" source="n1" target="n2" />
    </view>
  </diagrams>
</views>
\`\`\`

- \`<node>\` \`elementRef\` points at an element id; \`x\`, \`y\`, \`w\`, \`h\`
  place the box on the canvas.
- \`<connection>\` \`relationshipRef\` points at a relationship id, while its
  \`source\` and \`target\` point at **node** ids (not element ids).
- **Omit the entire \`<views>\` section on a first import.** OpenArch creates a
  default view with grid-placed nodes automatically, and \`create_element\` /
  \`create_relationship\` will draw nodes and edges for you.

## Minimal complete example

\`\`\`xml
<?xml version="1.0" encoding="UTF-8"?>
<model identifier="mini" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <name xml:lang="en">Mini model</name>
  <elements>
    <element identifier="e-actor" xsi:type="BusinessActor">
      <name xml:lang="en">Customer</name>
    </element>
    <element identifier="e-process" xsi:type="BusinessProcess">
      <name xml:lang="en">Handle claim</name>
    </element>
  </elements>
  <relationships>
    <relationship identifier="r-1" source="e-actor" target="e-process" xsi:type="Assignment" />
  </relationships>
</model>
\`\`\`

## Workflow tips

1. Call \`get_aoef_format_guide\` (this resource) and \`get_metamodel\` first.
2. Generate XML with stable, descriptive ids and no view section.
3. Call \`preview_aoef\` to validate and to diff against a target model.
4. Fix every error-severity issue, then call \`apply_aoef\` to write.
5. Call \`validate_model\` and \`export_markdown\` to confirm the result.

## Trademark notice

ArchiMate® is a registered trademark of The Open Group. OpenArch is
independent and is not affiliated with, endorsed by, or certified by The Open
Group. This guide is an independent interoperability description, not official
The Open Group documentation.
`;

/**
 * Full metamodel payload used by the `aoef://metamodel` compatibility alias:
 * element types, relationship definitions, and the pairwise allowed rules.
 */
export function buildFullMetamodel(): {
  metamodelVersion: string;
  elementTypes: typeof ELEMENT_TYPES;
  relationshipTypes: typeof RELATIONSHIP_TYPES;
  allowed: Array<{ sourceType: string; targetType: string; relationshipTypes: string[] }>;
} {
  const allowed: Array<{ sourceType: string; targetType: string; relationshipTypes: string[] }> = [];
  for (const source of ELEMENT_TYPES) {
    for (const target of ELEMENT_TYPES) {
      const relationshipTypes = allowedRelationships(source.id, target.id).map((item) => item.id);
      if (relationshipTypes.length) {
        allowed.push({ sourceType: source.id, targetType: target.id, relationshipTypes });
      }
    }
  }
  return {
    metamodelVersion: '3.2',
    elementTypes: ELEMENT_TYPES,
    relationshipTypes: RELATIONSHIP_TYPES,
    allowed,
  };
}

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplateDescriptor {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ResourceReadResult {
  contents: ResourceContent[];
}

export class ResourceNotFoundError extends Error {
  constructor(public readonly uri: string) {
    super(`Resource not found: ${uri}`);
    this.name = 'ResourceNotFoundError';
  }
}

export const RESOURCES: ResourceDescriptor[] = [
  {
    uri: 'aoef://format-guide',
    name: 'AOEF format guide',
    description:
      'Complete guide for generating valid ArchiMate Open Exchange Format (AOEF) XML, with namespaces, elements, relationships, views, an example and ArchiMate trademark disclaimer.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'openarch://metamodel/elements',
    name: 'Element types',
    description: 'All ArchiMate 3.2 element types with their layer, kind and notation metadata.',
    mimeType: 'application/json',
  },
  {
    uri: 'openarch://metamodel/relationships',
    name: 'Relationship types',
    description: 'All ArchiMate 3.2 relationship types with allowed source/target kinds.',
    mimeType: 'application/json',
  },
  {
    uri: 'openarch://viewpoints',
    name: 'Viewpoints',
    description: 'The stakeholder viewpoints supported by OpenArch.',
    mimeType: 'application/json',
  },
  {
    uri: 'openarch://models',
    name: 'Models',
    description: 'Summaries of every model currently available to the MCP server.',
    mimeType: 'application/json',
  },
  // Compatibility URIs kept so existing ArchiPulse-style agent prompts work.
  {
    uri: 'aoef://metamodel',
    name: 'Full metamodel (AOEF alias)',
    description:
      'Compatibility alias for the full ArchiMate 3.2 metamodel: element types, relationship types, and allowed-relationship rules. Same data as openarch://metamodel/elements plus openarch://metamodel/relationships.',
    mimeType: 'application/json',
  },
  {
    uri: 'aoef://viewpoints',
    name: 'Viewpoints (AOEF alias)',
    description: 'Compatibility alias exposing the 23 ArchiMate viewpoints; same data as openarch://viewpoints.',
    mimeType: 'application/json',
  },
  {
    uri: 'aoef://model-context',
    name: 'Model context guidance (AOEF alias)',
    description:
      'Generic context resource for ArchiPulse-style prompts. For a specific model, agents should use the templated openarch://context/{modelId} or aoef://model/{modelId} resource instead.',
    mimeType: 'text/markdown',
  },
];

export const RESOURCE_TEMPLATES: ResourceTemplateDescriptor[] = [
  {
    uriTemplate: 'openarch://model/{modelId}',
    name: 'Full model',
    description: 'The complete JSON representation of a model.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'openarch://element/{modelId}/{elementId}',
    name: 'Element',
    description: 'One element plus its direct relationships.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'openarch://view/{modelId}/{viewId}',
    name: 'View',
    description: 'One view with its nodes and edges.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'openarch://context/{modelId}',
    name: 'Model context',
    description: 'A token-efficient Markdown rendering of the whole model.',
    mimeType: 'text/markdown',
  },
  {
    uriTemplate: 'aoef://model/{modelId}',
    name: 'Full model (AOEF alias)',
    description: 'Compatibility alias returning the same full model JSON as openarch://model/{modelId}.',
    mimeType: 'application/json',
  },
];

function jsonContent(uri: string, value: unknown): ResourceContent {
  return { uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getModelOrThrow(store: ModelStore, modelId: string, uri: string): Promise<Model> {
  const model = await store.getModel(modelId);
  if (!model) throw new ResourceNotFoundError(uri);
  return model;
}

/** Resolve a resource URI to its contents. Unknown URIs throw ResourceNotFoundError. */
export async function readResource(uri: string, store: ModelStore): Promise<ResourceReadResult> {
  if (uri === 'aoef://format-guide') {
    return { contents: [{ uri, mimeType: 'text/markdown', text: AOEF_FORMAT_GUIDE }] };
  }
  if (uri === 'aoef://metamodel') {
    return { contents: [jsonContent(uri, buildFullMetamodel())] };
  }
  if (uri === 'aoef://viewpoints') {
    return { contents: [jsonContent(uri, VIEWPOINTS)] };
  }
  if (uri === 'aoef://model-context') {
    const models = await store.listModels();
    const listing = models.length
      ? models.map((item) => `- \`${item.id}\` — ${item.name}`).join('\n')
      : '_No models are currently available._';
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: sanitizeAiText(
            `# Model context\n\n` +
              `This generic resource exists for ArchiPulse-style prompts. ` +
              `To read the context of a specific model, use the templated ` +
              `\`openarch://context/{modelId}\` resource (or its \`aoef://model/{modelId}\` alias for the full JSON).\n\n` +
              `## Available models\n\n${listing}\n`,
          ),
        },
      ],
    };
  }
  if (uri === 'openarch://metamodel/elements') {
    return {
      contents: [
        jsonContent(uri, {
          metamodelVersion: '3.2',
          count: ELEMENT_TYPES.length,
          elementTypes: ELEMENT_TYPES,
        }),
      ],
    };
  }
  if (uri === 'openarch://metamodel/relationships') {
    return {
      contents: [
        jsonContent(uri, {
          metamodelVersion: '3.2',
          count: RELATIONSHIP_TYPES.length,
          relationshipTypes: RELATIONSHIP_TYPES,
        }),
      ],
    };
  }
  if (uri === 'openarch://viewpoints') {
    return { contents: [jsonContent(uri, VIEWPOINTS)] };
  }
  if (uri === 'openarch://models') {
    return { contents: [jsonContent(uri, await store.listModels())] };
  }

  const modelMatch = /^(?:openarch|aoef):\/\/model\/(.+)$/.exec(uri);
  if (modelMatch) {
    const model = await getModelOrThrow(store, decode(modelMatch[1]), uri);
    return { contents: [jsonContent(uri, model)] };
  }

  const elementMatch = /^openarch:\/\/element\/([^/]+)\/(.+)$/.exec(uri);
  if (elementMatch) {
    const model = await getModelOrThrow(store, decode(elementMatch[1]), uri);
    const elementId = decode(elementMatch[2]);
    const element = model.elements.find((item) => item.id === elementId);
    if (!element) throw new ResourceNotFoundError(uri);
    return {
      contents: [
        jsonContent(uri, {
          element,
          name: primaryText(element.name),
          incoming: model.relationships.filter((item) => item.target === elementId),
          outgoing: model.relationships.filter((item) => item.source === elementId),
        }),
      ],
    };
  }

  const viewMatch = /^openarch:\/\/view\/([^/]+)\/(.+)$/.exec(uri);
  if (viewMatch) {
    const model = await getModelOrThrow(store, decode(viewMatch[1]), uri);
    const viewId = decode(viewMatch[2]);
    const view = model.views.find((item) => item.id === viewId);
    if (!view) throw new ResourceNotFoundError(uri);
    return { contents: [jsonContent(uri, view)] };
  }

  const contextMatch = /^openarch:\/\/context\/(.+)$/.exec(uri);
  if (contextMatch) {
    const model = await getModelOrThrow(store, decode(contextMatch[1]), uri);
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: sanitizeAiText(modelToMarkdown(model)),
        },
      ],
    };
  }

  throw new ResourceNotFoundError(uri);
}
