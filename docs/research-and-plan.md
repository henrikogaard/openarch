# OpenArch — Research & Product Plan

> **Superseded for execution by [`docs/roadmap.md`](roadmap.md) (Master Plan v2).**
> This document remains the original research record and rationale.

**Status:** draft for discussion
**Date:** 2026-11-17
**Repo:** `openarch` (MIT licensed, empty apart from LICENSE/README)

---

## 0. Decisions made (2026-11-17)

| Decision | Choice | Consequence |
|---|---|---|
| Project direction | **New standalone project** (not an ArchiPulse fork) | We own the architecture; borrow ideas/code from ArchiPulse where permitted (Apache-2.0 → keep attribution). |
| Frontend | **React + TypeScript + XYFlow** | Use XYFlow for the canvas, Zustand + command pattern for editor state. |
| Storage | **Local-first AND optional server, in parallel** | Define a `ModelRepository` interface on day 1; implement `LocalRepository` (IndexedDB + files) and `ServerRepository` (HTTP + DB) behind it. One frontend, two backends. |
| First release (v0.1) | **Full platform outline** (thin vertical slice across editor + repository + analysis) | Not just an editor. v0.1 must demonstrate all three layers working end-to-end with a small subset of the domain, then fill in breadth. |

---

## 1. The short version

"ArchiMate" is two things:

1. **A modeling language** — the Open Group's ArchiMate® standard (currently 3.2 widely deployed, 4.0 emerging). It defines ~60 element types, ~15 relationship types, layers, aspects, and viewpoints.
2. **A category of tools** — editors/repositories that implement that language. The best-known free one, **Archi**, is a desktop app.

Your goal — **web-based + open source + free** — sits in a genuine gap today:

| Need | Existing answer | Gap |
|---|---|---|
| Free open-source authoring tool | Archi (desktop, Eclipse/Java) | Not web-based |
| Browser-based editor | Arkidor, Visual Paradigm Online, ArchiModel.net | Closed source, cloud-hosted, or limited |
| Open-source web platform | ArchiPulse (Go/Svelte, Apache-2.0) | Repository + viewer + light editor, not a full diagramming editor |
| Open interchange | ArchiMate Open Exchange Format (AOEF), an Open Group standard | Widely supported, so interoperability is achievable |

**Recommended positioning:** a local-first, self-hostable, open-source ArchiMate editor that reads/writes AOEF natively, stores models in a Git-friendly text format, and works offline — i.e. "Archi, in the browser, with Git and no lock-in." That is not what any of the tools above fully deliver.

---

## 2. What exists today (research)

### 2.1 Authoring tools

| Tool | Web? | License / cost | Notes |
|---|---|---|---|
| **Archi** (archimatetool/archi) | No (desktop, Win/Mac/Linux) | Free, open source (EPL/GPL-style) | The reference free tool. Archi 5.11 (Nov 2026) supports ArchiMate 3.2. Has `coArchi` plugin for Git collaboration and `jArchi` scripting. Strong plugin ecosystem. |
| **Arkidor** (arkidor.io) | Yes (cloud-hosted static app, data stays in browser) | Free, **proprietary** | Supports ArchiMate 3.2 and 4.0, AOEF import/export, SVG/PNG export, shareable URLs, no registration. Closest to your idea but not open source. Good product reference for UX and positioning. |
| **Visual Paradigm Online** | Yes (cloud/SaaS) | Freemium | Certified tool, many templates; free tier is limited, not open source. |
| **ArchiModel.net** | Yes | Free (likely closed source) | Smaller tool, mentioned in bpmn.io forum; frequent releases claimed. |
| **`@peter.prib/renderengine`** (npm) | Yes (browser library) | Check package license | "ArchiMate modeller, diagram editor and chart library for the browser, with no runtime dependencies." Potentially useful as a rendering reference/component. |
| **bigArchiMate** (borkdominik) | Web-capable (Eclipse Theia) | Open source | Hybrid textual + graphical modeling using GLSP. Academic/research angle, heavy stack. |
| **sysdesign** (g-obare13) | Yes | Open source | General architecture diagram tool built on React Flow; useful as an implementation reference, not ArchiMate-specific. |
| **Modelio** | No (desktop) | Free, open source | UML/BPMN tool with ArchiMate module, XMI import/export. |
| **BiZZdesign / ADOIT / Sparx EA / LeanIX / Ready! API etc.** | Mostly web | Commercial, per-seat | The expensive incumbents Arkidor and ArchiPulse position against. |

