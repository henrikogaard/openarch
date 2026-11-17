# @openarch/mcp

A full AI-native [Model Context Protocol](https://modelcontextprotocol.io/) server
for OpenArch. It speaks JSON-RPC 2.0 over stdio (newline-delimited JSON), with no
SDK dependency: responses go to stdout, all logs go to stderr. It exposes tools,
resources and prompts for modelling ArchiMate® 3.2 architectures.

> ArchiMate® is a registered trademark of The Open Group. OpenArch is independent
> and is not affiliated with, endorsed by, or certified by The Open Group.

## Running

```bash
npm run mcp -w @openarch/mcp
```

### Backend selection (environment variables)

The server picks its data source in this order:

1. **`OPENARCH_API_URL`** — attach to a running OpenArch server via its REST API
   (default when unset: `http://localhost:8080/api`). The agent then sees the
   **same models as the web app**. Example:
   `OPENARCH_API_URL=http://localhost:8080/api npm run mcp -w @openarch/mcp`
2. **`OPENARCH_MODEL_FILE`** — load a single model from disk on startup. A
   `.json` file is parsed as native OpenArch JSON; anything else is parsed as
   AOEF XML. Example:
   `OPENARCH_MODEL_FILE=/path/to/model.aoef.xml npm run mcp -w @openarch/mcp`
3. Neither set — seed an in-memory store with `createSampleModel()`.

If the API cannot be reached, the error names `OPENARCH_API_URL` so the
misconfiguration is easy to spot. All write tools call `saveModel` on the active
store, so changes are persisted to the server or kept in memory accordingly.

## MCP client configuration

The entry point is TypeScript, so launch it through `tsx`. Use absolute paths.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openarch": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/openarch/apps/mcp/src/index.ts"],
      "env": {
        "OPENARCH_API_URL": "http://localhost:8080/api"
      }
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json` (or your user `mcp.json`):

```json
{
  "servers": {
    "openarch": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/openarch/apps/mcp/src/index.ts"],
      "env": {
        "OPENARCH_MODEL_FILE": "/absolute/path/to/model.aoef.xml"
      }
    }
  }
}
```

Remove the `env` block to use the built-in sample model. If the workspace is
installed, the `openarch-mcp` bin can replace `npx tsx …`.

## Protocol

`initialize` negotiates protocol version `2025-06-18` and advertises `tools`,
`resources` and `prompts` capabilities. The server also handles `ping`,
`notifications/initialized`, `notifications/cancelled`, `tools/list`,
`tools/call`, `resources/list`, `resources/read`, `resources/templates/list`,
`prompts/list` and `prompts/get`. Unknown methods return `-32601`; unknown
resources return `-32002`.

Tool results contain a text content block plus `structuredContent` when the tool
has an output schema. Every text block is passed through `sanitizeAiText`, which
prepends an untrusted-data safety prefix, strips control characters and caps
size. Each tool call is logged to stderr as
`{"ts":…,"event":"tool.call","tool":…,"success":…,"durationMs":…}`. Model data
is never written to stdout outside JSON-RPC responses.

## Tools

All write tools are validated against the ArchiMate 3.2 metamodel. Unknown
element/relationship types and illegal relationship combinations are rejected
before anything is saved; rejections include `suggestions` from
`list_relationship_types` so an agent can repair the call.

### Discovery and validation

| Tool | Purpose |
|---|---|
| `list_models` | List model summaries; start here to discover model ids. |
| `get_model` | Full model JSON. |
| `get_model_meta` | Counts, layers and server-side version/audit metadata when available. |
| `get_metamodel` | Element/relationship type lists, layers and counts. |
| `list_element_types` | Valid element `xsi:type` values, optionally filtered by layer. |
| `list_relationship_types` | All relationships, or only those legal for a source/target pair. |
| `list_viewpoints` | The 23 stakeholder viewpoints. |
| `validate_model` | Structural plus AI-oriented validation with actionable suggestions. |

### Reading and analysis

| Tool | Purpose |
|---|---|
| `search_elements` | Find elements by name, documentation or property text. |
| `get_element` | One element plus its direct incoming/outgoing relationships. |
| `get_relationship` | One relationship with resolved source/target names. |
| `list_views` / `get_view` | List views or read one view's nodes and edges. |
| `trace_element` | Walk relationships to a chosen depth and direction. |
| `impact_analysis` | Downstream change impact through dependency relationships. |
| `get_matrix` | Preset or custom cross-element-type matrix. |
| `get_capability_tree` | Capability hierarchy from Composition/Specialization. |
| `get_application_dashboard` | Counts by layer/type/relationship plus validation summary. |

### Exchange and export

| Tool | Purpose |
|---|---|
| `get_aoef_format_guide` | Call before generating AOEF XML. |
| `preview_aoef` | Parse + validate inline XML and optionally diff, without writing. |
| `apply_aoef` | Validate then save; refuses error-severity issues. |
| `export_aoef` | Serialize a model to AOEF XML. |
| `export_markdown` | Compact, information-dense Markdown rendering of a model. |
| `get_diff` | Diff one model against another. |

### Writing

| Tool | Purpose |
|---|---|
| `create_model` | New empty model with a default view. |
| `create_model_from_spec` | **Headline path:** describe elements + relationships, get a validated model with a laid-out view. |
| `create_element` / `update_element` / `delete_element` | Element CRUD; new nodes are grid-placed on the first view. |
| `create_relationship` / `update_relationship` / `delete_relationship` | Relationship CRUD; illegal combinations are rejected with suggestions. |
| `create_view` | Add an empty diagram view. |
| `add_element_to_view` | Place an element as a node on a view. |
| `connect_in_view` | Draw an existing relationship as an edge in a view. |

### Enrichment

| Tool | Purpose |
|---|---|
| `preview_enrichment` | Turn inline CSV text and/or path+content file pairs into candidate elements and relationships for review; writes nothing. |
| `apply_enrichment` | Append the proposals (optionally only the given `elementIds`) to a model, save it and return validation issues. |
| `list_enrichment_sources` | List the supported adapter kinds and their descriptions. |

Enrichment is a deterministic adapter layer that maps real-world resources — CSV
rows or files supplied from a repository scan — to candidate ArchiMate elements
using local name/extension heuristics. It makes **no network calls and no LLM
requests**: the same input always produces the same proposals, with a confidence
score and a human-readable reason for each. Preview first, review the proposals,
then apply only what you trust. Re-running against an already-enriched model
skips resources whose key or name matches an existing element, so enrichment is
idempotent.

### Recommended agent workflow

1. `get_aoef_format_guide` and `get_metamodel` (or the matching resources).
2. `create_model_from_spec` for a new model, or read an existing one.
3. `validate_model` and `get_application_dashboard` to check the result.
4. If importing XML: `preview_aoef` → fix issues → `apply_aoef`.

## Resources

Two URI families are exposed. The `openarch://` family is canonical; the
`aoef://` family is kept for compatibility with existing ArchiPulse-style agent
prompts that already reference `aoef://` URIs. Both resolve to the same data.

