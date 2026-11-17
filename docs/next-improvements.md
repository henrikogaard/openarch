# Next improvements — a prioritised assessment

**Date:** 2026-11-17
**Question:** the product now has workspaces, domains, infrastructure import, Archi interoperability,
portfolio, governance, and AI. What should improve next?

The guiding rule stays the same: **one model, three lenses**. Improvements should make the existing
workflows more trustworthy and more repeatable, not add a fourth product.

---

## 1. The five highest-leverage improvements

| # | Improvement | Why it matters | Effort |
|---|---|---|---|
| 1 | **IaC drift detection** — re-import and diff against the model | Turns a one-off import into a living, current topology. This is the reason a platform team keeps the tool open. | M |
| 2 | **Autosave + version history + restore** | Today saving is explicit. A crash or a wrong save loses work, which destroys trust faster than any missing feature. | S–M |
| 3 | **End-to-end tests (Playwright)** | 135 unit tests, but no test clicks the canvas, creates a workspace, imports a file, or saves. The most valuable flows are unverified. | M |
| 4 | **Git-native workspace flow** — open a folder/repo, save as files, commit/push | The Git adapter exists but is not wired into the UI. This is the core differentiator for code-first teams. | M |
| 5 | **Complete i18n + error boundary** | Many new workspace/settings strings are hardcoded English; a render error blanks the app. Both are cheap and visible. | S |

These five are the difference between "impressive demo" and "I use it every week".

---

## 2. Trust and correctness

| Item | Detail | Effort |
|---|---|---|
| **Autosave** | Debounced save after edits, with a visible "saved / unsaved" indicator. | S |
| **Version history UI** | Snapshots exist on the server; add list, diff, and restore in the app. | M |
| **Error boundary** | Catch render errors per tab, show a recoverable panel, keep the model in memory. | S |
| **Save validation** | Run structural validation before save; warn on errors, allow override. | S |
| **Conflict UI** | On `409`, show "theirs vs yours" and let the user reload or overwrite deliberately. | M |
| **Schema migration** | Version the native JSON format and migrate old files on import. | S |
| **Backup all** | Export every workspace as a single archive; import it back. | S |
| **Accessibility** | Keyboard navigation for the palette, canvas, and dialogs; focus traps; contrast audit. | M |
| **Performance** | Measure at 2,000+ elements; virtualise tables, memoise canvas nodes, lazy-load analysis tabs. | M |
| **Bundle size** | 796 KB / 250 KB gzip. Code-split analysis, AI, and import packages. | S |

---

## 3. Workflows that make it sticky

### 3.1 IaC drift detection (the killer feature)

```
Import (first time)  →  model
Re-import            →  diff: +3 resources, ~2 changed, -1 removed
Review               →  apply / ignore per resource
```

- Keep the `iacAddress` property as the stable key.
- Show a drift badge on the workspace card.
- Optionally run it in CI: `openarch iac diff plan.json model.xml --fail-on drift`.

This is what separates "we documented the architecture once" from "the architecture is current".

### 3.2 Git-native workspaces

- Open a local folder (File System Access API) or a GitHub repo (token).
- Save each workspace as `architecture/<workspace>.json` (already Git-friendly).
- Commit and push from the app; pull with a diff preview.
- CI: `openarch check` on every PR.

### 3.3 Daily-use ergonomics

- **Command palette** (⌘K): jump to workspace, domain, element, view, or action.
- **Global search** across workspaces.
- **Recent workspaces** and favourites on the home screen.
- **Bulk edit**: multi-select elements, assign domain/environment, add properties.
- **Drag-and-drop** file import.
- **Onboarding**: a guided first model and a sample gallery.
- **Dark mode** and a denser layout for large screens.

---

## 4. Enterprise readiness

| Item | Detail | Effort |
|---|---|---|
| **OIDC end-to-end** | Test against a real IdP (Keycloak/Entra); map group claims to workspace roles; member-management UI. | M |
| **Governance UI** | Approval inbox, baseline diff, immutable approved baselines, waivers with expiry. | M |
| **Reporting** | DOCX/PPTX packs; Confluence publish; scheduled PDF. Markdown/HTML already exist. | M–L |
| **Connectors** | Jira (link elements to epics), Confluence (publish views), ServiceNow CMDB (read-only enrichment). | L |
| **SCIM** | Provision users and groups once OIDC is in place. | M |
| **Audit** | Retention policy, export, and a readable audit timeline per element. | S–M |
| **Portfolio** | Cross-workspace dependency map, capability heatmap, roadmap timeline. | M |
| **Value streams** | A dedicated value-stream view with stages and capabilities. | M |

