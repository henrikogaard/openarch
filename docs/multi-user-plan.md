# Multi-user OpenArch — safe, privacy-friendly plan

**Date:** 2026-11-19 · **Status:** proposal. Extends roadmap §14, §19 (real-time awareness) and
AGENTS.md §6/§13 (invariants). Nothing here weakens invariant 6 (validation on every write) or
the local-first default.

## 0. Where we are

Already shipped: self-hosted server with owner/editor/viewer RBAC, member management UI, OIDC
(RS256/JWKS, local-issuer-tested + live Keycloak opt-in), per-tab access tokens (sessionStorage,
never disk), group→role mapping, per-workspace WebSocket awareness hub (presence, focus,
comments, save notifications — **read-only relay; writes stay on validated REST**), optimistic
locking + three-way per-entity conflict review, version history + snapshots, comments, audit
log, SCIM users, org scoping, GitHub-backed Git workspaces, Docker + Keycloak compose,
`SECURITY.md` threat model, `npm audit` = 0. Local solo use remains fully offline, anonymous,
and accountless.

The gaps this plan closes, in priority order.

## 1. Identity done right (P0)

1. **Browser login flow.** Replace the raw "paste a token" prompt with:
   - **OIDC Authorization Code + PKCE** (public client): the web app redirects to the IdP,
     stores only the returned *session* (access + refresh token) in sessionStorage, silent
     renews. Keycloak and Entra both documented in `docs/deployment.md`.
   - **Static-token mode stays** for small teams (it is the simplest possible identity), but
     the prompt gains a "who am I?" echo: after entering a token, the UI calls `/api/me` and
     shows the resolved display name so users see *what identity* they're taking on.
2. **WebSocket auth without query strings.** `?token=` can land in proxies' logs. Move to
   first-frame auth: the socket opens, client sends `{type:"auth", token}` as the first
   message, server closes with 4401 if invalid. One-line migration of `useCollab`.
3. **Refresh + expiry hygiene.** 401s from the repository surface a re-login prompt instead
   of a generic "Save failed"; warn 5 min before token expiry.
4. **Subject privacy by default.** Subject identifiers are opaque strings; display names are
   the only PII the product stores beyond what an IdP asserts. Never collect email in
   OpenArch itself (only the IdP holds it). SCIM stores `userName` only.
5. **Admin bootstrap doc, not code.** OPENARCH_ADMIN is documented in `.env.example`; add a
   `doctor --auth` section that prints whether auth is configured safely.

## 2. Data protection (P0)

1. **Encryption at rest (optional, opt-in).** `OPENARCH_DATA_KEY` (32-byte hex) switches the
   persistence layer to AES-256-GCM: on boot, read `models.json.enc` instead of `models.json`
   (a one-migration command converts originals and shreds plaintext). Compose gets a
   `openarch-enc` example. Document loudly: the default remains plaintext JSON because
   self-hosters own their volume — encryption is available where the threat model needs it
   (managed hosting, laptops).
2. **WS hygiene.** Max message size (e.g. 16 KiB), join/ping rate limits in the hub, and
   presence rosters sent only to authenticated members (already true — keep it tested).
3. **Audit log integrity.** Hash-chain each audit entry (`prev = sha256(prev + entry)`),
   verifying on boot; tampering becomes evident. Owners can export the chain.
4. **Backups respect privacy.** `Export all` includes author names — add a `--anonymise`
   flag (replace subjects with `user-1…`, drop comments/audit) for sharing models externally.
5. **Right to leave.** "Delete workspace" already exists; add "leave workspace" for members,
   and a member-removal cascade that keeps comments but re-labels authors as `former-member`
   (configurable: redact vs. keep) — write the choice into the data retention section of
   `docs/privacy.md` (new).

## 3. Multi-user semantics beyond awareness (P1)

Ordered by value/effort; each ships independently and nothing is co-editing.

1. **Element claim locks (soft locks).** A member editing an element sends a claim (TTL
   60 s, heartbeat on focus). Others see "Henrik is editing X" on the canvas node pin and a
   non-blocking warning if they save conflicting changes to a claimed element. Claims are
   *advisory, never enforced server-side* (locking two users into a broken flow is worse
   than a rare three-way review).
2. **Comment threading + resolution.** Comments get `parentId` and `resolved` (type exists;
   the REST/web already carry `resolved`). Unread badge per element pin.
3. **Per-operation attribution.** Version history entries today say who saved; make the
   audit trail per-op by switching the web app's autosave path to the server's
   import/apply-with-ops (or a new `POST /models/:id/ops`) when ops ≤ N, where each op is
   individually validated, individually attributed, and individually revertable. This is the
   OT-lite path roadmap §19 names; it is a large change, so it lands *after* soft locks and
   comments prove the awareness layer is used.
