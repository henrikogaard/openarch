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

  it('PKCE flow: /api/auth/oidc/start issues a challenge; callback exchanges it', async () => {
    const base = process.env.OPENARCH_OIDC_LIVE_BASE ?? 'http://localhost:8080';
    const start = await fetch(`${base}/api/auth/oidc/start`);
    expect(start.status).toBe(200);
    const { authorizationUrl, state, codeVerifier } = (await start.json()) as {
      authorizationUrl: string;
      state: string;
      codeVerifier: string;
    };
    expect(authorizationUrl).toContain('code_challenge_method=S256');
    expect(state).toBeTruthy();
    expect(codeVerifier).toBeTruthy();
    // Completing the flow needs a real browser login — asserted by the
    // manual recipe in docs/deployment.md; here we only contract-check that
    // an unknown-state callback is refused.
    const rejected = await fetch(`${base}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'x', state: 'unknown-state' }),
    });
    expect(rejected.status).toBe(401);
  });
});