### 2.2 Repositories, viewers, analysis

| Tool | License | Notes |
|---|---|---|
| **ArchiPulse** (DisruptiveWorks) | Apache-2.0 | Self-hosted web platform: maps AOEF directly to PostgreSQL tables, collaborative workspaces, optimistic locking, semantic diff on import, static viewer, graph explorer (Cytoscape.js), EAM analytical views, CLI, MCP server for AI agents, Svelte 5 + Vite 6 frontend, Docker Compose. **This is the closest open-source project to your idea** — but it is primarily a repository/analysis layer, with only a light web model editor. Worth studying and possibly contributing to instead of forking from scratch. |
| **coArchi** (Archi plugin) | Open source | Git-based collaboration for desktop Archi — validates the "Git as collaboration backbone" idea. |
| **Open Group ArchiMate forum / reference cards / ArchiSurance & ArchiMetal example models** | Public standards material | Free examples and notation reference cards to seed your test fixtures and sample models. |

### 2.3 Diagramming engine candidates

| Library | License | Fit |
|---|---|---|
| **React Flow / XYFlow** (xyflow/xyflow, ~39k stars) | MIT | Strong default: custom nodes/edges, pan/zoom, minimap, controls, selection, undo helpers via state libs. Active and huge community. |
| **Svelte Flow** (@xyflow/svelte) | MIT | Same engine for Svelte. |
| **JointJS** (clientIO/joint) | MPL-2.0 (community edition) | Mature SVG diagram engine, good for nested/grouped shapes and connectors; more "batteries included" but heavier API. |
| **diagram-js** (bpmn.io) | bpmn.io license (open source, permissive-ish) | Excellent editor primitives (modeling, snapping, rules engine). Used in Camunda Modeler; ArchiMate would need custom element definitions. The bpmn.io forum has ArchiMate discussion. |
| **GoJS** | Commercial | Powerful but not free for your use case — exclude. |
| **Custom SVG + renderengine** | Varies | Full control over exact ArchiMate notation; more work. |

**Recommendation:** React Flow (or Svelte Flow if you prefer Svelte) for the canvas, plus your own small SVG shape layer that renders the official ArchiMate notation (layer color, corner style, letter badge, top-right glyph). Own the shape rendering yourself so notation correctness is under your control.

---

## 3. Standards you need to know

### 3.1 ArchiMate language essentials

- **Concepts = Elements + Relationships.** Elements are Structure / Behavior / Motivation / Composite (abstract categories are not directly drawable).
- **Full framework** extends the core **3 layers × 3 aspects** matrix:

| Aspect | Business (yellow) | Application (blue) | Technology (green) |
|---|---|---|---|
| Active structure | Business actor, role, collaboration, component… | Application component, collaboration, interface… | Node, device, system software… |
| Behavior | Business process, function, service, event, interaction… | Application process, function, service, event, interaction… | Technology process, function, service, event… |
| Passive structure | Business object | Data object | Artifact |

- **Extensions:** Strategy layer (capability, resource, course of action, value stream), Physical layer (facility, equipment, material, distribution network), Motivation aspect (stakeholder, driver, goal, outcome, principle, requirement, constraint, meaning, value, assessment), Implementation & Migration (work package, deliverable, plateau, gap).
- **Core relationships** (~15, grouped): structural (composition, aggregation), dependency (serving, access, realization, influence, association), dynamic (triggering, flow), other (specialization, junction), plus assignment and others.
- **Notation:** color = layer, corner style = structure/behavior/motivation, top-left letter = layer badge, icon = element type; nesting is shorthand for composition/assignment.
- **Viewpoints:** the standard defines ~23 viewpoints (stakeholder-oriented selections of elements + relationships). You don't need all at MVP, but a viewpoint store is a useful feature.

**Version note:** 3.2 is the version with broad tool support (Archi, ArchiPulse). 4.0 support is emerging (Arkidor claims 3.2 + 4.0 with migration). Decide early whether to target 3.2 first with a pluggable metamodel version, or 4.0 directly.

