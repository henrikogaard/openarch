import {
  ELEMENT_TYPES,
  LAYER_LABELS,
  LAYER_ORDER,
  METAMODEL_VERSION,
  RELATIONSHIP_TYPES,
  VIEWPOINTS,
  allowedRelationships,
  buildMatrix,
  buildPresetMatrix,
  createModel,
  diffModels,
  diffSummary,
  getElementType,
  getRelationshipType,
  impactAnalysis,
  isAllowedRelationship,
  parseAoef,
  primaryText,
  searchModel,
  serializeAoef,
  traceElements,
  typeCounts,
  validateModel,
  type ArchiElement,
  type Model,
  type Property,
  type Relationship,
  type ValidationIssue,
  type View,
  type ViewEdge,
  type ViewNode,
} from '@openarch/core';
import {
  modelToMarkdown,
  sanitizeAiText,
  suggestRelationshipTypes,
  validateAiModel,
} from '@openarch/ai';
import {
  filesToResources,
  parseCsvResources,
  proposeElements,
  proposeRelationships,
  proposalsToElements,
  type RawResource,
} from '@openarch/enrichment';
import { AOEF_FORMAT_GUIDE } from './resources';
import type { ModelStore } from './store';

/* -------------------------------------------------------------------------- */
/* Protocol shapes                                                            */
/* -------------------------------------------------------------------------- */

interface JsonSchema {
  type: 'object' | 'string' | 'array' | 'number' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: string[];
}

interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: false;
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations: ToolAnnotations;
}

export interface ToolContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const OBJECT_OUTPUT: JsonSchema = { type: 'object', additionalProperties: true };

const str = (description: string): JsonSchema => ({ type: 'string', description });
const num = (description: string): JsonSchema => ({ type: 'number', description });
const bool = (description: string): JsonSchema => ({ type: 'boolean', description });
const arr = (items: JsonSchema, description?: string): JsonSchema => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});
const obj = (
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  description?: string,
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
  ...(description ? { description } : {}),
});

const MODEL_ID = str('Id of the model to operate on. Call list_models if you do not know it.');
const ELEMENT_ID = str('Id of the element. Call search_elements if you only know its name.');
const VIEW_ID = str('Id of the view. Call list_views to discover it.');
const ELEMENT_TYPE = str('Exact ArchiMate 3.2 xsi:type, e.g. "BusinessActor". Call list_element_types.');
const RELATIONSHIP_TYPE = str('Exact ArchiMate relationship xsi:type, e.g. "Assignment". Call list_relationship_types.');
const PROPERTY = obj(
  { key: str('Property key.'), value: str('Property value.') },
  ['key', 'value'],
  'A key/value property.',
);

/* -------------------------------------------------------------------------- */
/* Tool catalogue                                                             */
/* -------------------------------------------------------------------------- */

