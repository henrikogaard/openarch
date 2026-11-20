---
section: Implementation spec
title: Multi-user, tier-2 hardening, storage tiers — build-ready spec
status: Approved for implementation (do not implement from this doc without reading `AGENTS.md` §6/§12 and `docs/adr/0004-multi-user-editing-op-log.md`)
owner: Henrik (decisions) — implementation agent picks PRs top-down
references:
  - docs/multi-user-plan.md §8–§12 (design rationale + user-visible contracts)
  - docs/adr/0004-multi-user-editing-op-log.md (op-log decision)
  - docs/roadmap.md §19 (CRDT reasoning), docs/code-review.md (guards in place)
date: 2026-11-20
---

# 0. Meta

Every PR in this spec is **independently reviewable and greenable** — no PR depends on an
unmerged PR that is not named in its *Depends on* line. Each PR must satisfy the repo D-D
(`AGENTS.md` §12): typecheck, full unit suite, build, E2E (local + server-mode where the PR
touches server flows), docs updated, no secrets in the diff, no new dependency
vulnerabilities. Each PR also names one **negative gate**: what must keep working that could
plausibly break (regression named).

Out of scope for this epic (binding): CRDT editing (ADR 0004 forbids without a validation-first
ADR), password accounts, open registration, WebDAV wallet **defer** (spec kept, no PR), per-org
sharding (defer), encryption-at-rest (separate spec, §2 of the plan), SQLite/Postgres storage
swap (per §11.3; only the *annotations* are laid out), mobile UIs.

# 1. Foundation decisions already made (binding for every PR)

| Decision | Where |
|---|---|
| Tier-2 collaboration = server-authored **validated op log**; every op must pass `validateModel` before entering the log | ADR 0004 |
| Centralized tier-2 storage (browser = token + crash mirror only, never canonical) | plan §10 preamble |
| Tier-2 login requires auth: OTP-email → session cookie (browser) or Bearer (CLI/MCP); named tokens & OIDC/PKCE interoperable in one middleware | plan §11.1 |
| Both Resend and SMTP from day one; from-address set at runtime in `config.json` | plan §10.4 |
| Invites can never grant owner role; owner-granted only | plan §8.3 |
| Permissions stay **workspace-coarse** (viewer/editor/owner); no element-level ACL | plan §11.2 |
| Folder storage, backup commands, session cookies — all **cross-platform**; no Node-service daemons for backups (cron only) | plan §12.3 |
| Existing E2E suite + CI layouts must stay green (local + server mode); server-mode E2E boots real server via `playwright.server.config.ts` | existing |

---

# 2. Common data formats (all PRs)

```
data/config.json            # runtime admin config (created on first boot; env vars bootstrap defaults only)
{
  "version": 1,
  "auth": { "bootstrapTokenHash": "sha256:<hex>" },
  "mail": {
    "provider": "resend" | "smtp" | null,
    "fromName": "OpenArch on <host>",
    "fromAddress": null,
    "replyTo": null,
    "resend": { "apiKey": "<plaintext-at-rest, masked on GET>" },
    "smtp": { "host": null, "port": 587, "secure": false, "user": null, "pass": null }
  },
  "invite": { "defaultTtlDays": 7, "retentionDays": 30, "outstandingCap": 100 }
}
```

```
data/sessions.json         # sessions may persist; hashed only
[ "sha256:<session-id>" ] + meta per row: { subject, displayName, kind: 'otp' |
  'token' | 'oidc', createdAt, lastSeenAt, expiresAt, revokedAt? }
```

```
workspace.invites         # migrated field on existing workspace records (existing rows: [])
[ { id, codeHash: "sha256:<hex>", displayPrefix: "abcd…", role: 'viewer' | 'editor',
    email?: string, invitedBy: subject, createdAt, expiresAt, acceptedAt?,
    revokedAt?, acceptedBy? } ]
```

