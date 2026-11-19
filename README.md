<div align="center">

# OpenArch

**Open-source, browser-based ArchiMate® 3.2 modelling — local-first, Git-friendly, AI-operable.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![ArchiMate 3.2](https://img.shields.io/badge/ArchiMate-3.2-orange.svg)](https://www.opengroup.org/archimate-forum)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.base.json)
[![Node 22+](https://img.shields.io/badge/node-22%2B-339933.svg)](https://nodejs.org)

[Quick start](#quick-start) · [AI agents](#ai-agents-mcp) · [Interoperability](#interoperability) · [Architecture](#architecture) · [Docs](docs/)

</div>

> ArchiMate® is a registered trademark of The Open Group. OpenArch is independent and is not
> affiliated with, endorsed by, or certified by The Open Group.

---

## Why OpenArch

Enterprise-architecture tools are either **expensive per-seat platforms** or **desktop
applications**. OpenArch is neither: it is a complete ArchiMate editor that runs in the browser,
works offline with no account, stores models as files you can commit to Git, and exposes the
model to AI agents through MCP.

- **A real editor, not a viewer** — 64 element types, 11 relationship types, 23 viewpoints,
  a metamodel-aware "magic connector", multiple views, layer filters, and undo/redo.
- **Enterprise views with granulation** — stakeholder viewpoints (CIO, enterprise, solution,
  platform, security…), L1–L4 detail levels, dependency depth, expandable servers-behind-apps
  detail, and configurable attributes such as version, IP, owner, and environment.
- **Local-first by default** — models live in IndexedDB or a file you own. No sign-up, no
  telemetry, no server required.
- **Interoperable, and proven** — every export is validated against the official Open Group
  `archimate3_Diagram.xsd` in CI, including models created in the app.
- **AI-operable** — a 38-tool MCP server, resources, prompts, and write-time validation let an
  agent build or edit a model that a human then opens in a first-class editor.
- **Self-hostable** — one Docker image adds collaboration: optimistic locking, comments,
  baselines, audit log, and owner/editor/viewer roles.

## Features

| Area | What you get |
|---|---|
| **Workspaces** | Workspace home with purpose (`AS-IS`/`TO-BE`/`MIGRATION`), status, owner, tags, search/filter/sort · create, duplicate, archive, delete · templates · deep links (`?workspace=<id>`) |
| **Domains** | Partition a large model into areas (Customer, Payments, Platform…) · assign in the inspector · filter the editor, catalogue, dashboard, and matrices · domain dependency map |
| **Views & viewpoints** | Stakeholder viewpoints (CIO, enterprise, solution, platform, security…) · **L1–L4 granulation** · dependency depth · expandable lower-level detail (servers behind applications) · configurable attributes (version, IP, owner, environment) · grouped, regenerable views |
| **Editor** | Searchable layer-grouped palette · magic connector · multiple views · layer and environment filters · inline inspector (name, documentation, properties, domain, environment) · undo/redo · SVG/PNG export |
| **Analysis** | Element catalogue · live dashboard · validation panel · traceability & impact explorer · matrix views · EAM views (capability tree, application/technology catalogues, dependency graph) · deployment topology · interface & integration catalogue |
| **Interchange** | AOEF import/export (XSD-validated) · Archi native `.archimate` import/export · Git-friendly native JSON · CSV · Mermaid · read-only share links |
| **Infrastructure** | Import Terraform plan JSON, Kubernetes manifests, and docker-compose into ArchiMate Nodes, System Software, Artifacts, and networks · environment overlays · deterministic and idempotent |
| **Collaboration** | Self-hosted server with optimistic locking, comments, baselines, audit log, saved views, member-scoped RBAC, semantic-diff import preview, and baseline approvals |
| **Portfolio** | Cross-workspace dashboard · status/purpose breakdown · TIME quadrant for applications · workspace table · Markdown/HTML reports |
| **Governance** | ADRs, requirements, principles, and assessments linked to elements · workspace validation rules · `openarch check` for CI · standards packs (NIST CSF, ISO 27001, DORA, GDPR) |
| **AI** | MCP server (38 tools, resources, prompts, structured output) · in-app AI panel · server AI endpoints · `aoef://` resource aliases for compatibility |
| **Identity** | Optional static tokens, HS256 JWTs, or OIDC/RS256 via JWKS discovery · owner/editor/viewer roles · SIEM audit webhook |
| **Platform** | Plugin API · headless CLI · English/Norwegian UI · Docker Compose · zero runtime vulnerabilities |

## Quick start

Requires **Node.js 22+**.

### Local-first (no server)

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. A sample model is seeded on first run. Everything is stored in your
browser; use **Import** / **Export AOEF** to move files.

### Self-hosted server

```bash
npm run build
npm run dev:server
```

Open <http://localhost:8080>. The server serves the built web app and the REST API, and persists
to `data/models.json` by default.

### Docker

```bash
docker compose up --build
```

The app and API are available at <http://localhost:8080>, with data in the `openarch-data` volume.

## AI agents (MCP)

OpenArch ships a Model Context Protocol server (spec `2025-06-18`) over stdio.

```bash
npm run mcp
```

It exposes **38 tools** (model, element, relationship and view CRUD; search, validation,
traceability, matrices, EAM views; AOEF export/preview/apply; `create_model_from_spec`;
enrichment), plus resources (`aoef://format-guide`, `aoef://metamodel`, `aoef://viewpoints`,
`openarch://context/{modelId}`) and five reusable prompts.

Point an MCP client at it:

```json
{
  "mcpServers": {
    "openarch": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/openarch/apps/mcp/src/index.ts"],
      "env": {
        "OPENARCH_API_URL": "http://localhost:8080/api",
        "OPENARCH_TOKEN": "your-token-if-auth-is-enabled"
      }
    }
  }
}
```

Backends, selected by environment:

| Mode | Variables | Behaviour |
|---|---|---|
| Server | `OPENARCH_API_URL` (+ `OPENARCH_TOKEN`) | Operates on the **same workspaces as the web app** |
| File | `OPENARCH_MODEL_FILE` | Works on a single AOEF `.xml` or native `.json` file |
| Memory | *(none)* | Seeds the sample model; changes are discarded on exit |

Every AI write is checked against the ArchiMate 3.2 metamodel before it is saved — illegal
relationships are rejected with suggestions. Model text returned to agents is prefixed with an
untrusted-content warning, and tool calls are logged to stderr.

## Interoperability

The AOEF codec is tested against the official Open Group schemas, not just against itself:

- models **created in the app** export valid XML (namespaces declared),
- **ad-hoc properties** produce a `propertyDefinition` and a valid `propertyReference`,
- **deletions** of nodes, views, or relationships are honoured on export,
- **round-trips** of The Open Group's ArchiSurance example preserve properties and layout,
- **negative canvas coordinates** are clamped to the schema's `nonNegativeInteger`.

Run `npm test` to execute the conformance suite (uses `xmllint`; skipped if unavailable).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Web app in local-first mode (`:5173`) |
| `npm run dev:server` | API + hosted web app (`:8080`) |
| `npm run build` | Production web build + server typecheck |
| `npm run typecheck` | Typecheck the whole monorepo |
| `npm test` | Run all tests (unit, XSD conformance, server integration, UI) |
| `npm run test:watch` | Watch mode |
| `npm run cli -- <cmd>` | Headless CLI (see below) |
| `npm run mcp` | MCP stdio server |

### CLI

```bash
npm run cli -- validate examples/archisurance.xml
npm run cli -- list examples/archisurance.xml
npm run cli -- convert examples/archisurance.xml model.json
npm run cli -- convert examples/archisurance.xml model.archimate
npm run cli -- check model.xml                          # default rules; exit 1 on errors
npm run cli -- check model.xml architecture-rules.json  # custom rules
npm run cli -- report model.xml report.md
npm run cli -- diff before.xml after.xml
npm run cli -- doctor
```

## Configuration

### Web build

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8080/api` | Server endpoint used in **Server** mode |

### Server

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `OPENARCH_DATA` | `data/models.json` | Persistence file |
| `OPENARCH_REQUIRE_AUTH` | `false` | Require a bearer token |
| `OPENARCH_TOKENS` | — | JSON map of static tokens, e.g. `{"token":{"subject":"alice"}}` |
| `OPENARCH_JWT_SECRET` | — | Accept HS256 JWTs with a `sub` claim |
| `OPENARCH_OIDC_ISSUER` | — | OIDC issuer for discovery, e.g. `https://login.microsoftonline.com/<tenant>/v2.0` |
| `OPENARCH_OIDC_AUDIENCE` | — | Expected `aud` claim |
| `OPENARCH_OIDC_JWKS_URL` | discovered | Override the JWKS endpoint |
| `OPENARCH_ADMIN` | first static token | Bootstrap owner of seeded workspaces |
| `OPENARCH_AUDIT_WEBHOOK` | — | POST every audit event to this URL (SIEM) |

With auth enabled, reads are **member-scoped**: a user who is not a member of a workspace cannot
list or read it. Saves use optimistic locking (`If-Match`); a stale write returns `409`.

## Architecture

```
packages/core         types, metamodel, viewpoints, workspaces/domains, templates,
                      AOEF codec, validation, analysis, diff, plugins
packages/ai           LLM context, prompts, guardrails
packages/enrichment   CSV / Git-file adapters, deterministic element & relationship proposals
packages/iac          Terraform, Kubernetes, docker-compose importers
packages/archi        Archi native .archimate import/export
packages/reporting    Markdown/HTML reports, CI rule engine, standards packs
packages/repository   ModelRepository + Local / Server / Git adapters, share links
packages/exporters    SVG, PNG, CSV, Mermaid
apps/web              React + XYFlow editor, workspace home, domains, analysis, AI panel
apps/server           Fastify API, collaboration, governance, auth/RBAC, persistence
apps/cli              Headless validate / list / convert / diff / check / report
apps/mcp              MCP stdio server (38 tools, resources, prompts)
examples/             Open Group ArchiSurance example model (test fixture)
test/fixtures/xsd/    Official Open Group schemas used for conformance testing
docs/                 Roadmap, research, comparison, code review, ADRs, user guide
```

**Design rule:** one canonical model store; views are projections that reference elements by ID.
The editor, catalogue, analysis views, AI tools, and exporters all read and write the same data,
whether it lives in IndexedDB, a file, or the server.

## Testing

```bash
npm test
```

135 tests covering XSD schema conformance, AOEF regressions, the full metamodel, workspaces and
domains, stakeholder viewpoints and L1–L4 granulation, analysis, diffing, plugins, enrichment, IaC
import, Archi `.archimate` round-trips, reporting and rules, share links, auth (static tokens,
HS256 and OIDC), server integration (401/403/409, saved views, import preview/apply, approvals),
and UI rendering.

## Status

Phase 0 is implemented, reviewed, and verified. The forward plan is in
[`docs/roadmap.md`](docs/roadmap.md) — workspaces, domains, infrastructure modelling, Archi
interoperability, and TOGAF/enterprise features.

- [`AGENTS.md`](AGENTS.md) — **handoff for the next agent** (state, invariants, gotchas, first task)
- [`docs/status-2026-11-17.md`](docs/status-2026-11-17.md) — current status, caveats, gaps, next sprint
- [`docs/roadmap.md`](docs/roadmap.md) — **canonical master plan (v2)**
- [`docs/next-improvements.md`](docs/next-improvements.md) — prioritised improvement assessment
- [`docs/enterprise-and-project-use.md`](docs/enterprise-and-project-use.md) — enterprise and infrastructure opportunity assessment
- [`docs/research-and-plan.md`](docs/research-and-plan.md) — original research and product plan
- [`docs/comparison-and-usefulness.md`](docs/comparison-and-usefulness.md) — comparison with ArchiPulse and AI strategy
- [`docs/code-review.md`](docs/code-review.md) — review findings, fixes, and remaining gaps
- [`docs/user-guide.md`](docs/user-guide.md) — how to use the app
- [`docs/adr/`](docs/adr/) — architecture decision records

Deliberate non-goals: hosted SaaS, a SQL-table projection of the store, and SaaS connectors.
Known gaps: interactive canvas E2E tests, drawing-depth polish, OIDC end-to-end testing, Git sync
UI, C4 bridge, ArchiMate 4.0, connectors, SCIM, and Helm packaging.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

```bash
npm run typecheck && npm test && npm run build
```

Please keep the AOEF conformance tests green — interoperability is the point of the project.

## License

[MIT](LICENSE) © 2026 Henrik Øgård

## Self-hosting

```bash
docker build -t openarch .
docker run -p 8080:8080 -v openarch-data:/app/data openarch
# or with everything incl. Keycloak for live OIDC testing:
docker compose --profile keycloak up
```

Configuration (auth, CORS, SCIM, org scoping) is documented in `.env.example`.

## Documentation site

`docs/` render to a single-page site (zero dependencies):

```bash
npm run docs:build          # -> site-dist/index.html
```

CI publishes it to GitHub Pages on every push to `main` (`.github/workflows/docs.yml`).

## Scheduled publishing

Publish a workspace report to Confluence from cron:

```bash
npx openarch publish-confluence model.xml \
  --url https://company.atlassian.net/wiki --space ARCH \
  --email me@company.com --token "$CONFLUENCE_TOKEN"
```

For live OIDC verification against a real Keycloak (compose profile above):

```bash
OPENARCH_OIDC_LIVE_ISSUER=http://localhost:8180/realms/openarch \
OPENARCH_OIDC_LIVE_TOKEN=<access-token> npx vitest run apps/server/src/oidc.live.test.ts
```
