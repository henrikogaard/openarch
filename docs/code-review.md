# Code review — findings and fixes

**Date:** 2026-11-17
**Scope:** full review of the Phase 0–3 implementation (63 files, ~10.7k lines), verified by
running probes against the official Open Group XSD rather than by trusting the test suite.

This document records what was wrong, what was fixed, and how each fix is now guarded. It is
kept because the root cause — testing our own parser against itself — is easy to reintroduce.

---

## Root cause

The AOEF round-trip test compared **parsed model objects**, not XML. Because the parser produced
the same wrong structure on both sides, the test passed while the exported file was corrupt.
There was no schema validation anywhere in CI, despite AOEF interoperability being the project's
primary differentiator.

---

## Critical defects (fixed)

### 1. Properties were parsed from the wrong node and exported in a non-schema format

`propertiesFromXml` received the `<properties>` wrapper (`{ property: [...] }`) instead of the
array, producing one bogus property with an empty key/value for every concept. Export then
emitted `<property key="…" value="…"/>`, which AOEF does not allow (the schema requires a
`propertyDefinitionRef` attribute and a `<value>` child), and nested `<property>` inside
`<property>` on round-trip.

**Fix:** parse `properties.property`, resolve the definition name, and emit
`<property propertyDefinitionRef="…"><value>…</value></property>`. Ad-hoc keys get a generated
`<propertyDefinition>` so the file stays valid.

**Guards:** `aoef.regression.test.ts` (parse, emit, no nesting over repeated round-trips) and
`aoef.conformance.test.ts` (schema validation with ad-hoc properties).

### 2. Models created in the app exported invalid XML

`serializeAoef` spread `model.raw ?? {}`. A model created in the app has no raw fragment, so the
output used `xsi:type` without declaring `xmlns` or `xmlns:xsi`. `xmllint` reported
`Namespace prefix xsi for type on connection is not defined`.

**Fix:** always declare `xmlns`, `xmlns:xsi`, and `xsi:schemaLocation`.

**Guard:** `aoef.conformance.test.ts` validates a model created by `createSampleModel()`.

### 3. Deleting content did not delete it on export

`serializeView` and `serializeAoef` only overwrote `node`, `connection`, and `views` when the new
array was non-empty, so the stale `raw` fragment won. Deleting all nodes from a view still
exported 12 nodes; deleting all views still exported 17.

**Fix:** always overwrite the containers; omit optional containers entirely when empty (the
schema requires `minOccurs=1` when present).

**Guards:** three regression tests (nodes, views, relationships).

---

## High-severity defects (fixed)

### 4. Core relationship validation never ran

`validation.ts` guarded on `getElementType(relationship.type)`, which is always false for
relationship types. The Validation tab and `openarch validate` silently missed every illegal
relationship; only the AI path (with its own check) caught them.

**Fix:** use `getRelationshipType`, and add a distinct `relationship.unknown-type` rule.

**Guard:** two tests in `extended.test.ts`.

### 5. Optimistic locking was ineffective in the UI

`ServerRepository.saveModel` fetched the current version immediately before the PUT, so the lock
only covered a millisecond race. A concurrent edit was silently overwritten.

**Fix:** the repository interface accepts `expectedVersion`; the app records the revision it
loaded and sends it as `If-Match`; a `409` surfaces a clear message.

**Guard:** server integration test asserts stale → 409 and current → 200.

### 6. RBAC had no read isolation

`GET /api/models` and `GET /api/models/:id` required only *an authenticated actor*. Any user
could read every workspace; "viewer" was meaningless as a boundary.

**Fix:** member-scoped reads via `isMember`; non-members get `403` and the workspace is omitted
from the list.

**Guard:** server integration test with a non-member token.

### 7. MCP could not reach an authenticated server

`HttpModelStore` sent no `Authorization` header.

**Fix:** `OPENARCH_TOKEN` is sent on every request.

**Verified:** end-to-end run — authenticated server → MCP `create_model_from_spec` →
`export_aoef` → **validates against `archimate3_Diagram.xsd`**.

---

## Medium defects (fixed)

| Defect | Fix |
|---|---|
| Share links were ~4.4 KB for 8 elements and unusable for real models | gzip via `CompressionStream`, plus `ShareLinkTooLongError` with an actionable message instead of a silently broken URL |
| `Junction` was not a valid AOEF element type; `Path` was missing | replaced with `AndJunction`/`OrJunction`, added `Path`, removed the bogus `Junction` relationship type |
| "Add as new model" could overwrite the current model on id collision | a fresh id is generated when the AI result collides with a stored workspace |
| SVG exported all views but was named after the current view | SVG now exports the current view, matching PNG |
| Empty models exported invalid AOEF | optional containers are omitted when empty |
| Negative canvas coordinates violated `nonNegativeInteger` | coordinates are clamped on export |
| Viewpoints referenced non-existent types (`BusinessUnit`, `Network`, `Triggering`) | removed; viewpoints now match real element types |