```
Op (one JSON line inside a shard)
{ "seq": 23, "actor": "subject", "at": "ISO",
  "kind": "element.update" | "element.delete" | "element.create" | "relationship.*" |
          "view.*" | "property.*" | "domain.*" | "artefact.*" | "member.add" | ... ,
  "ref": "<entity-id>", "before": {…}, "after": {…}, "idempotencyKey": "sha256:<hash>" }
```

```
Backup manifest (bandaged into §12 contract)
{ "format": "openarch-backup", "formatVersion": 1, "createdAt": "ISO", "serverVersion":
  <version>, "files": [ { "path", "bytes", "sha256" } ], "secrets": false, "anonymised": false }
```

---

# 3. Track A — Identity hardening (PR sequence)

## A1. One-time owner bootstrap — Status: owner-ready, ships first

**Depends on**: —
Add to `apps/server/src/auth.ts` and `index.ts`: on boot with `OPENARCH_REQUIRE_AUTH=true`,
if **no admin credential** is configured (`OPENARCH_TOKENS` empty and no
`config.json → auth.bootstrapTokenHash`), generate `openarch_admin_<32-char>` token
(crypto.randomBytes), print **exactly once** to stderr:

```
OpenArch: first boot — owner access token: <token>
(Copy it now: it is not shown again and only its hash is stored.)
```

Store `sha256:<hex>` in `data/config.json`. Subsequent boots stay silent. Running with
`OPENARCH_ADMIN_TOKEN=<token>` env at any time replaces the hash (recovery pattern for
lost bootstrap tokens, documented in `docs/deployment.md`; print a confirmation warning, still
masked). Compare in constant time with the existing `timingSafeEqual` helper.
**Files**: index.ts (init sequence), auth.ts (bootstrapTokenHash check), types (config store
shared type), auth tests.
**Acceptance**: boot with clean volume prints a token whose printed value authenticates
`GET /api/me` with role `owner`; the next boot prints nothing, the token still works; replacing
the hash via env invalidates the old one; sessions never persisted as plaintext there.
**Test gates**: integration tests extending `apps/server/src/integration.test.ts`; negative gate:
with `OPENARCH_TOKENS` set the auto-bootstrap stays completely silent.
**Effort**: S.

## A2. Named tokens ("People & tokens") — owner-only admin CRUD

**Depends on**: A1 (needs config/bootstrap to exist so minting is tied to admin authority).
Zero-cost migration of legacy `OPENARCH_TOKENS` env entries: at boot, keys in the env are
imported into the named-token store (hash only) so an existing install keeps working; env
remains the operator's fallback recovery set. Rotation flow (settings screen) is a later PR
(A9); endpoints here are the backend layer.

```
POST   /api/admin/tokens   { subject, displayName?, expiresAt? }  →
       { id, token }  (201; token body = only ever time the plaintext is shown)
GET    /api/admin/tokens          → [ { id, subject, displayName, createdAt, expiresAt,
       lastUsedAt?, last4 } ]
DELETE /api/admin/tokens/:id      → 204 (404 if unknown)
```

**Rules**: plaintext is displayed **once** (response body) and never stored — `sha256` only;
`admin` role required for all three (bootstrap owner only, not workspace owners — they get
member management only); each use updates `lastUsedAt`; subject strings must not collide with
an existing subject or the response is `409`.
**Acceptance**: mint → authenticate works; list shows last4 not prefix of token; delete →
requests with that token start failing; on restart list is stable (persisted).
**Files**: new `apps/server/src/tokens.ts` (store + basic CRUD), admin routes on
`apps/server/src/index.ts`.
**Test gates**: integration CRUD test + rotation + constant-time hint not asserted via timing
(fuzz instead: near-miss token is rejected).
**Effort**: S–M.
**Freq-by-freq**: named tokens are only the *credential*; permissions stay workspace/member as
today. `roleFor(...)` on subject comes from member lists – no change requested here.

## A3. Invites (core: create/redeem/revoke, role-baked, email-less)

**Depends on**: —
`workspaces/:id/invites` routes (owner-only for create/revoke, self-service redeem):

