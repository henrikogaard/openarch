# Changelog

All notable changes to OpenArch are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added (2026-11-18/19 — review + enhancement round)

- **Drawing depth** (Phase 7A): canvas delete synced to the model; Shift multi-select +
  bulk domain/environment assignment; copy/paste/duplicate; align/distribute; snap-to-grid;
  double-click rename; context menu; edge bendpoints + reconnection; grouping; z-order;
  palette drag-and-drop; presentation mode (read-only, arrow-key view switch, F fullscreen).
- **Trust** (Phase 6): debounced autosave with saved/unsaved badge; per-tab error boundary;
  Playwright E2E suites (local + server modes) in CI; save-time validation; server version
  history with restore + pre-restore snapshot; per-entity conflict resolution (Merge review
  with Mine/Theirs per row); schema migration for native JSON; backup-all import/export.
- **Stickiness** (Phase 7): ⌘K command palette with cross-workspace search; IaC drift
  detection + apply (user work preserved) and `openarch iac diff --fail-on drift` CI gate;
  Git-native workspaces (GitHub Contents store); onboarding; dark mode.
- **Bridges**: C4/Structurizr DSL import/export (pragmatic parser, deterministic ids);
  draw.io import; ArchiMate 3.2 registry with versioned metamodel mechanics; `.archimate`
  Archi 5+ property import; cloud icon packs (view styling only).
- **Enterprise**: member management UI + OIDC group→role mapping (owner-only, ≥1-owner
  guard); governance UI (approval inbox, baseline approval, check waivers — owner-only);
  SCIM 2.0 users API; multi-tenant org scoping; connector links (Jira/Confluence/ServiceNow,
  Atlassian Basic auth) + Confluence publish (storage-format convert, space key, timeout).
- **Analysis**: requirements traceability (coverage + uncovered); migration timeline
  (Plateau/WorkPackage/Deliverable with dates); scenario compare (overlap score);
  value-stream view.
- **Engineering**: deterministic auto-layout engine (grid + layered) + MCP tools
  (`auto_layout_view`, `get_validation_issues`, `render_view_svg`; 41 tools total); optional
  server with validation gates on every durable write (no AI bypass), optimistic locking
  everywhere, atomic persistence with corrupt-file quarantine; summary-pagination APIs;
  crash journal (IndexedDB recovery); PWA shell; print stylesheet; documentation site
  generator + GitHub Pages workflow; Docker image + compose (incl. Keycloak profile);
  CONTRIBUTING + issue templates + release workflow; `npm audit` = 0.

### Fixed

- Generated views produced duplicate AOEF `xs:ID`s (view-namespaced ids now).
- AOEF nested container children were invisible to editing/validation (flattened with
  absolute bounds; serializer re-nests).
- Group delete left dangling `parentId`; ungroup left dangling edges; reconnect left lying
  edges (all guarded by new validation rules).
- Palette offered types the XSD rejects (hidden; import tolerance kept).
- Archi 5+ `.archimate` files lost all properties (`propertyDefinitionRef` resolution).
- Server-mode create/duplicate/import was broken (POST route existed but was never called);
  deep links now preserve `?mode=server`.
- MCF/SSRF-class hardening: CSV formula injection, SVG control characters, terraform
  secret redaction, zip-bomb caps, share-link reader caps, timing-safe SCIM token compare.

See `docs/code-review.md` for the full audit trail with guards.

## [0.1.0] — 2026-11-17

First working state: workspaces/domains/viewpoints, editor, analysis, IaC import, AOEF
round-trip conformance, CLI + MCP servers, 135 tests.
