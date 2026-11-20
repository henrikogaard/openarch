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

---

## 9. The three product tiers (2026-11-20) — storage, mail invites, bring-your-own public app

Elaborates the proposal: **solo-local · team-server · public BYO webapp**. All three share one
rule from the invariants: the UI only ever talks to a `ModelRepository` (AGENTS §6). Every store
below is therefore just another adapter — no forked product, no divergent metamodel.

### 9.1 Tier 1 — Solo local (default): where data lives, and how it survives many computers

**Today**: workspaces in IndexedDB per browser profile (+ crash journal + PWA shell). Real
gaps: browser storage can be evicted by quota/ITP policies, and profiles don't roam between
machines. Both fixes come from one feature: **attach a real folder**.

```
Settings → Storage →
  ● Browser (default — zero setup, everything local, crash journaled)
  ○ Local folder      (File System Access API — real files you can see, sync, back up)
  ○ WebDAV share      (Nextcloud / Syncthing+webdav / any DAV server)   [P1, same adapter]
  ○ Git repository    (already shipped — GitHub Contents store)
```

- **Local folder** (`showDirectoryPicker`, Chromium desktop ≥ 86; Firefox/Safari fall back to
  browser mode with an explanatory note): the app mirrors every workspace to
  `<folder>/models/<id>.json` (the same schema-versioned native JSON the Git adapter already
  round-trips) plus `<folder>/journal/<id>.json` mirrors of the crash journal. The directory
  handle is persisted in IndexedDB, so "reattach later" is one permission re-grant click; on a
  different computer you point the app at the (synced) folder and it adopts the files — ids are
  stable.
- **Why "database" is the wrong tool here**: browser-local SQLite (sql.js/WASM) adds complexity
  without solving roaming — it is still per-profile blob storage, evictable like IndexedDB. A
  *server* database is the right answer only when multiple humans write concurrently — that is
  tier 2. The JSON folder **is** the database: schema-versioned, human-diffable in PRs, and
  already the format every other adapter (Git, server, backup-all) shares.
- **The file-share question, answered honestly**: a synced folder with **one writer at a
  time** (you, from several machines, via Syncthing/Dropbox/Nextcloud) is fully supported and
  safe — atomic writes (`tmp`+rename, already our server pattern), per-file `updatedAt`
  stamps, and the crash journal mean you lose at most seconds. A folder with **multiple
  simultaneous users is a corruption machine** — SMB/NFS/DAV give neither locks nor events.
  Multi-writer is tier 2. Enforce honestly instead of pretending: on open, the folder adapter
  checks the file's `updatedAt` against the last state it wrote; on drift it opens the
  **already-built three-way review** (per-entity mine/theirs + semantic merge), never a silent
  last-writer-wins. That conflict machinery was built for the server — the folder reuses it
  verbatim.
- **Fail-proofing tier 1 explicitly**: eviction-proof (files outside IndexedDB), IT-proof
  (plain JSON you can copy), crash-proof (journal ships already), quota-proof (no browser
  cap), and `Export all` remains the escape hatch. Public webapp-tier users get the identical
  fix (§9.3).

### 9.2 Tier 2 — Team server: email invites via Resend/SMTP (amending the "no email" stance)

The earlier "no email ever" line was a privacy default, not a law; the owner's call is that
**operators who want email invites get them**. Doing it safely:

1. **Mail adapter, pluggable, validated before first send.** `OPENARCH_MAIL_PROVIDER` =
   `resend` (`OPENARCH_RESEND_API_KEY`, `RESEND_FROM`) or `smtp` (`SMTP_HOST/PORT/USER/PASS`).
   Dev/test compose gains a **Mailpit** service so acceptance tests run offline.
2. **Setup screen (admin-only, Settings → Email)**: shows detected provider + from-address
   health; a **"Send test email"** that must round-trip before invite-by-email is enabled —
   the UI refuses to enable sending until the test is delivered (Resend also demands a
   verified domain, and we surface its validation). No half-configured silent failures.