```
POST   /api/workspaces/:id/invites  { role: 'viewer'|'editor', ttlDays?, email? } →
       { id, code, url, expiresAt }       # 201; code = 128-bit base32, shown once
GET    /api/workspaces/:id/invites        # owner-only → listing of invites with
                                          # displayPrefix only (never full codes)
DELETE /api/workspaces/:id/invites/:id    # owner-only revoke → can no longer redeem
POST   /api/invites/redeem  { code }      # ANY authenticated subject → 204, adds
                                          # subject to that workspace's members at
                                          # the invitation's role; 403 when expired/
                                          # revoked/already-redeemed/unknown code
```

**Rules**: `sha256(code)` stored; single use (delete/move to `acceptedAt` on redemption);
outstanding invite count cap per workspace (from config, default 100); locked-out after ≥10
failed redemption attempts per code (`codeHash` workspace aggregates lock the code, unlock via
a new invite from owner only); role can never be `owner` — request is `400`.
Audit records invite create/redeem/revoke (actor + workspace). Reusing the existing
`relationship.dangling`/`roleFor` guards: redemption must atomically add the member — no
partial writes.
**Acceptance**: owner invites viewer-role, redeemer becomes member with viewer role and is
denied editor actions; expired/revoked rejected; role=`owner` rejected; audit entries exist;
a viewer **cannot** create an invite (403).
**Files**: `apps/server/src/index.ts` (new routes + workspace record field `invites` + audit
calls), repository client (invite return types), web Actions: create/redeem flows are UI PR
A8.
**Test gates**: extend integration.test.ts, invite lifecycle matrix — [valid, expired,
revoked, reused, wrong-selected role, requester non-owner], exactly one 201 and one 204 in the
set; audit chain integrity passes.
**Effort**: M.

## A4. OTP login + sessions (email code → session, cookie + Bearer)

**Depends on**: structured to work standalone; the **mail adapter (D1)** is optional here: OTP
emails fall back to **console log** ("mail not configured: printed to logs") so this PR is
shippable/decoupled from mail.

```
POST /api/auth/otp/request { email }  → 204 always (generic; unknown emails never confirm)
POST /api/auth/otp/verify  { email, code }  → 200 { token, subject, displayName }
POST /api/auth/logout      → 204
```