### Static resources (`resources/list`)

| URI | Content |
|---|---|
| `aoef://format-guide` | Complete AOEF XML guide (also the canonical format-guide URI). |
| `openarch://metamodel/elements` | All element types with layer/kind metadata. |
| `openarch://metamodel/relationships` | All relationship types. |
| `aoef://metamodel` | Compatibility alias: element types, relationship types **and** allowed-relationship rules. |
| `openarch://viewpoints` / `aoef://viewpoints` | The 23 viewpoints. |
| `openarch://models` | Summaries of all available models. |
| `aoef://model-context` | Generic context guidance; agents should use a templated context URI for a specific model. |

### Templates (`resources/templates/list`)

| URI template | Content |
|---|---|
| `openarch://model/{modelId}` | Full model JSON. |
| `aoef://model/{modelId}` | Compatibility alias for the full model JSON. |
| `openarch://element/{modelId}/{elementId}` | One element plus its direct relationships. |
| `openarch://view/{modelId}/{viewId}` | One view with nodes and edges. |
| `openarch://context/{modelId}` | Token-efficient Markdown rendering of a model. |

For a specific model, agents should use `openarch://context/{modelId}` (or
`aoef://model/{modelId}` for full JSON). `aoef://model-context` intentionally
does not embed any single model.

## Prompts

`prompts/list` exposes five reusable prompts, and `prompts/get` renders their
`{{argument}}` placeholders:

| Prompt | Arguments | Purpose |
|---|---|---|
| `model_from_description` | `description`, `layers?` | Turn a system description into a validated model. |
| `review_model` | — | Critique an existing model for correctness and completeness. |
| `explain_element` | `elementId` | Explain an element's ArchiMate semantics and neighbours. |
| `suggest_relationships` | `elementId` | Suggest metamodel-legal relationships. |
| `document_architecture` | — | Produce stakeholder-ready architecture documentation. |

## Safety

Model content is untrusted data. Every tool text result is passed through
`sanitizeAiText` from `@openarch/ai`, which prepends a safety prefix warning the
model not to follow embedded instructions, strips control characters and caps
the output. The Markdown context resource is sanitized the same way.

## License

MIT — see [LICENSE](../../LICENSE).