export const TOOLS: ToolDescriptor[] = [
  {
    name: 'list_models',
    title: 'List models',
    description:
      'Start here when you do not know a model id. Lists every available model as a summary (id, name, element and view counts). In server mode these are the same models the web app shows.',
    inputSchema: obj({}),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_model',
    title: 'Get model',
    description:
      'Return the complete JSON representation of a model: elements, relationships, views and properties. Use get_model_meta or export_markdown first if you only need an overview.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_model_meta',
    title: 'Get model metadata',
    description:
      'Lightweight overview of a model (counts, layers, and server-side version/audit metadata when attached to OPENARCH_API_URL). Prefer this over get_model for a quick check.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_metamodel',
    title: 'Get metamodel',
    description:
      'Return ArchiMate 3.2 metamodel counts, layers, all element types and all relationship types. Call this before creating elements or relationships so you use valid type identifiers.',
    inputSchema: obj({}),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'list_element_types',
    title: 'List element types',
    description:
      'List valid ArchiMate element xsi:type values with label, layer and kind. Optionally filter by layer (strategy, business, application, technology, physical, motivation, implementation, other).',
    inputSchema: obj({ layer: str('Only return element types from this layer.') }),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'list_relationship_types',
    title: 'List relationship types',
    description:
      'List ArchiMate relationship types. When sourceType and targetType are supplied, return only the relationships legal between those element types — this is the best way to repair a rejected relationship.',
    inputSchema: obj({
      sourceType: str('Source element xsi:type to filter legal relationships.'),
      targetType: str('Target element xsi:type to filter legal relationships.'),
    }),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'list_viewpoints',
    title: 'List viewpoints',
    description:
      'List the 23 stakeholder viewpoints supported by OpenArch. Use one to choose which parts of a model to discuss with a given audience.',
    inputSchema: obj({}),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'search_elements',
    title: 'Search elements',
    description:
      'Find elements by case-insensitive text in their name, documentation or properties. Use this to turn a name mentioned by a user into the element id required by other tools.',
    inputSchema: obj({ modelId: MODEL_ID, query: str('Text to search for.') }, ['modelId', 'query']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_element',
    title: 'Get element',
    description:
      'Return one element with its direct incoming and outgoing relationships (ids, types and neighbour names). Use for focused questions about a single concept.',
    inputSchema: obj({ modelId: MODEL_ID, elementId: ELEMENT_ID }, ['modelId', 'elementId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_relationship',
    title: 'Get relationship',
    description:
      'Return one relationship with resolved source and target element names. Useful when validating a dependency between two named elements.',
    inputSchema: obj(
      { modelId: MODEL_ID, relationshipId: str('Id of the relationship.') },
      ['modelId', 'relationshipId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'list_views',
    title: 'List views',
    description:
      'List the views (diagrams) in a model with node and edge counts. Call this before get_view, add_element_to_view or connect_in_view.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_view',
    title: 'Get view',
    description:
      'Return a single view with its nodes and edges as a readable structure. Use it to explain what a diagram shows or to find node ids for connect_in_view.',
    inputSchema: obj({ modelId: MODEL_ID, viewId: VIEW_ID }, ['modelId', 'viewId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'validate_model',
    title: 'Validate model',
    description:
      'Run structural and AI-oriented validation: unknown/duplicate ids and names, dangling references and illegal ArchiMate relationships. Call after every batch of write tools.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_aoef_format_guide',
    title: 'Get AOEF format guide',
    description:
      'Call this before generating any ArchiMate XML. Returns the complete AOEF guide: root <model> namespaces, <elements>, <relationships>, <views>, <node>, <connection>, a worked example and import advice.',
    inputSchema: obj({}),
    annotations: READ_ONLY,
  },
  {
    name: 'export_aoef',
    title: 'Export AOEF',
    description:
      'Serialize a whole model to an ArchiMate Open Exchange Format XML string. Use preview_aoef rather than this tool when you only want to validate incoming XML.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    annotations: READ_ONLY,
  },
  {
    name: 'export_markdown',
    title: 'Export markdown',
    description:
      'Render a model as compact, information-dense Markdown (layers, elements, relationships, views). Ideal for handing an entire architecture to an LLM in a small context.',
    inputSchema: obj({ modelId: MODEL_ID, maxChars: num('Maximum characters in the output (default 24000).') }, ['modelId']),
    annotations: READ_ONLY,
  },
  {
    name: 'get_diff',
    title: 'Get model diff',
    description:
      'Compare a model with another model and return added/removed/changed elements, relationships and views. Use after an import or to explain what changed between revisions.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        compareModelId: str('Id of the model to compare against (the "before" model).'),
      },
      ['modelId', 'compareModelId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'trace_element',
    title: 'Trace element',
    description:
      'Walk incoming and/or outgoing relationships from an element up to a chosen depth. Use for dependency and impact questions; returns element names and the path of relationship types.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        elementId: ELEMENT_ID,
        directions: arr(str('"in", "out", or both.'), 'Traversal directions (default both).'),
        relationshipTypes: arr(str('Relationship xsi:type.'), 'Only follow these relationship types.'),
        maxDepth: num('Maximum traversal depth (default 3).'),
      },
      ['modelId', 'elementId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'impact_analysis',
    title: 'Impact analysis',
    description:
      'Find what would be affected if an element changed, following Serving, Realization, Assignment, Flow and Triggering relationships downstream. Use for change-impact questions.',
    inputSchema: obj(
      { modelId: MODEL_ID, elementId: ELEMENT_ID, maxDepth: num('Maximum depth (default 2).') },
      ['modelId', 'elementId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_matrix',
    title: 'Get matrix',
    description:
      'Build a cross-layer matrix. Supply presetId (capability-application, process-application, application-technology) or explicit rowType/columnType and optional relationshipTypes.',
    inputSchema: obj({
      modelId: MODEL_ID,
      presetId: str('Preset to use; overrides rowType/columnType when given.'),
      rowType: str('Element xsi:type for matrix rows.'),
      columnType: str('Element xsi:type for matrix columns.'),
      relationshipTypes: arr(str('Relationship xsi:type to include.')),
      title: str('Title for a custom matrix.'),
    }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_capability_tree',
    title: 'Get capability tree',
    description:
      'Build a hierarchy of Capability elements from Composition and Specialization relationships. Use when asked what capabilities an organisation has or how they decompose.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'get_application_dashboard',
    title: 'Get application dashboard',
    description:
      'Aggregate element counts by layer and type, relationship counts and view counts. Use for a quick architecture health check or before writing documentation.',
    inputSchema: obj({ modelId: MODEL_ID }, ['modelId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'create_model',
    title: 'Create model',
    description:
      'Create a new empty model with a default view. Prefer create_model_from_spec when you already know the elements and relationships to include.',
    inputSchema: obj(
      {
        name: str('Display name of the new model.'),
        id: str('Optional stable model id; generated when omitted.'),
        documentation: str('Optional model documentation.'),
      },
      ['name'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'create_element',
    title: 'Create element',
    description:
      'Add an element with a generated id, optional documentation and properties, and place its node in the first view at a free grid position. Unknown types fail with a hint to call list_element_types.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        type: ELEMENT_TYPE,
        name: str('Display name of the element.'),
        documentation: str('Optional documentation.'),
        properties: arr(PROPERTY, 'Optional key/value properties.'),
      },
      ['modelId', 'type', 'name'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'update_element',
    title: 'Update element',
    description:
      'Update an element name, type, documentation or properties. Omitted fields are left unchanged; a supplied type is validated against the ArchiMate metamodel.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        elementId: ELEMENT_ID,
        name: str('New display name.'),
        type: ELEMENT_TYPE,
        documentation: str('New documentation.'),
        properties: arr(PROPERTY, 'Replaces all existing properties.'),
      },
      ['modelId', 'elementId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'delete_element',
    title: 'Delete element',
    description:
      'Delete an element and, to avoid dangling references, also remove its relationships, its view nodes and their edges. Use deliberately.',
    inputSchema: obj({ modelId: MODEL_ID, elementId: ELEMENT_ID }, ['modelId', 'elementId']),
    outputSchema: OBJECT_OUTPUT,
    annotations: DESTRUCTIVE,
  },
  {
    name: 'create_relationship',
    title: 'Create relationship',
    description:
      'Add a relationship and draw its edge on the first view (creating missing nodes). Rejects ArchiMate-illegal source/type/target combinations and returns metamodel suggestions instead of writing.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        type: RELATIONSHIP_TYPE,
        source: str('Source element id (or name).'),
        target: str('Target element id (or name).'),
        name: str('Optional relationship label.'),
      },
      ['modelId', 'type', 'source', 'target'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'update_relationship',
    title: 'Update relationship',
    description:
      'Change a relationship type, source, target, label or documentation. Re-validates the ArchiMate rule whenever type, source or target changes.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        relationshipId: str('Id of the relationship.'),
        type: RELATIONSHIP_TYPE,
        source: str('New source element id.'),
        target: str('New target element id.'),
        name: str('New label.'),
        documentation: str('New documentation.'),
      },
      ['modelId', 'relationshipId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'delete_relationship',
    title: 'Delete relationship',
    description: 'Delete a relationship and every view edge that references it.',
    inputSchema: obj(
      { modelId: MODEL_ID, relationshipId: str('Id of the relationship.') },
      ['modelId', 'relationshipId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: DESTRUCTIVE,
  },
  {
    name: 'create_view',
    title: 'Create view',
    description: 'Add a new empty diagram view. Follow with add_element_to_view and connect_in_view to populate it.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        name: str('View name.'),
        type: str('View xsi:type (default "Diagram").'),
      },
      ['modelId', 'name'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'add_element_to_view',
    title: 'Add element to view',
    description:
      'Place an existing element on a view as a new node. Position is chosen on a free grid slot unless x and y are supplied.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        viewId: VIEW_ID,
        elementId: ELEMENT_ID,
        x: num('Optional x coordinate.'),
        y: num('Optional y coordinate.'),
      },
      ['modelId', 'viewId', 'elementId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'connect_in_view',
    title: 'Connect in view',
    description:
      'Draw an existing relationship as an edge in a view. Supply view-node ids (or element ids) for source and target.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        viewId: VIEW_ID,
        relationshipId: str('Id of an existing relationship.'),
        sourceNodeId: str('Source view node id (or element id).'),
        targetNodeId: str('Target view node id (or element id).'),
      },
      ['modelId', 'viewId', 'relationshipId', 'sourceNodeId', 'targetNodeId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'create_model_from_spec',
    title: 'Create model from specification',
    description:
      'Headline "describe a system, get a model" tool. Pass a name, a list of elements (type, name, optional id/layer) and relationships (type, source, target; source/target may be ids or names). Validates every type and ArchiMate relationship rule, then creates and saves the model with a grid-laid-out default view. Nothing is written if validation fails.',
    inputSchema: obj(
      {
        name: str('Name of the new model.'),
        description: str('Optional description, stored as model documentation.'),
        elements: arr(
          obj(
            {
              id: str('Optional stable element id.'),
              type: ELEMENT_TYPE,
              name: str('Element display name.'),
              layer: str('Optional intended layer; the effective layer comes from the type.'),
            },
            ['type', 'name'],
            'An ArchiMate element to create.',
          ),
          'Elements of the system.',
        ),
        relationships: arr(
          obj(
            {
              type: RELATIONSHIP_TYPE,
              source: str('Element id or case-insensitive name.'),
              target: str('Element id or case-insensitive name.'),
              name: str('Optional relationship label.'),
            },
            ['type', 'source', 'target'],
            'An ArchiMate relationship to create.',
          ),
          'Relationships between the elements.',
        ),
      },
      ['name', 'elements', 'relationships'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'preview_aoef',
    title: 'Preview AOEF',
    description:
      'Parse inline AOEF XML, validate it, and optionally diff it against a target model — without writing anything. Always call this before apply_aoef and before generating XML read get_aoef_format_guide.',
    inputSchema: obj(
      {
        xml: str('The complete AOEF XML document, supplied inline.'),
        modelId: str('Optional target model id to diff against.'),
      },
      ['xml'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'apply_aoef',
    title: 'Apply AOEF',
    description:
      'Safe bulk import: previews the inline AOEF XML, refuses to write when any error-severity validation issue exists, otherwise saves the model (or replaces modelId) and returns its id. Call preview_aoef first if you want to inspect the diff.',
    inputSchema: obj(
      {
        xml: str('The complete AOEF XML document, supplied inline.'),
        modelId: str('Optional target model id; defaults to the model identifier in the XML.'),
      },
      ['xml'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'preview_enrichment',
    title: 'Preview enrichment',
    description:
      'Deterministically turn real-world resources (inline CSV text and/or path+content file pairs) into candidate ArchiMate elements and relationships using local heuristics — no LLM or network calls. Returns proposals, elements and relationships for review; nothing is written. Call apply_enrichment to persist.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        csv: str('Optional CSV text with a header row to propose elements from.'),
        files: arr(
          obj(
            { path: str('Repository-relative file path.'), content: str('File contents.') },
            ['path', 'content'],
            'A file read from a repository scan, drop zone or API.',
          ),
          'Optional path/content pairs to propose elements from.',
        ),
        source: str('Optional source label for CSV resources (default "csv").'),
      },
      ['modelId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
  {
    name: 'apply_enrichment',
    title: 'Apply enrichment',
    description:
      'Append enrichment proposals to an existing model and save it. Runs the same deterministic pipeline as preview_enrichment; pass elementIds from a preview to apply only a subset. Returns counts and validation issues. Nothing is inferred via LLM or network.',
    inputSchema: obj(
      {
        modelId: MODEL_ID,
        csv: str('Optional CSV text with a header row to propose elements from.'),
        files: arr(
          obj(
            { path: str('Repository-relative file path.'), content: str('File contents.') },
            ['path', 'content'],
            'A file read from a repository scan, drop zone or API.',
          ),
          'Optional path/content pairs to propose elements from.',
        ),
        elementIds: arr(str('Element id from a preview to apply (all when omitted).')),
        source: str('Optional source label for CSV resources (default "csv").'),
      },
      ['modelId'],
    ),
    outputSchema: OBJECT_OUTPUT,
    annotations: WRITE,
  },
  {
    name: 'list_enrichment_sources',
    title: 'List enrichment sources',
    description:
      'List the supported enrichment adapter kinds (csv and git-files) with descriptions. Mapping is deterministic heuristics with no network calls.',
    inputSchema: obj({}),
    outputSchema: OBJECT_OUTPUT,
    annotations: READ_ONLY,
  },
];

/* -------------------------------------------------------------------------- */
/* Argument helpers                                                           */
/* -------------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fail(payload: Record<string, unknown>): never {
  throw new ToolFailure(payload);
}

class ToolFailure extends Error {
  constructor(readonly payload: Record<string, unknown>) {
    super(String(payload.error ?? 'Tool failed'));
    this.name = 'ToolFailure';
  }
}

function stringArg(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = args[key];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`Missing or invalid argument: ${key}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid argument: ${key} (expected a string)`);
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid argument: ${key} (expected a number)`);
  }
  return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid argument: ${key} (expected an array of strings)`);
  }
  return value as string[];
}

function propertiesArg(args: Record<string, unknown>, key: string): Property[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Invalid argument: ${key} (expected an array of {key, value})`);
  return value.map((item) => {
    const property = record(item);
    return {
      key: stringArg(property, 'key'),
      value: stringArg(property, 'value', true),
    };
  });
}

function localized(value: string): Array<{ lang: string; value: string }> {
  return [{ lang: 'en', value }];
}

async function getModelOrThrow(store: ModelStore, modelId: string): Promise<Model> {
  const model = await store.getModel(modelId);
  if (!model) {
    fail({
      error: `Model not found: ${modelId}`,
      suggestion: 'Call list_models to discover available model ids.',
    });
  }
  return model;
}

function findElement(model: Model, reference: string): ArchiElement | undefined {
  return (
    model.elements.find((element) => element.id === reference) ??
    model.elements.find((element) => primaryText(element.name).toLowerCase() === reference.toLowerCase())
  );
}

const NODE_W = 170;
const NODE_H = 64;
const CELL_W = 210;
const CELL_H = 100;
const COLS = 5;

function nextFreePosition(view: View): { x: number; y: number } {
  for (let index = 0; index < 2000; index += 1) {
    const x = 40 + (index % COLS) * CELL_W;
    const y = 40 + Math.floor(index / COLS) * CELL_H;
    const clash = view.nodes.some(
      (node) =>
        Math.abs(node.bounds.x - x) < NODE_W && Math.abs(node.bounds.y - y) < NODE_H,
    );
    if (!clash) return { x, y };
  }
  return { x: 40 + view.nodes.length * CELL_W, y: 40 };
}

function makeNode(elementId: string, position: { x: number; y: number }): ViewNode {
  return {
    id: `n-${crypto.randomUUID()}`,
    type: 'Element',
    elementRef: elementId,
    label: [],
    bounds: { ...position, w: NODE_W, h: NODE_H },
  };
}

function makeEdge(relationshipId: string, sourceNodeId: string, targetNodeId: string): ViewEdge {
  return {
    id: `ed-${crypto.randomUUID()}`,
    type: 'Relationship',
    relationshipRef: relationshipId,
    source: sourceNodeId,
    target: targetNodeId,
    bendpoints: [],
  };
}

function ensureNode(view: View, elementId: string): ViewNode {
  let node = view.nodes.find((item) => item.elementRef === elementId);
  if (!node) {
    node = makeNode(elementId, nextFreePosition(view));
    view.nodes.push(node);
  }
  return node;
}

function createDefaultView(): View {
  return {
    id: `view-${crypto.randomUUID()}`,
    type: 'Diagram',
    name: localized('Overview'),
    nodes: [],
    edges: [],
  };
}

function firstView(model: Model): View | undefined {
  return model.views[0];
}

function elementSummary(element: ArchiElement): Record<string, unknown> {
  return {
    id: element.id,
    type: element.type,
    name: primaryText(element.name),
    layer: getElementType(element.type)?.layer ?? 'other',
  };
}

function relationshipSummary(relationship: Relationship): Record<string, unknown> {
  return {
    id: relationship.id,
    type: relationship.type,
    source: relationship.source,
    target: relationship.target,
    name: primaryText(relationship.name),
  };
}

function traceSummary(entries: ReturnType<typeof traceElements>): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    elementId: entry.element.id,
    elementName: primaryText(entry.element.name),
    elementType: entry.element.type,
    relationshipId: entry.relationship.id,
    relationshipType: entry.relationship.type,
    direction: entry.direction,
    depth: entry.depth,
  }));
}

function illegalRelationshipFailure(
  type: string,
  sourceType: string,
  targetType: string,
  context: Record<string, unknown> = {},
): never {
  const suggestions = suggestRelationshipTypes(sourceType, targetType);
  return fail({
    error: `${type} is not allowed from ${sourceType} to ${targetType} in ArchiMate 3.2; nothing was written.`,
    sourceType,
    targetType,
    suggestions,
    suggestion: suggestions.length
      ? `Use one of: ${suggestions.map((item) => item.id).join(', ')}.`
      : 'Call list_relationship_types for valid alternatives.',
    ...context,
  });
}

/* -------------------------------------------------------------------------- */
/* Read/general handlers                                                      */
/* -------------------------------------------------------------------------- */

async function listModels(store: ModelStore): Promise<unknown> {
  const models = await store.listModels();
  return { count: models.length, models };
}

async function getModelMeta(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const layers = [
    ...new Set(model.elements.map((element) => getElementType(element.type)?.layer ?? 'other')),
  ].sort();
  const derived = {
    modelId: model.id,
    name: primaryText(model.name),
    elementCount: model.elements.length,
    relationshipCount: model.relationships.length,
    viewCount: model.views.length,
    propertyCount: model.properties.length,
    layers,
  };
  let remote: Record<string, unknown> = {};
  if (store.getModelMeta) {
    try {
      remote = await store.getModelMeta(model.id);
    } catch {
      remote = {};
    }
  }
  return { ...derived, ...remote };
}

function getMetamodel(): unknown {
  return {
    metamodelVersion: METAMODEL_VERSION,
    counts: {
      elementTypes: ELEMENT_TYPES.length,
      relationshipTypes: RELATIONSHIP_TYPES.length,
      viewpoints: VIEWPOINTS.length,
      layers: LAYER_ORDER.length,
    },
    layers: LAYER_ORDER.map((id) => ({ id, label: LAYER_LABELS[id] })),
    elementTypes: ELEMENT_TYPES,
    relationshipTypes: RELATIONSHIP_TYPES,
  };
}

function listElementTypes(args: Record<string, unknown>): unknown {
  const layer = optionalString(args, 'layer');
  const elementTypes = layer
    ? ELEMENT_TYPES.filter((type) => type.layer === layer)
    : ELEMENT_TYPES;
  return { count: elementTypes.length, elementTypes };
}

function listRelationshipTypes(args: Record<string, unknown>): unknown {
  const sourceType = optionalString(args, 'sourceType');
  const targetType = optionalString(args, 'targetType');
  if (sourceType && targetType) {
    const relationshipTypes = allowedRelationships(sourceType, targetType);
    return { sourceType, targetType, count: relationshipTypes.length, relationshipTypes };
  }
  return { count: RELATIONSHIP_TYPES.length, relationshipTypes: RELATIONSHIP_TYPES };
}

function listViewpoints(): unknown {
  return { count: VIEWPOINTS.length, viewpoints: VIEWPOINTS };
}

async function searchElements(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const query = stringArg(args, 'query', true);
  const results = searchModel(model, query);
  return { modelId: model.id, query, count: results.length, results };
}

async function getElement(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const elementId = stringArg(args, 'elementId');
  const element = model.elements.find((item) => item.id === elementId);
  if (!element) {
    fail({
      error: `Element not found: ${elementId}`,
      suggestion: 'Call search_elements to find the correct element id.',
    });
  }
  const incoming = model.relationships.filter((item) => item.target === elementId);
  const outgoing = model.relationships.filter((item) => item.source === elementId);
  const nameOf = (id: string): string => {
    const other = model.elements.find((item) => item.id === id);
    return other ? primaryText(other.name) : id;
  };
  return {
    modelId: model.id,
    element,
    name: primaryText(element.name),
    layer: getElementType(element.type)?.layer ?? 'other',
    incoming: incoming.map((relationship) => ({
      ...relationshipSummary(relationship),
      from: nameOf(relationship.source),
    })),
    outgoing: outgoing.map((relationship) => ({
      ...relationshipSummary(relationship),
      to: nameOf(relationship.target),
    })),
  };
}

async function getRelationship(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const relationshipId = stringArg(args, 'relationshipId');
  const relationship = model.relationships.find((item) => item.id === relationshipId);
  if (!relationship) {
    fail({
      error: `Relationship not found: ${relationshipId}`,
      suggestion: 'Use get_model to list relationships, or get_element to see those touching an element.',
    });
  }
  const source = model.elements.find((item) => item.id === relationship.source);
  const target = model.elements.find((item) => item.id === relationship.target);
  return {
    modelId: model.id,
    relationship,
    sourceName: source ? primaryText(source.name) : relationship.source,
    targetName: target ? primaryText(target.name) : relationship.target,
  };
}

async function listViews(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  return {
    modelId: model.id,
    count: model.views.length,
    views: model.views.map((view) => ({
      id: view.id,
      name: primaryText(view.name),
      type: view.type,
      nodeCount: view.nodes.length,
      edgeCount: view.edges.length,
    })),
  };
}

async function getView(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const viewId = stringArg(args, 'viewId');
  const view = model.views.find((item) => item.id === viewId);
  if (!view) fail({ error: `View not found: ${viewId}`, suggestion: 'Call list_views.' });
  return { modelId: model.id, view };
}

async function validateModelTool(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const issues = validateAiModel(model);
  return {
    modelId: model.id,
    count: issues.length,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    infoCount: issues.filter((issue) => issue.severity === 'info').length,
    issues,
  };
}

async function getDiff(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const compareId = stringArg(args, 'compareModelId');
  const before = await getModelOrThrow(store, compareId);
  const diff = diffModels(before, model);
  return { modelId: model.id, compareModelId: before.id, ...diff, summary: diffSummary(diff) };
}

async function traceElement(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const elementId = stringArg(args, 'elementId');
  if (!findElement(model, elementId)) {
    fail({ error: `Element not found: ${elementId}`, suggestion: 'Call search_elements.' });
  }
  const directions = optionalStringArray(args, 'directions')?.filter(
    (value): value is 'in' | 'out' => value === 'in' || value === 'out',
  );
  const relationshipTypes = optionalStringArray(args, 'relationshipTypes');
  const maxDepth = optionalNumber(args, 'maxDepth');
  const entries = traceElements(model, elementId, {
    ...(directions ? { directions } : {}),
    ...(relationshipTypes ? { relationshipTypes } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  });
  return { modelId: model.id, elementId, count: entries.length, entries: traceSummary(entries) };
}

async function impactAnalysisTool(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const elementId = stringArg(args, 'elementId');
  if (!findElement(model, elementId)) {
    fail({ error: `Element not found: ${elementId}`, suggestion: 'Call search_elements.' });
  }
  const maxDepth = optionalNumber(args, 'maxDepth');
  const entries = impactAnalysis(model, elementId, maxDepth ?? 2);
  return { modelId: model.id, elementId, maxDepth: maxDepth ?? 2, count: entries.length, entries: traceSummary(entries) };
}

async function getMatrix(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const presetId = optionalString(args, 'presetId');
  const relationshipTypes = optionalStringArray(args, 'relationshipTypes');
  const matrix = presetId
    ? buildPresetMatrix(model, presetId)
    : buildMatrix(
        model,
        optionalString(args, 'title') ?? 'Custom matrix',
        stringArg(args, 'rowType'),
        stringArg(args, 'columnType'),
        relationshipTypes,
      );
  if (!matrix) {
    fail({
      error: `Unknown matrix preset: ${presetId}`,
      suggestion: 'Use capability-application, process-application or application-technology.',
    });
  }
  const nameOf = (id: string): string => {
    const element = model.elements.find((item) => item.id === id);
    return element ? primaryText(element.name) : id;
  };
  return {
    modelId: model.id,
    title: matrix.title,
    rows: matrix.rows.map(elementSummary),
    columns: matrix.columns.map(elementSummary),
    cells: matrix.cells.map((cell) => ({
      rowId: cell.rowId,
      rowName: nameOf(cell.rowId),
      columnId: cell.columnId,
      columnName: nameOf(cell.columnId),
      relationships: cell.relationships.map(relationshipSummary),
    })),
  };
}

async function getCapabilityTree(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const capabilities = model.elements.filter((element) => element.type === 'Capability');
  const capabilityIds = new Set(capabilities.map((element) => element.id));
  const parentOf = new Map<string, string>();
  const usedRelationships: string[] = [];
  for (const relationship of model.relationships) {
    if (relationship.type === 'Composition' && capabilityIds.has(relationship.source) && capabilityIds.has(relationship.target)) {
      if (!parentOf.has(relationship.target)) {
        parentOf.set(relationship.target, relationship.source);
        usedRelationships.push(relationship.id);
      }
    } else if (
      relationship.type === 'Specialization' &&
      capabilityIds.has(relationship.source) &&
      capabilityIds.has(relationship.target)
    ) {
      // The target of Specialization is the more general capability.
      if (!parentOf.has(relationship.source)) {
        parentOf.set(relationship.source, relationship.target);
        usedRelationships.push(relationship.id);
      }
    }
  }
  const visited = new Set<string>();
  const toNode = (element: ArchiElement): Record<string, unknown> => {
    visited.add(element.id);
    const children = capabilities
      .filter((child) => parentOf.get(child.id) === element.id && !visited.has(child.id))
      .map(toNode);
    return { id: element.id, name: primaryText(element.name), type: element.type, children };
  };
  const roots = capabilities
    .filter((element) => !parentOf.has(element.id))
    .map(toNode);
  return {
    modelId: model.id,
    totalCapabilities: capabilities.length,
    roots,
    cycleOrNestedNotShown: capabilities.length - visited.size,
    relationshipsUsed: usedRelationships,
  };
}

async function getApplicationDashboard(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const byLayer = LAYER_ORDER.map((layer) => ({
    layer,
    label: LAYER_LABELS[layer],
    count: model.elements.filter((element) => (getElementType(element.type)?.layer ?? 'other') === layer).length,
  })).filter((entry) => entry.count > 0);
  const relationshipCounts = new Map<string, number>();
  for (const relationship of model.relationships) {
    relationshipCounts.set(relationship.type, (relationshipCounts.get(relationship.type) ?? 0) + 1);
  }
  const issues = validateAiModel(model);
  return {
    modelId: model.id,
    modelName: primaryText(model.name),
    elements: {
      total: model.elements.length,
      byType: typeCounts(model),
      byLayer,
    },
    relationships: {
      total: model.relationships.length,
      byType: [...relationshipCounts.entries()]
        .map(([type, count]) => ({ type, label: getRelationshipType(type)?.label ?? type, count }))
        .sort((a, b) => b.count - a.count),
    },
    views: {
      total: model.views.length,
      items: model.views.map((view) => ({
        id: view.id,
        name: primaryText(view.name),
        nodes: view.nodes.length,
        edges: view.edges.length,
      })),
    },
    validation: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Write handlers                                                             */
/* -------------------------------------------------------------------------- */

async function createModelTool(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const name = stringArg(args, 'name');
  const model = createModel({
    ...(optionalString(args, 'id') ? { id: stringArg(args, 'id') } : {}),
    name: localized(name),
    documentation: optionalString(args, 'documentation') ? localized(stringArg(args, 'documentation')) : [],
    views: [createDefaultView()],
  });
  await store.saveModel(model);
  return {
    modelId: model.id,
    name: primaryText(model.name),
    viewId: model.views[0].id,
    ...elementAndRelationshipCounts(model),
  };
}

function elementAndRelationshipCounts(model: Model): Record<string, number> {
  return {
    elementCount: model.elements.length,
    relationshipCount: model.relationships.length,
    viewCount: model.views.length,
  };
}

async function createElement(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const type = stringArg(args, 'type');
  if (!getElementType(type)) {
    fail({
      error: `Unknown element type: ${type}; nothing was written.`,
      suggestion: 'Call list_element_types and use one of the returned xsi:type values.',
    });
  }
  const name = stringArg(args, 'name');
  const element: ArchiElement = {
    id: `el-${crypto.randomUUID()}`,
    type,
    name: localized(name),
    documentation: optionalString(args, 'documentation') ? localized(stringArg(args, 'documentation')) : [],
    properties: propertiesArg(args, 'properties') ?? [],
  };
  model.elements.push(element);
  let view = firstView(model);
  if (!view) {
    view = createDefaultView();
    model.views.push(view);
  }
  ensureNode(view, element.id);
  await store.saveModel(model);
  return {
    modelId: model.id,
    viewId: view.id,
    element,
    name: primaryText(element.name),
  };
}

async function updateElement(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const elementId = stringArg(args, 'elementId');
  const element = model.elements.find((item) => item.id === elementId);
  if (!element) fail({ error: `Element not found: ${elementId}`, suggestion: 'Call search_elements.' });
  const type = optionalString(args, 'type');
  if (type && !getElementType(type)) {
    fail({
      error: `Unknown element type: ${type}; nothing was written.`,
      suggestion: 'Call list_element_types.',
    });
  }
  const name = optionalString(args, 'name');
  const documentation = optionalString(args, 'documentation');
  const properties = propertiesArg(args, 'properties');
  if (type) element.type = type;
  if (name !== undefined) element.name = localized(name);
  if (documentation !== undefined) element.documentation = documentation ? localized(documentation) : [];
  if (properties !== undefined) element.properties = properties;
  // A type change can retroactively make existing relationships illegal —
  // validate and report instead of writing silently questionable models.
  const issues = validateModel(model);
  await store.saveModel(model);
  return {
    modelId: model.id,
    element,
    validation: {
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues
        .filter((issue) => issue.severity === 'warning' && issue.entityId === elementId)
        .map((issue) => `${issue.rule}: ${issue.message}`),
      note: 'Type changes can invalidate relationships touching this element; review warnings.',
    },
  };
}

async function deleteElement(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const elementId = stringArg(args, 'elementId');
  const index = model.elements.findIndex((item) => item.id === elementId);
  if (index === -1) fail({ error: `Element not found: ${elementId}`, suggestion: 'Call search_elements.' });
  model.elements.splice(index, 1);

  const removedRelationshipIds = new Set(
    model.relationships
      .filter((relationship) => relationship.source === elementId || relationship.target === elementId)
      .map((relationship) => relationship.id),
  );
  model.relationships = model.relationships.filter(
    (relationship) => !removedRelationshipIds.has(relationship.id),
  );
  const removedNodeIds = new Set<string>();
  for (const view of model.views) {
    for (const node of view.nodes) {
      if (node.elementRef === elementId) removedNodeIds.add(node.id);
    }
    view.nodes = view.nodes.filter((node) => !removedNodeIds.has(node.id));
    view.edges = view.edges.filter(
      (edge) =>
        !removedNodeIds.has(edge.source) &&
        !removedNodeIds.has(edge.target) &&
        !removedRelationshipIds.has(edge.relationshipRef),
    );
  }
  await store.saveModel(model);
  return {
    modelId: model.id,
    deletedElementId: elementId,
    removedRelationships: [...removedRelationshipIds],
    removedNodes: [...removedNodeIds],
  };
}

async function createRelationship(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const type = stringArg(args, 'type');
  const sourceRef = stringArg(args, 'source');
  const targetRef = stringArg(args, 'target');
  if (!getRelationshipType(type)) {
    fail({
      error: `Unknown relationship type: ${type}; nothing was written.`,
      suggestion: 'Call list_relationship_types.',
    });
  }
  const source = findElement(model, sourceRef);
  const target = findElement(model, targetRef);
  if (!source || !target) {
    fail({
      error: `Source or target element not found: ${!source ? sourceRef : targetRef}; nothing was written.`,
      suggestion: 'Call search_elements to resolve names to element ids.',
    });
  }
  if (!isAllowedRelationship(type, source.type, target.type)) {
    illegalRelationshipFailure(type, source.type, target.type, {
      source: source.id,
      target: target.id,
    });
  }
  const name = optionalString(args, 'name');
  const relationship: Relationship = {
    id: `rel-${crypto.randomUUID()}`,
    type,
    source: source.id,
    target: target.id,
    name: name ? localized(name) : [],
    documentation: [],
    properties: [],
  };
  model.relationships.push(relationship);
  let view = firstView(model);
  if (!view) {
    view = createDefaultView();
    model.views.push(view);
  }
  const sourceNode = ensureNode(view, source.id);
  const targetNode = ensureNode(view, target.id);
  view.edges.push(makeEdge(relationship.id, sourceNode.id, targetNode.id));
  await store.saveModel(model);
  return { modelId: model.id, viewId: view.id, relationship, name: primaryText(relationship.name) };
}

async function updateRelationship(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const relationshipId = stringArg(args, 'relationshipId');
  const relationship = model.relationships.find((item) => item.id === relationshipId);
  if (!relationship) {
    fail({ error: `Relationship not found: ${relationshipId}`, suggestion: 'Use get_model to list relationships.' });
  }
  const type = optionalString(args, 'type') ?? relationship.type;
  if (!getRelationshipType(type)) {
    fail({
      error: `Unknown relationship type: ${type}; nothing was written.`,
      suggestion: 'Call list_relationship_types.',
    });
  }
  const sourceRef = optionalString(args, 'source') ?? relationship.source;
  const targetRef = optionalString(args, 'target') ?? relationship.target;
  const source = findElement(model, sourceRef);
  const target = findElement(model, targetRef);
  if (!source || !target) {
    fail({ error: 'Source or target element not found; nothing was written.', suggestion: 'Call search_elements.' });
  }
  if (!isAllowedRelationship(type, source.type, target.type)) {
    illegalRelationshipFailure(type, source.type, target.type);
  }
  const name = optionalString(args, 'name');
  const documentation = optionalString(args, 'documentation');
  relationship.type = type;
  relationship.source = source.id;
  relationship.target = target.id;
  if (name !== undefined) relationship.name = name ? localized(name) : [];
  if (documentation !== undefined) {
    relationship.documentation = documentation ? localized(documentation) : [];
  }
  await store.saveModel(model);
  return { modelId: model.id, relationship };
}

async function deleteRelationship(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const relationshipId = stringArg(args, 'relationshipId');
  const index = model.relationships.findIndex((item) => item.id === relationshipId);
  if (index === -1) {
    fail({ error: `Relationship not found: ${relationshipId}`, suggestion: 'Use get_model to list relationships.' });
  }
  model.relationships.splice(index, 1);
  let removedEdges = 0;
  for (const view of model.views) {
    const before = view.edges.length;
    view.edges = view.edges.filter((edge) => edge.relationshipRef !== relationshipId);
    removedEdges += before - view.edges.length;
  }
  await store.saveModel(model);
  return { modelId: model.id, deletedRelationshipId: relationshipId, removedEdges };
}

async function createView(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const view: View = {
    id: `view-${crypto.randomUUID()}`,
    type: optionalString(args, 'type') ?? 'Diagram',
    name: localized(stringArg(args, 'name')),
    nodes: [],
    edges: [],
  };
  model.views.push(view);
  await store.saveModel(model);
  return { modelId: model.id, view };
}

async function addElementToView(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const viewId = stringArg(args, 'viewId');
  const view = model.views.find((item) => item.id === viewId);
  if (!view) fail({ error: `View not found: ${viewId}`, suggestion: 'Call list_views.' });
  const elementId = stringArg(args, 'elementId');
  const element = findElement(model, elementId);
  if (!element) fail({ error: `Element not found: ${elementId}`, suggestion: 'Call search_elements.' });
  const existing = view.nodes.find((node) => node.elementRef === element.id);
  if (existing) return { modelId: model.id, viewId, node: existing, alreadyPresent: true };
  const x = optionalNumber(args, 'x');
  const y = optionalNumber(args, 'y');
  const position = x !== undefined && y !== undefined ? { x, y } : nextFreePosition(view);
  const node = makeNode(element.id, position);
  view.nodes.push(node);
  await store.saveModel(model);
  return { modelId: model.id, viewId, node, alreadyPresent: false };
}

async function connectInView(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const viewId = stringArg(args, 'viewId');
  const view = model.views.find((item) => item.id === viewId);
  if (!view) fail({ error: `View not found: ${viewId}`, suggestion: 'Call list_views.' });
  const relationshipId = stringArg(args, 'relationshipId');
  const relationship = model.relationships.find((item) => item.id === relationshipId);
  if (!relationship) {
    fail({ error: `Relationship not found: ${relationshipId}`, suggestion: 'Use get_model to list relationships.' });
  }
  const resolveNode = (reference: string): ViewNode | undefined =>
    view.nodes.find((node) => node.id === reference || node.elementRef === reference);
  const sourceNode = resolveNode(stringArg(args, 'sourceNodeId'));
  const targetNode = resolveNode(stringArg(args, 'targetNodeId'));
  if (!sourceNode || !targetNode) {
    fail({
      error: 'Source or target view node not found; nothing was written.',
      suggestion: 'Call get_view for node ids, or add_element_to_view first.',
    });
  }
  const edge = makeEdge(relationship.id, sourceNode.id, targetNode.id);
  view.edges.push(edge);
  await store.saveModel(model);
  return { modelId: model.id, viewId, edge };
}

async function createModelFromSpec(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const name = stringArg(args, 'name');
  const description = optionalString(args, 'description');
  if (!Array.isArray(args.elements)) {
    throw new Error('Invalid argument: elements (expected an array)');
  }
  if (!Array.isArray(args.relationships)) {
    throw new Error('Invalid argument: relationships (expected an array)');
  }

  const problems: string[] = [];
  const relationshipProblems: Array<Record<string, unknown>> = [];
  const elements: ArchiElement[] = [];
  const references = new Map<string, string>();
  const usedIds = new Set<string>();

  args.elements.forEach((raw, index) => {
    const item = record(raw);
    const type = stringArg(item, 'type');
    const elementName = stringArg(item, 'name');
    if (!getElementType(type)) {
      problems.push(`elements[${index}]: unknown element type "${type}" (call list_element_types)`);
      return;
    }
    const id = optionalString(item, 'id') ?? `el-${crypto.randomUUID()}`;
    if (usedIds.has(id)) {
      problems.push(`elements[${index}]: duplicate element id "${id}"`);
      return;
    }
    usedIds.add(id);
    const element: ArchiElement = {
      id,
      type,
      name: localized(elementName),
      documentation: [],
      properties: [],
    };
    const layer = optionalString(item, 'layer');
    if (layer) element.properties.push({ key: 'layer', value: layer });
    elements.push(element);
    references.set(id, id);
    const byName = elementName.toLowerCase();
    if (references.has(byName) && references.get(byName) !== id) {
      references.set(byName, '#ambiguous#');
    } else if (!references.has(byName)) {
      references.set(byName, id);
    }
  });

  const relationships: Relationship[] = [];
  args.relationships.forEach((raw, index) => {
    const item = record(raw);
    const type = stringArg(item, 'type');
    const sourceRef = stringArg(item, 'source');
    const targetRef = stringArg(item, 'target');
    const label = optionalString(item, 'name');
    if (!getRelationshipType(type)) {
      problems.push(`relationships[${index}]: unknown relationship type "${type}" (call list_relationship_types)`);
      return;
    }
    const sourceId = references.get(sourceRef);
    const targetId = references.get(targetRef);
    if (!sourceId || !targetId || sourceId === '#ambiguous#' || targetId === '#ambiguous#') {
      problems.push(
        `relationships[${index}]: unresolved source "${sourceRef}" or target "${targetRef}" (use a unique element id or name)`,
      );
      return;
    }
    const source = elements.find((element) => element.id === sourceId);
    const target = elements.find((element) => element.id === targetId);
    if (!source || !target) {
      problems.push(`relationships[${index}]: source or target element was not created`);
      return;
    }
    if (!isAllowedRelationship(type, source.type, target.type)) {
      relationshipProblems.push({
        index,
        type,
        source: sourceRef,
        target: targetRef,
        error: `${type} is not allowed from ${source.type} to ${target.type} in ArchiMate 3.2`,
        suggestions: suggestRelationshipTypes(source.type, target.type),
      });
      return;
    }
    relationships.push({
      id: `rel-${crypto.randomUUID()}`,
      type,
      source: source.id,
      target: target.id,
      name: label ? localized(label) : [],
      documentation: [],
      properties: [],
    });
  });

  if (problems.length || relationshipProblems.length) {
    fail({
      error: 'create_model_from_spec validation failed; nothing was written.',
      problems,
      relationshipProblems,
      suggestion:
        'Call list_element_types and list_relationship_types (with sourceType/targetType) to fix the reported entries, then retry.',
    });
  }

  const view = createDefaultView();
  const nodeByElement = new Map<string, string>();
  for (const element of elements) {
    const node = makeNode(element.id, nextFreePosition(view));
    view.nodes.push(node);
    nodeByElement.set(element.id, node.id);
  }
  for (const relationship of relationships) {
    const sourceNode = nodeByElement.get(relationship.source);
    const targetNode = nodeByElement.get(relationship.target);
    if (sourceNode && targetNode) {
      view.edges.push(makeEdge(relationship.id, sourceNode, targetNode));
    }
  }

  const model = createModel({
    name: localized(name),
    documentation: description ? localized(description) : [],
    elements,
    relationships,
    views: [view],
  });
  await store.saveModel(model);
  return {
    modelId: model.id,
    name: primaryText(model.name),
    viewId: view.id,
    ...elementAndRelationshipCounts(model),
    elements: elements.map(elementSummary),
    relationships: relationships.map(relationshipSummary),
  };
}

function parseAndValidate(xml: string): { model: Model; issues: ValidationIssue[] } {
  let model: Model;
  try {
    model = parseAoef(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail({
      error: `Could not parse AOEF XML: ${message}`,
      suggestion: 'Call get_aoef_format_guide for the required document structure.',
    });
  }
  return { model, issues: validateAiModel(model) };
}

function modelCounts(model: Model): Record<string, number> {
  return {
    elements: model.elements.length,
    relationships: model.relationships.length,
    views: model.views.length,
  };
}

async function previewAoef(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const xml = stringArg(args, 'xml');
  const targetId = optionalString(args, 'modelId');
  const { model, issues } = parseAndValidate(xml);
  let diff: Record<string, unknown> | undefined;
  if (targetId) {
    const target = await getModelOrThrow(store, targetId);
    const computed = diffModels(target, model);
    diff = { ...computed, summary: diffSummary(computed) };
  }
  return {
    parsedModelId: model.id,
    name: primaryText(model.name),
    targetModelId: targetId,
    counts: modelCounts(model),
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    issues,
    ...(diff ? { diff } : {}),
    written: false,
    suggestion: issues.some((issue) => issue.severity === 'error')
      ? 'Fix all error-severity issues before calling apply_aoef.'
      : 'No error-severity issues found; you can call apply_aoef to write.',
  };
}

async function applyAoef(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const xml = stringArg(args, 'xml');
  const targetId = optionalString(args, 'modelId');
  const { model, issues } = parseAndValidate(xml);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    fail({
      error: 'AOEF contains error-severity validation issues; nothing was written.',
      errors,
      issues,
      suggestion: 'Fix the listed issues, call preview_aoef again, then retry apply_aoef.',
    });
  }
  const finalId = targetId || model.id;
  const toSave: Model = { ...model, id: finalId };
  await store.saveModel(toSave);
  return {
    modelId: finalId,
    name: primaryText(toSave.name),
    counts: modelCounts(toSave),
    issueCount: issues.length,
    issues,
    written: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Enrichment handlers                                                        */
/* -------------------------------------------------------------------------- */

function resourceFilesArg(args: Record<string, unknown>): Array<{ path: string; content: string }> {
  const value = args.files;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('Invalid argument: files (expected an array of {path, content})');
  }
  return value.map((item) => {
    const file = record(item);
    return {
      path: stringArg(file, 'path'),
      content: stringArg(file, 'content', true),
    };
  });
}

function resourcesFromArgs(args: Record<string, unknown>): RawResource[] {
  const csv = optionalString(args, 'csv');
  const source = optionalString(args, 'source');
  const files = resourceFilesArg(args);
  if (csv === undefined && files.length === 0) {
    fail({
      error: 'Provide csv and/or files to enrich.',
      suggestion: 'Call list_enrichment_sources for the supported adapter kinds.',
    });
  }
  const resources: RawResource[] = [];
  if (csv !== undefined) resources.push(...parseCsvResources(csv, source ?? 'csv'));
  resources.push(...filesToResources(files));
  return resources;
}

interface EnrichmentPipeline {
  proposals: ReturnType<typeof proposeElements>;
  elements: ArchiElement[];
  relationships: Relationship[];
}

function buildEnrichment(model: Model, args: Record<string, unknown>): EnrichmentPipeline {
  const resources = resourcesFromArgs(args);
  const proposals = proposeElements(model, resources);
  const elements = proposalsToElements(proposals);
  const relationships = proposeRelationships(model, proposals, elements);
  return { proposals, elements, relationships };
}

function listEnrichmentSources(): unknown {
  return {
    mapping: 'Deterministic heuristics with no network calls and no LLM.',
    sources: [
      {
        kind: 'csv',
        description: 'CSV text with headers: the first row is the header and each data row becomes a candidate element.',
      },
      {
        kind: 'git-files',
        description: 'Caller supplies path/content pairs from a repository scan (also usable for a drop zone or API).',
      },
    ],
  };
}

async function previewEnrichment(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  const { proposals, elements, relationships } = buildEnrichment(model, args);
  return {
    proposalCount: proposals.length,
    proposals,
    elements,
    relationships,
    warning: 'Review before applying — nothing was written.',
  };
}

async function applyEnrichment(args: Record<string, unknown>, store: ModelStore): Promise<unknown> {
  const model = await getModelOrThrow(store, stringArg(args, 'modelId'));
  let { proposals, elements, relationships } = buildEnrichment(model, args);
  const elementIds = optionalStringArray(args, 'elementIds');
  if (elementIds) {
    const keep = new Set(elementIds);
    const selected = proposals
      .map((proposal, index) => ({ proposal, element: elements[index] }))
      .filter(({ element }) => keep.has(element.id));
    proposals = selected.map(({ proposal }) => proposal);
    elements = selected.map(({ element }) => element);
    relationships = proposeRelationships(model, proposals, elements);
  }
  model.elements.push(...elements);
  model.relationships.push(...relationships);
  const issues = validateModel(model);
  // Same rule as apply_aoef: refuse to persist error-severity results
  // (invariant 6 must hold uniformly across MCP write tools).
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    fail({
      error: `Applying this enrichment would produce ${errors.length} validation error(s); nothing was written.`,
      suggestion: `First error: ${errors[0].message}. Use preview_enrichment to inspect the proposal.`,
    });
  }
  await store.saveModel(model);
  return {
    appliedElements: elements.length,
    appliedRelationships: relationships.length,
    modelId: model.id,
    issues,
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatch and result formatting                                             */
/* -------------------------------------------------------------------------- */

function makeResult(value: unknown): ToolResult {
  const json = JSON.stringify(value, null, 2);
  const isObject = typeof value === 'object' && value !== null;
  return {
    content: [{ type: 'text', text: sanitizeAiText(json) }],
    ...(isObject ? { structuredContent: value as Record<string, unknown> } : {}),
  };
}

function errorResult(error: unknown): ToolResult {
  if (error instanceof ToolFailure) {
    return {
      content: [{ type: 'text', text: sanitizeAiText(JSON.stringify(error.payload, null, 2)) }],
      structuredContent: error.payload,
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: sanitizeAiText(message) }], isError: true };
}

/** Execute a named tool. Unknown tools throw (and therefore return isError). */
export async function callTool(
  name: string,
  rawArgs: unknown,
  store: ModelStore,
): Promise<ToolResult> {
  const args = record(rawArgs);
  try {
    let value: unknown;
    switch (name) {
      case 'list_models':
        value = await listModels(store);
        break;
      case 'get_model':
        value = await getModelOrThrow(store, stringArg(args, 'modelId'));
        break;
      case 'get_model_meta':
        value = await getModelMeta(args, store);
        break;
      case 'get_metamodel':
        value = getMetamodel();
        break;
      case 'list_element_types':
        value = listElementTypes(args);
        break;
      case 'list_relationship_types':
        value = listRelationshipTypes(args);
        break;
      case 'list_viewpoints':
        value = listViewpoints();
        break;
      case 'search_elements':
        value = await searchElements(args, store);
        break;
      case 'get_element':
        value = await getElement(args, store);
        break;
      case 'get_relationship':
        value = await getRelationship(args, store);
        break;
      case 'list_views':
        value = await listViews(args, store);
        break;
      case 'get_view':
        value = await getView(args, store);
        break;
      case 'validate_model':
        value = await validateModelTool(args, store);
        break;
      case 'get_aoef_format_guide':
        value = AOEF_FORMAT_GUIDE;
        break;
      case 'export_aoef':
        value = serializeAoef(await getModelOrThrow(store, stringArg(args, 'modelId')));
        break;
      case 'export_markdown':
        value = modelToMarkdown(
          await getModelOrThrow(store, stringArg(args, 'modelId')),
          optionalNumber(args, 'maxChars') ?? 24000,
        );
        break;
      case 'get_diff':
        value = await getDiff(args, store);
        break;
      case 'trace_element':
        value = await traceElement(args, store);
        break;
      case 'impact_analysis':
        value = await impactAnalysisTool(args, store);
        break;
      case 'get_matrix':
        value = await getMatrix(args, store);
        break;
      case 'get_capability_tree':
        value = await getCapabilityTree(args, store);
        break;
      case 'get_application_dashboard':
        value = await getApplicationDashboard(args, store);
        break;
      case 'create_model':
        value = await createModelTool(args, store);
        break;
      case 'create_element':
        value = await createElement(args, store);
        break;
      case 'update_element':
        value = await updateElement(args, store);
        break;
      case 'delete_element':
        value = await deleteElement(args, store);
        break;
      case 'create_relationship':
        value = await createRelationship(args, store);
        break;
      case 'update_relationship':
        value = await updateRelationship(args, store);
        break;
      case 'delete_relationship':
        value = await deleteRelationship(args, store);
        break;
      case 'create_view':
        value = await createView(args, store);
        break;
      case 'add_element_to_view':
        value = await addElementToView(args, store);
        break;
      case 'connect_in_view':
        value = await connectInView(args, store);
        break;
      case 'create_model_from_spec':
        value = await createModelFromSpec(args, store);
        break;
      case 'preview_aoef':
        value = await previewAoef(args, store);
        break;
      case 'apply_aoef':
        value = await applyAoef(args, store);
        break;
      case 'preview_enrichment':
        value = await previewEnrichment(args, store);
        break;
      case 'apply_enrichment':
        value = await applyEnrichment(args, store);
        break;
      case 'list_enrichment_sources':
        value = listEnrichmentSources();
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return makeResult(value);
  } catch (error) {
    return errorResult(error);
  }
}