**Rules**:
- OTP = 6 digits, single use, TTL 10 min, stored `sha256` in memory only (lockouts in memory
  too; restart loses codes — the next login re-requests — that is acceptable and spec'd).
- Rate limit: max 10 outstanding code emails per subject per hour, max 5 failed verifies per
  code per IP, global per-IP request cap 60/hour. All in-memory (fastify rate-limit or simple counter).
- Requests for unknown emails **must not be telemetry** for guessing (same 204, no email sent).
- Verify response sets `Set-Cookie: openarch_session=<token>; HttpOnly; Secure;
  SameSite=Lax; Path=/` where `<token>` is the same session id, and also returns the raw
  token in the body (non-browser clients use `Authorization: Bearer <token>`).
- Session store: `data/sessions.json`, hashed tokens (see §2), idle expiry
  `OPENARCH_SESSION_IDLE_DAYS` (default 30), `lastSeenAt` refresh on each authenticated
  request; absolute expiry 90 days hard.
- Middleware: all `/*` non-auth routes accept either named token (A2 hash path) or session id
  (resolved to subject via sessions store). `requireAuth` stays one function; the PR refactors
  `auth.ts` so `resolveActor` tries session cookie → Bearer token → hash in named-token store,
  in constant time for the token path.
- CSRF: since SameSite=Lax plus all unsafe methods are JSON+same-origin (guard: POST/PUT/DELETE
  require request's `Origin` equals the request host when cookie auth is in play; keep Bearer-only
  clients exempt), spec the `Origin` check in code as a precondition wrapper, not a see-it-later.
- Auto-auth sequence on web side is a separate UI PR (A8); nothing here changes when
  `OPENARCH_REQUIRE_AUTH=false` (existing open posture unaffected).
**Acceptance**: request→verify→authenticated me→logout round-trip works from both cookie and
Bearer; unknown email gets no code but same 204; 6th verify attempt on a locked code gets 429;
restart clears live codes and lockouts but sessions persist, hashed.
**Test gates**: full matrix in integration.test.ts (+ log-mode fallback test when mail absent
via stub console), E2E server-mode login happy + wrong-code path.
**Effort**: M.

## A5. OIDC + PKCE login (public client code flow)

**Depends on**: none (works beside A4).
```
GET  /api/auth/oidc/start    → { authorizationUrl, state, codeVerifier }
POST /api/auth/oidc/callback { code, state, codeVerifier } → 200 { token, subject,
       displayName }    # cookie+body identical to A4 verify response
```
**Rules**: subject = the IdP's stable `sub` (never email); groups claim → existing
`group→role` mapper; PKCE S256; `state` persisted server-side with the verifier and redirect
URL, TTL 10 min, single use; token exchange and JWKS validation reuse the existing common
verification path (RS256) so no second crypto; sessions minted from this path reuse A4's
session store. `OPENARCH_OIDC_CLIENT_ID`, `OPENARCH_OIDC_REDIRECT_URI` are the only new env
vars. Spec'd as **server-exchanged** to get around CORS/IdP limitations and keep secret-free
(public client).
**Acceptance**: live Keycloak (compose profile) login round-trip, subject matches the
`sub` claim, session works against every existing route, logout kills it; only configured
groups map (no leak when `groups` absent).
**Test gates**: opt-in live-Keycloak integration test (skipped unless env set, see existing
`apps/server/src/oidc.live.test.ts`), for CI add an opaque mock server unit test for the PKCE
endpoints; negative gate: existing OIDC env config acceptance path from previous work unchanged.
**Effort**: M.
**Relationship to CRDT/op-log**: orthogonal; ships in parallel.

## A6. API parity & auth doc sweep

**Depends on**: A2, A3, A4 (or A5) — runs after whichever lands first.
Sweep all non-`admin` routes for presence of `reqAuth` or explicit-open, across `apps/server`,
and reflect new knowledge in `docs/deployment.md` (bootstrap/token/OTP/OIDC/Sessions
guide + `docs/SECURITY.md` token rows). This is **not** covered by E1 (Parity Runner) —
E1 is the CI/regression harness; A6 is the one-time doc + route annotations pass.
**Acceptance**: every route in `app.printRoutes()` appears in a hand-curated parity matrix in
docs/deployment.md with required-role column, and PR review adds rows for every new route.
**Effort**: S.

# 4. Track B — Storage adapters

## B1. FolderRepository adapter + Storage settings UI

**Depends on**: cross-cutting with A; no exact requirement on A-PRs.
Scope: a new `packages/repository/src/folder.ts` implementing the existing `ModelRepository`
interface, plus a Storage section in Settings. Uses `showDirectoryPicker` (Chromium; warn
otherwise). Workspace store files:
```
<chosen>/models/<id>.json     # schemaVersion-stamped parseNativeModel round-trip
<chosen>/journal/<id>.json    # crash-journal mirror written on every autosave tick
<chosen>/.openarch-index.json # { workspaceId: { updatedAt, sha256 } } written on save
```

Drift rule on open: if file `updatedAt` > index's recorded `updatedAt` ⇒ external change ⇒
surface `ConflictReview` with (theirs)=file, (yours)=journal mirror (journal takes precedence
over IndexedDB state); never silently last-writer-wins.
**Rules**: mirror happens on the existing autosave tick (1.5 s debounce, 15 s cap); handle
re-grant persisted in IndexedDB; "Adopt folder" sweeps `<models>/*.json`, adopts any
workspace id found; a workspace missing from the folder is synced down (not generated blank);
Export-all format compatibility byte-for-byte.
**Acceptance**: attach → edit → reload → reattach keeps state; second-machine adoption works;
drift opens the conflict dialog; no E2E-regression in server mode when folder is disabled.
**Test gates**: Playwright (Chromium-only, skipOtherwise) happy+drift+reattach; unit tests for
the drift rule with fixtures.
**Effort**: M.

## B2. `openarch admin backup/restore/verify-store`

**Depends on**: works today against the current `models.json` store; the op-log PR (C1–C4)
adds per-workspace layout support as its own **non-blocking** follow-up.
Commands, flags, manifest per §12 of the plan. Add tar creation (pure Node, no new deps
— use existing `fflate` which is already in the tree), SHA-256 manifest, `--dry-run`,
`--anonymise`, `--workspace`, `--at <seq>` (the `--at` flag is accepted and errorred
"requires event-source store (coming in Track C)" until C2 lands — the flag surface stays
stable).
**Acceptance / test gates**: the §12.4 table, adapted: whole-volume equivalence restore,
fresh-volume restore, single-workspace surgical restore, corrupt manifest rejection,
`--anonymise` redaction grep, secrets-masked default.
**Effort**: M.

# 5. Track C — Collaboration op log (ADR 0004 implementation)

## C1. Core op types, apply & validate helpers (pure, no server dependency)

**Depends on**: —
New `packages/core/src/ops.ts`:
```ts
type Op = { seq, actor, at, kind, ref, before?, after? }
applyOp(model: Model, op: Op): Model      // pure; throws ValidationErrorKind
canApply(model, op): ValidationIssue[]     // same gate as validateModel
kind enum, per-kind before/after schema, serialiser/parser for shard lines,
idempotencyKey = sha256(actor|kind|ref|after-canonical)
```
`applyOp` is a projection of the existing helpers (create/update/delete semantics equal to
the current model functions: e.g. `element.delete` == `removeElements([ref])` so all the
invariant work of the past week is reused, not forked).
**Test gates**: unit suite per kind (element, relationship, view, domain, artefact,
member, comment, approval, waiver), "invalid op can never produce an invalid model"
(fuzz group: 300 random ops applied to seeded models always validate) .
**Effort**: M–L.

## C2. Server event store + `GET /events` + WS broadcasting

**Depends on**: C1. **Optional**: may ship before op client (C3) so server-side history starts
recording from full-model PUTs by decomposing the diff into ops (via `buildOpsFromDiff`) —
this means the log is complete from day one even before the client PR, and C3 becomes an
optimization (smaller writes, live collaboration) not a migration risk.
`data/workspaces/<id>/{meta.json, events/…, snapshots/…}` per §10.2. On boot, existing
`models.json` migrates automatically (snapshot 0 + one synthetic op per workspace from the old
file), atomic write order: snapshot then meta pointer then live. The full-model PUT route
becomes a **compat layer**: internally decompose to ops and append (merge semantics preserved).
Broadcast via the existing RT hub: new message type `{type:"ops", workspaceId, ops:[…]}` to
all room members.
**Acceptance**: old models.json boots + list/save/restore E2E still green with legacy paths;
restore-from-backup keeps working with B2 extension; events/snapshot compaction at the
documented thresholds.
**Test gates**: integration — PUT produces a shrinkable op trace, shard rotation at 1 MB /
10k events, snapshot every 200 ops, replay matches `workspace.version` monotonic; kill-storm
test from A3-verifier CI slot runs here.
**Effort**: L (split: server store, migration, snapshotting, broadcast client).

## C3. Web live-editing client

**Depends on**: C2. Autosave / explicit save switches from full-model PUT to op batches (lane
per view), with ops individually validated client-side before send. Conflict/lock path stays
via `HttpModelStore` per current PRD? No — defines a new client API:
```
POST /api/workspaces/:id/ops      # { ops: Op[] } → 207 { applied: n, rejected: [{seq, rule,
                                                     message}] }
```
This request doesn't edit concurrent-mod conflicts: ops rejected under exact IDR check (the
server either applies or rejects per op, never merges); ConflictReview opens on rejection when
the client's local replay produces divergence.
**Acceptance**: two browser tabs in server mode see each other's element adds/deletes within
seconds (E2E with two contexts, no conflict triggered when editing different elements);
existing E2E suite still green; rejected op surfaced as a toast with the validation rule.
**Effort**: M.

