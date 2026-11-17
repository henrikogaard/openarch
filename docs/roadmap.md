# OpenArch — Master Plan (v2)

**Date:** 2026-11-17
**Status:** canonical execution plan. Supersedes the roadmap section of
`docs/research-and-plan.md` (which remains the original research record).

---

## 1. Thesis

> **One model, three lenses.**
>
> OpenArch should be the open, file-based architecture workbench that is useful whether you are
> drawing a cloud landing zone on a Tuesday afternoon, exchanging ArchiMate models with Archi on
> Wednesday, or running a TOGAF-governed portfolio on Thursday.

The product must not become three products. The unifying ideas are:

1. **A workspace is the unit of work** — a named, owned, versioned architecture model with a
   purpose, a status, and members.
2. **A domain is the unit of scope** — a business area or segment inside a workspace, so large
   models stay navigable.
3. **A view is a lens** — ArchiMate viewpoint, C4 level, TOGAF ADM artefact, or infrastructure
   topology. Same underlying elements, different presentation.
4. **The model is a file** — AOEF for interchange, native JSON for Git, `.archimate` for Archi
   users. No lock-in, no mandatory server.

---

## 2. Audiences and what "useful" means to each

| Tier | Persona | They arrive with | They need | Success looks like |
|---|---|---|---|---|
| **A. Infrastructure & cloud** | Platform / solution architect, DevOps lead | Terraform, Kubernetes, a cloud account, a blank draw.io | Import reality, see the topology, document environments and integrations, export to docs | A current topology in < 10 minutes, regenerated on change |
| **B. Archi / ArchiMate** | Enterprise or solution architect already using Archi | `.archimate` files, AOEF exports, Git | A free, web-based, standards-correct editor that round-trips with Archi | Open an Archi model, edit it in the browser, export it back without loss |
| **C. TOGAF / enterprise EA** | Chief architect, EA team, governance | ADM phases, capability maps, a portfolio, approvals | Artefacts, portfolio views, baselines, sign-off, reporting, SSO | Governed baseline produced and published without a per-seat licence |

**Design rule:** every feature must serve at least one tier without making another tier worse.
If it only serves Tier C and adds friction to Tier A, it is a plugin or a server-side option.

---

## 3. Core concepts to add

### 3.1 Workspace

The top-level container. Replaces the current "model list" as the primary navigation.

| Field | Purpose |
|---|---|
| `id`, `name` | Identity |
| `description` | One-line summary shown on the card |
| `purpose` | `as-is` · `to-be` · `migration` (badge on the card) |
| `status` | `draft` · `active` · `approved` · `archived` |
| `owner` | Accountable person |
| `tags` | Free-form labels (domain, programme, client) |
| `createdAt`, `updatedAt` | Recency and sorting |
| `members` | Owner / editor / viewer (server mode) |
| `domains` | Registry of areas inside the workspace |
| `baselineId` | Currently approved baseline, if any |

**Operations:** create, open, duplicate, archive, delete, export, import, transfer ownership.

**Multiple workspaces are first-class:** the home screen lists them, search and filter across them,
and the app remembers the last opened workspace. A workspace is one AOEF model plus metadata.

### 3.2 Domain (modelling different areas)

A **domain** is a named area of the architecture inside a workspace — for example *Customer*,
*Payments*, *Data Platform*, *Security*, *Integration*. It is the answer to "we have 800 elements;
where do I start?"

| Field | Purpose |
|---|---|
| `id`, `name`, `description` | Identity |
| `owner` | Domain architect |
| `color` | Visual coding on the canvas and in reports |
| `parentId` | Optional nesting (e.g. *Payments → Cards*) |

**Implementation rules:**

- An element carries a `domain` property (AOEF-safe; survives round-trip).
- A view can be scoped to one or more domains.
- The editor filters by domain; cross-domain relationships are highlighted.
- A **Domain Map** view shows domains as boxes with dependency counts between them.
- Domains are not a second metamodel — they are a partition of the same model.

Architecture *layers* (business, application, technology, data, security) remain ArchiMate
concepts. Domains are business/portfolio segments; layers are architectural aspects. Both are
filters, not separate models.

### 3.3 Environment

`dev` · `staging` · `prod` · custom. Stored as a property, filterable, diffable. Prevents three
drifting copies of the same diagram.

### 3.4 Artefacts

Things that live next to the model:

- **ADR** — context, decision, consequences, status, linked elements.
- **Requirement / principle / constraint** — already ArchiMate elements; add a document view.
- **Assessment** — capability or application scoring (criticality, cost, risk).
- **Baseline** — an immutable snapshot with an approval record.

### 3.5 View presets

A view is defined by `(domain, viewpoint, environment, notation)`:

| Preset family | Examples |
|---|---|
| ArchiMate viewpoints | Organization, Business Process, Application Structure, Technology, Motivation, Migration |
| C4 | Context, Container, Component, Deployment |
| TOGAF ADM | Architecture Vision, Business Architecture, IS Architecture, Technology Architecture, Opportunities & Solutions, Migration Planning |
| Infrastructure | Deployment topology, Network zones, Environment comparison, Integration map |
| Portfolio | Capability map, Application landscape, TIME quadrant, Roadmap |

---

## 4. Information architecture (UX)

```
Home — Workspaces
├── search, filter (purpose, status, owner, tag), sort (recent, name)
├── workspace cards: name · purpose badge · description · counts · updated
└── + New workspace (name, description, purpose, template)

Workspace
├── breadcrumb: Workspaces / <name>
├── domain switcher: All domains · Customer · Payments · + Manage domains
├── tabs
│   ├── Editor            (canvas, palette, magic connector, domain filter)
│   ├── Catalog           (elements, filtered by domain/environment)
│   ├── Dashboard         (counts, validation, domain coverage)
│   ├── EAM views         (capability tree, catalogues, dependency graph)
│   ├── Validation
│   ├── Trace / Impact
│   ├── Matrices
│   ├── Artefacts         (ADRs, requirements, assessments)
│   ├── Collaborate       (comments, baselines, audit)
│   ├── AI
│   └── Settings          (name, purpose, status, owner, members, domains, archive)
└── actions: Save · Export (AOEF/JSON/SVG/PNG/CSV/Mermaid/DOCX) · Share · Baseline
```

A **command palette** (⌘K) searches workspaces, domains, elements, and views.

---

## 5. Data model changes

