# Deploying OpenArch

**Solo local (default):** open the app — everything stays in the browser
(IndexedDB); optionally attach a real folder via the Storage switch (Folder
mode, Chromium) or connect a Git repository.

## Team server (Docker)

```bash
docker compose up          # server on :8080 with a persistent volume
```

First boot with auth required **prints a one-time owner token** in the logs —
copy it, log in, then mint named tokens for people (Settings → People &
tokens) or send invite links. All configuration lives in
[`docs/multi-user-plan.md`](multi-user-plan.md) §8–§11 and the
[spec](multi-user-spec.md).

### Login options (in order of weight)
1. **OTP by email** — request a 6-digit code; needs a mail provider
   configured and round-trip tested (Settings → Email).
2. **Named tokens** — long-lived hashed tokens for people and CLIs.
3. **OIDC SSO** — any OIDC RS256 issuer (Keycloak compose profile included);
   PKCE public client, verified through the same JWKS path as bearer tokens.

### Mail

Configure Resend or SMTP in Settings → Email; invite-by-email stays disabled
until the "Send test email" round-trip passes. SMTP against the bundled
Mailpit profile for local testing:

```yaml
# docker-compose.override.yml
services:
  mailpit:
    image: axllent/mailpit
    ports: ["8025:8025", "1025:1025"]
```

### Route parity (CI gate)

`OPENARCH_ENFORCE_ROUTE_PARITY=true` (CI default) makes the server refuse to
boot when a route lacks a minRole expectation in
[`apps/server/src/parity.ts`](../apps/server/src/parity.ts) — add the row in
the same PR as any new route.

### Backups

```bash
openarch admin backup /path/to/data       # zip + sha256 manifest
openarch admin restore backup.zip /data   # verifies checksums
openarch admin verify-store /data        # boot-check
```

Sessions are excluded and config keys blanked unless `--include-secrets`;
`--anonymise` scrubs subjects and wipes comments/audit/invites. Data layout
and restore granularities: [`multi-user-plan.md`](multi-user-plan.md) §10, §12.

## Public webapp (BYO)

The public build hosts only static assets — no accounts, no database rows, no
model bytes. Users pick Browser, a local folder, a Git repository, or **their
own** team-server URL (CORS note: the target server must include the public
app's origin in its allow-list).