## C4. `admin restore --at <seq>` + verify-store extension

**Depends on**: C2. Point-in-time restore enunciates §12's reversal-op protocol (restore
writes a reversal op, never rewrites history); `verify-store` replays and reports per
workspace.
**Effort**: M.

# 6. Track D — Mail

## D1. `MailAdapter` (both drivers) + config store + admin endpoints

**Depends on**: A1's config-store mechanism.
```
interface MailAdapter { send({ to, subject, text, html }): Promise<{ delivered, providerMessage?
}>; describe(): ProviderInfo }
```
Resend driver: `POST https://api.resend.com/emails` with Bearer key; SMTP driver:
`nodemailer` (new server-side dep, pinned version, zero vulns). Default delivery when no
provider configured = **console fallback** used by A4's OTP path.
Admin endpoints (admin role only):
```
GET  /api/admin/mail       → masked config (key material: last4 only)
PUT  /api/admin/mail       → persists config; rejects unrecognized provider fields
POST /api/admin/mail/test  { to } → delivers using current config and reports
```
**Rules**: mail config is the ONLY place API keys are stored (plaintext at rest inside the
server's own protected `config.json` — the same boundary ADR/plan treat it as: never
returned by API; excluded from backups by default (B2); env vars are bootstrap-time copies
not editable values). Token allows: request rate cap 5/hour for the test endpoint. Errors
never echo the raw key back.
**Acceptance**: config persists, masked GET response; test-send works for each provider via
local harness (Mailpit container in compose for SMTP tests; a mocked fetch for Resend —
no network in CI); no provider configured → generic 400/503 "mail not configured" with
console-fallback flow intact (A4 unaffected).
**Effort**: M.

