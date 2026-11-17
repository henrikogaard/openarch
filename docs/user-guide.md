# OpenArch user guide

## Modes

**Local** (default) stores models in your browser. No account, no server, works offline. Use
*Import* to open an `.xml` (AOEF) or `.json` (native) file, and *Export AOEF* to move models to
Archi, ArchiPulse, or other compliant tools.

**Server** connects to a self-hosted instance at `VITE_API_URL` (default `http://localhost:8080/api`).
It adds optimistic locking, comments, baselines, and an audit log. The server seeds a sample model
on first start.

## Workspaces and domains

The home screen lists **workspaces** — one model each, with a purpose (`AS-IS`, `TO-BE`,
`MIGRATION`), status (`draft`, `active`, `approved`, `archived`), owner, tags, and counts. Use
*New workspace* to start from a template (blank, ArchiMate starter, cloud landing zone, TOGAF
Architecture Vision, integration landscape). Cards support duplicate, archive, and delete.

Inside a workspace, **domains** partition a large model by area (Customer, Payments, Platform…).
Add domains in **Settings**, assign elements in the **Inspector**, then filter the editor,
catalogue, dashboard, and matrices with the domain selector. **Analysis → Domains** shows a
dependency map between areas.

Deep links: `/?workspace=<id>` opens a workspace directly.

## View designer, viewpoints, and granulation

The **Views** tab generates a view for a stakeholder and a level of detail. The recipe is stored
with the view, so it can be regenerated when the model changes.

- **Viewpoint** — chosen by stakeholder: capability landscape (CIO), enterprise landscape
  (enterprise architect), solution architecture (solution architect), integration, deployment
  (platform engineer), infrastructure, security, business process, value stream, technology
  lifecycle, data architecture, and dependency/impact.
- **Granulation** — four levels:
  - **L1 Landscape** — capabilities, value streams, services, application landscape.
  - **L2 Application & process** — processes, applications, services, data.
  - **L3 Component & deployment** — applications with the servers, system software, and artifacts
    behind them.
  - **L4 Infrastructure** — servers, devices, networks, system software, artifacts.
- **Scope** — domain, environment, grouping (domain, layer, or none), and dependency depth.
- **Element types** — fully editable: add or remove any ArchiMate type, so a viewpoint can be
  customised beyond the preset.
- **Relationships** — choose which relationship types appear.
- **Displayed attributes** — show built-ins (`type`, `domain`, `environment`) and any property key
  on the canvas, such as `version`, `ip`, `owner`, `criticality`, or `classification`.
- **Focus & drill-down** — choose root elements to see their dependency neighbourhood, and expand
  selected elements with lower-level detail. Expanding an application at L2 reveals the servers,
  system software, and artifacts behind it.

Example: choose **Deployment topology**, granulation **L3**, group by **layer**, and enable
`version`, `ip`, `environment`, and `owner`. The view shows applications in one group and the
servers, artifacts, and datacenter in another, with the dependency edges between them.

Generated views are marked **Generated · L3** in the editor and can be regenerated from their
recipe. The recipe is stored in the native JSON model; AOEF export materialises the view but does
not carry the recipe.

## Editor

- **Add element** opens a searchable palette grouped by ArchiMate layer.
- Drag a connection handle from one element to another. The magic connector lists the relationship
  types that are valid for that pair of element types.
- Click an element to edit its name, documentation, and properties in the Inspector.
- **View tabs** let you create, rename, and delete views. Layer checkboxes dim other layers.
- `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` undo and redo model edits.
- Save explicitly with *Save model* — edits are kept in history until then.

## Analysis tabs

- **Catalog** — searchable table of every element.
- **Dashboard** — live counts by layer and type, plus validation findings.
- **EAM views** — capability tree, application and technology catalogues, and an application
  dependency graph, generated from the model itself.
- **Validation** — structural checks with click-to-navigate, shared with the CLI and server.
- **Trace** — follow realization/serving chains up to six levels deep, or compute impact.
- **Matrices** — capability × application, process × application, and application × technology.
- **Deployment** — runtime topology (networks, nodes, system software, artifacts, applications)
  filtered by environment.
