# AGENTS.md — handoff for the next agent

This file is the entry point for an agent picking up OpenArch on another computer. Read it fully
before changing code.

---

## 1. What this is

**OpenArch** is an open-source, browser-based ArchiMate® 3.2 modelling tool. It is local-first
(IndexedDB or files), interoperable (AOEF validated against the Open Group XSD, plus Archi
`.archimate`), and AI-operable (a 38-tool MCP server). A self-hosted Fastify server adds
collaboration, governance, and RBAC.

**Thesis:** one model, three lenses.

- Infrastructure/cloud architects import IaC and document topology.
- Archi/ArchiMate users edit and exchange models.
- TOGAF/enterprise teams govern workspaces, domains, baselines, and portfolios.

**Do not turn it into three products.** Tier-specific features are templates, views, or server
options — never forked metamodels.

---

## 2. Read these first

| Document | Why |
|---|---|
| [`docs/status-2026-11-17.md`](docs/status-2026-11-17.md) | **Current status, caveats, gaps, and the next sprint** |
| [`docs/roadmap.md`](docs/roadmap.md) | Canonical plan (phases 0–8) |
| [`docs/user-guide.md`](docs/user-guide.md) | How the product is used |
| [`docs/code-review.md`](docs/code-review.md) | Past defects and the guards that now protect them |
| [`docs/enterprise-and-project-use.md`](docs/enterprise-and-project-use.md) | Enterprise/infrastructure opportunity assessment |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

---

## 3. Current state (2026-11-17)

- **135 tests** across 16 files; typecheck and build pass; 0 dependency vulnerabilities.
- **8 packages**: `core`, `ai`, `enrichment`, `iac`, `archi`, `reporting`, `repository`, `exporters`.
- **4 apps**: `web` (React + XYFlow), `server` (Fastify), `cli`, `mcp`.
- **Committed and pushed** (`8c45f61` on `origin/main`). New work goes on a named feature branch
  in its own worktree under `.claude/worktrees/` (git-ignored). See §10 before transferring.
- Servers may be running on `:5173` (Vite) and `:8080` (API + built app).

Shipped: workspaces, domains, environments, editor, magic connector, **stakeholder viewpoints with
L1–L4 granulation and expandable detail**, analysis, EAM views, deployment view, interface
catalogue, AOEF + `.archimate` + JSON + CSV + Mermaid, IaC import, artefacts (ADRs), portfolio,
governance approvals, OIDC/RS256, standards packs, MCP server, CLI.

Partial/planned: see the status document. The biggest gap is **drawing depth**, not features.

---

## 4. Quick start

Requires **Node.js 22+**. `xmllint` (libxml2) is needed for AOEF schema-conformance tests.

```bash
npm install
npm run typecheck
npm test
npm run dev            # http://localhost:5173
```

Server mode:

```bash
npm run build
npm run dev:server     # http://localhost:8080
```

CLI and MCP:

```bash
npm run cli -- validate examples/archisurance.xml
npm run cli -- check examples/archisurance.xml
npm run cli -- report examples/archisurance.xml /tmp/report.md
npm run mcp
```

Environment variables are documented in `.env.example` and the README.

---

## 5. Repository map

```
packages/core         types, metamodel, viewpoints, workspaces/domains, templates,
                      AOEF codec, validation, analysis, diff, plugins
packages/ai           LLM context, prompts, guardrails
packages/enrichment   CSV / Git-file adapters
packages/iac          Terraform, Kubernetes, docker-compose importers
packages/archi        Archi native .archimate import/export
packages/reporting    Markdown/HTML reports, CI rules, standards packs
packages/repository   ModelRepository + Local / Server / Git adapters, share links
packages/exporters    SVG, PNG, CSV, Mermaid

apps/web/src/App.tsx          routing, workspace CRUD, tabs, exports
apps/web/src/components/      WorkspaceHome, WorkspaceSettings, Canvas, Inspector,
                              ViewDesigner, ViewPreview, Artefacts, DomainMap,
                              Portfolio, DeploymentView, InterfaceCatalog,
                              Enrichment, AiPanel, …
apps/server/src/index.ts      REST API, collaboration, governance, persistence
apps/server/src/auth.ts       static tokens, HS256, OIDC/JWKS, roles
apps/cli/src/index.ts         validate/list/convert/diff/check/report/doctor
apps/mcp/src/                 MCP server: tools.ts, resources.ts, store.ts

examples/                     Open Group ArchiSurance fixture
test/fixtures/xsd/            Official Open Group schemas (conformance tests)
docs/                         roadmap, status, user guide, ADRs, reviews
```

---

## 6. Invariants — do not break these

1. **One canonical model.** Views are projections referencing elements by ID. The editor,
   catalogue, analysis, AI, and exporters all read/write the same data.
2. **AOEF conformance is the gate.** Every export must validate against
   `test/fixtures/xsd/archimate3_Diagram.xsd`. Run `npm test` before and after touching
   `packages/core/src/aoef.ts`.
3. **Local-first by default.** No account, no server, no telemetry required for solo use.
4. **Domains are a partition, not a metamodel.** They are an AOEF-safe property plus a registry.
5. **Repository abstraction.** UI code depends on `ModelRepository`, never on a backend directly.
6. **AI writes go through the same validation as human writes.** No bypass.
7. **Model text is untrusted.** Keep the `SAFETY_PREFIX` on AI-facing text.
8. **ArchiMate® is a registered trademark.** Use it descriptively only.
9. **Generated views keep their recipe.** `View.config` drives `buildConfiguredView`; regenerate
   rather than hand-editing a generated view. AOEF export materialises nodes/edges, not the recipe.

---

## 7. Data model essentials

