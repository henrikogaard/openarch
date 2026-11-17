# OpenArch — Comparison & Usefulness Strategy

**Status:** strategy document for discussion
**Date:** 2026-11-17
**Companion to:** `docs/research-and-plan.md`
**Scope:** how OpenArch compares to ArchiPulse and the wider AI-for-EA landscape, and what makes it *more useful* to real users.

---

## 1. Executive summary

OpenArch and ArchiPulse are not the same product wearing different logos. ArchiPulse is a **repository and analysis server** with a faithful, largely read-only viewer and a strong AI-agent story. OpenArch is a **full authoring tool** — a proper ArchiMate 3.2 notation editor — with a local-first core, broad export formats, and Git-native files. Each is genuinely more useful than the other depending on where you sit in the modeling workflow.

**Where we win.** We have the better *editor*: full 3.2 notation shapes, a searchable layer-grouped palette, a metamodel-aware "magic connector," multiple views, layer filters, undo/redo, and inline inspection. We are local-first and anonymous — you can open the app, model offline, and commit a clean `.json` file to Git with no server, account, or database. Our export breadth (AOEF, native JSON, SVG, PNG, CSV, Mermaid) and share links exceed ArchiPulse's. We are MIT and carry no operational footprint unless the user wants one.

**Where ArchiPulse wins.** They own the *analysis and AI* surface: a catalogue of EAM views generated from SQL (capability tree, application landscape, dependency/integration graphs, tech stack, catalogues, application dashboard), a two-stage enrichment pipeline with real extractors (AWS/Jira/Confluence/CSV), JWT + OIDC auth with workspace RBAC, saved views, and semantic-diff import preview. Their **27-tool MCP server** plus an `aoef://format-guide` resource markets the product as "AI-native Enterprise Architecture" (v0.6.0, June 2026).

**Update — post-review status.** The functional gaps identified below are closed: a **38-tool MCP server** with resources (`aoef://` compatibility aliases), prompts, structured output, tool annotations, write-time validation, and dual local/server backends; an in-app AI panel; server-side AI endpoints; capability tree, application/technology catalogues, dependency graph, import preview, saved views, and enrichment; optional authentication (static tokens / HS256 JWT) with owner/editor/viewer RBAC and member-scoped reads.

A code review then found that the **interoperability promise was not actually met**, despite the feature list. Three defects were fixed and are now covered by tests:

1. AOEF properties were parsed from the wrong XML node and exported in a non-schema format, corrupting every property.
2. Models created in the app exported without `xmlns`/`xmlns:xsi`, producing XML that no conformant tool could open.
3. Deleting all nodes or all views did not remove them on export.

The exporter now validates against the official `archimate3_Diagram.xsd` in CI, including app-created models, ad-hoc properties, deletions, and round-trips. The lesson is recorded here deliberately: **feature breadth is not interoperability**, and the earlier "gaps closed" claim was premature until the schema tests existed.

Remaining honest gaps versus ArchiPulse: SaaS connectors (AWS/Jira/Confluence/ServiceNow), OIDC provider integration (we accept signed HS256 JWTs), a portfolio-scale repository (we are document-oriented, not SQL-projectable), and Helm packaging. These are deliberate non-goals or later work, not omissions.

**The single most important next move:** turn our MCP server from a 7-tool afterthought into the **primary AI integration surface** — full CRUD, the ArchiPulse-baseline tool set, MCP resources (`aoef://format-guide`, metamodel, viewpoints, model context), prompts, structured output with annotations, write-time metamodel validation, and a dual backend (local repository *and* server repository). This is our differentiator because it composes our genuine strengths (full metamodel, lossless AOEF codec, local-first files, Git-native JSON) with the capability the market is chasing — and no other player in the landscape combines an AI-native agent API with a *full authoring editor*. ArchiPulse can parse AOEF but cannot author rich diagrams; the Eclipse plugins (jgs-archi-mcp, archi-mcp-server) are desktop-bound; archiscribe-mcp is read-only. We can be the first tool where an AI agent both **builds** and **edits** a real ArchiMate model with validation, then a human opens it in a first-class editor.

**Explicit non-decision:** we will **not fork ArchiPulse**. We keep our architecture and add a thin compatibility layer where useful (shared AOEF semantics, equivalent tool/resource names, borrowed view definitions and extractor ideas, with Apache-2.0 attribution where we borrow code).

