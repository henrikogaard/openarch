import { createHash, createHmac, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import type { WorkspaceMember, WorkspaceRole } from '@openarch/core';

export interface Actor {
  subject: string;
  displayName?: string;
  authenticated: boolean;
  /** Security-group claims (e.g. OIDC `groups`), used for group→role mapping. */
  groups?: string[];
}

interface StaticToken {
  subject: string;
  displayName?: string;
}

export interface AuthConfig {
  required: boolean;
  jwtSecret?: string;
  staticTokens: Map<string, StaticToken>;
  adminSubject: string;
  /** OIDC discovery issuer, e.g. https://login.microsoftonline.com/<tenant>/v2.0 */
  oidcIssuer?: string;
  /** Expected `aud` claim. */
  oidcAudience?: string;
  /** Optional explicit JWKS URL; otherwise discovered from the issuer. */
  oidcJwksUrl?: string;
  /** SHA-256 of the first-boot owner token (data/config.json auth.bootstrapTokenHash). */
  bootstrapTokenHash?: string;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const staticTokens = new Map<string, StaticToken>();
  if (env.OPENARCH_TOKENS) {
    try {
      const parsed = JSON.parse(env.OPENARCH_TOKENS) as Record<string, StaticToken | string>;
      for (const [token, value] of Object.entries(parsed)) {
        if (typeof value === 'string') staticTokens.set(token, { subject: value });
        else if (value?.subject) staticTokens.set(token, value);
      }
    } catch (error) {
      throw new Error(`OPENARCH_TOKENS is not valid JSON: ${String(error)}`);
    }
  }
  return {
    required: env.OPENARCH_REQUIRE_AUTH === 'true' || env.OPENARCH_REQUIRE_AUTH === '1',
    jwtSecret: env.OPENARCH_JWT_SECRET,
    staticTokens,
    // Bootstrap: when static tokens are configured, the first one owns seeded workspaces.
    adminSubject: env.OPENARCH_ADMIN ?? [...staticTokens.values()][0]?.subject ?? 'system',
    oidcIssuer: env.OPENARCH_OIDC_ISSUER,
    bootstrapTokenHash: env.OPENARCH_BOOTSTRAP_TOKEN_HASH || undefined,
    oidcAudience: env.OPENARCH_OIDC_AUDIENCE,
    oidcJwksUrl: env.OPENARCH_OIDC_JWKS_URL,
  };
}

export const authConfig = loadAuthConfig();

interface JwksCache {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
}

let jwksCache: JwksCache | undefined;
const JWKS_TTL_MS = 10 * 60 * 1000;

/**
 * Fetch the OIDC JWKS. Called at startup and refreshed periodically; token
 * verification itself stays synchronous so request handlers stay simple.
 */
export async function refreshJwks(config: AuthConfig = authConfig): Promise<void> {
  if (!config.oidcIssuer && !config.oidcJwksUrl) return;
  let url = config.oidcJwksUrl;
  if (!url && config.oidcIssuer) {
    const discovery = await fetch(
      `${config.oidcIssuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    );
    if (!discovery.ok) throw new Error(`OIDC discovery failed: ${discovery.status}`);
    const document = (await discovery.json()) as { jwks_uri?: string };
    url = document.jwks_uri;
  }
  if (!url) throw new Error('No JWKS URL configured or discovered');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const data = (await response.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = new Map<string, KeyObject>();
  for (const jwk of data.keys ?? []) {
    if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
    try {
      const input = { key: jwk, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0];
      keys.set(jwk.kid, createPublicKey(input));
    } catch {
      // Ignore keys Node cannot import (e.g. unsupported curves).
    }
  }
  jwksCache = { keys, fetchedAt: Date.now() };
}

function verifyRs256(
  token: string,
  config: AuthConfig,
  now = Date.now(),
): Record<string, unknown> | undefined {
  if (!jwksCache || now - jwksCache.fetchedAt > JWKS_TTL_MS) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerPart)) as { alg?: string; kid?: string };
  } catch {
    return undefined;
  }
  if (header.alg !== 'RS256' || !header.kid) return undefined;
  const key = jwksCache.keys.get(header.kid);
  if (!key) return undefined;
  const valid = verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    key,
    Buffer.from(signaturePart, 'base64url'),
  );
  if (!valid) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < now) return undefined;
    if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now) return undefined;
    if (config.oidcAudience) {
      const audience = payload.aud;
      const audiences = Array.isArray(audience) ? audience : [audience];
      if (!audiences.includes(config.oidcAudience)) return undefined;
    }
    if (config.oidcIssuer && payload.iss !== config.oidcIssuer) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

export function verifyJwt(
  token: string,
  secret: string,
  now = Date.now(),
): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: { alg?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerPart)) as { alg?: string };
  } catch {
    return undefined;
  }
  if (header.alg !== 'HS256') return undefined;
  const expected = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(signaturePart);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart)) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < now) return undefined;
    if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

/** Resolve an actor from request headers. Returns null when auth is required but absent/invalid. */
export function resolveActor(
  headers: Record<string, unknown>,
  config: AuthConfig = authConfig,
): Actor | null {
  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    const staticEntry = config.staticTokens.get(token);
    if (staticEntry) {
      return { subject: staticEntry.subject, displayName: staticEntry.displayName, authenticated: true };
    }
    if (config.bootstrapTokenHash) {
      const digest = createHash('sha256').update(token).digest('hex');
      const expected = config.bootstrapTokenHash.replace(/^sha256:/, '');
      const a = Buffer.from(digest);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        return { subject: config.adminSubject, displayName: 'Owner (bootstrap)', authenticated: true };
      }
    }
    if (config.jwtSecret) {
      const payload = verifyJwt(token, config.jwtSecret);
      if (payload) {
        const subject = payload.sub ?? payload.preferred_username ?? payload.email;
        if (typeof subject === 'string' && subject) {
          return {
            subject,
            displayName: typeof payload.name === 'string' ? payload.name : subject,
            authenticated: true,
            groups: groupsOf(payload),
          };
        }
      }
    }
    const oidcPayload = verifyRs256(token, config);
    if (oidcPayload) {
      const subject = oidcPayload.sub ?? oidcPayload.preferred_username ?? oidcPayload.email;
      if (typeof subject === 'string' && subject) {
        return {
          subject,
          displayName: typeof oidcPayload.name === 'string' ? oidcPayload.name : subject,
          authenticated: true,
          groups: groupsOf(oidcPayload),
        };
      }
    }
    return null;
  }

  if (!config.required) {
    const header = headers['x-actor'];
    return { subject: typeof header === 'string' && header ? header : 'anonymous', authenticated: false };
  }
  return null;
}

/** Extract string group claims (`groups`, or a single `group`) from a token payload. */
function groupsOf(payload: Record<string, unknown>): string[] | undefined {
  const groups = payload.groups ?? payload.group;
  if (Array.isArray(groups)) {
    const names = groups.filter((group): group is string => typeof group === 'string');
    return names.length ? names : undefined;
  }
  if (typeof groups === 'string') return [groups];
  return undefined;
}

/** Effective role for an actor in a workspace. Auth-disabled deployments remain fully open. */
export function roleFor(
  members: WorkspaceMember[] | undefined,
  actor: Actor,
  config: AuthConfig = authConfig,
  groupRoles?: { group: string; role: WorkspaceRole }[],
): WorkspaceRole {
  if (!config.required) return 'owner';
  if (actor.subject === config.adminSubject) return 'owner';
  // Explicit membership wins; then group→role mapping (first match wins);
  // otherwise the default is read-only.
  const member = members?.find((item) => item.subject === actor.subject);
  if (member) return member.role;
  for (const mapping of groupRoles ?? []) {
    if (actor.groups?.includes(mapping.group)) return mapping.role;
  }
  return 'viewer';
}

export function hasRole(role: WorkspaceRole, allowed: WorkspaceRole[]): boolean {
  return allowed.includes(role);
}

/**
 * Whether an actor may read a workspace at all. In open mode everything is
 * readable; with auth on, only members (and the bootstrap admin) are.
 */
export function isMember(
  members: WorkspaceMember[] | undefined,
  actor: Actor,
  config: AuthConfig = authConfig,
  groupRoles?: { group: string; role: WorkspaceRole }[],
): boolean {
  if (!config.required) return true;
  if (actor.subject === config.adminSubject) return true;
  // Explicit membership OR a group→role mapping counts as access.
  if (members?.some((member) => member.subject === actor.subject)) return true;
  if (actor.groups?.length && groupRoles?.some((mapping) => actor.groups!.includes(mapping.group))) {
    return true;
  }
  return false;
}

export function initialMembers(actor: Actor): WorkspaceMember[] {
  return [{ subject: actor.subject, role: 'owner', displayName: actor.displayName }];
}