### 3.2 Interchange format

- **ArchiMate Open Exchange Format (AOEF)** — the Open Group XML format, XSD-validated. Both Archi and ArchiPulse import/export it. This is your non-negotiable interoperability target: **import and export AOEF with round-trip fidelity** (stable IDs, relationships, view layouts, properties).
- Also consider **CSV** for catalog workflows and **SVG/PNG/PDF** for publication.
- `.archimate` (Archi native ZIP format) is on many backlogs — possible later via community contribution.

### 3.3 Legal / naming

- **ArchiMate® is a registered trademark of The Open Group.** Use it only descriptively ("an ArchiMate® modeling tool"), include a disclaimer, and do not claim certification. `openarch` as a product name is safer than anything like "OpenArchiMate".
- Existing repos use MIT (yours), Apache-2.0 (ArchiPulse), EPL-style (Archi). MIT is fine and maximally permissive.

---

## 4. Product definition

### 4.1 Vision statement (proposed)

> An open-source, browser-based ArchiMate® modeling tool that is free forever, works offline, keeps models in Git-friendly files, and round-trips with the Open Exchange Format — so architects and developers can model together without per-seat licenses or vendor lock-in.

### 4.2 Target users

1. **Solution architects** who need fast sketches with correct notation (Arkidor's core audience).
2. **Small teams / growing companies** who can't justify €800+/seat enterprise tooling.
3. **Enterprise EA teams** who want a free companion tool for solution-level modeling that imports/exports AOEF to their governed repository.
4. **Educators / students / open-source contributors** learning enterprise architecture.

### 4.3 Differentiators (your "why another one")

- **Actually open source** (not just free SaaS like Arkidor).
- **Local-first & offline**: models live in your browser/file system first; no account required; no server needed for solo use.
- **Git-native**: human-readable text format (YAML or JSON) that diffs cleanly in Git, plus AOEF for interchange. coArchi proved teams want this.
- **Self-hostable collaboration**: optional lightweight sync server (or use Git/CRDT) for teams that want shared workspaces.
- **Standards-first**: AOEF round-trip, metamodel-versioned, notation-correct rendering, relationship-rule validation.
- **Extensible**: plugin API for custom element types, properties, views, and exports.

---

## 5. Feature plan (prioritized)

Legend: **P0** = MVP, **P1** = next, **P2** = later, **P3** = nice-to-have.

### 5.1 Core editor — P0

- [ ] Canvas: pan, zoom (wheel + controls), minimap, fit-to-view, grid/snap, rulers
- [ ] Palette organized by **layer → aspect → type** with search ("magic connector" style type-ahead recommended)
- [ ] Drag-and-drop element creation; click-to-place alternative
- [ ] Custom SVG shapes rendering official notation (layer colors, corner styles, letter badges, glyphs)
- [ ] Element labels editable inline; resize; ellipsis handling
- [ ] Connections: create by dragging from ports; **magic connector** that suggests valid relationship types based on source/target (major UX win — Archi's signature feature)
- [ ] Connection routing: orthogonal/straight/curved, waypoints, re-routing on move, label placement
- [ ] Nested/grouping shapes (composition/assignment shorthand), z-order, alignment guides
- [ ] Multi-select, marquee select, copy/paste/duplicate, delete, keyboard shortcuts
- [ ] Undo/redo (command pattern)
- [ ] Multiple views/diagrams per model; folder tree in sidebar to organize models/views
- [ ] Inspector panel: name, documentation/description, layer/type (read-only after create), custom properties (key/value with typed values)
- [ ] Auto-save to local storage / IndexedDB; explicit Save As / Open file
- [ ] Keyboard accessibility basics and ARIA labels on controls

### 5.2 Model correctness & structure — P0/P1

- [ ] Metamodel registry with **allowed relationship rules** (source type × relationship × target type) — load from versioned definition (3.2 first, pluggable for 4.0)
- [ ] Validation panel: illegal relationships, missing labels, orphan elements, duplicate names; click-to-fix
- [ ] Viewpoints: create/store views based on predefined viewpoint templates (start with ~6: business process, application landscape, technology, motivation, realization, migration)
- [ ] Derived views: "show all elements related to X" / neighborhood exploration
- [ ] Layer/aspect filter toggles to fade or hide layers in a view

### 5.3 Import / export / storage — P0/P1

- [ ] **AOEF import/export** with XSD validation and round-trip stability (P0 — differentiator and compatibility gate)
- [ ] Native Git-friendly text format (YAML or JSON) with stable IDs (P0/P1 — your unique selling point)
- [ ] SVG and PNG export (per view and whole model) — P1
- [ ] PDF export — P1/P2
- [ ] CSV export of element/relationship catalogs — P2
- [ ] Mermaid / Graphviz export as a "text diagram" option — P3
- [ ] Model templates & examples (ArchiSurance, ArchiMetal — public Open Group examples) for onboarding — P1

### 5.4 Collaboration — P1/P2

- [ ] Shareable read-only view links (URL-encoded or snapshot ID) — P1, cheap and high value
- [ ] Optional self-hosted sync server: workspaces, users, roles, changes feed — P2
- [ ] Optimistic locking + semantic diff on merge (learn from ArchiPulse) — P2
- [ ] Git backend adapter (commit/push/pull native format) — P2/P3; or CRDT-based realtime editing — P3 (high complexity)
- [ ] Comments / annotations on elements — P2

### 5.5 Analysis & reporting — P2/P3

- [ ] Search across elements (name, docs, properties) with "go to in view"
- [ ] Catalog/table views: elements, relationships, applications, interfaces
- [ ] Traceability: "what realizes/implements/influences this element?" upstream/downstream navigation
- [ ] Impact analysis: highlight all elements reachable from an element via selected relationships
- [ ] Dashboards: counts by layer/type, lifecycle/criticality properties, gap analysis
- [ ] Matrix views: capability ↔ application, process ↔ application, app ↔ technology
- [ ] Validation rules as configurable governance policies per workspace

### 5.6 Platform / extensibility — P2/P3

- [ ] Plugin API: custom shapes, property schemas, validators, import/export adapters, viewpoints
- [ ] CLI for headless import/export/validate/CI checks (e.g., `openarch validate model.yml`)
- [ ] MCP server / AI-assisted modeling (generate or extend models from natural language) — trend in the space (ArchiPulse already ships one)
- [ ] i18n (start with English; structure for translations)
- [ ] Dark/light theme, customizable palettes
- [ ] Accessibility audit and full keyboard navigation

### 5.7 Explicitly out of scope (at least initially)

- Full TOGAF/BPMN/UML modeling — stay focused on ArchiMate.
- Realtime multi-cursor collaborative editing (very high complexity; ship async collaboration first).
- Certified Open Group tooling (expensive and slow).
- Billing/accounts for the core product (keep it free and anonymous).

---

## 6. Technical architecture recommendation

### 6.1 Stack

| Layer | Recommendation | Rationale |
|---|---|---|
| UI | **React + TypeScript + Vite** (or Svelte 5 + Vite if preferred) | Fast, huge ecosystem; React Flow is React-first. Svelte would align with ArchiPulse and is leaner. |
| Canvas | **React Flow / XYFlow (MIT)** + custom SVG shape components | Mature, MIT-licensed, actively maintained; full control over notation via custom nodes/edges. |
| State | Zustand or XState for editor state; command pattern for undo/redo | Simple, testable; XState if workflows get complex. |
| Persistence | Local-first: **IndexedDB** (Dexie) + File System Access API where available; YAML/JSON project files; optional backend later | No account required; offline-first; Git-friendly. |
| Backend (optional, phase 2) | Node/TypeScript (Fastify) + SQLite/Postgres, or reuse ArchiPulse's API | Keeps one language; ArchiPulse already solves collaborative repository if you'd rather integrate. |
| Validation | JSON Schema / Zod for config; XSD-based checks for AOEF; rule engine for relationships | Deterministic, testable rules. |
| Export | Client-side SVG serialization + `svg-to-image` for PNG; pdf-lib/jsPDF for PDF | No server needed. |
| Testing | Vitest + React Testing Library; Playwright e2e; fixture models from Open Group examples | Round-trip tests are critical for AOEF. |
| CI/CD | GitHub Actions: lint, typecheck, test, build, static site deploy; semantic-release | Free for public repos. |

### 6.2 Data model (conceptual)

```
Model
├── id, name, metamodelVersion (3.2 | 4.0), metadata
├── folders[]
├── elements[]       { id, type, name, documentation, properties{}, bounds }
├── relationships[]  { id, type, sourceId, targetId, name, properties{}, routing }
└── views[]          { id, name, viewpoint, folderId, nodes[], edges[], viewport }
```

Key design rule: **one canonical model store**; views are projections that reference elements/relationships by ID, so an element updated in one view updates everywhere. This mirrors AOEF structure and makes round-tripping feasible.

### 6.3 Storage abstraction (critical for "both in parallel")

```ts
interface ModelRepository {
  listModels(): Promise<ModelSummary[]>
  getModel(id: string): Promise<Model>
  saveModel(model: Model): Promise<void>
  deleteModel(id: string): Promise<void>
  watch?(id: string, cb: (m: Model) => void): Promise<Unsubscribe>
}
```

- `LocalRepository` — Dexie/IndexedDB, File System Access API, YAML/JSON import/export. Default, works offline.
- `ServerRepository` — REST client to the optional self-hosted server (Node/Fastify + SQLite for small teams, Postgres option later).
- `GitRepository` (phase 3) — commits native YAML/JSON to a remote (GitHub/GitLab) via API or local CLI.
- UI code and editor state depend only on the interface; a settings switch selects the backend. The same data model and validation rules run on both sides (shared TypeScript package).

### 6.4 Deployment modes (all supported from one codebase)

1. **Static web app** (GitHub Pages / any static host): open URL, work locally, export files. Zero infra.
2. **Self-hosted** (in parallel): Docker Compose with the sync server + SQLite/Postgres for teams.
3. **Desktop wrapper** (optional, later): Tauri/Electron for offline app-store-ish distribution without losing the web codebase.

### 6.5 Proposed monorepo layout

```
openarch/
├── packages/
│   ├── core/          # shared types, metamodel registry, AOEF codec, validation rules (pure TS)
│   ├── editor/        # React + XYFlow canvas, shapes, palette, inspector
│   ├── repository/    # ModelRepository interface + Local/Server/Git adapters
│   └── ui/            # app shell, sidebar, catalog, dashboard, shared components
├── apps/
│   ├── web/           # static Vite app (local-first; wires LocalRepository)
│   ├── server/        # Fastify API + DB; serves the built web app
│   └── cli/           # headless validate/import/export (phase 3)
├── docs/              # this plan, ADRs, user docs
└── examples/          # Open Group example models (ArchiSurance, ArchiMetal) as fixtures
```

---

## 7. Roadmap proposal (revised for "full platform outline" v0.1)

**v0.1 is a thin vertical slice, not a editor-only MVP.** The goal is to prove the architecture end-to-end with a narrow but real domain subset: ~10 element types (Business Actor, Business Process, Business Service, Application Component, Application Service, Data Object, Node, Artifact, Goal, Capability) and ~6 relationships (assignment, serving, realization, access, composition, influence). Breadth comes in v0.2.

| Phase | Scope | Rough outcome |
|---|---|---|
| **0. Foundations** (1–2 weeks) | Monorepo scaffolding, shared `core` types + metamodel registry, AOEF fixture from ArchiSurance, `ModelRepository` interface + `LocalRepository`, CI | Architecture decision records, data model that all layers share |
| **0.5. Vertical slice** (2–4 weeks) | XYFlow canvas with 10 shapes, palette, magic connector (6 relationships), inspector; catalog list + search + simple dashboard reading from the *same* repository; `ServerRepository` + Docker Compose behind the same interface | **v0.1**: editor + repository + analysis all demonstrably working in both local and server modes |
| **1. Breadth** (4–6 weeks) | Full element/relationship set, validation panel, viewpoints, SVG/PNG export, share links, i18n scaffolding, docs site | v0.2: adoptable solo tool |
| **2. Collaboration** (6–10 weeks) | Workspaces, optimistic locking, semantic diff/import preview, Git adapter, comments | v0.3: teams can use it |
| **3. Analysis & extensions** (ongoing) | Traceability/impact analysis, matrix views, more dashboards, plugin API, CLI, MCP/AI | v1.0 |
| **4. Ecosystem** | Community templates, Confluence/Teams integrations, desktop wrapper | Growth |

Key principle for v0.1: **narrow and deep beats wide and shallow.** Every feature in the slice must run through the shared data model so later breadth is additive, not a rewrite.

| Phase | Scope | Rough outcome |
|---|---|---|
| **0. Foundations** (1–2 weeks) | Decide scope, metamodel version, stack; repo scaffolding; 10–15 element types + 6 relationships; AOEF fixture from ArchiSurance | Architecture decision records, clickable skeleton |
| **1. MVP editor** (6–10 weeks) | Sections 5.1 + 5.2 basics + AOEF import/export + local save + SVG/PNG | Usable solo tool; publish v0.1 |
| **2. Interop & polish** (4–6 weeks) | Round-trip hardening, viewpoints, examples/templates, validation panel, shareable links, i18n scaffolding, docs site | v0.2; people can actually adopt it |
| **3. Collaboration** (6–10 weeks) | Optional sync server, workspaces, optimistic locking, semantic diff, Git adapter, comments | v0.3; teams can use it |
| **4. Analysis & extensions** (ongoing) | Dashboards, matrix views, impact analysis, plugin API, CLI, MCP/AI | v1.0 |
| **5. Ecosystem** | Certified-looking docs, community templates, integrations (Confluence, Teams), desktop wrapper | Growth |

Estimates assume one motivated developer; adjust heavily for a team or part-time work.

---

## 8. Risks & open questions

| Risk / question | Mitigation / decision needed |
|---|---|
| **Trademark** — ArchiMate® is registered | Descriptive use + disclaimer; pick a non-infringing product name (`openarch` is fine) |
| **Scope creep** — trying to beat commercial EA suites | Stay laser-focused on authoring + AOEF interop; analysis is phase 3+ |
| **AOEF fidelity** — subtle import/export mismatches | XSD validation + golden-file round-trip tests from day 1; consider reusing/learning from ArchiPulse's parser |
| **Metamodel version** — 3.2 vs 4.0 | Ship 3.2 first with versioned metamodel registry; add 4.0 mapping later (Arkidor shows demand) |
| **"Build vs. extend ArchiPulse"** | ArchiPulse is Apache-2.0 and already has repository/analysis; could contribute a full editor there instead of standalone. Big strategic choice. |
| **Collaboration complexity** | Start with shareable links + async Git-backed collaboration; defer realtime CRDT |
| **Community/bootstrap** | Publish early, ship Open Group example models, write "how to migrate from Archi/draw.io" guides, keep issues/discussions open |

---

## 9. Decision log

**Resolved (2026-11-17):** standalone project ✅ · React + TS + XYFlow ✅ · local-first + server in parallel ✅ · v0.1 = full platform outline (thin vertical slice) ✅.

**Defaults we're proceeding with (revisit anytime):**

- **Target standard version:** ArchiMate **3.2 first**, behind a versioned metamodel registry so 4.0 can be added without rewrites. (Arkidor shows 4.0 demand; revisit before v0.2.)
- **Desktop wrapper (Tauri/Electron):** deferred until after v0.3 — the static web app covers the offline use case initially.
- **Collaboration:** share links and async Git-backed sync before realtime CRDT editing.
- **Name:** ship as `openarch` or another neutral name; use "ArchiMate®" only descriptively with a trademark disclaimer.

---

## 10. Sources

- Archi — https://github.com/archimatetool/archi and https://www.archimatetool.com/
- Arkidor technical overview — https://arkidor.io/arkidor-technical-overview.html
- ArchiPulse README — https://github.com/DisruptiveWorks/archipulse
- XYFlow / React Flow — https://xyflow.com/ and https://github.com/xyflow/xyflow
- JointJS — https://www.jointjs.com/ and https://github.com/clientIO/joint
- ArchiMate 3.2 language structure tutorial — https://archimetric.com/📘tutorial-archimate-3-2-chapter-3-language-structure
- ArchiMate 3 cheat sheet (elements + relationships) — https://gbruneau.github.io/ArchiMate/
- Open Group ArchiMate 3.2 reference — https://pubs.opengroup.org/architecture/archimate32-doc/
- Open Group ArchiMate 3.2 reference cards — https://www.opengroup.org/sites/default/files/docs/downloads/n221p.pdf
- Open source EA tools overview (2026) — https://catio.tech/blog/open-source-enterprise-architecture-tools