---

## 2. Feature-by-feature comparison

Honest scoring. "Verdict/Action" is what we actually do about it.

| Capability | OpenArch | ArchiPulse | Verdict/Action |
|---|---|---|---|
| **Editor / notation** | Full ArchiMate 3.2: 61 element types, 12 relationship types, 23 viewpoints; XYFlow canvas, full notation shapes, searchable layer-grouped palette, magic connector driven by metamodel rules, multiple views, layer filters, undo/redo, inline inspector | Static viewer faithful to ArchiMate diagrams; repository/analysis first, light editing; no comparable notation editor | **We win clearly.** Double down — this is our core asset, not a feature to pare back. |
| **Repository / collaboration** | Local IndexedDB; REST server with optimistic locking **wired through the UI**, comments, snapshots, audit, member-scoped RBAC; Git adapter incl. GitHub API | Collaborative repo with optimistic locking + semantic diff on import; one workspace per baseline; snapshots; audit log; full paginated REST API; JWT + OIDC + workspace RBAC | **Parity on mechanics**, verified by server integration tests. Our Git adapter and local-first mode remain genuine advantages for code-first teams. |
| **Analysis / EAM views** | Catalogue, dashboard, validation panel, traceability/impact explorer, 3 matrix presets, capability tree, application/technology catalogues, dependency graph | SQL-generated EAM views: app landscape map, integration map, tech stack, application dashboard (lifecycle/criticality); graph explorer (Cytoscape.js) | **Gap narrowed.** We now have the core tree/catalogue/graph trio; remaining differences are the richer SQL dashboards and Cytoscape's layout engine. |
| **Import / export** | AOEF codec **validated against the official XSD in CI**; native JSON (Git-friendly); AOEF/JSON/SVG/PNG/CSV/Mermaid exports; semantic-diff import preview in UI, API, and MCP | AOEF mapped directly to PostgreSQL tables; export = SELECT, import = INSERT; semantic diff on import; preview_import / import_model tools | **Parity, with schema proof.** We match import preview and now prove export conformance rather than asserting it. |
| **AI / MCP** | **38 MCP tools** (incl. enrichment); resources (`aoef://` + `openarch://`), 5 prompts, structured output + annotations, write-time metamodel validation, dual local/server backends; in-app AI panel | 27 MCP tools incl. full CRUD, EAM view tools, import tools, `aoef://format-guide` resource; v0.6.0 "AI-native EA"; structural validation at write time | **We lead on depth of validation and authoring integration.** They market the broader extractor story; we ship a full editor that agents can drive. |
| **Extensibility** | Plugin API; CLI; Docker Compose | CLI with named contexts; extractor library on roadmap (AWS/Azure/Confluence/ServiceNow/Jira); Helm chart roadmap | **Parity with different center of gravity.** Ours is client-side plugin extensibility; theirs is server-side extractor extensibility. Add our own adapter layer (§6). |
| **Deployment / auth** | Local-first/anonymous; Docker Compose; optional server auth (static tokens / HS256 JWT) with owner/editor/viewer RBAC | Self-hosted server; JWT + OIDC; workspace RBAC; Helm chart on roadmap | **Parity on RBAC mechanics** (we lack OIDC provider integration but support signed JWTs). Local-first remains zero-friction. |
| **Data enrichment** | Deterministic CSV + Git-file adapters in UI and MCP (`preview_enrichment`/`apply_enrichment`), idempotent with confidence + rationale | Two-stage ETL: extractors (AWS/Jira/Confluence/CSV/ServiceNow) → mappers → ArchiMate elements | **They win on connector breadth; we match the pattern.** SaaS connectors remain a deliberate non-goal; CSV + repo scan cover our code-first users. |
| **UX / docs** | EN/NB i18n; share links; layered palette; local-first onboarding; saved views now shipped | Static viewer, saved views with filter state; CLI/MCP docs | **We win on editor UX, i18n, and local-first onboarding; saved views now at parity.** |

---

## 3. Where OpenArch is genuinely more useful today

These are not aspirational — they work now.