## D2. Setup screen & validated invite-by-email enablement

**Depends on**: D1.
Web UI in Settings → Email (admin role only): provider form; "Send test email" blocked until
a successful `POST /api/admin/mail/test` response; invite-by-email UI is separately disabled
server-side (`emailDeliveryEnabled` derived from config + a confirmed test) — enforced at the
invite-create endpoint, not just client-side.
**Acceptance**: creating an email invite without a validated provider is rejected with the
invoice-error; after validating, the same call succeeds and delivers.
**Effort**: S–M.

## D3. Email invite delivery + magic-link accept

**Depends on**: A3 (invite core) **and** D1+D2.
When `email` provided on invite-create and delivery enabled: send email with the base
`#invite=<code>` link; mail body contains the workspace name, role, expiry date. No
per-user data beyond the invitee's address; retention of the email field *already handled* by
A3's `INVITE_RETENTION_DAYS` sweep.
**Acceptance**: create → mail received in Mailpit (CI) containing the link → new user pastes
link → redeem succeeds only with a session/token; no email leak into logs.
**Effort**: S (on top of A3+D1).

# 7. Track E — Guards & ecosystem

## E1. Endpoint-parity runner (CI regression)

**Depends on**: nothing; **build this EARLY so every later route lands with parity tests in the same PR**.