- **Interfaces** — interface and service catalogue with provider, consumers, protocol, and owner.
- **Domains** — dependency map between the areas of the workspace.
- **Artefacts** — ADRs, requirements, principles, and assessments linked to elements; export as Markdown.
- **Collaborate** — comments, baselines, changes since the last baseline, and audit history (server only).
- **Portfolio** (from the home screen) — cross-workspace totals, status/purpose breakdown, and a
  TIME quadrant for application elements.

## Export formats

| Button | Format | Use |
|---|---|---|
| Export AOEF | `.xml` | Interchange with other ArchiMate tools |
| Export native | `.json` | Git-friendly diffs and backups |
| Export SVG / PNG | images | Presentations and documentation |
| Export CSV | elements | Spreadsheets and catalogs |
| Export Mermaid | `.mermaid` | Text diagrams in Markdown |
| Copy share link | gzip URL fragment | Read-only view of the current model (refuses models too large for a URL) |

## Command line

```bash
npm run cli -- validate examples/archisurance.xml
npm run cli -- list examples/archisurance.xml
npm run cli -- convert examples/archisurance.xml model.json
npm run cli -- diff before.xml after.xml
npm run cli -- doctor
```

## AI integration

### MCP server

`npm run mcp` starts a stdio JSON-RPC server (MCP spec 2025-06-18) with 30+ tools covering model,
element, relationship, and view CRUD; search, validation, traceability, matrices, EAM views;
AOEF export/preview/apply; and `create_model_from_spec` for building a model from a description.
It also exposes resources (`aoef://format-guide`, `aoef://metamodel`, `aoef://viewpoints`,
`openarch://context/{modelId}`) and reusable prompts.

- Set `OPENARCH_API_URL=http://localhost:8080/api` to let the agent operate on the **same server
  workspace** the web app uses.
- Set `OPENARCH_TOKEN=<bearer token>` when that server runs with `OPENARCH_REQUIRE_AUTH=true`.
  The token must belong to a workspace member; the MCP server sends it on every request.
- Set `OPENARCH_MODEL_FILE=/path/to/model.xml` to work on a single local AOEF/JSON file.
- With neither set, the server seeds the sample model in memory.

All AI writes are checked against the ArchiMate 3.2 metamodel; illegal relationships are rejected
with suggestions. Every model text result is prefixed with an untrusted-content warning, and tool
calls are logged to stderr. Destructive operations should be confirmed by a human.

### In-app AI panel

The **AI** tab lets you copy the current model as agent-ready Markdown or AOEF XML, build a prompt
from a plain-language system description, optionally run it against an OpenAI-compatible endpoint
(e.g. a local Ollama server), and review validation findings plus a structural diff before
applying the result to the current model or adding it as a new workspace.

### Server endpoints

When using the server, `GET /api/ai/context/:id`, `POST /api/ai/validate/:id`, and
`GET /api/ai/metamodel` expose the same context and guardrails over HTTP.

## Self-hosting

```bash
npm run build
docker compose up --build
```

The app and API are then available at `http://localhost:8080`. Data is stored in the
`openarch-data` volume at `/data/models.json`.

## Interoperability guarantees

Everything the app exports as AOEF is validated in CI against the official Open Group
`archimate3_Diagram.xsd`:

- models created in the app (namespaces are always declared),
- models with ad-hoc properties (a `propertyDefinition` is generated and referenced),
- imported models after a round-trip (properties, relationships, and views preserved),
- deletions (removing all nodes, views, or relationships is honoured on export),
- negative canvas coordinates (clamped to the schema's `nonNegativeInteger`).

Run `npm test` locally; the conformance tests use `xmllint` and skip if it is not installed.

## Import preview

Importing an AOEF/JSON file now opens a **preview dialog** showing added, removed, and changed
elements, relationships, and views before anything is written. Choose *Replace current model* or
*Add as new model*. The server exposes the same pipeline at
`POST /api/models/:id/import/preview` and `/import/apply` (with `mode: replace | merge`).

## Saved views

Click **☆ Views** in the toolbar to bookmark the current tab, active view, and selection. Saved
views persist in IndexedDB in local mode and through `/api/models/:id/saved-views` in server mode.

## Enrichment and infrastructure import

The **Enrichment** tab has three deterministic adapters (no LLM, no network calls):

- **CSV** — one resource per row; headers become properties.
- **Files** — a JSON array of `{path, content}` records from a repository scan.
- **Infrastructure** — paste Terraform `plan -json` / `show -json`, Kubernetes YAML, or
  docker-compose YAML. Resources map to ArchiMate Nodes, System Software, Artifacts,
  Communication Networks, and services, with relationships derived from dependencies and stable
  ids so re-importing updates rather than duplicates.

Every adapter previews its proposals before applying. The same capability is available to agents
via `preview_enrichment`, `apply_enrichment`, and `list_enrichment_sources`.

## Archi interoperability

Use **Import model** with a `.archimate` file to open an Archi desktop model, and
**Export Archi (.archimate)** to write one back. The native format is a ZIP containing `model.xml`;
elements, relationships, views, bounds, and properties are preserved. Custom icons and styling are
not. AOEF remains the canonical interchange format and is validated against the Open Group XSD.

## Portfolio and reporting

**Portfolio** on the home screen aggregates every workspace: totals, status and purpose breakdown,
and a TIME quadrant (invest / tolerate / migrate / eliminate) derived from the `lifecycle` and
`criticality` properties on application elements.

Export a Markdown workspace report from the sidebar, or generate reports and run rules headlessly:

```bash
npm run cli -- report model.xml report.md
npm run cli -- check model.xml                    # default architecture rules
npm run cli -- check model.xml architecture-rules.json
```

The reporting package also ships standards packs (NIST CSF, ISO 27001, DORA, GDPR) that add
requirement elements and a compliance view.

## Governance

Workspace status moves from `draft` to `active` to `approved`. On the server, owners can approve a
baseline (`POST /api/models/:id/approvals`), which records the decision and marks the workspace
approved. Every action is written to the audit log; set `OPENARCH_AUDIT_WEBHOOK` to stream events
to a SIEM.

## Authentication and roles (server mode)

The server is open by default (local-first friendly). To protect it:

- `OPENARCH_REQUIRE_AUTH=true` requires a bearer token.
- `OPENARCH_TOKENS='{"token":{"subject":"alice","displayName":"Alice"}}'` defines static tokens;
  the first subject becomes owner of seeded workspaces.
- Alternatively `OPENARCH_JWT_SECRET=...` accepts HS256 JWTs with a `sub` claim and optional `exp`.
- For an identity provider, set `OPENARCH_OIDC_ISSUER` (discovery), `OPENARCH_OIDC_AUDIENCE`, and
  optionally `OPENARCH_OIDC_JWKS_URL`. RS256 tokens are verified against the JWKS, which is loaded
  at startup and refreshed every ten minutes.
- `OPENARCH_ADMIN=<subject>` overrides the bootstrap owner.
- `OPENARCH_AUDIT_WEBHOOK=<url>` streams every audit event to a SIEM.

Roles are **owner** (delete workspace, manage members), **editor** (edit models, comments,
snapshots, saved views, imports), and **viewer** (read-only). `GET /api/me` lists your effective
role per workspace; `PUT /api/models/:id/members/:subject` lets owners change roles.

Reads are member-scoped: a user who is not a member of a workspace cannot list or read it.
Saves are protected by optimistic locking — the web app sends the revision it loaded and the
server returns `409 Conflict` when someone else has saved in the meantime.

## Further reading

- [`docs/comparison-and-usefulness.md`](comparison-and-usefulness.md) — comparison with ArchiPulse
  and the AI integration strategy.
- [`docs/research-and-plan.md`](research-and-plan.md) — original research and product plan.

## Trademark

ArchiMate® is a registered trademark of The Open Group. OpenArch is independent and is not
affiliated with, endorsed by, or certified by The Open Group.