- **Local-first, anonymous, offline.** No account, no server, no database. A user can model on a plane and keep working. ArchiPulse's value is concentrated in a deployed server with a workspace; ours is in the browser. For individuals, Consultants, and workshops this is a decisive advantage.
- **A full notation editor, not a viewer.** 61 element types, 12 relationship types, and 23 viewpoints with faithful shapes and layer/aspect semantics means OpenArch can be the place a model is *born and edited*, not just inspected. ArchiPulse's viewer is faithful but not an authoring tool.
- **The magic connector.** Because suggestions come from the metamodel rules, users are guided to *valid* relationships instead of guessing. This turns a standards-compliance burden into a UX feature — and it is exactly the same rule set we will expose to AI writes (§5).
- **Export breadth.** AOEF, native JSON, SVG, PNG, CSV, and Mermaid from one model covers interchange, documentation, and presentation without extra tooling. Native JSON is deliberately Git-diffable.
- **Git-native files.** Native JSON that diffs cleanly in a pull request fits code-first and platform-engineering teams. ArchiPulse's semantic diff on import is good, but its canonical store is PostgreSQL tables, not a file in your repo.
- **Share links.** Lightweight, no-account sharing of a view or model is a better fit for ad-hoc collaboration than a workspace invitation.
- **i18n (EN/NB).** Norwegian + English is a real differentiator for Nordic public-sector and enterprise users; ArchiPulse has no stated i18n story.
- **Lower operational cost.** MIT-licensed, no required backend, Docker Compose for those who want a server. No OIDC provider, no Postgres to run for the common case.

---

## 4. Where ArchiPulse is more useful — and what to do about it

For each capability: a recommendation using **build / borrow / integrate / decline**, with reasoning.

| ArchiPulse capability | Recommendation | Reasoning |
|---|---|---|
| **EAM view catalogue** (capability tree, app landscape, dependency/integration graph, tech stack, catalogues, application dashboard) | **Borrow (definitions) + Build (rendering)** | The view *semantics* (what a capability tree or app landscape shows) are standard EA practice — borrow the definitions and SQL logic ideas (Apache-2.0 attribution where code is copied), render them in our own UI on top of our model. |
| **Enrichment pipeline / extractors** (AWS, Jira, Confluence, CSV → ArchiMate elements) | **Borrow the pattern, Build a thin adapter layer** | The two-stage ETL (extractors → mappers → CRUD API) is sound; we already expose CRUD, so adapters are decoupled. Start with CSV and a Git-repo reader (§6), which fit our user base better than enterprise SaaS connectors. |
| **Graph explorer (Cytoscape.js)** | **Integrate** | Drop-in library on top of our existing model data; high visual payoff for modest effort. Wire it to the same traceability/impact data we already compute (no need to reinvent graph analysis). |
| **Auth / JWT / OIDC / workspace RBAC** | **Integrate (server option only)** | Add OIDC + RBAC to the *server repository* for enterprise deployment, but never make it a prerequisite for local-first use — that would destroy our biggest advantage. |
| **Saved views with filter state** | **Build (small)** | Persist filters/view state to the repository (local and server); cheap to implement and immediately improves repeated-analysis workflows. |
| **Import preview / semantic diff** | **Build** | We already have a lossless AOEF codec, so we can compute a precise structural diff; showing it before apply is a contained feature with high trust value. |
| **SQL analytics (AOEF → PostgreSQL tables, export = SELECT)** | **Decline (for now)** | Our store is a document model + Git-friendly JSON; a SQL-table projection would add a second source of truth. If demand appears, expose an optional read-only projection, not a rewrite of persistence. |
| **Helm chart / hosted SaaS / enterprise support** | **Decline (out of scope)** | Operational packaging, not product usefulness for our target user. Docker Compose covers self-hosting; SaaS contradicts our local-first, no-lock-in positioning. |

**Cross-cutting decision: do not fork ArchiPulse.** Forking would inherit its Go/Svelte/PostgreSQL architecture, replace our strongest asset (the full XYFlow notation editor), and saddle us with their repository-centric model. Instead: keep our architecture, match the *interfaces* they expose (tool names, `aoef://format-guide` resource, AOEF semantics), and borrow view definitions and extractor ideas with proper attribution. A thin compatibility layer gives AI agents and users familiar entry points without importing their technical debt.

---

## 5. AI agent integration strategy — the differentiator