```ts
Model {
  id, name, documentation, properties, propertyDefinitions,
  elements, relationships, views,
  purpose: 'as-is' | 'to-be' | 'migration',
  status: 'draft' | 'active' | 'approved' | 'archived',
  owner, tags, domains, artefacts, approvals,
  createdAt, updatedAt
}

ArchiElement { id, type, name, documentation, properties, domain?, environment? }
Relationship { id, type, source, target, name, documentation, properties }
Domain       { id, name, description?, owner?, color?, parentId? }
Artefact     { id, kind: 'adr'|'requirement'|'principle'|'assessment', title, body, status, elementIds, … }
```

Helpers live in `packages/core/src/workspace.ts` (`filterModelByDomain`, `domainStats`,
`portfolioStats`, `timeClassification`, `validateWorkspace`, `workspaceSummary`).

---

## 8. Testing

```bash
npm test                 # unit, XSD conformance, server integration, UI render (vitest)
npm run test:e2e         # Playwright smoke test against the dev server on :5173
npm run typecheck
npm run build
```

- **AOEF conformance** uses `xmllint`; tests skip if it is missing.
- **Server integration** boots the real server on a random port and exercises auth/RBAC/locking/
  import/approvals.
- **UI tests** use jsdom and render analysis components; they do **not** click the canvas.
- **E2E** uses Playwright (`npm run test:e2e`, config `playwright.config.ts`, specs in `e2e/`):
  create → add → connect → bulk-assign → delete → reload → export AOEF against the dev server on
  `:5173`. Runs in CI after `npx playwright install --with-deps chromium`.

When fixing a bug, add a regression test. When changing the metamodel, update
`packages/core/src/extended.test.ts`.

---

## 9. Known gotchas

1. ~~Canvas deletion not wired to the model.~~ Fixed: `onNodesDelete`/`onEdgesDelete` in
   `Canvas.tsx` remove elements/relationships from the model via `removeElements` /
   `removeRelationships` in `packages/core/src/workspace.ts` (tests: `workspace-editing.test.ts`).
2. ~~No autosave.~~ Fixed: debounced autosave (1.5 s) with a saved/unsaved badge in `App.tsx`;
   explicit Save still available.
3. **`.archimate` is best-effort** — icons/styling are dropped.
4. **IaC mapping is heuristic** — review before applying.
5. **OIDC is unit-tested, not live-tested.**
6. **i18n is incomplete** — new workspace strings are hardcoded English.
7. **Bundle is one 797 KB chunk** (250 KB gzip); code-splitting is pending.
8. **Server seed is stale if `data/models.json` exists** — delete it to reseed the richer sample.
9. **`openarch check` is noisy by default** (36 warnings on ArchiSurance); no waivers yet.
10. **Headless screenshots** can show an empty workspace list because IndexedDB seeding is async.
11. **`npm run dev:server` serves the built app** — rebuild after web changes.
12. **Ports**: kill stale processes with `lsof -ti :5173 -ti :8080 | xargs kill`.
13. **Generated views are snapshots.** They store a `ViewConfig` and can be regenerated, but AOEF
    export does not carry the recipe. Use the **Regenerate** button after model changes.

---

## 10. Transferring to another computer

`main` is committed and pushed (`origin` = GitHub). For new work, branch in a worktree under
`.claude/worktrees/` (git-ignored) and open a PR. If a clone ever ends up with only the initial
commit, recover from a bundle:

```bash
# Option A — commit and push (preferred)
git add -A
git commit -m "OpenArch: workspaces, domains, IaC, Archi, reporting, governance"
git remote add origin <your-repo-url>
git push -u origin main
```

```bash
# Option B — a Git bundle (no remote needed)
git add -A
git commit -m "OpenArch handoff"
git bundle create openarch.bundle --all
# copy openarch.bundle, then on the other machine:
git clone openarch.bundle openarch
```

```bash
# Option C — an archive (exclude node_modules and build output)
tar --exclude=node_modules --exclude=dist --exclude=data -czf openarch.tgz .
```

After transfer: `npm install && npm test && npm run dev`.

---

## 11. First task

Follow the two-week sprint in `docs/status-2026-11-17.md` §5 and the drawing-depth track
(Phase 7A) in `docs/roadmap.md` §12. Done already: commit/push (`8c45f61`), canvas delete synced
to the model, multi-select + bulk assign, autosave, error boundary, Playwright E2E (branch
`feat/drawing-depth-trust`). Next:

1. **Drawing polish**: align/distribute, snap-to-grid, bendpoints, on-canvas labels, containers,
   z-order, context menu, palette drag-and-drop (copy/paste/duplicate ✅; roadmap Phase 7A,
   `docs/roadmap.md` §12).

**Definition of done for this sprint:** a new user can create a workspace, draw and connect
elements, delete them, bulk-assign a domain, reload without losing work, and export a valid AOEF
file — with an E2E test proving it.

---

## 12. Definition of done for any change

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (add tests for new behaviour)
- [ ] `npm run build` passes
- [ ] AOEF conformance tests still pass if the codec changed
- [ ] No new dependency vulnerabilities (`npm audit`)
- [ ] Docs updated if behaviour or configuration changed
- [ ] No secrets, tokens, or customer data committed

---

## 13. Do not do

- Do not replace the document model with a SQL schema.
- Do not add a CMDB/ITSM or a full TOGAF process engine.
- Do not add real-time CRDT editing.
- Do not make a server mandatory for local use.
- Do not bypass metamodel validation for AI writes.
- Do not chase Gartner-MQ feature parity.
- Do not launch a marketplace before adoption.

---

*ArchiMate® is a registered trademark of The Open Group. OpenArch is not affiliated with,
endorsed by, or certified by The Open Group.*
