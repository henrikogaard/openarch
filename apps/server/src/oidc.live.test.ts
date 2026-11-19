import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuthConfig, refreshJwks, resolveActor } from './auth';

/**
 * LIVE OIDC test — runs ONLY when a real issuer is provided, exercising the
 * docker-compose Keycloak profile end-to-end instead of the local fixture.
 *
 *   docker compose --profile keycloak up -d
 *   # create realm 'openarch', client 'openarch' (public), a user, and a token
 *   OPENARCH_OIDC_LIVE_ISSUER=http://localhost:8180/realms/openarch \
 *   OPENARCH_OIDC_LIVE_TOKEN=<access token> npx vitest run apps/server/src/oidc.live.test.ts
 */
const issuer = process.env.OPENARCH_OIDC_LIVE_ISSUER;
const audience = process.env.OPENARCH_OIDC_LIVE_AUDIENCE ?? 'openarch';
const token = process.env.OPENARCH_OIDC_LIVE_TOKEN;
const live = Boolean(issuer && token);

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(!live)('OIDC live issuer (opt-in via OPENARCH_OIDC_LIVE_*)', () => {
  it('verifies a real RS256 token from the configured issuer', async () => {
    const config = loadAuthConfig({
      OPENARCH_REQUIRE_AUTH: 'true',
      OPENARCH_OIDC_ISSUER: issuer,
      OPENARCH_OIDC_AUDIENCE: audience,
      ...(process.env.OPENARCH_OIDC_LIVE_AZURE_EMAIL ? {} : {}),
    } as unknown as NodeJS.ProcessEnv);
    await refreshJwks(config);
    const actor = resolveActor({ authorization: `Bearer ${token}` }, config);
    expect(actor?.authenticated).toBe(true);
    expect(actor?.subject).toBeTruthy();
  });
});
