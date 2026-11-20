/**
 * Endpoint parity runner fixture (spec E1).
 *
 * Extracts the live route table from Fastify at connect time, diffs it
 * against a hand-curated registry of { method, pathPattern, minRole }
 * expectations, and provides the five-role fixture matrix asserts. The
 * self-audit (every route registered ⇒ every route expected) makes
 * "new route must add a row" mechanical: CI fails when a route exists but
 * has no registered expectations.
 */
import type { Actor } from './auth';

export type ParityRole = 'anonymous' | 'authenticated' | 'viewer' | 'editor' | 'owner' | 'admin';

export interface RouteExpectation {
  method: string;
  /** Fastify route pattern as printed, e.g. '/api/models/:id/members'. */
  path: string;
  /** Lowest role that reaches the handler without 401/403 (before per-body validation). */
  minRole: ParityRole;
  /** 'public-open' routes answer for anyone (health); 'auth' for any authenticated subject. */
  auth: 'public-open' | 'auth-required';
}

/**
 * Subject set for the matrix — final personas asserted by the integration
 * suite. `admin` covers /api/admin/* and bootstrap-only routes.
 */
export const PARITY_SUBJECTS: Record<'admin' | 'owner' | 'editor' | 'viewer' | 'stranger', Actor> = {
  admin: { subject: 'admin', displayName: 'Admin', authenticated: true },
  owner: { subject: 'admin', displayName: 'Admin', authenticated: true },
  editor: { subject: 'ed@example.com', displayName: 'Ed', authenticated: true },
  viewer: { subject: 'viewer', displayName: 'Viewer', authenticated: true },
  stranger: { subject: 'stranger', displayName: 'Stranger', authenticated: true },
};

/**
 * Registry of expectations. MUST grow with every new route — the runner
 * asserts at boot that the server's live route table contains no route
 * without an entry here (allowlist `IGNORED_PREFIXES` escapes exist for
 * framework-internal routes only).
 */
export const ROUTE_EXPECTATIONS: RouteExpectation[] = [
  { method: 'GET', path: '/health', minRole: 'anonymous', auth: 'public-open' },
  { method: 'POST', path: '/api/auth/otp/request', minRole: 'anonymous', auth: 'public-open' },
  { method: 'POST', path: '/api/auth/otp/verify', minRole: 'anonymous', auth: 'public-open' },
  { method: 'POST', path: '/api/auth/logout', minRole: 'authenticated', auth: 'auth-required' },
  { method: 'GET', path: '/api/models', minRole: 'authenticated', auth: 'auth-required' },
  { method: 'POST', path: '/api/models', minRole: 'editor', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id', minRole: 'viewer', auth: 'auth-required' },
  { method: 'PUT', path: '/api/models/:id', minRole: 'editor', auth: 'auth-required' },
  { method: 'DELETE', path: '/api/models/:id', minRole: 'owner', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/meta', minRole: 'viewer', auth: 'auth-required' },
  { method: 'GET', path: '/api/me', minRole: 'authenticated', auth: 'auth-required' },
  { method: 'GET', path: '/api/portfolio', minRole: 'authenticated', auth: 'auth-required' },
  { method: 'POST', path: '/api/admin/tokens', minRole: 'admin', auth: 'auth-required' },
  { method: 'GET', path: '/api/admin/tokens', minRole: 'admin', auth: 'auth-required' },
  { method: 'DELETE', path: '/api/admin/tokens/:id', minRole: 'admin', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/invites', minRole: 'owner', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/invites', minRole: 'owner', auth: 'auth-required' },
  { method: 'DELETE', path: '/api/models/:id/invites/:inviteId', minRole: 'owner', auth: 'auth-required' },
  { method: 'POST', path: '/api/invites/redeem', minRole: 'authenticated', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/members', minRole: 'viewer', auth: 'auth-required' },
  { method: 'PUT', path: '/api/models/:id/members', minRole: 'owner', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/approvals', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/approvals', minRole: 'owner', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/waivers', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/waivers', minRole: 'owner', auth: 'auth-required' },
  { method: 'DELETE', path: '/api/models/:id/waivers/:waiverId', minRole: 'owner', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/snapshots', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/snapshots', minRole: 'editor', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/snapshots/:snapshotId', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/snapshots/:snapshotId/restore', minRole: 'editor', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/comments', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/comments', minRole: 'editor', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/audit', minRole: 'viewer', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/diff', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/import/preview', minRole: 'editor', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/import/apply', minRole: 'editor', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/saved-views', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/saved-views', minRole: 'editor', auth: 'auth-required' },
  { method: 'DELETE', path: '/api/models/:id/saved-views/:viewId', minRole: 'editor', auth: 'auth-required' },
  { method: 'POST', path: '/api/models/:id/org', minRole: 'owner', auth: 'auth-required' },
  { method: 'GET', path: '/api/ai/context/:id', minRole: 'viewer', auth: 'auth-required' },
  { method: 'POST', path: '/api/ai/validate/:id', minRole: 'viewer', auth: 'auth-required' },
  { method: 'GET', path: '/api/models/:id/rt', minRole: 'viewer', auth: 'auth-required' },
  { method: 'GET', path: '/scim/v2/Users', minRole: 'admin', auth: 'auth-required' },
  { method: 'POST', path: '/scim/v2/Users', minRole: 'admin', auth: 'auth-required' },
  { method: 'GET', path: '/scim/v2/Users/:id', minRole: 'admin', auth: 'auth-required' },
  { method: 'DELETE', path: '/scim/v2/Users/:id', minRole: 'admin', auth: 'auth-required' },
];

/** Framework-internal routes exempt from the registry (never data routes). */
export const IGNORED_PREFIXES: string[] = [
  '/api/schema', // fastify swagger/schema internals if any appear
];

export interface PrintedRoute {
  method: string;
  path: string;
}

/** Parse fastify.printRoutes() output into route rows. */
export function parsePrintedRoutes(printed: string): PrintedRoute[] {
  const routes: PrintedRoute[] = [];
  for (const line of printed.split('\n')) {
    const match = /^\s*(\S+)\s+(\/\S*)/.exec(line);
    if (match) routes.push({ method: match[1], path: match[2] });
  }
  return routes;
}

/**
 * Self-audit: every live data route must have an expectation row, and every
 * expectation row must correspond to a live route. Returns the violations.
 */
export function auditRouteParity(routes: PrintedRoute[]): string[] {
  const violations: string[] = [];
  const live = new Set(routes.map((route) => `${route.method} ${route.path}`));
  const expected = new Set(ROUTE_EXPECTATIONS.map((row) => `${row.method} ${row.path}`));
  for (const key of live) {
    const [, path] = key.split(' ');
    if (IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    if (!expected.has(key)) violations.push(`unregistered route: ${key}`);
  }
  for (const key of expected) {
    if (!live.has(key)) violations.push(`expected route not live: ${key}`);
  }
  return violations;
}