Mechanism: a registry in the integration-test fixture listing `{ method, path, template,
minRole }` for every `:id`-bearing route extracted at test-bootstrap time from
`fastify.printRoutes()`; a registry-level assertion fails CI when a route exists but is not
registered (the "new PR must add a row" convention becomes **mechanical**, not memetic).
Five-role fixture subjects (stranger / auth-non-member / viewer / editor / owner) map exactly
to plan §8.4's matrix. The runner re-uses the seeded fixtures; no mocks.
**Acceptance**: temporarily removing an `requireMember` guard from one route makes CI fail
(identifies the exact route).
**Effort**: M (mechanism) + S per-PR (each new route's row thereafter).

## E2. Public-BYO hardening pass

**Depends on**: B1 (folder) — because the "attach your own data" nudge lands with it.
Static bundle no-storage audit in CI (grep built JS for `fetch(\`https?://<PUBLIC-ORIGIN>\``, plus
any non-relative sendBeacon), privacy statement page, and a warnings banner in the public-host
distribution (`VITE_PUBLIC_HOST=1` build env shows it).
**Effort**: S.

# 8. Environment, compose, docs changes (cross-track summary)

New/changed env vars (each with `.env.example` entry and `docs/deployment.md` section):
- `OPENARCH_ADMIN_TOKEN` — override/reset the bootstrap admin token at boot.
- `OPENARCH_SESSION_IDLE_DAYS` (default 30).
- `OPENARCH_OIDC_CLIENT_ID`, `OPENARCH_OIDC_REDIRECT_URI` (A5).
- `OPENARCH_INVITE_TTL_DAYS`, `OPENARCH_INVITE_RETENTION_DAYS`, `OPENARCH_INVITE_CAP` (config
  defaults, env-var overrides honoured on first boot into `config.json`).
- `OPENARCH_MAIL_PROVIDER`, `OPENARCH_RESEND_API_KEY`, `RESEND_FROM`, `SMTP_HOST/PORT/USER/PASS/SECURE`.
- No new **default-on** flags: an operator running the plain Docker `compose up` gets auth
  **enabled automatically** with the A1 bootstrap flow (this is the tier-2 posture: login
  required, alone on a LAN). `OPENARCH_REQUIRE_AUTH=false` remains available for local dev.

Sample data & UI seed guard: rt/OTP tests should not collide with the seed sample; keep the
Existing seeded sample flow intact and keep using it as the fixture workspace in parity tests.

# 9. Sequencing map (dependency graph → suggested PR order)

```
A1 (bootstrap) ──> A2 (named tokens) ──> A3 (invites core) ─┬─> D3 (email delivery)
                                                            ├─> D1 (mail adapter)
A4 (OTP+sessions)  (needs only D1's console fallback embedded in D1, stub-born independent)
A5 (OIDC+PKCE)
A6 (route-parity annotations)  after A2..A4
B1 (folder)  independent
B2 (backup CLI) after A1 (config store) — independent of A2..A5 for the *current* store
C1 (ops core) independent — start early, it's prerequisites for C2/C3/C4
C2 (server event store) depends on C1
C3 (live client) depends on C2
C4 (restore --at) depends on C2, extends B2
D2 (setup screen) after D1
E1 (parity runner) ship FIRST among E; ideally first PR of the whole epic
E2 (BYO hardening) after B1
```

Suggested first five PRs (order + reasoning):
1. **E1 parity runner** — mechanical guard before any new routes exist.
2. **A1 bootstrap** (S; unblocks A2/B2/config store).
3. **A2 tokens + admin CRUD** (S–M).
4. **A3 invites core** (M).
5. **A4 OTP+sessions** (M) — after this the tier-2 login story is complete without mail.

# 10. Acceptance summary (epic-level DoD)

- A new operator: `docker compose up` → captures a one-time bootstrap token from logs →
  logs into the web app via OTP (email or console-fallback) → invites a teammate by code →
  the teammate logs in and **sees only the workspace they were invited to** (no other
  workspace names in list responses) — the membership/visibility guarantee verified by E1.
- With C1–C4: two users edit the same workspace concurrently; all writes go through op
  validation (any invalid op is rejected and shown with its rule); history restores to any
  point (`--at seq`); no operation can enter the store that would render export invalid.
- With B1/B2: solo user attaches a folder, works from two machines, uses timestamp drift →
  three-way review, and backs up the instance with one CLI command restoring in <5 minutes.
- Metrics: no functional E2E regressions (all existing local + server suites stay green),
  0 npm audit vulnerabilities maintained, and every new route shows in the parity matrix.

*Any deviation from this spec (adding a flag, loosening a role, storing anything new in the
browser) requires updating this document in the same PR.*