This is where the market is moving and where OpenArch can lead. The broader landscape is small and fragmented: **archiscribe-mcp** (4 read-only tools, HTTP `/mcp`, markdown/yaml/json output, Entra ID auth, a prompt-injection disclaimer prefix, NDJSON audit logging); **jgs-archi-mcp** and **archi-mcp-server** (Eclipse plugins exposing Archi via MCP, desktop-bound); **mcp-Archimate** (generates Mermaid/draw.io diagrams with validation); **byrondelgado/mcp-archimate** (FastMCP + pyArchimate). None combines a full authoring editor, a lossless AOEF codec, local-first files, and an AI-native agent API. We can.

MCP spec 2025-06-18 gives us the primitives to do this properly: **structured tool output** (`outputSchema` + `structuredContent`), **tool annotations** (`readOnlyHint`, `destructiveHint`), **elicitation**, and **resources/prompts** as first-class primitives. Use all of them.

### Tier (a) — MCP server as the primary integration ✅ shipped

The MCP server is now the main way agents and tools talk to OpenArch. It implements 35 tools,
both `aoef://` and `openarch://` resource families, five prompts, structured content with
annotations, write-time validation, and a dual backend (`OPENARCH_API_URL` attaches the agent to
the running server; `OPENARCH_MODEL_FILE` loads a single file; no config seeds the sample model).

- **Full tool set** at least matching ArchiPulse's baseline, with our own additions. Concrete tool list to implement:
  - Discovery/context: `list_models`, `get_model`
  - CRUD: `create_element`, `get_element`, `update_element`, `delete_element`; `create_relationship`, `get_relationship`, `update_relationship`, `delete_relationship`; `create_view`, `get_view`, `update_view`, `delete_view`
  - Search/validation/analysis: `search_elements`, `validate_model`, `trace_element`, `impact_analysis`, `get_matrix`
  - EAM views: `get_capability_tree`, `get_application_dashboard`, `get_dependency_graph`, `get_integration_map`, `get_app_catalogue`, `get_tech_catalogue`, `get_process_application_matrix`, `get_app_detail`
  - AOEF/import: `export_aoef`, `preview_aoef`, `apply_aoef`, `preview_import`, `import_model`, `create_model_from_spec`
  - Using ArchiPulse's names where they exist keeps agents and user muscle memory portable; our extra tools (`create_model_from_spec`, `preview_aoef`) are where we differentiate.