3. **Invite flow, updated**: owner enters email + role → `invite { email, role, token,
   invitedBy, expiresAt = 7d, acceptedAt }`; if mail is validated the accept URL is sent,
   otherwise the owner copies the link out-of-band as today. **Acceptance is a magic link**:
   - **OIDC mode**: the link prompts SSO login; membership is granted when the IdP's *verified
     email claim* matches the invited address (exact match only — never domain-wide), else
     manual code entry.
   - **No-IdP mode**: the accept link opens a one-time join page that **issues the person
     their own named access token** (shown once, download offered) and adds them as a member.
     The no-passwords promise survives — "password" becomes "a token the server gave you at
     join time"; there is no reset surface, and the token is hashed at rest.
4. **Privacy rail-guards the email path adds** (recorded in `docs/privacy.md`):
   - Email addresses are **PII**: invite records delete after
     `OPENARCH_INVITE_RETENTION_DAYS` (default 30) post-expiry/acceptance; export/redaction
     applies like any other record.
   - Resend = a subprocessor: named in `docs/privacy.md`; self-hosted SMTP (same screen) is
     the zero-subprocessor path.
   - Anti-abuse: outstanding-invites cap per server, per-IP send rate limit, single-use 128-bit
     tokens, accept lockout after N attempts; create/accept/revoke all audited (feeding the
     §2.3 hash-chained log).
5. Nothing in §8.4 changes — email changes **delivery**, not permissions: an invited editor is
   the same editor; invites can still never mint an owner.

### 9.3 Tier 3 — Public BYO webapp: "your data, our static file server"

The publicly hosted deployment. The contract, printed on the tin: **the host stores nothing
about you — no accounts, no database rows, no model bytes, no telemetry.** The app bundle is
static (already CSP-auditable: no CDNs, no remote fonts, errors stay in your console, PWA
cache-first).

- **The storage picker is the tier-1 UI from §9.1 — that is the whole point.** A public-webapp
  user picks Browser, **local folder**, WebDAV, Git, or *their own team server's URL* (with a
  CORS note — their server must allow the public app's origin, which is why server CORS takes
  explicit configured origins).
- **"Attach my data, reattach later"** = the persisted directory handle on the *user's
  machine* — the public host never sees the bytes. On a second computer, point at the synced
  folder; the app adopts the files (ids stable, same reattach semantics as tier 1).
- **Autosave/mirror**: the shipped autosave (1.5 s debounce, 15 s max-delay) drives the folder
  mirror on every tick once folder mode is on.
- **Honest non-goals**: no server-side "forgot workspace" recovery — Browser-mode data on the
  public app is gone if site data is cleared; the UI says so plainly and nudges to folder
  mode. No sync service ever ships from the public host.

### 9.4 The tiers at a glance

| Concern | 1. Solo local | 2. Team server | 3. Public webapp |
|---|---|---|---|
| Where the bytes live | Browser + your folder (or WebDAV/Git share) | Server volume (`models.json`) | User's browser + their folder |
| Identity | none — you are you | tokens + OIDC + **email invites** | none — or *their own server's* identity |
| Multi-user data | one writer at a time (conflict review on drift) | full (locking, 3-way review, presence) | one writer at a time (same as tier 1) |
| Privacy contract | your machine | operator-run; PII/mail policy in privacy docs | nothing persisted or observed by the host |
| Data risk & fix | quota eviction → folder mirror | operator ops (backups, encryption-at-rest §2.1) | user's choice; folder mode recommended |

### 9.5 One conflict pipeline, all tiers

Tier-1 folder drift and tier-2 409s both funnel into the same shipped machinery —
`conflictEntries` + `ConflictReview` + `applyResolutions`. That is invariant 6 paying off:
add a store, inherit the safety net.

### 9.6 Build order (extends §8.6)