---

## 5. Modelling depth

| Item | Detail | Effort |
|---|---|---|
| **ArchiMate 4.0** | A versioned registry alongside 3.2, with migration. | M |
| **C4 / Structurizr** | Import/export DSL; C4 view presets; mapping table already designed. | M |
| **Archi fidelity** | Preserve icons and styling in `.archimate`; add an Archi interop test corpus. | M |
| **Merge review** | Three-way merge UI on top of the existing semantic diff. | M |
| **Containers** | Nested/grouped nodes on the canvas (ArchiMate composition shorthand). | M |
| **Custom properties** | A workspace property schema with types and validation. | S–M |
| **Metamodel extensions** | Plugin-defined element/relationship types (the plugin API exists). | M |
| **Model compare** | Side-by-side diff of two workspaces in the UI. | S |

---

## 6. AI improvements

| Item | Detail | Effort |
|---|---|---|
| **More MCP tools** | `list_domains`, `get_portfolio`, `check_rules`, `preview_iac`, `apply_iac`, `create_adr`. | S |
| **Agent evaluation** | A golden set of prompts and expected models; run in CI to catch regressions. | M |
| **Human-in-the-loop** | Confirmation prompts for destructive tools; dry-run mode. | S |
| **Context resources** | `openarch://workspace/{id}`, `openarch://domain/{id}`, `openarch://portfolio`. | S |
| **AI review** | "Review this model" prompt that returns validation findings, gaps, and suggested relationships. | S |
| **Cost controls** | Token budget, truncation strategy, and per-workspace context limits. | S |

---

## 7. Distribution and community

- **Publish a Docker image** (`ghcr.io/...`) and a one-command install.
- **Hosted demo** with the sample workspaces (no sign-up).
- **`npx openarch`** for the CLI.
- **Docs site** with tutorials: "ArchiMate in 10 minutes", "Import Terraform", "TOGAF vision".
- **Example gallery**: ArchiSurance, a cloud landing zone, a TOGAF vision, an integration landscape.
- **Contribution guide** with good-first-issues.
- **Desktop wrapper** (Tauri) for offline installs.
- **PWA** so the static app works offline after first load.

---

## 8. What not to build

| Don't | Why |
|---|---|
| A CMDB or ITSM system | ServiceNow owns it; integrate read-only |
| Real-time multi-cursor editing | High complexity, low differentiation for the target teams |
| A full TOGAF process engine | Provide artefacts and templates, not a workflow engine |
| Gartner-MQ feature parity | A small team cannot win that race |
| A marketplace before adoption | Empty marketplaces look abandoned |
| Cloud icons as the core metamodel | Maintenance burden and lock-in; map to ArchiMate |

---

## 9. Recommended sequence

| Window | Work | Outcome |
|---|---|---|
| **Next 2 weeks** | Autosave, error boundary, E2E tests, i18n completion, bundle splitting | Trustworthy daily driver |
| **Next 4–6 weeks** | IaC drift detection, Git-native workspaces, command palette, version history UI | Sticky workflow |
| **Next quarter** | OIDC end-to-end, governance UI, reporting, C4 bridge, ArchiMate 4.0 | Enterprise-ready |
| **Later** | Connectors, SCIM, value streams, desktop/PWA, docs site | Ecosystem |

---

## 10. How to know it worked

- **Time to first useful diagram** < 10 minutes (from IaC or template).
- **Weekly active workspaces** grows after each release.
- **IaC drift checks** run repeatedly per workspace (not once).
- **Saved → reopened** rate: users return to the same workspace.
- **Validation pass rate** rises as rules and AI guardrails mature.
- **E2E suite green** on every PR.
- **Support questions per release** fall.

---

*ArchiMate® is a registered trademark of The Open Group. OpenArch is not affiliated with,
endorsed by, or certified by The Open Group.*