- **Resources and prompts matter more than raw tool count.** Tools are verbs; resources are the *knowledge* that makes verbs produce correct models. Expose:
  - `aoef://format-guide` — the AOEF format guide (match ArchiPulse's URI so existing agent prompts work).
  - `aoef://metamodel` — our 61 element types / 12 relationship types and the allowed-relationship rules (the magic-connector rules, made machine-readable). This is what lets an agent generate a *valid* model instead of a plausible-looking invalid one.
  - `aoef://viewpoints` — the 23 viewpoints and what each is for.
  - `aoef://model-context` — the current model's elements/relationships/views as context for an agent.
  - Prompts: "build a model from a system description," "review this model for gaps," "explain this model" — packaged so an agent gets a correct, repeatable workflow rather than an improvised one.
- **Structured output + annotations.** Give tools `outputSchema`/`structuredContent` so agents consume results deterministically, and annotate with `readOnlyHint`/`destructiveHint` (but treat annotations as untrusted on our side).
- **Write-time validation.** Route every AI write through the same metamodel rules the magic connector uses. This is our structural advantage over ArchiPulse: our validation is backed by the full 3.2 metamodel, not just AOEF table shape.
- **Dual backend.** The MCP server must work against both the local IndexedDB repository and the server repository through the same `ModelRepository` interface — so an agent can build a model locally with no account, or against a shared server with auth.

### Tier (b) — Bring-your-own-LLM in the web app

Not everyone has an MCP-capable agent. Inside OpenArch:

- **Copy context / import generated AOEF.** Buttons to copy the current model (or selection) as agent-ready context, and to paste/import an AOEF snippet an LLM produced — validated and diffed before apply.
- **Optional OpenAI-compatible endpoint.** Users can configure a base URL + key (local model, Ollama, OpenAI, etc.) to generate a model from a description *in the editor*, with the result reviewed via import preview. No bundled, mandatory LLM; no data leaving the machine by default.

### Tier (c) — Server-side agent workflows / enrichment

For deployed servers only: agents that ingest real systems (starting with CSV, then a Git-repo reader) and propose ArchiMate elements through the same CRUD API, with human review. This is our version of ArchiPulse's extractor pipeline, and it feeds the AI tools rather than being a separate pipeline.

### Safety rules (non-negotiable)

- **Sanitize untrusted model text.** Model names, comments, and imported text are prompt-injection vectors (archiscribe-mcp's disclaimer prefix is a good precedent). Treat all model content as data, never as instructions; mark it clearly when passed to an LLM.
- **Validate every AI write** through the same metamodel rules as human edits — no "AI bypass."
- **Log all agent actions** to the audit log (tool, arguments, result, actor) for both local and server backends.
- **Require human confirmation for destructive operations** (`delete_*`, mass `apply_aoef`, overwrites). Keep a human in the loop; treat tool annotations as untrusted hints, not guarantees.

---

## 6. Usefulness roadmap

Ordered by value/effort (highest value per unit effort first). Effort estimates are rough.

| # | Item | Status | Why it matters |
|---|---|---|---|
| 1 | **Full MCP server + resources/prompts** — complete tool list from §5, `aoef://` resources, prompts, structured output, write-time validation, dual backend | ✅ shipped | The single differentiator: an AI agent can build and edit a validated ArchiMate model that a human then opens in a real editor. |
| 2 | **Capability tree + application/technology catalogues + dependency graph** | ✅ shipped (SVG, no Cytoscape) | Closes the biggest analysis gap so users analyse models in the same tool they author them in. |
| 3 | **Import preview with semantic diff** | ✅ shipped (UI, API, MCP) | Builds trust in imports and AI-generated models; changes are accepted deliberately. |
| 4 | **Saved views** | ✅ shipped (local + server) | Cheap, immediately improves repeated-analysis workflows. |
| 5 | **Enrichment adapters** — CSV + Git-file scan | ✅ shipped (no SaaS connectors) | Connects OpenArch to systems engineers actually work in, turning AI tools from a blank-page exercise into grounded modelling. |
| 6 | **Schema-conformance CI** — validate every export against the Open Group XSD | ✅ shipped | The review found interoperability was asserted, not proven. This is now the gate that keeps it true. |

The roadmap items are complete. The next tranche is depth rather than breadth: portfolio-scale
repositories, SaaS connectors, OIDC provider integration, and Helm packaging.

---

## 7. Success metrics

How we know the app became *more useful*, not just bigger.

- **Time to first model** — median time from opening the app to a saved model with ≥10 elements; should drop with AI tools and copy/import flows. Target: under 10 minutes.
- **AI-generated model acceptance rate** — % of `create_model_from_spec` / `apply_aoef` results accepted after preview rather than discarded or heavily edited. High acceptance means resources/prompts and validation are working.
- **Number of exported AOEF files** (and native JSON commits) — a leading indicator that models are real and leaving the tool into other systems and Git repos.
- **Editor → analysis tab usage** — % of sessions that create/edit a model and then open a dashboard, capability tree, catalogue, or graph explorer. Higher means the authoring and analysis halves are connected.
- **MCP adoption** — number of distinct agent clients/contexts calling the MCP server, and the ratio of read tools to write tools. Growing *write* usage means agents are trusted to build.
- **Validation pass rate** — % of models passing `validate_model` on first check; should rise as magic connector + AI write validation mature.
- **Saved-view and import-preview usage** — repeat-analysis and safe-import behaviors, directly measuring roadmap items 3–4.
- **Local-first retention** — % of users who never create an account but return with a second model; confirms we grew without sacrificing our zero-friction advantage.
- **Enrichment adoption** — number of CSV/Git-repo imports proposing elements that are accepted, for item 5.

Track these per release. If AI acceptance and editor→analysis usage do not move after item 1, the integration is not landing — revisit the resources/prompts (the *knowledge*), not just the tool count.

---

*ArchiMate® is a registered trademark of The Open Group. OpenArch is not affiliated with, endorsed by, or sponsored by The Open Group. ArchiPulse is a project of DisruptiveWorks and is not affiliated with OpenArch. All trademarks belong to their respective owners.*