4. **Notifications inbox.** In-app (never email by default — no SMTP dependency, no
   address retention): approvals awaiting you, comments on your elements, conflicts on
   workspaces you own.

## 4. Multi-tenant safety (P1/P2)

Today `orgId` scopes list endpoints, but membership is still the real gate. Once a deployment
has multiple orgs:

1. **Org-scoped identity.** A member's roles are resolved per-workspace (already true);
   add org-level claims so an `org-admin` group grants owner-like list/read within their
   org's workspaces only. Every list/read route is already member-gated — the change is
   a role resolver plus tests; no data moves.
2. **Per-org data segregation.** One data file per org (`/data/<org>.json`) loaded lazily,
   so a corrupted or malicious tenant file cannot take down other orgs.
3. **Cross-workspace leak guards** — a dedicated test class asserting: no route accepts a
   cross-org compare/diff/members lookup without membership (pattern already exists for
   `diff?compare=`; codify as a fuzz-style test over all `:id`-bearing routes with two
   fixtures from different orgs).

## 5. Privacy policy artifacts (P0, docs)

1. **`docs/privacy.md`** — what data exists, where, for how long, and how to delete it:
   - *Browser (local mode)*: models + summaries + journal snapshots in IndexedDB/localStorage
     per origin; nothing ever leaves the machine. Delete = "Delete workspace" or clear site
     data. The crash journal holds only model JSON, never credentials.
   - *Server*: `models.json` (whole workspace payloads incl. comments, audit, approvals,
     waivers, display names, group roles, snapshots — capped at 50), `models.json.users` for
     SCIM user records. Retention: everything lives until a workspace is deleted; snapshots
     garrote with the same cap. Suggested operator policy templates per GDPR art. 5/17.
   - *What the product never does*: telemetry, third-party CDNs/fonts, crash reports, emails,
     cookies (auth uses Authorization headers and sessionStorage only), secret persistence.
   Right side by side: export (backup-all), rectify (it is a modelling tool — edit your
     data), erasure (delete workspace; member removal cascade above), portability (AOEF/JSON).
2. **`docs/deployment.md`** — TLS (reverse proxy; cookie-free), firewalling the data volume,
   Keycloak realm/client/realm-role recipe (matching the compose profile), token handling,
   encryption-at-rest keys, scaling notes (single-process persistence is deliberate; scale
   by org sharding, not StatefulSets, until someone needs it).

## 6. Track record of what we deliberately do not do

- **No CRDT** (roadmap §19 reasoning) and no server-side enforceable locks (§3.1).
- **No password accounts.** Authentication is delegated to existing identity systems
  (OIDC or static tokens). Password reset flows, credential theft surface, and hash
  migrations are other people's core competency and risk.
- **No telemetry, ever.** Usage insight would be opt-in file-based (user emails a report
  generated by `openarch doctor --privacy`) — a command that produces a report *the user
  reads before deciding anything*.
- **No email** for anything; if notifications ever need to travel beyond the app, the
  operator adds a webhook connector (their SMTP, their retention, their choice).

## 7. Sequencing

| Phase | Items | Effort | Test gates |
|---|---|---|---|
| P0a (identity) | OIDC+PKCE login, WS first-frame auth, token-expiry UX, `/api/me` echo | M | E2E login against compose Keycloak (opt-in), integration tests for WS 4401 path |
| P0b (data) | encryption-at-rest, WS limits, audit hash-chain, anonymised backup, `docs/privacy.md`, `docs/deployment.md` | M | persistence round-trip tests (enc on/off), tamper-evident audit test, anonymisation diff test |
| P1a (semantics) | claim locks + UI pins, comment threads | M | conflict-warning tests + focus/claim integration suite |
| P1b (attribution) | per-op API + audit, after 1a proves the load | L | per-op op/persistence/audit test suite, rollback test per op |
| P2 (tenancy) | org claims, per-org shards, cross-org fuzz suite | M/L | org fixture matrix in integration tests |

Everything above the current three-pass review standard is D-D ('definition of done', AGENTS
§12) + the new gates listed; each line in this table can be one PR.

---

## 8. Signup, identity provider, and workspace access — the concrete design

(Answers the three questions posed 2026-11-19: *identity provider? how do people sign up?
permissions and access to workspaces?*)

### 8.1 The four deployment modes — each has its own "signup"

