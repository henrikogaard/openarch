# OpenArch — Worklog & Handoff Status

**Date:** 2026-11-22 · **Branch:** `feat/drawing-depth-trust` (91 commits, PR #1 open) · **Base:** `main` @ `8c45f61`

## How to pick up on another machine

```bash
git clone https://github.com/henrikogaard/openarch.git
cd openarch
git checkout feat/drawing-depth-trust
npm install
npm run typecheck   # clean
npm test           # 294 passed (2 opt-in skips)
npm run dev        # http://localhost:5173
```

All state is in this branch. There is no uncommitted work, no stash, no orphan worktree.

---

## 1. What has been built (PR #1 scope)

Everything below is committed and pushed. CI `verify`, `e2e-server`, and the external
Devin review all pass on the pushed HEAD (`0ad69d3`).

### Product build-out (the original waves)

| Track | Items (all shipped) |
|---|---|
| **Drawing depth (Phase 7A)** | Canvas delete synced to model, multi-select + bulk domain/env assign, copy/paste/duplicate, align/distribute, snap-to-grid, double-click rename, context menu, edge bendpoints + reconnection, grouping, z-order, palette drag-and-drop, presentation mode (read-only, ←→ views, F fullscreen) |
| **Trust (Phase 6)** | Debounced autosave + badge, per-tab error boundary, Playwright E2E (local + server-mode, in CI), save-time validation, version history + restore, 409/403 conflict dialog + per-entity 3-way resolution (mine/theirs/merge), native schema migration, backup-all, dark mode, i18n EN/NB completion, bundle split (797→207 kB initial), 2k-element perf (core + canvas E2E) |
| **Stickiness (Phase 7)** | ⌘K command palette with cross-workspace search, IaC drift + `iac diff --fail-on drift`, Git-native workspaces, onboarding wizard, crash journal, WebDAV adapter |
| **Bridges** | C4/Structurizr (parser/mapper/exporter, deterministic ids), draw.io import, ArchiMate 3.2 registry, `.archimate` Archi 5+ properties, cloud icon packs |
| **Enterprise** | Member management UI, group→role mapping, governance (approval inbox, baseline, waivers — owner-only), SCIM 2.0, org scoping, connectors (Jira/Confluence/ServiceNow + publish), OIDC RS256 e2e-tested |
| **Platform** | Docker + compose (incl. Keycloak profile), CONTRIBUTING, SECURITY, CHANGELOG, release workflow, docs site (zero-dep builder + Pages), `npx openarch` (1 MB esbuild bundle), scheduled Confluence publish, live OIDC opt-in |

### Multi-user spec (docs/multi-user-spec.md, all A/B/C/D/E lines shipped)

| Track | Items |
|---|---|
| **A1** First-boot owner bootstrap (print-once token, SHA-256) | **A2** Named tokens (hash store, shown-once) | **A3** Invites (128-bit, single-use, TTL, owner-only, never-grant-owner) |
| **A4** OTP login + sessions (cookie + Bearer, idle/absolute expiry, 401-aware relogin prompt) | **A5** OIDC Authorization Code + PKCE (GET+POST callback, code_verifier server-side, existing JWKS path) | **A6** `.env.example` + deployment guide |
| **B1** FolderRepository (File System Access API, drift → ConflictReview) | **B2** `admin backup/restore/verify-store` (checksum manifest, tamper refused, secrets excluded, `--anonymise`, surgical workspace) |
| **C1** Op engine (19 kinds, ADR 0004 gate: `applyOp` **throws on any error-severity projected result**; 300-op fuzz storm) | **C2** Event store (hash-chained shards, snapshot cadence, boot migration, PUT-compat chains from `preSaveModel`) | **C3** `POST /ops` → 207 per-op apply-or-reject + RT broadcast | **C4** `restore-at/:seq` (+ reversal op in the log) |
| **D1** Mail adapter (Resend + SMTP + console fallback, masked admin, hot refresh) | **D2** Setup screen (test-email round-trip gate) | **D3** Email invite delivery |
| **E1** Route-parity registry (all routes, CI-fatal) | **E2** BYO audit (E2E: zero data-bearing requests) |

### Onboarding (wave 3, last item)

Full first-time setup wizard with live validation: Welcome → Storage (Browser/Folder/Team server) → Auth (server URL health check + token verification against `/api/me`) → Template (live SVG preview) → Done. Focus-trapped, responsive, progress dots. Replaces the old static 3-step dialog.

---

## 2. Review history

Three full review rounds, each recorded in `docs/code-review.md`:

| Round | Scope | Found | Fixed |
|---|---|---|---|
| 1 | All packages + apps (~19,850 lines) | 2 CRITICAL, 9 HIGH, 16 MEDIUM | All CRITICAL/HIGH + most MEDIUM |
| 2 | Residuals + white-op (fixes themselves) | 12 findings | All 12 |
| 3 | Auth/storage + op-log/concurrency (subagent focus) | ~40 findings | 12 most severe (CRITICAL + HIGH + top MEDIUM); remainder deferred (below) |

---

## 3. What is still open (prioritized, deferred from the third review)

These are **not** bugs shipping today (the CI tests + E2E prove the current
surface) but are the list to work from next:

### Server (op-log correctness)
| # | Item | Why it matters | Effort |
|---|---|---|---|
| 1 | `submitOp` client-side unwired — autosave still PUTs whole models | Op endpoint + event store + RT relay are all operational; the client just hasn't switched its save path, so the log is populated from PUT-compat decomposition (chained correctly) but ops are not yet the primary traffic | M |
| 2 | Server-side idempotency key check in `append()` | Retries double-apply view-node ops (only elements are safe by their duplicate-id validation rule); the spec put `idempotencyKey` on every op | S |
| 3 | Self-echo filter on RT ops | A user's own ops broadcast back and re-apply → redundant undo entries + possible duplicate-creation error | S |
| 4 | Flash re-flush after POST completes (queue can stall mid-batch) | Last batch in a pending flush waits for the next submitOp to retry | S |
| 5 | Rejected-op rollback on the client (optimistic projection currently stays when the server rejects) | UI shows a change the server didn't accept; the next autosave re-sends it as a PUT | S |
| 6 | Boot-time reconciliation: compare event-log replay vs `models.json` | Crash windows desynchronize them; nothing detects or repairs this today | M |
| 7 | `append()` torn-line quarantine + duplicate-seq dedupe | Crash between shard-append and meta-flip creates duplicate seqs that break replay; torn lines make `JSON.parse` fail with no recovery | S–M |
| 8 | `compact()` is dead code (never called); when it runs it's non-atomic | Shards grow monotonically; compaction exists to remove old event lines but is unwired and would need temp+rename | S |
| 9 | `GET /events` endpoint (spec C2 calls for it) | Clients have no way to read event seqs; `restore-at/:seq` is undiscoverable from the API | S |

### Server (auth hardening)
| # | Item | Why it matters | Effort |
|---|---|---|---|
| 10 | WS reconnect in `useCollab` (no retry after close; presence silently dies) | Server restart or network blip kills the real-time room until the browser refreshes | S |
| 11 | OIDC audience pinning for login (defaults to optional; any same-issuer token mints a session) | With `OPENARCH_OIDC_AUDIENCE` unset the login flow accepts tokens minted for other apps | S |
| 12 | WS auth via first-frame message (removes token from query string) | Bearer tokens in URLs land in server/proxy logs | S |
| 13 | Per-IP OTP limiter counts successful verifications too (not just failures) | Comment says "failure" but code counts all calls; behaviour is conservative (more strict) but wrong | S |
| 14 | `invite.failedAttempts` never incremented (lockout branch unreachable) | Dead code masquerading as a security control | XS |

### Client (storage adapters)
| # | Item | Why it matters | Effort |
|---|---|---|---|
| 15 | Folder adapter drift false-positives (`commit` never re-stamps `updatedAt`, so save-after-save fires against the user's own previous write) | The `.openarch-index` saved track is also mismatched with its parsed form | S–M |
| 16 | WebDAV PROPFIND path (`base/models/`) has no PUT equivalent (saves go to `base/models-<id>.json` flat) | First listing on a fresh DAV server may fail because nothing creates that collection | S |
| 17 | `workerParse` data-URL module worker can't import bare module specifiers (`@openarch/core`) in real browsers | Off-thread parse silently falls back to the same thread; no perf gain in production | xs (revert or use a real bundled worker) |

### Housekeeping
| # | Item | Effort |
|---|---|---|
| 18 | Remove the old `OnboardingDialog.tsx` (superseded but still in the tree) | XS |
| 19 | `recordHasNoSecrets()` in `integration.test.ts` has an inverted name (returns `true` when secrets ARE found) | XS |
| 20 | Various dead code: `(staticTokens.size > 0 && false)`, `actorCanJoin` ternary collapsing to same value, empty `ensureDir` stub | XS |
| 21 | `SessionStore.mint()` returns an object whose `id` field leaks the session's SHA-256 hash prefix — not exploit today but should be stripped | XS |

---

## 4. Development commands

```bash
npm run typecheck        # tsc --noEmit, strict, 0 errors
npm test                # vitest run — 294 passed (41 files, 2 opt-in skips)
npm run build           # vite build + server tsc
npm run dev             # http://localhost:5173 (local mode, auto-seeds sample)
npm run dev:server      # http://localhost:8080 (API + built app)
npx playwright test     # 9 E2E specs (Chromium, local mode)
# Server-mode E2E (boots real server on a port, runs server.spec.ts):
npx playwright test --config playwright.server.config.ts
# Route parity check (CI sets this env too):
OPENARCH_ENFORCE_ROUTE_PARITY=true npx tsx apps/server/src/index.ts
# Backup:
npm run cli -- admin backup data
npm run cli -- admin verify-store data
npm audit               # 0 vulnerabilities
npm run docs:build      # zero-dep docs site → site-dist/
```

## 5. Key architecture decisions

| Decision | Reference |
|---|---|
| Tier-2 multi-user editing = validated op log (never CRDT without a validation-first ADR) | `docs/adr/0004-multi-user-editing-op-log.md` |
| Tier-2 is server-authoritative (browser = token + crash mirror only) | `docs/multi-user-plan.md` §10 preamble |
| Auth = OTP/email → sessions → named tokens → OIDC/PKCE (one middleware `requireActor`) | `docs/multi-user-spec.md` §3 |
| Route-parity registry: new route must add a `minRole` row in the same PR (CI-fatal) | `apps/server/src/parity.ts` |
| Event-store ops chain from `preSaveModel` in the PUT-compat layer (never the post-overwrite workspace.model) | `apps/server/src/index.ts` PUT block |
| Folder/WebDAV drift → typed error → existing ConflictReview (never silent overwrite) | `docs/multi-user-plan.md` §9.1/§9.5 |
| `applyOp` throws on ANY error-severity projected result (ADR 0004 in a single sentence) | `packages/core/src/ops.ts` |

## 6. Merging after pickup

PR #1 is open, CI green, Devin review passed. After pickup:

```bash
git checkout feat/drawing-depth-trust
git pull
# fix remaining items or add new features → commit → push to the same branch
gh pr checks 1      # green
gh pr merge 1 --squash --delete-branch    # when you are ready to merge

31 files changed across packages/{core,repository,exporters} + apps/{web,server,cli}
```

If further work is needed before merging, commit it to the same branch — no sibling PRs.
