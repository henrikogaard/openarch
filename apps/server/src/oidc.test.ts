import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildAuthorizationUrl, exchangeCode, PkceStore, s256 } from './oidc';

describe('OIDC + PKCE (A5 unit contract)', () => {
  it('S256 challenge is the base64url SHA-256 of the verifier', () => {
    const verifier = 'test-verifier-string-43chars-long-enough-aa';
    expect(s256(verifier)).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });

  it('state is single-use and expires; attempts outside TTL fail', async () => {
    const store = new PkceStore();
    const begun = store.begin('https://app/callback', (state) => `https://idp/authorize?state=${state}`);
    expect(begun.state).toBeTruthy();
    const pair = store.finish(begun.state);
    expect(pair?.codeVerifier).toBe(begun.codeVerifier);
    // Reuse fails.
    expect(store.finish(begun.state)).toBeUndefined();
  });

  it('builds a compliant authorization URL', () => {
    const url = new URL(
      buildAuthorizationUrl({
        issuer: 'https://idp.example/realms/openarch/',
        clientId: 'openarch-web',
        redirectUri: 'https://app.example/api/auth/oidc/callback',
        state: 'abc123',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      }),
    );
    expect(url.searchParams.get('client_id')).toBe('openarch-web');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('abc123');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.pathname).toContain('/realms/openarch/authorize');
  });

  it('exchanges the code with the verifier at the token endpoint', async () => {
    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: new URLSearchParams(String(init?.body)) });
      return new Response(JSON.stringify({ access_token: 'at-123', token_type: 'Bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const result = await exchangeCode({
        issuer: 'https://idp.example',
        clientId: 'openarch-web',
        redirectUri: 'https://app.example/cb',
        code: 'the-code',
        codeVerifier: 'the-verifier',
      });
      expect(result.accessToken).toBe('at-123');
      expect(calls[0].url).toContain('https://idp.example/token');
      expect(calls[0].body.get('grant_type')).toBe('authorization_code');
      expect(calls[0].body.get('code_verifier')).toBe('the-verifier');
      // No client secret ever leaves (public client).
      expect(calls[0].body.get('client_secret')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
