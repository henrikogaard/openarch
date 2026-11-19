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