OpenArch is self-hosted, local-first, and deliberately has **no account database**. "Signup"
therefore means a different thing per mode, and all modes share one rule: **authentication is
delegated, never stored** (no passwords, no emails, no reset flows — that risk is the IdP's
core competency or the operator's explicit choice).

| Mode | Identity source | How a person starts using it | Who decides access |
|---|---|---|---|
| **1. Local solo** (default, zero install) | None — anonymous | Open the app. Everything stays in the browser. No server, no account, nothing to sign up for. | Nobody — it is your machine |
| **2. Invite team server** (2–15 people) | Operator-minted named tokens (hashed at rest) | Operator boots Docker; first boot **prints a one-time owner token** to the logs. Owner logs in, then either mints each person a named token or sends them an **invite code** (role baked in). The person pastes the invite code at first login → member. | The owner |
| **3. SSO org server** (any size) | OIDC: Keycloak (compose profile), Entra ID, Google Workspace, Authentik/Authelia | Person signs in with SSO (PKCE); first login auto-creates their **personal workspace**; team workspaces arrive via (a) invite code or (b) **group→role mapping** from IdP claims. | The owner + the IdP group structure |
| **4. Public demo** | SSO or lock behind a proxy | **Off by default**, and it stays off** — open registration contradicts the privacy stance and is the classic self-hosted takeover vector. If someone wants a demo, run it read-only behind a reverse proxy. | Deliberately unsupported |

The answer to *"which identity provider?"*: **Keycloak for anything you must host yourself
(the compose profile already exists), Entra/Google for orgs that already run SSO.** The
product supports any OIDC RS256 issuer and treats the IdP as authoritative for identity and
MFA. Password accounts are an explicit non-goal (§6).

### 8.2 Signup flow per first-time persona (what the new user literally sees)

**Operator (mode 2/3, first boot)**
1. `docker compose up` → server detects no admin credentials are configured.
2. Generates `openarch_admin_<32-char>` and prints it **once** to stderr:
   `OpenArch: first boot — owner access token: … (copy now; shown once; store hashed)`.
3. Stores only the SHA-256 hash; `openarch init --out .env` additionally writes a complete
   starter env (token, JWT secret, SCAN hint) for restarts without re-checking logs.

**Invited teammate (mode 2)**
1. Receives out-of-band: a URL `https://arch.internal/?invite=<32-char code>` (the URL
   contains no identity data — share it over Signal/Teams/whatever; the product never
   emails anything).
2. Logs in (their token, minted by the owner in Settings → People & tokens — shown once,
   stored hashed) or, in SSO mode, just signs in.
3. The app opens directly on **Redeem invite**; one click → member of that workspace with
   the role the owner chose when minting the code. Audit log records both the invite
   creation and the redemption.

**SSO user first login (mode 3)**
1. Browser redirects to the IdP; returns with `code` → PKCE exchange → access token in
   sessionStorage only.
2. Empty home screen shows exactly two things: **Redeem invite code** and — because
   `OPENARCH_PERSONAL_WORKSPACE=true` by default — their fresh **Personal workspace**
   (owned by them, member-gated so nobody else can read it).
3. Team workspaces appear only when someone invites them or their IdP group maps to a role.

### 8.3 What gets built (concrete pieces, in order)

| Piece | Where | Detail |
|---|---|---|
| **One-time owner bootstrap** | server auth | No admin creds configured → generate, print once to stderr, persist SHA-256. Removes today's "hand-edit OPENARCH_TOKENS JSON" step. |
| **Named tokens ("People & tokens")** | server + Settings UI | Owner creates tokens `{subject, displayName?, expiresAt?}`; stored **hashed**; displayed once; revocable list in Settings. This is user lifecycle without an IdP, and it retires plaintext-in-env tokens. Constant-time compare (pattern already used for SCIM). |
| **Invites** | server + home UI | `POST /workspaces/:id/invites {role, ttlDays?}` (owner) → `{code,url}`; `GET` list; `DELETE` revoke; `POST /invites/redeem {code}` (any authenticated user) → membership with the baked role. 128-bit codes, single-use, default 7-day TTL, redemption rate-limit + lockout, fully audited. |
| **OIDC + PKCE login** | web | Authorization-code + PKCE public client; refresh with silent renew; 401 surfaces a re-login prompt instead of a save failure. Static-token path remains for mode 2. |
| **WS first-frame auth** | hub | Replace `?token=` with `{type:"auth"}` first message (proxy-log hygiene; already flagged in §1.2). |
| **Personal workspace on login** | server | `OPENARCH_PERSONAL_WORKSPACE` (default true): create-on-first-login, owner-only. Nothing shared, nothing listed to others (member gating already enforces this). |
| **`/api/me` echo** | web login dialog | After entering a token, show the resolved display name so people see *which identity* they took on before working. |
| **IdP recipes** | `docs/deployment.md` | Keycloak realm/client/role recipe (maps to the compose profile), Entra app registration, Google Workspace, Authentik. Include "keep `sub` stable; display `preferred_username`; map `groups`". |

### 8.4 Permission model — the full matrix, single source of truth

Zones: **workspace data** (model, views, comments, snapshots), **governance** (approvals,
waivers), **admin** (members, tokens, invites). Anonymous column exists only for explicitly
open deployments (`OPENARCH_REQUIRE_AUTH=false` — the local-loops posture, warned about in
`.env.example` and `docs/deployment.md`; with auth on, it does not exist).

| Capability | Anonymous¹ | Authenticated non-member | Viewer | Editor | Owner |
|---|---|---|---|---|---|
| See workspace in list / open | ✅¹ | ❌ | ✅ | ✅ | ✅ |
| Read model, views, history | ✅¹ | ❌ | ✅ | ✅ | ✅ |
| Save edits (validated PUT) | ✅¹ | ❌ | ❌ | ✅ | ✅ |
| Own conflict review outcome | — | — | — | ✅ | ✅ |
| Comments (post) | ✅¹ | ❌ | ❌ | ✅ | ✅ |
| Snapshots: create / restore² | ✅¹ | ❌ | ❌ | ✅ | ✅ |
| Approvals: approve / reject baseline | ✅¹ | ❌ | ❌ | ❌ | ✅ |
| Waivers: add / remove | ✅¹ | ❌ | ❌ | ❌ | ✅ |
| Members & group→role mapping | ✅¹ | ❌ | ❌ | ❌ | ✅ |
| Named tokens (create/revoke) | — | ❌ | ❌ | ❌ | ✅³ |
| Invites: create/revoke | ✅¹ | ❌ | ❌ | ❌ | ✅ |
| Redeem invite code | — | ✅ | ✅ | ✅ | ✅ |
| Real-time room (presence/focus) | ✅¹ | ❌ | ✅ | ✅ | ✅ |
| Delete workspace | ✅¹ | ❌ | ❌ | ❌ | ✅ |

¹ *Open mode default-off recommendation; with auth on this column is empty.*
² *Restore is deliberately owner/editor — an editor triggering restore snapshots first, so it
stays reversible.*
³ *Token minting is a server-operator concern, not per-workspace: gate to the bootstrap
owner (subject == `OPENARCH_ADMIN`) — the person who controls the container.*

Design rules the matrix encodes (and the tests must therefore assert):

- **Membership is the only gate for reads.** No route ever answers for a non-member, and
  *workspace names/counts are invisible to non-members* (list filtering already works this
  way — the cross-org fuzz suite from §4.3 keeps it true for every future `:id` route).
- **Governance sits one role above editing** (waivers/approvals owner-only, as shipped).
- **Invites flip a non-member into a member; they never grant owner.** Escalating to owner
  happens only by an existing owner editing members — invite minting cannot become a
  privilege-escalation path even if a code leaks.
- **Tokens are identity, not permission.** A named token says *who you are*; every capability
  above still flows from membership per workspace. This is why token minting is admin-scoped
  and hashed: leaking the token store yields identities, not access to other people's models.
- **Everything is audited with the actor.** Invite create/redeem, token create/revoke,
  member edits — all owner actions carry subject + timestamp (the hash-chained audit from
  §2.3 then makes the trail tamper-evident).

### 8.5 What this plan deliberately still does not add

- **No passwords, no email addresses, no verification emails, no account settings page.**
  If a deployment wants those, they run Keycloak and get all of it there.
- **No "request access" button.** The owner's contact channel is out-of-band by design; the
  product does not become a messaging surface.
- **No open registration**, even behind a flag: a misconfigured flag becoming a public
  write-capable instance is the worst-case failure mode of a self-hosted tool, so the flag
  does not exist to misconfigure.
- **No cross-workspace browsing for non-members** — including super-admins: the bootstrap
  owner can *manage identity* (tokens/invites/membership via the API) because they control
  the host, but the UI never surfaces other people's models to them beyond what membership
  and the org-scoped portfolio already grant. Keep the operator honest with the same gates.

### 8.6 Build order and gates

| Step | Ships | Test gate |
|---|---|---|
| 1 | Bootstrap token + `openarch init` | integration: first-boot print-once, hashed verify, reuse rejection |
| 2 | Named tokens (hash store + Settings UI + `/api/me`) | integration: mint/revoke/constant-time; UI test for shown-once flow |
| 3 | Invites (API + home redemption UI) | integration: single-use, expiry, lockout after N attempts, audit entries; escalation tests (invite can never mint owner) |
| 4 | OIDC+PKCE + WS first-frame auth | E2E login against compose Keycloak (opt-in job), WS replay-auth test |
| 5 | Personal workspace + empty-home UX | member-gating regression (others never see it), fuzz-suite entry |

Steps 1–3 are mode-2 complete (a small team can run entirely without an IdP); step 4 is
mode-3 complete. Every step is one PR against the D-D standard, and none of them changes the
permission matrix in 8.4 — additions to capabilities require updating this document first.