```ts
interface WorkspaceMeta {
  id: string;
  name: string;
  description: string;
  purpose: 'as-is' | 'to-be' | 'migration';
  status: 'draft' | 'active' | 'approved' | 'archived';
  owner: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  domains: Domain[];
  baselineId?: string;
}

interface Domain {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  color?: string;
  parentId?: string;
}

// Model additions (all optional, all AOEF-safe as properties)
interface Model {
  purpose?: ModelPurpose;
  updatedAt?: string;
  domains?: Domain[];
}

interface ArchiElement {
  domain?: string;        // domain id
  environment?: string;   // dev | staging | prod | custom
}

interface Artefact {
  id: string;
  workspaceId: string;
  kind: 'adr' | 'requirement' | 'principle' | 'assessment';
  title: string;
  body: string;           // Markdown
  status: string;
  elementIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

**Storage:** workspace metadata, domains, and artefacts live in the native JSON document and in
the server workspace record. AOEF export carries domains/environments as properties so other
tools retain the information; AOEF import maps them back.

---

## 6. Feature plan by tier

### Tier A — infrastructure & cloud (project usefulness)

| # | Feature | Detail | Effort |
|---|---|---|---|
| A1 | **IaC import** | Terraform `plan -json` / `show -json`, Kubernetes YAML, docker-compose, CloudFormation → elements + relationships. Deterministic, preview-first, idempotent by resource address. | M |
| A2 | **Environment overlays** | Property + filter + two-environment diff + validation for missing environment. | S–M |
| A3 | **Deployment view** | Generated artifact → node → device → network-zone topology. | M |
| A4 | **Interface & integration catalogue** | Protocol, sync/async, provider, consumer, owner, SLA. | M |
| A5 | **C4 bridge** | Structurizr DSL import/export; C4 → ArchiMate mapping; C4 view presets. | M |
| A6 | **Cloud icon packs** | View styling only, not the metamodel. | S |
| A7 | **Templates** | Landing zone, three-tier app, event-driven, data platform, Kubernetes platform. | S |
| A8 | **ADR log** | Markdown editor, status, element links, repo export. | S |
| A9 | **CI check** | `openarch check --rules`, `diff --fail-on`, PR comment. | S |
| A10 | **Cost/risk annotations** | Cost centre, criticality, data classification; roll-up dashboards. | S |

### Tier B — Archi / ArchiMate depth

| # | Feature | Detail | Effort |
|---|---|---|---|
| B1 | **`.archimate` import/export** | Archi's native ZIP format, for users who never touch AOEF. | M |
| B2 | **ArchiMate 4.0 registry** | Versioned metamodel; 3.2 remains default. | M |
| B3 | **Git sync in the UI** | Wire the existing Git adapter: clone, pull, commit, push, diff. | M |
| B4 | **Model merge & conflict review** | Semantic diff already exists; add three-way merge and accept/reject. | M |
| B5 | **Viewpoint UX** | Create a view from a viewpoint template; filter by layer/aspect. | S–M |
| B6 | **jArchi-style scripting** | Plugin API already exists; add a scripting sandbox and examples. | M |
| B7 | **Archi interoperability tests** | Golden files exported by Archi, imported and re-exported in CI. | S |

### Tier C — TOGAF / enterprise

| # | Feature | Detail | Effort |
|---|---|---|---|
| C1 | **ADM artefact templates** | Architecture Vision, Business/IS/Technology Architecture, Opportunities & Solutions, Migration Planning, Governance. | M |
| C2 | **Capability & value-stream views** | Capability map, value-stream stages, heatmaps. | M |
| C3 | **Portfolio fields** | Owner, lifecycle dates, criticality, cost, vendor; TIME quadrant; obsolescence report. | M |
| C4 | **Governance workflow** | Draft → review → approved; reviewers, sign-off, immutable baselines, waivers. | M–L |
| C5 | **Reporting** | DOCX/PPTX/PDF packs; scheduled Confluence publish. | M |
| C6 | **OIDC/SSO** | Authorization Code + PKCE, group→role mapping, client credentials for MCP. | M |
| C7 | **Jira / Confluence connectors** | Link elements to delivery work; publish views and tables. | M |
| C8 | **Standards packs** | NIST CSF, ISO 27001, DORA, GDPR as requirement templates and validation rules. | M |
| C9 | **ServiceNow CMDB (read-only)** | Enrich from CIs; write back a link. Never replace the CMDB. | L |
| C10 | **SCIM + SIEM export** | Provisioning and audit streaming. | M |

---

## 7. Phased roadmap

| Phase | Theme | Scope | Outcome |
|---|---|---|---|
| **0** ✅ | Foundation | Monorepo, metamodel, AOEF codec, editor, analysis, AI/MCP, server, tests, XSD conformance | Working product, verified interoperability |
| **1** | **Workspaces & domains** | Workspace home, create/duplicate/archive, purpose/status/owner/tags, domain registry, domain filters, workspace settings, breadcrumb, templates gallery, ADR artefacts | Multiple workspaces and large models become navigable |
| **2** | **Project & infrastructure** | IaC import, environments, deployment view, interface catalogue, C4 bridge, cloud icon styling, CI check | A platform team can document a real system in minutes |
| **3** | **Archi/ArchiMate depth** | `.archimate` I/O, ArchiMate 4.0, Git sync UI, merge review, viewpoint UX, scripting | Archi users can adopt it without changing their workflow |
| **4** | **TOGAF & enterprise** | ADM templates, capability/value-stream views, portfolio fields, governance workflow, reporting | An EA team can run a governed baseline |
| **5** | **Scale & ecosystem** | OIDC/SCIM, Jira/Confluence, CMDB read-only, standards packs, multi-workspace portfolio, marketplace | Enterprise deployment and ecosystem |
| **6** | **Trust & daily use** | Autosave, error boundary, version history + restore, conflict UI, E2E tests, i18n completion, accessibility, performance, bundle splitting | A tool people trust with real work every day |
| **7** | **Workflow stickiness** | IaC drift detection, Git-native workspaces, command palette, global search, bulk edit, onboarding, dark mode | A tool people reopen every week |
| **7A** | **Drawing depth** (runs alongside 6–7) | Canvas delete synced to the model, multi-select + bulk assign, copy/paste/duplicate, align/distribute, snap-to-grid, bendpoints, on-canvas labels, containers, z-order, context menu, palette drag-and-drop, presentation mode — see §12 | The canvas feels like a dedicated diagramming tool, not a form |
| **8** | **Enterprise & ecosystem** | OIDC end-to-end, governance UI, DOCX/PPTX/Confluence reporting, Jira/Confluence/CMDB connectors, SCIM, value streams, C4 bridge, ArchiMate 4.0, marketplace | A platform an organisation can standardise on |

Phases 2 and 3 can run in parallel; Phase 4 depends on Phase 1 (workspaces, domains, baselines).
Phases 6, 7, and 7A should run before more Phase 8 breadth: trust, repeat use, and drawing depth
matter more than another connector.

### Implementation status (2026-11-17)

| Phase | Status | Shipped | Still open |
|---|---|---|---|
| **1. Workspaces & domains** | ✅ Done | Workspace home, create/duplicate/archive/delete, purpose/status/owner/tags, templates, deep links, domain registry, element domain/environment, domain filters, domain map, ADR/requirement/principle artefacts, workspace settings, portfolio dashboard, **stakeholder viewpoints with L1–L4 granulation, dependency depth, expandable detail, and configurable attributes** | — |
| **2. Project & infrastructure** | 🟡 Mostly done | Terraform/Kubernetes/docker-compose import, environment overlays, deployment view, interface catalogue, `openarch check`, infrastructure templates | C4/Structurizr bridge, cloud icon packs |
| **3. Archi/ArchiMate depth** | 🟡 Partial | `.archimate` import/export (ZIP), AOEF conformance, viewpoints library | ArchiMate 4.0 registry, Git sync UI, merge review UI, scripting sandbox |
| **4. TOGAF & enterprise** | 🟡 Mostly done | TOGAF Architecture Vision template, capability tree, portfolio fields + TIME, baseline approvals, Markdown/HTML reports, OIDC/RS256 via JWKS, standards packs, SIEM webhook | Value-stream view, DOCX/PPTX/Confluence publishing, Jira/Confluence connectors, CMDB, SCIM |
| **5. Scale & ecosystem** | 🟡 Partial | Cross-workspace portfolio, templates gallery | Marketplace, SCIM, multi-tenant hierarchy |
| **6. Trust & daily use** | 🟡 In progress | Debounced autosave + saved/unsaved badge, per-tab error boundary | Version history, conflict UI, E2E, i18n, accessibility, performance |
| **7. Workflow stickiness** | ⏳ Planned | — | IaC drift, Git-native workspaces, command palette, search, bulk edit, onboarding |
| **7A. Drawing depth** | 🟡 In progress | Canvas delete synced to the model (`onNodesDelete`/`onEdgesDelete` → `removeElements`/`removeRelationships`), multi-select + bulk domain/environment assignment | Copy/paste/duplicate, align/distribute, snap-to-grid, bendpoints, on-canvas labels, containers, z-order, context menu, palette drag-and-drop, presentation mode |
| **8. Enterprise & ecosystem** | ⏳ Planned | — | OIDC end-to-end, governance UI, reporting, connectors, SCIM, value streams, C4, ArchiMate 4.0 |

The remaining items in Phases 2–5 are integration-heavy (external systems) or require a larger
design (ArchiMate 4.0 registry, Git sync UX). Phases 6–8 are specified below.

---

## 8. Phase 1 detail (completed)

**Goal:** the app feels like a workspace product, and large models are navigable.

1. **Workspace home** — card grid with name, purpose badge, description, element/view counts,
   updated date; search, filter, sort; empty state; "New workspace" dialog with template choice.
2. **Workspace shell** — breadcrumb, workspace switcher, settings tab, archive/duplicate/delete.
3. **Workspace metadata** — purpose, status, owner, tags, description; persisted locally and on
   the server; shown on the card and in the top bar.
4. **Domains** — domain registry in settings; assign elements in the inspector; filter the canvas,
   catalogue, dashboard, and matrices by domain; Domain Map view.
5. **Artefacts** — ADR list and editor, linked to elements, exported as Markdown.
6. **Templates** — sample workspaces for the three tiers (ArchiMate starter, cloud landing zone,
   TOGAF Architecture Vision).
7. **Tests** — workspace CRUD, domain filtering, ADR round-trip, UI render tests.

**Definition of done:** a new user can create two workspaces, assign domains, switch between them,
filter by domain, write an ADR, and export AOEF — with all tests green.

---

## 9. Phase 6 detail — trust & daily use (next sprint)

**Goal:** a tool people trust with real work, every day.

1. **Autosave** — debounced save after edits, a saved/unsaved indicator, and recovery on reload.
2. **Error boundary** — a recoverable panel per tab; the model stays in memory.
3. **Version history** — list snapshots, diff, and restore (server mode).
4. **Conflict UI** — on `409`, show theirs vs yours; reload or overwrite deliberately.
5. **Save validation** — run structural validation before save; warn and allow override.
6. **Schema migration** — version the native JSON format and migrate older files on import.
7. **Backup all** — export and import every workspace as one archive.
8. **E2E tests** — Playwright: create workspace → add element → connect → save → export AOEF.
9. **i18n completion** — move every hardcoded workspace/settings string into translations.
10. **Accessibility** — keyboard navigation, focus traps, contrast audit.
11. **Performance** — measure at 2,000+ elements; virtualise tables, memoise canvas nodes.
12. **Bundle splitting** — code-split analysis, AI, and import packages.

**Definition of done:** reloading after edits loses nothing; a thrown component is recoverable; the
E2E suite covers the core flow; the bundle is split; all new strings are translated.

---

## 10. Phase 7 detail — workflow stickiness

**Goal:** a tool people reopen every week.

1. **IaC drift detection** — re-import diff (`+added / ~changed / -removed`), apply or ignore per
   resource, drift badge on the workspace card, and `openarch iac diff --fail-on drift`.
2. **Git-native workspaces** — open a folder or GitHub repo, save
   `architecture/<workspace>.json`, commit/push, and pull with a diff preview.
3. **Command palette** — ⌘K across workspaces, domains, elements, views, and actions.
4. **Global search** — search across every workspace.
5. **Bulk edit** — multi-select, assign domain/environment, add properties.
6. **Drawing polish** — copy/paste/duplicate, align/distribute, snap, bendpoints, on-canvas
   labels, containers, context menu, and keyboard shortcuts.
7. **Onboarding** — a guided first model, sample gallery, and template preview.
8. **Dark mode and density controls.**

**Definition of done:** a platform team can re-import a Terraform plan, review drift, and commit
the updated model without leaving the app.

---

## 11. Phase 8 detail — enterprise & ecosystem

**Goal:** a platform an organisation can standardise on.

1. **OIDC end-to-end** — Keycloak/Entra, group→role mapping, member-management UI.
2. **Governance UI** — approval inbox, baseline diff, immutable approved baselines, waivers.
3. **Reporting** — DOCX/PPTX packs, Confluence publish, scheduled PDF.
4. **Connectors** — Jira, Confluence, ServiceNow CMDB (read-only).
5. **SCIM** — automated user and group provisioning.
6. **Value-stream view** — stages and the capabilities that support them.
7. **C4/Structurizr bridge** — import/export DSL and C4 view presets.
8. **ArchiMate 4.0 registry** — versioned alongside 3.2, with migration.
9. **Marketplace / template gallery** — only after adoption.

**Definition of done:** an EA team can deploy with SSO, approve a baseline, publish a report, and
link elements to delivery work.

---

## 12. Phase 7A detail — drawing depth (active priority)

**Goal:** the canvas feels like a dedicated diagramming tool. The status document
(`docs/status-2026-11-17.md` §3.A) calls this the biggest remaining gap: the biggest gap is no
longer features — it is drawing depth.

Already shipped on `feat/drawing-depth-trust`:

1. **Delete synced to the model** — `onNodesDelete`/`onEdgesDelete` resolve node/edge ids to
   element/relationship refs and remove them via `removeElements`/`removeRelationships`
   (`packages/core/src/workspace.ts`), which also prune view nodes/edges, touching relationships,
   and artefact links. Regression tests in `workspace-editing.test.ts`.
2. **Multi-select + bulk actions** — Shift-click multi-select, Delete/Backspace removes the
   selection, and a selection bar bulk-assigns domain/environment to all selected elements.
3. **Autosave** — debounced save 1.5 s after the last edit, saved/unsaved badge in the top bar
   (Phase 6 item 1).
4. **Error boundary per tab** — a render error shows a recoverable panel; the model stays in
   memory (Phase 6 item 2).

Remaining, in order:

5. Copy/paste/duplicate (clipboard of element subgraphs, including internal relationships).
6. Align/distribute (left/center/right/top/middle/bottom, horizontal/vertical distribute).
7. Snap-to-grid + alignment guides while dragging.
8. Edge bendpoints and reconnection (drag edge ends to another node).
9. On-canvas label editing (double-click to rename).
10. Containers/nested nodes, z-order controls (bring forward/send backward).
11. Context menu + keyboard shortcuts (documented); drag-and-drop from the palette onto the canvas.
12. Comments anchored to elements; presentation mode for sharing a view.

**Definition of done:** a new user can create a workspace, draw and connect elements, delete them,
bulk-assign a domain, reload without losing work, and export a valid AOEF file — with an E2E test
proving it, and the diagram survives a round-trip looking the way the user left it.

---

## 13. Compatibility strategy

| Concern | Decision |
|---|---|
| AOEF fidelity | Domains, environments, purpose are stored as AOEF properties (or model metadata) and survive round-trip. The XSD conformance suite remains the gate. |
| Archi users | `.archimate` import/export in Phase 3; until then, AOEF is the bridge. |
| TOGAF users | Artefacts and views are templates over the same model, not a separate metamodel. |
| Cloud users | Cloud icons are a view style; the underlying model stays ArchiMate (Node, Device, SystemSoftware, Artifact, CommunicationNetwork). |
| Local-first | Workspace metadata lives in IndexedDB and native JSON; the server adds sharing, not a requirement. |
| AI agents | Workspace and domain become first-class MCP resources (`openarch://workspace/{id}`, `openarch://domain/{id}`) and tool parameters. |