---

## Test coverage added

| Area | Before | After |
|---|---|---|
| AOEF schema conformance | none | 5 tests against the official XSD (app-created, properties, empty, round-trip, negative coords) |
| AOEF regressions | none | 7 tests (properties, namespaces, deletions, no nesting) |
| Server auth / RBAC / locking / import / saved views | none | 8 integration tests booting the real server |
| Auth unit tests | none | 14 tests (static tokens, HS256, expiry, tampering, roles, membership) |
| UI rendering | none | 6 jsdom tests (catalogue, dashboard, validation, EAM, matrix, inspector) |
| **Total** | 43 | **88** |

CI installs `libxml2-utils` so the conformance tests run on every push. The schemas are vendored
under `test/fixtures/xsd/` with attribution; the only modification is a local `xml.xsd`
`schemaLocation` so validation works offline.

---

## Deliberate non-goals

- A SQL-table projection of the document store (ArchiPulse's model).
- SaaS connectors (AWS/Jira/Confluence/ServiceNow); CSV and repo-scan adapters cover code-first users.
- OIDC provider integration; signed HS256 JWTs are accepted.
- Hosted SaaS and Helm packaging.

---

## Process lesson

Breadth of features is not interoperability. The earlier claim that "every gap is closed" was
premature: the feature list was accurate, but the foundational codec was unverified. The fix that
matters most is not any single bug — it is that **the export path is now checked against the
standard on every commit**.

---

## Phase 7A findings (2026-11-17, found by the new Playwright E2E)

### 4. Selection state caused an infinite render loop

`onSelectionChange` set two state arrays with fresh identities on every store emission, so React
hit "Maximum update depth exceeded" and (before the error boundary existed) the editor blanked.

**Fix:** reference-stable `setState` (return the previous array when the ids are unchanged), plus a
per-tab `ErrorBoundary` so a future loop shows a recoverable panel instead of a blank app.

**Guard:** `e2e/smoke.spec.ts` exercises select → bulk-assign → delete; the ErrorBoundary itself is
covered by a jsdom test in `components.test.tsx`.

### 5. Controlled `selected` flag on canvas nodes broke multi-select

`toFlowNodes` stamped `selected` from the app-level `selectedElementId`, so every node click rebuilt
the node array and silently deselected everything else.

**Fix:** selection is owned by React Flow alone; the app-level selection only drives the inspector.

**Guard:** `e2e/smoke.spec.ts` asserts Shift multi-select reaches "2 selected" before bulk-assign.

### 6. Selection reporting re-rendered App mid-drag and cancelled connections

Lifting canvas selection into App state re-rendered App on every selection emission, which
interrupted an in-progress handle drag, so the magic connector never opened.

**Fix:** reference-stable `setState` in the App-level selection handler.

**Guard:** `e2e/smoke.spec.ts` and `e2e/duplicate.spec.ts` both drive a real handle-to-handle
connection.

### 7. Initial fitView ran before layout settled, leaving nodes under the inspector

React Flow only auto-fits on mount; when the workspace route mounts, the pane can still measure
0×0, so `fitView` fell back to max zoom and nodes rendered beyond the pane edge (under the
inspector), unclickable.

**Fix:** `FitViewOnChange` re-fits shortly after the active view id changes, once layout has
settled; model commits now also preserve React Flow's selection flags instead of resetting them.

**Guard:** `e2e/align.spec.ts` drags and aligns three nodes at real coordinates.

---

*ArchiMate® is a registered trademark of The Open Group. OpenArch is not affiliated with,
endorsed by, or certified by The Open Group.*

---

## 2026-11-19 — Full-codebase review round (four parallel deep dives)

**Scope:** all 10 packages + 4 apps (~19,850 lines). Each finding was verified by
reproduction (xmllint against the official XSD, library-escape experiments, scratch
probes) before fixing; nothing was fixed "on faith".

### CRITICAL (fixed)

8. **Generated views produced duplicate `xs:ID`s.** `buildConfiguredView` derived node ids
   as `gen-<elementId>` / `group-<name>`; two generated views sharing an element exported
   a model the official XSD rejects. Fixed: ids namespaced per view (`gen-<view>-<id>`);
   conformance test now exports two generated views sharing elements.

9. **AOEF nested container children were invisible to edit and validation.** Children of
   container nodes lived only in opaque `raw` passthrough — `removeElements` couldn't prune
   them and deleting a container's element produced an IDREF-key failure on export. Fixed:
   `parseViewNodeTree` flattens children into real `ViewNode`s (bounds converted to
   absolute, `parentId` kept native), and the serializer re-nests with relative bounds;
   round-trip reproduces the original nesting. Grouping was also switched to a schema-legal
   `Container` (the previous `Group` + `elementRef` combination is not valid AOEF).

### HIGH (fixed)

10. **The server stored unvalidated bodies.** `PUT /api/models`, `POST /models`, and
    `import/apply` cast `request.body as Model` and persisted it — invariant 6 was only
    enforced in clients. Fixed: a `modelWriteProblem()` gate (shape check + refuse
    error-severity) on every durable write; `apply` also uses core `mergeModels` now
    (merges views, registry sets, prune lying edges).
11. **MCP writes silently clobbered concurrent human edits.** Blind PUTs without `If-Match`;
    the server treats a missing header as unconditional overwrite. Fixed:
    `HttpModelStore.saveModel` fetches the version and always sends `If-Match`.
12. **Server-mode create/import/duplicate was broken.** `ServerRepository.saveModel` only
    ever PUT; the creation route is `POST /models`. Fixed: create falls back to POST; unknown
    versions now refuse to clobber a newer server copy instead of fetching-and-saving blind.
13. **Group deletes corrupted the model** (`removeElements` never promoted children of a
    removed container → dangling `parentId`). Fixed + `view.dangling-parent` validation rule.
14. **Ungroup left dangling edges** (removed group node/relationships stayed referenced in
    every view). Fixed + `view.dangling-edge-endpoint` rule.
15. **Reconnected edges lied.** `reconnectRelationship` kept old endpoints when the new
    element had no node — a violation of "views are projections". Fixed: edges that cannot
    faithfully depict the new endpoints are removed; `view.edge-mismatched-*` rules added.
16. **Palette offered types the XSD rejects** (`BusinessComponent`, `MigrationEvent` —
    removed in ArchiMate 3.0). Fixed: hidden from the palette via `PALETTE_HIDDEN_TYPES`
    (import tolerance preserved); the viewpoint library's dead/mistyped entries removed.
17. **Archi 5+ `.archimate` files lost all user properties** (parser only read the legacy
    `key=`/`value=` attributes). Fixed: `propertyDefinitionRef` properties resolve through the
    model's definitions; fixture test covers both shapes.

### MEDIUM (fixed)

- `applyIacDrift` destroyed user work (manual relationships between imported elements were
  replaced; "changed" resources reverted user renames; ignored adds left dangling
  relationships). Rewritten: only `source=iac` relationships are replaceable, user-owned
  fields survive changes, incoming relationships are endpoint-validated. Terraform secret
  attributes are redacted before persistence.
- CSV formula injection (=, +, -, @ prefixes are quote-neutralised). Auth on connectors:
  Atlassian cloud APIs need Basic `email:token` (was Bearer); Confluence publish now sends a
  storage-format fragment (no DOCTYPE/styles), requires a configured space key, Jira keys
  are URL-encoded. C4 DSL round-trip: quote/hash/URL-aware tokenizer + chained arrows +
  deterministic id disambiguation. Share links: reader caps fragments/decompressed size.
  Archi import: zip-bomb caps via fflate filter. Waiver governance is owner-only. Server:
  atomic persistence + corrupt-file quarantine, snapshot cap on POST /snapshots, `nbf`
  checked, SCIM token compared constant-time, `/health` leaks nothing, `diff?compare=`
  membership-checks the comparison target, comment authors are the authenticated actor,
  restore snapshots the pre-restore state first. MCP: unknown notifications are dropped
  (JSON-RPC compliance), `update_element` validates relationships after type changes,
  `apply_enrichment` refuses error-severity like `apply_aoef`. Editor: autosave has a
  15 s max-delay, in-flight saves no longer clear another workspace's dirty flag, undo/redo
  treat saved state as clean, renames preserve non-English locales, presentation mode is
  truly read-only, office exporters are async chunks (vendor 1,165 kB→475 kB eager + 556 kB
  on-demand), ⌘K search is memoised and capped, re-applying imports upserts by id. CLI: uses
  the canonical core diff; doctor reports the real capabilities.

### Guard tests added this round

conformance (two generated views; container delete → valid export; group round-trip),
view-integrity (parentId promotion, ungroup pruning, reconnect faithfulness, merge remap),
ServerRepository (create/update/conflict/timeout; previously zero tests), server gate
(refuse dangling/garbage bodies — incl. non-500 on garbage; owner-only waivers; actor-bound
comments), archi 5 properties + entry-cap bomb rejection, iac drift semantics, CSV injection,
connector auth/format/encoding, hostile C4 inputs. 211 unit + 30 server-integration/auth
tests + 8 E2E green across 25 files.

### Known residuals (documented, not bugs)

- `new Function` scripting is NOT a sandbox and the docs now say so; the trust boundary is
  the validation gate. jArchi mutate-without-return now works as users expect.
- The bundled XSD is 3.0; `ValueStream` (3.1+) stays available for the value-stream feature
  and exports of models containing it will not pass the 3.0 conformance check — trading
  this against the feature was judged correct, flagged in `PALETTE_HIDDEN_TYPES` docs.
- Open-mode `x-actor` header remains by design (local deployments); with auth on it is ignored.