| Step | Ships | Effort | Test gates |
|---|---|---|---|
| 6 | `FolderRepository` adapter (FS Access API) + Storage settings UI + mirror-on-autosave | M | Playwright (Chromium): attach → edit → reload → reattach; drift → conflict review opens; native files identical to `Export all` |
| 7 | WebDAV adapter (same conflict path) — can defer | S–M | conformance vs local DAV server (container) or mock |
| 8 | Mail: adapter + validated setup screen + email invites + magic-link accept + hashed token issuance (no-IdP) + `INVITE_RETENTION_DAYS` | M | integration: round-trip gate, single-use/lockout, retention deletion, audit chain; Mailpit compose |
| 9 | Public-BYO hardening: CORS guidance for user servers, on-site privacy statement, static-bundle no-storage audit | S | CI lint: bundle contains no fetch/POST to the public origin's host |

Decisions needed before step 8: **Resolved 2026-11-20 — both Resend and SMTP ship on day
one** (one `MailAdapter` interface, two drivers, both tested through Mailpit for SMTP and a
mocked API for Resend), and **the from-address is set during configuration**, not only by env:
the admin setup screen persists it to the server's runtime config store (§9.7), with
`OPENARCH_*` env vars acting only as bootstrap defaults/overrides on first boot.

---

## 10. Tier-2 data storage — the concrete layout (answers "how is data stored on tier 2?")

Two storage eras, one migration.

### 10.1 Today (shipped): whole-model file store

```
$OPENARCH_DATA                                           (default: data/models.json)
  └── one JSON file = every workspace:
      [ { model: Model, version, updatedAt, updatedBy, orgId?, groupRoles?,
          members: [{subject, role}], comments: [], audit: [],
          snapshots: []  (capped 50, structuredClone on each save),
          savedViews: [] } ]
```

- Atomic writes (`tmp`+rename), corrupt-file quarantine, backups via `Export all`. This is
  what a Docker volume, Keycloak compose, encryption-at-rest (planned §2.1), and all 30+
  integration tests operate on today.

### 10.2 The multi-user target (with mail + concurrent editing): event-sourced store

Per ADR 0004, the collaboration engine is the validated op log, and **the log is the
persistence**:

```
data/
  config.json                    # runtime admin config (mail provider, from-address, …)
  workspaces/<workspaceId>/
    meta.json                    # { version, createdAt, updatedAt, orgId?, members,
                                 #   groupRoles, retention… }
    events/                      # the canonical history, append-only
      000001.jsonl               # one op per line, numbered shards (~1 MB each)
    snapshots/                   # periodic materialisations (every N ops + on compaction)
      000000.model.json          # full validated Model at event n
    tombstones.json              # ops explicitly reversed + why (conflict fallback log)
  users.json                     # SCIM records (unchanged)
```

- **Op** `{ seq, actor, at, kind, path, before?, after? }` — kinds cover
  `element.*`, `relationship.*`, `view.*`, `property.*`, `domain.*`, `artefact.*`,
  `member.*`, `approve/reject/waive`, `comment`. Small, idempotent, replayable.
- **Write path**: op → server projects the result → `validateModel` (invariant 6, unchanged)
  → if invalid, **reject with reasons** (the client sees exactly which rule) → if valid,
  append + bump `version` + broadcast. No op enters the log unvalidated; convergence becomes
  *authorized* before it becomes *automatic*.
- **Read path**: boot = latest snapshot + replay remaining events (fast: snapshots happen
  every ~200 ops and on server shutdown); clients receive op broadcasts live — editing is
  genuinely co-current, and full-model `PUT`s stop being the only write path.
- **Why the file-per-$OPENARCH_DATA model graduates to this**: one artifact — the event log —
  now serves as audit trail (`actor` on every op), version history (replay to any `seq`),
  per-op attribution, and merge record; four reconciled stores become one.
- **Snapshots stay real**: they're what backup, AOEF export, tiers 1/3, and restore fall back
  to; the log is compacted against them so the folder never grows quadratically.
- **Retention**: `snapshots` rolling cap (configurable, default 50) and event shards compacted
  when their events are all superseded and snapshotted; tombstones kept for governance
  traceability.
- **Migration**: boots were automatic — an existing `models.json` becomes snapshot 0 + a
  synthetic `snapshot_import` op per workspace; no user-facing step; `Export all` continues
  to emit exactly the snapshot document it does today.