---

## 14. Success metrics

| Tier | Metric | Target |
|---|---|---|
| A | Time to first topology from IaC | < 10 minutes |
| A | New workspaces seeded from IaC | > 30% |
| A | Repos running `openarch check` | > 20% of active users |
| B | AOEF round-trip conformance | 100% in CI |
| B | Archi model import success | > 95% of test corpus |
| B | Weekly AOEF exports | Growing month over month |
| C | Workspaces per organisation | > 5 |
| C | Approval cycle time | Down 30% after governance ships |
| C | Enterprise deployments with OIDC | 3 design partners |
| All | Weekly active workspaces | Growth after each phase |

---

## 15. Risks and decisions

| Risk | Mitigation |
|---|---|
| **Three audiences pull the product apart** | One model, three lenses. Tier-specific features are templates, views, or server options — never forked metamodels. |
| **Workspace vs model ambiguity** | A workspace *is* one model plus metadata. Portfolio aggregation across workspaces is read-only and later. |
| **Domains become a second metamodel** | Domains are a property + registry, not element types. |
| **AOEF compatibility vs rich metadata** | Rich metadata in native JSON; only AOEF-safe properties cross the boundary. |
| **Scope creep into CMDB/ITSM** | Integrate read-only; never replace ServiceNow. |
| **Real-time collaboration** | Not planned. Async collaboration + optimistic locking + baselines covers the target teams. |
| **Performance on large models** | Domain filtering, view scoping, and virtualised lists; measure at 2,000+ elements. |

