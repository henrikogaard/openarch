import { createHash, randomBytes } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';

/**
 * OIDC Authorization Code + PKCE login (spec A5) — server-exchanged public
 * client: no client secret, S256 code challenge, state/verifier pairs stored
 * server-side for 10 minutes, single use. The token exchange reuses the
 * same RS256/JWKS verification path as bearer tokens, so no second crypto.
 */
export interface PkcePair {
  state: string;
  codeVerifier: string;
  createdAt: number;
  redirectUri: string;
}

export function s256(challenge: string): string {
  return createHash('sha256').update(challenge).digest('base64url');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const PKCE_TTL_MS = 10 * 60 * 1000;
const MAX_OUTSTANDING = 1000;

export class PkceStore {
  private readonly pairs = new Map<string, PkcePair>();

  /** Begin a flow: returns state + verifier the client echoes back at callback. */
  begin(redirectUri: string, issuerAuthorizationUrl: (state: string) => string): {
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  } {
    const state = randomBytes(16).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    this.pairs.set(state, { state, codeVerifier, createdAt: Date.now(), redirectUri });
    // Evict expired + cap outstanding (login attempts, low volume).
    this.evict();
    return { authorizationUrl: issuerAuthorizationUrl(state), state, codeVerifier };
  }

  /** Complete a flow: returns the verifier when the state is fresh + single-use. */
  finish(state: string): { codeVerifier: string; redirectUri: string } | undefined {
    this.evict();
    const pair = this.pairs.get(state);
    if (!pair) return undefined;
    this.pairs.delete(state); // single use
    return { codeVerifier: pair.codeVerifier, redirectUri: pair.redirectUri };
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, pair] of this.pairs) {
      if (now - pair.createdAt > PKCE_TTL_MS) this.pairs.delete(key);
    }
    if (this.pairs.size > MAX_OUTSTANDING) {
      const oldest = [...this.pairs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (const [key] of oldest.slice(0, this.pairs.size - MAX_OUTSTANDING)) {
        this.pairs.delete(key);
      }
    }
  }
}

/**
 * Build the IdP authorization URL with PKCE S256 params.
 */
export function buildAuthorizationUrl(params: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const authorize = new URL(params.issuer.replace(/\/$/, '') + '/authorize');
  // OIDC discovery gives the real endpoint; this default covers Keycloak,
  // Entra (v2 endpoint shape), and Authentik. The server may override.
  authorize.searchParams.set('client_id', params.clientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', params.redirectUri);
  authorize.searchParams.set('state', params.state);
  authorize.searchParams.set('code_challenge', params.codeChallenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('scope', (params.scopes ?? ['openid', 'profile', 'email']).join(' '));
  return authorize.toString();
}

export interface TokenExchangeResult {
  accessToken: string;
}

/** Exchange the authorization code + verifier at the IdP token endpoint. */
export async function exchangeCode(params: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenExchangeResult> {
  const tokenUrl = new URL(params.issuer.replace(/\/$/, '') + '/token');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`OIDC token exchange failed: ${response.status} ${body}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error('OIDC token response had no access_token');
  return { accessToken: payload.access_token };
}

export interface OidcSessionInfo {
  subject: string;
  displayName: string;
  email?: string;
}

export { s256 as _s256 };