### 10.3 What separates tier 2 from tiers 1/3 — why they never need the log

Tiers 1 and 3 stay **whole-model JSON** (folder/IndexedDB) with `updatedAt` stamps and the
drift → three-way review path (§9.5). Only the shared-server tier speaks events. A workspace
can move between tiers freely: a tier-2 workspace exported (snapshot) becomes tier-1 files —
and tier-1 files opened on a server become `snapshot_import` events. **One format on the
ground, ops only where more than one human writes.**

### 10.4 Mail + runtime config storage (decision summary)

- One `MailAdapter` with two first-class drivers — `resend` (API, provider call) and `smtp`
  (nodemailer, pointed at Mailpit for dev/CI) — both shipped day one.
- `data/config.json` holds the *runtime* admin configuration: provider, from-domain,
  from-address, per-deployment reply-to, retention, outstanding-invite caps. Env vars
  (`OPENARCH_RESEND_API_KEY`, `SMTP_*`) remain the bootstrap values (first boot copies them
  in; the admin screen's edits persist there); the setup screen re-validates the current
  value with a delivery round-trip before invite-by-email is enabled — which includes the
  from-address, since Resend requires domain verification to match it.


### 11. Tier-2 hardening (2026-11-20): login + OTP, access granulation, storage safety

Tier 2 is the shared **web/internal server**: login-required, workspace-scoped, no anonymous
access, other people's data invisible by construction. This section fixes the remaining
design points the owner raised: OTP login (with password/SSO slotting in later), how access
is *granulated*, and whether the data model needs a "real database" to be safe.

### 11.1 The access envelope — credentials ladder + sessions

A tier-2 deployment ALWAYS requires authentication (`OPENARCH_REQUIRE_AUTH=true` is forced for
this mode). The credential ladder — every rung reduces to the same thing: `subject +
credential-check` in `auth.ts` middleware; nothing else in the stack ever sees "how" you logged
in, so later rungs swap in without touching request handlers:

| Rung | Credential | Use case | Status |
|---|---|---|---|
| 1 | **One-time OTP code by email** (login-as-you-know-it) | default login for invited users; no password anywhere | **design for this next** |
| 2 | named access tokens (hashed at rest) | CLI/MCP/API users; long-lived automation | already designed (§8.3) |
| 3 | SSO/OIDC via PKCE | enterprise deployment, later | spec exists (§8.2), ship after 1–2 |
| 4 | local password accounts | **not planned** — if an operator insists, Keycloak solves it (§8.5) | out of scope by design |

**Rung 1 (OTP) mechanics**:

- `POST /api/auth/otp/request { email }` → if the subject exists (member or has an
  outstanding invite), email a **6-digit code**: stored SHA-256-hashed, **10-minute TTL**,
  burn-after-5-failed-attempt lockout per subject+IP, per-IP and per-server rate limits; the
  response is always generic (no enumeration: registered and unknown emails answer
  identically, unknowns just never receive mail).
- `POST /api/auth/otp/verify { email, code }` → issues a **session**: opaque 256-bit token,
  stored hashed server-side, **HttpOnly Secure cookie for the browser** (SameSite=Lax — CSRF
  risk is nil for GET, and unsafe methods additionally require the request's own origin
  header), and a **Bearer token variant for CLI/MCP usage**. Idle expiry (default 30 days;
  `OPENARCH_SESSION_IDLE_DAYS`), absolute expiry, revocation list. Sessions audit
  `login/otp`, `login/failed`, `logout` into the existing hash-chained audit log.
- No user-visible "reset password" path ever exists; going through email *is* the recovery
  mechanism. That's the point: no credentials to forget, phish or reset.

### 11.2 Access granulation — the exact gate graph

Granulation is enforced at **four levels**, and each level is an independent, audited
permission check — never a single "global" role:

```
subject (from credential ladder)
   └── membership per workspace     [shared list of exact capabilities] §8.4
   └── idP groups → group→role map  [fills membership when no explicit row] §8.3
   └── org scoping (optional)       [subject's org limits which list endpoints return] §4
   └── operator (server host owner) [can mint identity/invites ONLY; no workspace-content browsing]
```

Concrete rules (all already enforced or already designed; the tests must hold them forever):

1. **Membership is the only path to content**: read, write, history, comments, real-time
   room, and the summary list filter by membership — so non-members never learn that other
   workspaces *exist* (list replies include neither names nor counts); audit trails and
   comments also leak nothing cross-workspace because comments/audit are stored per-workspace,
   not globally.
2. **Roles stay coarse and workspace-bound**: viewer/editor/owner per workspace, never
   global. A "superuser" role does not exist; an org-admin grants membership or nothing.
3. **Operator ≠ superuser**: whoever runs the container manages identity
   (tokens/invites/sessions) *as a capability of hosting*, but the API/UI never surfaces
   other people's model content to the operator unless the operator is themselves a member.
   This stayed a core rule in §8.5 and remains one here.
4. **Endpoint-parity tests are the real guarantee**: a four-role fixture matrix
   (stranger/authenticated/viewer/editor/owner) fires at *every* `:id`-bearing route and
   asserts status-code expectations — the guardrails aren't prose, they're the §4.3
   cross-tenant fuzz suite plus per-route integration tests that must grow with every new
   endpoint (new route, new row in the matrix, else build fails the "no route added without
   gates" convention).

### 11.3 "Should it be stored in a database? Is the data model safe?"

Direct answer: **the data model is safe because validity is checked at the op gate before it
can ever touch storage (ADR 0004), not because of which storage engine we point it at**; and
the correct storage evolution is *not* to switch to a database — it's to stop rewriting a
monolithic file and let the event-sourced design §10.2 do its job, adding SQLite/Postgres only
where a specific operation *needs one*, without ever normalizing the ArchiMate metamodel
into relational tables. Corrupted-by-bug data cannot land (protocol gate), and
corrupted-by-crash cannot spread (per-workspace blast radius in the §10.2 layout, not a
monolithic one).

**The decision table (engine per concern):**

| Concern | Default (all tier-2 installs) | Graduate to SQLite/postgres when | What NEVER to do |
|---|---|---|---|
| *Workspace content* | per-workspace folder: append-only `events/*.jsonl` + `snapshots/*.model.json` (§10.2) | multi-*process* servers need the wal+transaction machinery SQLite gives you (`events.db`) — single-process already safe under tmp+rename and fsync on every append+commit | **don't normalize the metamodel**: elements/relationships never become tables — they stay a Model document (JSONB row) + an events table, preserving AOEF passthrough and portability between tiers |
| *Sessions/OTP locks* | hashed opaque tokens, in-memory or sessions table embedded | SQLite (`sessions.db`) when rate-limits/lockout need persistence across restarts | don't store OTP codes or session tokens in plaintext anywhere |
| *Audit* | per-workspace audit ladder in the event log, hash-chained (§2.3) | Postgres when so many workspaces exist that a single audit table + per-index query is useful | don't write the audit log *beside* your event log; ADR 0004 keeps them one and the same chain |
| *Server config (mail, keys)* | `data/config.json` with write-only API-key fields (masked on read; env bootstrap only) | — | never GET the raw key material back out via API once saved |

**Why not "just use Postgres everywhere now"**: it solves problems today's design already
prevents (whole-file rewrites / cross-workspace blast radius), and it would *add* problems
we don't have (schema migration surface between formats that the single-document model can
trivially avoid by design; a second persistence layer to keep in sync with the event-log
invariants for no safety gain). What matters for the "safe against corruption" question is:

1. **Logical corruption can't enter**: every op/model write goes through `validateModel`
   before being persisted (already true, and ADR 0004 extends it from whole-model PUTs to
   individual ops — bad writes never land, so they can't corrupt anything).
2. **Physical corruption is contained and self-healing**: append-only shards + periodic
   snapshots + tmp/rename atomic writes + fsync-on-append + hash-chained events = a torn
   write at worst kills the last line of one shard, discovered by hash-chain mismatch and
   fixed from the prior snapshot + prior events. Quarantine on corrupt-parse already
   exists; add `openarch admin verify-store` (boot-check + CLI: replay each workspace's
   events against its newest snapshot and report diffs) and `openarch admin restore
   <workspace> [--at seq]` for the rare manual rollback.
3. **Backups are boring**: a tier-2 backup is the snapshots + a `config.json` minus API
   keys — users export/import all via UI; restore = copy snapshots back and replay from
   there; every workspace recovers independently, one bad workspace never stops another
   from booting.

The invariant conclusion: **per-workspace event-sourced files first; reach for SQLite/Postgres
per-concern when scale demands it; and keep the Model itself forever a document.** That keeps
tier-2 safe, portable to tiers 1/3, and AOEF-faithful without inventing a second meta-model.

### 11.4 The immediate build order for tier 2 (the login-first sequence)

| Step | Ships | Test gates |
|---|---|---|
| A1 | `POST /a/otp/request+verify` + hashed session store + HttpOnly cookie + middleware that *requires* a session on every route | integration: request/verify/lifecycle/lockout/no-enumeration; a run of the **existing** suite re-run with the middleware on must remain green |
| A2 | The endpoint-parity fixture matrix runner (stranger/auth/viewer/editor/owner × every route) wired into CI; new routes **must** add rows | suite self-audits its coverage so drift is a red build |
| A3 | `verify-store` CLI (replay vs snapshot) + a kill-mid-write corruption lab test in CI (a real SIGKILL storm against the append path, then boot) | the server must boot clean every time |
| A4 | Mail (Resend + SMTP both, runtime from-address) — §9.2 as amended by §10.4 | Mailpit round-trip + masked-key API test |
| A5 | `admin backup/restore/verify-store` CLI + manifest/checksum + `--at seq` point-in-time restore — §12 | the whole §12.4 gate table, incl. the kill-storm and fresh-volume equivalence tests |


---

## 12. Backup & restore — the runbook (answers "how do we backup/restore the instance?")

One design principle drives everything here: **in tier 2, backup = copy event-sourced files,
restore = copy them back and replay.** Because the store is append-only shards + periodic
snapshots (§10.2) with hash-chained events, backups need **no locks, no quiesce point, and
no database dumps** — a copy of the data directory is automatically crash-consistent for
every workspace whose writes follow those rules, and the verify step both proves it and
repairs it from an earlier point if a shard was torn mid-copy.

### 12.1 What is in a backup (and what is deliberately out)

| Artifact | In backup | Notes |
|---|---|---|
| `workspaces/<id>/events/*.jsonl` | ✅ | the canonical history — audit trail, version history, and op attribution ride along inside it (ADR 0004) |
| `workspaces/<id>/snapshots/*.model.json` | ✅ | native Model at snapshot points; these are what tiers 1/3 and UI import understand directly |
| `workspaces/<id>/meta.json` | ✅ | members, group→role, org, retention — access control restores *exactly* as it was |
| `workspaces/<id>/tombstones.json` | ✅ | governance traceability (reversed ops + reasons) |
| `data/users.json` (SCIM) | ✅ | contains `userName` — PII; the anonymise flag applies |
| `data/config.json` | ⚠️ **minus API keys** | from-address/retention/caps yes; mail provider keys are **masked out by default** and re-entered on restore (`openarch admin backup --include-secrets` exists for the rare encrypted-backup case, §2.1 AES-256-GCM) |
| Sessions & OTP lockouts | ❌ never | ephemeral by design; after a restore everyone re-logs (which is *correct*: sessions shouldn't survive a restore across machines) |
| Crash journal (tier 1/3 browsers) | ❌ never | browser-side recovery, not a server artifact |

**Privacy note for backups**: they contain PII (display names, emails in invite/SCIM records,
comment authors, audit actors) — so the rotation policy in `docs/privacy.md` must name
backups explicitly, and `--anonymise` (§2.2) gives a PII-scrubbed export for anything leaving
the org. The honest GDPR trade: right-to-erasure applies to *live + backups*; with rotation
(§12.3) old backups age out on a known schedule, which is the documented answer instead of
pretending un-deletable backups don't exist.

### 12.2 The three restore granularities

1. **Whole instance** (host dies / volume lost): restore the tar → `openarch admin
   verify-store` on boot and via CLI (replays every workspace's events against its newest
   snapshot; hash-chain mismatches pinpoint exactly which shard tore and replay repairs from
   the prior snapshot + surviving events). Workspaces are independent folders, so **one
   broken workspace never blocks the others from booting** — the blast radius stays
   per-workspace, not instance-wide.
2. **One workspace** (bad edit, corrupted shard, ransomware-touched subset): stop the server
   (or lock the workspace), replace `workspaces/<id>/`, verify, continue. Selective restore
   is *the* reason the store is per-workspace folders, not one `models.json` file.
3. **Point-in-time** (undo an hour-long mistake without touching the rest):
   `openarch admin restore <workspace> --at <seq>` = take latest snapshot ≤ seq, replay events
   up to seq, write the result as a new snapshot + a *reversal op* (so history stays honest —
   a restore is an event in the log, never a history rewrite). This is what an event log buys
   over both a static file and a database dump: file backups give you *yesterday*; the log
   gives you *3:42 PM Friday*.

**Cross-tier restore** is the same act: every snapshot inside a backup is a tier-1/3-openable
native model file. A team-server workspace restore into a solo folder = copy the snapshot out.
A solo-folder workspace onto a server = `snapshot_import` op (§10.3). One format everywhere
means backups and migration are *not separate features*.

### 12.3 The commands (CLI pack already ships the bundling pattern)

```bash
openarch admin backup [dir] [--include-secrets] [--anonymise] [--key <hex>]
#   → openarch-backup-YYYYMMDD-HHMMSS.tar(.gz) + a manifest.json
#     (per-file sha256 — restore refuses to replay against a checksum mismatch)
openarch admin restore <archive.tar> [--workspace <id>] [--at <seq>] [--dry-run]
#   --workspace = the surgical path; --dry-run = verify + report only
openarch admin verify-store           # replay-vs-snapshot check for every workspace
```

Scheduling is intentionally **not a server daemon**: the operator rules a cron/systemd-timer
(or a compose service) calling `openarch admin backup` to a mounted target — external
schedulers are boring, debuggable, and don't widen the server process's surface. Retention
(N daily / M weekly) is the operator's timer policy, documented in `docs/deployment.md`; the
backup format is an unencrypted-by-default tar so restic/rsync-level tooling also just works
on it, with `--key` for the encrypted variant.

### 12.4 The test gates (backup is a feature, so it gets feature tests)

| Test | Asserts |
|---|---|
| Backup-restore equivalence in CI | boot seeded server → make concurrent writes → `admin backup` → restore into a *fresh* empty volume → every workspace: same model, same members, same audit chain; sessions are gone |
| Kill-storm backup | SIGKILL the server mid-append, run `admin backup`, restore, verify passes (a torn last event line is detected by the hash chain and replay repairs from snapshot — never a silent bad state) |
| Surgical restore | corrupt ONE workspace's shard, restore just that workspace from the backup, others untouched |
| `--at seq` point-in-time | restore to midnight, confirm the reversal op exists in the log and later events are preserved beyond it |
| Secrets masking | backup manifest/config contains no key material without `--include-secrets`; with it, the archive is AES-GCM encrypted |
| `--anonymise` | no email/subject survives in the anonymised archive (a redaction grep test, not an eyeball check) |

### 12.5 Tiers 1 and 3, one paragraph each

**Tier 1** (folder mode): the folder *is* the live backup — backing up = any file sync of the
attached folder (or `Export all`), restore = point the app at a restored copy and re-grant
permission; journal + `updatedAt` stamps mean the app reconciles rather than overwrites. Tier 3
(public webapp, browser mode) makes the same point the other way: no host-side backup exists
*because no host-side data exists* — the UI's nudge is folder mode (§9.3), where the user's
own sync solution becomes their DR plan, and `Export all` is the manual escape hatch.