---

## 16. Immediate backlog

| Order | Item | Phase | Status |
|---|---|---|---|
| 1 | Workspace home + create dialog | 1 | ✅ |
| 2 | Workspace settings (purpose, status, owner, tags) | 1 | ✅ |
| 3 | Domain registry + element assignment + filters | 1 | ✅ |
| 4 | Domain Map view | 1 | ✅ |
| 5 | ADR artefacts | 1 | ✅ |
| 6 | Templates gallery | 1 | ✅ |
| 7 | Workspace CRUD tests + UI tests | 1 | ✅ |
| 8 | IaC import (Terraform + Kubernetes + compose) | 2 | ✅ |
| 9 | Environment overlays | 2 | ✅ |
| 10 | `openarch check` + PR workflow | 2 | ✅ |
| 11 | Canvas delete synced to model + multi-select bulk assign | 7A | ✅ `feat/drawing-depth-trust` |
| 12 | Autosave + saved/unsaved badge + per-tab error boundary | 6 | ✅ `feat/drawing-depth-trust` |
| 13 | Playwright E2E: create → add → connect → bulk-assign → delete → reload → export AOEF | 6/7A | ✅ `e2e/smoke.spec.ts`, runs in CI |
| 14 | Drawing polish: copy/paste, align/distribute, snap, bendpoints, on-canvas labels | 7A | Next |
| 15 | Containers, z-order, context menu, palette drag-and-drop, presentation mode | 7A | Later |
| 16 | C4 / Structurizr bridge | 2 | Next |
| 17 | ArchiMate 4.0 registry | 3 | Next |
| 18 | Git sync UI (clone/pull/commit/push) | 3 | Next |
| 19 | Value-stream view | 4 | Next |
| 20 | DOCX/PPTX and Confluence publishing | 4 | Later |
| 21 | Jira / Confluence / ServiceNow connectors | 4–5 | Later |

---

*ArchiMate® is a registered trademark of The Open Group. OpenArch is not affiliated with,
endorsed by, or certified by The Open Group.*
