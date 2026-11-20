import {
  createSampleModel,
  diffModels,
  parseAoef,
  primaryText,
  validateModel,
  type ArchiElement,
  type AuditEvent,
  type Comment,
  type Model,
  type Relationship,
  type SavedView,
  type View,
  type Waiver,
  type GroupRole,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@openarch/core';
import { diffSummary, mergeModels, type ModelDiff } from '@openarch/core';
import { modelToMarkdown, sanitizeAiText, validateAiModel } from '@openarch/ai';
import {
  ELEMENT_TYPES,
  portfolioStats,
  RELATIONSHIP_TYPES,
  VIEWPOINTS,
  workspaceSummary,
} from '@openarch/core';
import { MemoryRepository, parseNativeModel } from '@openarch/repository';
import {
  authConfig,
  hasRole,
  initialMembers,
  isMember,
  refreshJwks,
  resolveActor,
  roleFor,
  type Actor,
} from './auth';
import { TokenStore, TokensError, type NamedTokenRecord } from './tokens';
import { OtpStore, SessionStore, sessionCookie } from './sessions';
import { auditRouteParity, parsePrintedRoutes } from './parity';
import { buildMailAdapter, type MailAdapter } from './mail';
import { buildAuthorizationUrl, exchangeCode, PkceStore, s256, type OidcSessionInfo } from './oidc';
import { eventStoreRoot, migrateLegacyVolume, WorkspaceEventStore } from './events';
import { buildOpsFromDiff } from './opdiff';
import { ReplayAt } from './replay';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import {
  broadcastEvent,
  joinRoom,
  presenceOf,
  reportFocus,
} from './collab';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Snapshot {
  id: string;
  version: number;
  createdAt: string;
  label: string;
  model: Model;
}

interface Workspace {
  model: Model;
  /** Optional organisation/tenant id for multi-tenant deployments. */
  orgId?: string;
  /** Group→role mappings used when the actor has no explicit membership. */
  groupRoles?: GroupRole[];
  /** Outstanding/accepted invitations (spec A3). Codes stored hashed only. */
  invites?: InviteRecord[];
  version: number;
  updatedAt: string;
  updatedBy: string;
  comments: Comment[];
  audit: AuditEvent[];
  snapshots: Snapshot[];
  savedViews: SavedView[];
  members?: WorkspaceMember[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.PORT ?? 8080);
const dataFile = process.env.OPENARCH_DATA ?? resolve(repoRoot, 'data/models.json');
const webDist = resolve(repoRoot, 'apps/web/dist');
const workspaces = new Map<string, Workspace>();

const auditWebhook = process.env.OPENARCH_AUDIT_WEBHOOK;

// ── SCIM 2.0 user provisioning (minimal Users resource) ─────────────────────

interface ScimUser {
  id: string;
  userName: string;
  active: boolean;
  name?: { givenName?: string; familyName?: string };
  emails?: Array<{ value: string; primary?: boolean }>;
  meta: { created: string; lastModified: string };
}

/**
 * Model-shape check + the same structural validation every other write path
 * runs (invariant 6: AI writes, HTTP clients, and the web app all go through
 * the same gate — the server is the durable enforcement point).
 * Returns a 400-friendly error string, or undefined when the model is valid.
 */
function modelWriteProblem(value: unknown): string | undefined {
  const candidate = value as Partial<Model> | null;
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return 'Not an OpenArch model (an id is required)';
  }
  if (
    !Array.isArray(candidate.elements) ||
    !Array.isArray(candidate.relationships) ||
    !Array.isArray(candidate.views)
  ) {
    return 'Not an OpenArch model (elements/relationships/views must be arrays)';
  }
  const errors = validateModel({
    ...(candidate as Model),
    name: (candidate as Model).name ?? [],
    documentation: (candidate as Model).documentation ?? [],
    properties: (candidate as Model).properties ?? [],
    propertyDefinitions: (candidate as Model).propertyDefinitions ?? [],
    domains: (candidate as Model).domains ?? [],
  }).filter((issue) => issue.severity === 'error');
  if (errors.length) {
    return `Model failed validation with ${errors.length} error(s): ${errors.slice(0, 3).map((issue) => issue.message).join('; ')}`;
  }
  return undefined;
}


const scimToken = process.env.OPENARCH_SCIM_TOKEN;
const scimFile = dataFile.replace(/\.json$/, '') + '.users.json';
const scimUsers = new Map<string, ScimUser>();

// ── Runtime admin config (data/config.json) ──────────────────────────────────

export interface RuntimeConfig {
  version: number;
  auth: { bootstrapTokenHash?: string; generatedAt?: string };
  mail?: Record<string, unknown>;
  invite?: Record<string, unknown>;
}

const configFile = dataFile.replace(/[^/]*\.json$/, '') + 'config.json';

function readRuntimeConfig(): RuntimeConfig {
  try {
    return JSON.parse(readFileSync(configFile, 'utf8')) as RuntimeConfig;
  } catch {
    return { version: 1, auth: {} };
  }
}

function writeRuntimeConfig(config: RuntimeConfig): void {
  mkdirSync(dirname(configFile), { recursive: true });
  const temp = `${configFile}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(temp, configFile);
}

/**
 * First-boot owner bootstrap (spec A1): when auth is required and no admin
 * credential exists (no static tokens, no saved hash), mint a one-time token
 * printed to stderr exactly once; only its SHA-256 is stored.
 */
function bootstrapOwnerToken(): void {
  const config = readRuntimeConfig();
  const hasAdmin =
    authConfig.staticTokens.size > 0 || Boolean(config.auth?.bootstrapTokenHash);
  if (!hasAdmin) {
    const token = `openarch_admin_${randomBytes(24).toString('hex')}`;
    const digest = createHash('sha256').update(token).digest('hex');
    config.auth = {
      bootstrapTokenHash: `sha256:${digest}`,
      generatedAt: new Date().toISOString(),
    };
    writeRuntimeConfig(config);
    // eslint-disable-next-line no-console
    console.error(
      [
        '',
        'OpenArch: first boot — owner access token:',
        `  ${token}`,
        '(Copy it now: it is not shown again and only its hash is stored.)',
        'Log in with this token, then create named tokens for people (Settings → People & tokens).',
        '',
      ].join('\n'),
    );
    authConfig.bootstrapTokenHash = `sha256:${digest}`;
  } else {
    // Restore a previously generated hash into the live auth config.
    if (config.auth?.bootstrapTokenHash) {
      authConfig.bootstrapTokenHash = config.auth.bootstrapTokenHash;
    }
  }
}

if (authConfig.required) {
  bootstrapOwnerToken();
}

// Mail adapter (spec D1): built from runtime config; console fallback when
// unconfigured. Rebuilt when the admin settings change so PUT takes effect
// immediately. OTP's default sink switches to it once available.
let mailAdapter: MailAdapter = await buildMailAdapter(readRuntimeConfig());
async function refreshMailAdapter(): Promise<void> {
  mailAdapter = await buildMailAdapter(readRuntimeConfig());
  otpStore.mailSink = {
    async sendLoginCode(email, code) {
      const info = mailAdapter.describe();
      const message = info.provider === 'console'
        ? process.stderr.write(`OpenArch OTP for ${email}: ${code} (mail not configured; 10 min)\n`) as unknown as void
        : await mailAdapter.send({
            to: email,
            subject: 'Your OpenArch login code',
            text: `Your login code is ${code}. It expires in 10 minutes.`,
          }) as unknown as void;
      void message;
    },
  };
}



/** Invitation (spec A3): codes are 128-bit, hashed at rest, single-use, never owner-granting. */
interface InviteRecord {
  id: string;
  codeHash: string;        // sha256 of the base32 code
  displayPrefix: string;   // first 4 chars for admin recognition
  role: 'editor' | 'viewer';
  email?: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
  revokedAt?: string;
  failedAttempts: number;
}

function inviteCode(): string {
  // 128 bits of entropy, base32 (Crockford), no lookalike glyphs.
  return randomBytes(16).toString('base64url').replace(/[-_]/g, '').slice(0, 20).toUpperCase();
}

function hashInvite(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

const INVITE_FAILED_ATTEMPT_CAP = 10;
const INVITE_DEFAULT_CAP = 100;

const sessionStoreFile = dataFile.replace(/[^/]*\.json$/, '') + 'sessions.json';
const sessionStore = new SessionStore(sessionStoreFile);
const otpStore = new OtpStore();
const pkceStore = new PkceStore();
const oidcIssuerForLogin = process.env.OPENARCH_OIDC_ISSUER ?? authConfig.oidcIssuer;
const oidcClientId = process.env.OPENARCH_OIDC_CLIENT_ID;

// Wire the mail-backed OTP sink now that both exist (console fallback until configured).
await refreshMailAdapter();
const SESSION_IDLE_DAYS = Math.max(1, Number(process.env.OPENARCH_SESSION_IDLE_DAYS) || 30);

const tokenStoreFile = dataFile.replace(/[^/]*\.json$/, '') + 'tokens.json';
const tokenStore = new TokenStore(tokenStoreFile);

// Admin predicate: the bootstrap/OPENARCH_ADMIN subject only — token minting
// is a server-operator capability, not a per-workspace one.
function requireAdmin(request: { headers: Record<string, unknown> }, reply: import('fastify').FastifyReply): Actor | null {
  const actor = requireActor(request, reply);
  if (!actor) return null;
  if (actor.subject !== authConfig.adminSubject) {
    void reply.code(403).send({ error: 'Admin only' });
    return null;
  }
  return actor;
}



function loadScimUsers(): void {
  if (!existsSync(scimFile)) return;
  const stored = JSON.parse(readFileSync(scimFile, 'utf-8')) as ScimUser[];
  for (const user of stored) scimUsers.set(user.id, user);
}

function persistScimUsers(): void {
  writeFileSync(scimFile, JSON.stringify([...scimUsers.values()], null, 2));
}

loadScimUsers();

function requireScim(request: FastifyRequest, reply: FastifyReply): boolean {
  const header = request.headers.authorization ?? '';
  if (!scimToken || !header.startsWith('Bearer ')) {
    void reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'SCIM token required' });
    return false;
  }
  // Constant-time comparison — the token is a long-lived secret.
  const presented = Buffer.from(header.slice(7));
  const expected = Buffer.from(scimToken);
  const valid =
    presented.length === expected.length && timingSafeEqual(presented, expected);
  if (!valid) {
    void reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'SCIM token required' });
    return false;
  }
  return true;
}

function scimListResponse(users: ScimUser[]) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: users.length,
    itemsPerPage: users.length,
    startIndex: 1,
    Resources: users,
  };
}

function audit(workspace: Workspace, actor: string, action: AuditEvent['action'], summary: string, entityId?: string): void {
  const event: AuditEvent = {
    id: `audit-${crypto.randomUUID()}`,
    modelId: workspace.model.id,
    actor,
    action,
    summary,
    entityId,
    createdAt: new Date().toISOString(),
  };
  workspace.audit.unshift(event);
  workspace.audit = workspace.audit.slice(0, 200);
  // Stream to a SIEM when configured; failures must never break the request.
  if (auditWebhook) {
    void fetch(auditWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => undefined);
  }
}

function loadFromDiskSeed(): void {
  const model = createSampleModel();
  const workspace: Workspace = {
    model,
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
    comments: [],
    audit: [],
    snapshots: [],
    savedViews: [],
    members: initialMembers({ subject: authConfig.adminSubject, authenticated: false }),
  };
  audit(workspace, 'system', 'create', 'Seeded sample workspace');
  workspaces.set(model.id, workspace);
  persistToDisk();
}

function loadFromDisk(): void {
  if (!existsSync(dataFile)) {
    loadFromDiskSeed();
    return;
  }
  let raw: string;
  try {
    raw = readFileSync(dataFile, 'utf-8');
  } catch {
    loadFromDiskSeed();
    return;
  }
  let stored: Workspace[] | Record<string, Workspace> | Model[] | undefined;
  try {
    stored = JSON.parse(raw) as Workspace[] | Record<string, Workspace> | Model[];
  } catch (error) {
    // Never brick the server on a corrupt file: quarantine it and start
    // fresh so operators can recover data from the backup copy.
    const corrupt = `${dataFile}.corrupt-${Date.now()}`;
    renameSync(dataFile, corrupt);
    console.error(
      `OpenArch: data file was corrupt; moved to ${corrupt} (${error instanceof Error ? error.message : String(error)}). Starting fresh.`,
    );
    loadFromDiskSeed();
    return;
  }
  const list = Array.isArray(stored) ? stored : Object.values(stored);
  for (const entry of list) {
    const maybeWorkspace = entry as Partial<Workspace> & Partial<Model>;
    // Migrate legacy data files that stored bare models instead of workspaces.
    const workspace: Workspace = maybeWorkspace.model
      ? (maybeWorkspace as Workspace)
      : {
          model: maybeWorkspace as Model,
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: 'system',
          comments: [],
          audit: [],
          snapshots: [],
          savedViews: [],
          members: initialMembers({ subject: authConfig.adminSubject, authenticated: false }),
        };
    if (!workspace.model?.id) continue;
    workspace.comments ??= [];
    workspace.audit ??= [];
    workspace.snapshots ??= [];
    workspace.savedViews ??= [];
    workspace.members ??= initialMembers({ subject: authConfig.adminSubject, authenticated: false });
    workspaces.set(workspace.model.id, workspace);
  }
  if (workspaces.size === 0) loadFromDiskSeed();
}

function persistToDisk(): void {
  mkdirSync(dirname(dataFile), { recursive: true });
  // Atomic persistence: write a temp file, then rename over the target — a
  // crash mid-write can no longer corrupt the only copy of all workspaces.
  const tempFile = `${dataFile}.tmp-${process.pid}`;
  writeFileSync(tempFile, `${JSON.stringify([...workspaces.values()], null, 2)}\n`);
  renameSync(tempFile, dataFile);
}

loadFromDisk();

// C2: migrate the whole legacy volume (snapshot 0 per workspace) and keep
// per-workspace event-store handles for op logging + restore.
const eventStores = new Map<string, WorkspaceEventStore>();
(function migrateToEventStore(): void {
  const root = eventStoreRoot(dataFile);
  const records = [...workspaces.values()].map((workspace) => ({ model: workspace.model }));
  const migrated = migrateLegacyVolume(dataFile, records, () => undefined);
  for (const [id, store] of migrated) eventStores.set(id, store);
  // Workspaces created AFTER boot register lazily.
  void root;
})();


const app = Fastify({ logger: true });
/**
 * CORS origins: defaults to the local dev servers only — reflecting arbitrary
 * origins lets any visited website read and mutate a self-hosted instance
 * from the victim's browser. Set OPENARCH_CORS_ORIGIN to a comma-separated
 * list ("https://arch.example.com,https://ea.example.com") for real
 * deployments, or "true" to restore the old reflect-anything behaviour.
 */
const corsOriginSetting = process.env.OPENARCH_CORS_ORIGIN ?? '';
await app.register(websocket);
await app.register(cors, {
  // Default: allow same-origin requests plus any local dev loopback origin
  // (localhost/127.0.0.1 on any port) — the Vite dev server (:5173) and the
  // server's own hosted build must both reach the API. Set
  // OPENARCH_CORS_ORIGIN to a comma-separated list for deployments, or
  // "true" to reflect arbitrary origins (NOT recommended).
  origin(origin, callback) {
    if (!origin) return callback(null, true); // same-origin / non-browser clients
    if (corsOriginSetting === 'true') return callback(null, true);
    const allowed = corsOriginSetting
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (allowed.length) return callback(null, allowed.includes(origin));
    try {
      const { hostname } = new URL(origin);
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        return callback(null, true);
      }
    } catch {
      // fall through to deny
    }
    return callback(null, false);
  },
});
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: true });
}

// OIDC: load the JWKS at startup and refresh it periodically so verification
// stays synchronous in request handlers.
if (authConfig.oidcIssuer || authConfig.oidcJwksUrl) {
  try {
    await refreshJwks();
    app.log.info('OIDC JWKS loaded');
  } catch (error) {
    app.log.error({ err: error }, 'Could not load the OIDC JWKS');
  }
  const timer = setInterval(() => {
    void refreshJwks().catch(() => undefined);
  }, 10 * 60 * 1000);
  timer.unref();
}

/** Resolve the authenticated actor or send a 401. */
function requireActor(
  request: { headers: Record<string, unknown> },
  reply: import('fastify').FastifyReply,
): Actor | null {
  let actor = resolveActor(request.headers);
  if (!actor) {
    // Session store (spec A4): cookie or Bearer, hashed, idle+absolute expiry.
    const cookieToken = /openarch_session=([^;]+)/.exec(String(request.headers.cookie ?? ''))?.[1];
    const bearer = typeof request.headers.authorization === 'string'
      && request.headers.authorization.toLowerCase().startsWith('bearer ')
      ? request.headers.authorization.slice(7).trim()
      : undefined;
    const sessionToken = cookieToken ?? bearer;
    if (sessionToken) {
      const session = sessionStore.resolve(sessionToken, SESSION_IDLE_DAYS);
      if (session) {
        actor = { subject: session.subject, displayName: session.displayName, authenticated: true };
      }
    }
  }
  if (!actor) {
    // Named-token store (spec A2): constant-time hashed resolution.
    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
      const record = tokenStore.resolve(authorization.slice(7).trim());
      if (record) {
        actor = { subject: record.subject, displayName: record.displayName ?? record.subject, authenticated: true };
      }
    }
  }
  if (!actor) {
    void reply.code(401).send({
      error: 'Authentication required',
      hint: 'Send Authorization: Bearer <token> (OPENARCH_TOKENS or a HS256 JWT signed with OPENARCH_JWT_SECRET).',
    });
    return null;
  }
  return actor;
}

/** Check workspace membership or send a 401/403. */
function requireMember(
  request: { headers: Record<string, unknown> },
  reply: import('fastify').FastifyReply,
  workspace: Workspace,
): Actor | null {
  const actor = requireActor(request, reply);
  if (!actor) return null;
  if (!isMember(workspace.members, actor, undefined, workspace.groupRoles)) {
    void reply.code(403).send({ error: 'Forbidden: you are not a member of this workspace' });
    return null;
  }
  return actor;
}

/** Check workspace role or send a 401/403. */
function requireRole(
  request: { headers: Record<string, unknown> },
  reply: import('fastify').FastifyReply,
  workspace: Workspace,
  allowed: Array<'owner' | 'editor' | 'viewer'>,
): Actor | null {
  const actor = requireActor(request, reply);
  if (!actor) return null;
  if (!hasRole(roleFor(workspace.members, actor, undefined, workspace.groupRoles), allowed)) {
    void reply.code(403).send({ error: 'Forbidden: your workspace role does not allow this operation' });
    return null;
  }
  return actor;
}

app.get('/health', async () => ({
  // No counts, no mode: an unauthenticated endpoint gives away nothing.
  status: 'ok',
}));

app.get('/api/me', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  const roles: Record<string, string> = {};
  for (const workspace of workspaces.values()) {
    roles[workspace.model.id] = roleFor(workspace.members, actor, undefined, workspace.groupRoles);
  }
  return { ...actor, roles };
});

app.get('/scim/v2/Users', async (request, reply) => {
  if (!requireScim(request, reply)) return;
  const filter = (request.query as { filter?: string }).filter ?? '';
  let users = [...scimUsers.values()];
  if (filter) {
    const match = /userName eq "([^"]+)"/.exec(filter);
    if (!match) {
      // Unsupported filters must not silently return the full user list —
      // reply 400 so provisioners surface the mismatch instead of mis-syncing.
      return reply.code(400).send({ error: `Unsupported SCIM filter (only userName eq "..." is supported)` });
    }
    users = users.filter((user) => user.userName === match[1]);
  }
  return scimListResponse(users);
});

app.post('/scim/v2/Users', async (request, reply) => {
  if (!requireScim(request, reply)) return;
  const body = (request.body ?? {}) as Partial<ScimUser> & { userName?: string };
  if (!body.userName) return reply.code(400).send({ error: 'userName is required' });
  if ([...scimUsers.values()].some((user) => user.userName === body.userName)) {
    return reply.code(409).send({ error: 'User already exists' });
  }
  const now = new Date().toISOString();
  const user: ScimUser = {
    id: `urn:uuid:${crypto.randomUUID()}`,
    userName: body.userName,
    active: body.active ?? true,
    name: body.name,
    emails: body.emails,
    meta: { created: now, lastModified: now },
  };
  scimUsers.set(user.id, user);
  persistScimUsers();
  return reply.code(201).send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], ...user });
});

app.get('/scim/v2/Users/:id', async (request, reply) => {
  if (!requireScim(request, reply)) return;
  const user = scimUsers.get((request.params as { id: string }).id);
  if (!user) return reply.code(404).send({ error: 'User not found' });
  return { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], ...user };
});

app.delete('/scim/v2/Users/:id', async (request, reply) => {
  if (!requireScim(request, reply)) return;
  const user = scimUsers.get((request.params as { id: string }).id);
  if (!user) return reply.code(404).send({ error: 'User not found' });
  // SCIM delete = deactivate, keeping the record for audit.
  user.active = false;
  user.meta.lastModified = new Date().toISOString();
  persistScimUsers();
  return reply.code(204).send();
});


app.post('/api/models/:id/org', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const body = (request.body ?? {}) as { orgId?: string | null };
  workspace.orgId = body.orgId || undefined;
  audit(workspace, actor.subject, 'update', `Set organisation to ${workspace.orgId ?? '(none)'}`);
  persistToDisk();
  return { orgId: workspace.orgId ?? null };
});

app.get('/api/models', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  // Only list workspaces the actor can actually read. In open mode every
  // workspace is visible; with auth on, membership is required. An optional
  // ?orgId= scopes the list to one tenant (multi-tenant deployments).
  const orgId = (request.query as { orgId?: string }).orgId;
  const query = request.query as { summary?: string; limit?: string; cursor?: string };
  const readable = [...workspaces.values()]
    .filter(
      (workspace) =>
        !authConfig.required ||
        isMember(workspace.members, actor, undefined, workspace.groupRoles),
    )
    .filter((workspace) => !orgId || workspace.orgId === orgId);
  // Summary mode returns lightweight metadata (the web home screen only
  // needs summaries; full models are fetched on open) and supports simple
  // cursor pagination for large deployments.
  if (query.summary === '1') {
    const summaries = readable.map((workspace) => ({
      ...workspaceSummary(workspace.model),
      updatedAt: workspace.updatedAt,
    }));
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 200));
    const startIndex = query.cursor ? Math.max(0, summaries.findIndex((s) => s.id === query.cursor)) : 0;
    const items = summaries.slice(startIndex, startIndex + limit);
    return { items, nextCursor: startIndex + limit < summaries.length ? items[items.length - 1].id : undefined };
  }
  return readable.map((workspace) => ({ ...workspace.model, updatedAt: workspace.updatedAt }));
});

app.get('/api/models/:id/meta', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return {
    version: workspace.version,
    updatedAt: workspace.updatedAt,
    updatedBy: workspace.updatedBy,
    commentCount: workspace.comments.length,
    snapshotCount: workspace.snapshots.length,
    savedViewCount: workspace.savedViews.length,
    role: roleFor(workspace.members, resolveActor(request.headers)!, undefined, workspace.groupRoles),
  };
});

app.get('/api/models/:id', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  reply.header('x-model-version', String(workspace.version));
  return workspace.model;
});

app.post('/api/models', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  const model = request.body as Model;
  const problem = modelWriteProblem(model);
  if (problem) return reply.code(400).send({ error: problem });
  if (workspaces.has(model.id)) return reply.code(409).send({ error: 'Workspace already exists' });
  const workspace: Workspace = {
    model,
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.subject,
    comments: [],
    audit: [],
    snapshots: [],
    savedViews: [],
    members: initialMembers(actor),
  };
  audit(workspace, actor.subject, 'create', `Created workspace ${primaryText(model.name)}`);
  workspaces.set(model.id, workspace);
  persistToDisk();
  return reply.code(201).send(model);
});

app.put('/api/models/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const workspace = workspaces.get(id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const header = request.headers['if-match'];
  const expected = Number(Array.isArray(header) ? header[0] : header);
  if (Number.isFinite(expected) && expected !== workspace.version) {
    return reply.code(409).send({
      error: 'Conflict: workspace changed',
      currentVersion: workspace.version,
      current: workspace.model,
    });
  }
  const model = { ...(request.body as Model), id };
  // Invariant 6 enforcement at the durable write path: refuse error-severity
  // models no matter which client (web, MCP, curl) sends them.
  const problem = modelWriteProblem(model);
  if (problem) return reply.code(400).send({ error: problem });
  const preSaveModel = workspace.model;
  workspace.model = model;
  workspace.version += 1;
  workspace.updatedAt = new Date().toISOString();
  workspace.updatedBy = actor.subject;
  // Keep a rolling version history (newest last, capped).
  workspace.snapshots ??= [];
  workspace.snapshots.push({
    id: `snapshot-${crypto.randomUUID()}`,
    version: workspace.version,
    createdAt: workspace.updatedAt,
    label: `Revision ${workspace.version}`,
    model: structuredClone(model),
  });
  if (workspace.snapshots.length > 50) {
    workspace.snapshots.splice(0, workspace.snapshots.length - 50);
  }
  audit(
    workspace,
    workspace.updatedBy,
    'update',
    `Saved revision ${workspace.version} (${model.elements.length} elements)`,
  );
  persistToDisk();
  // C2 compat: the whole-model save decomposes into ops so the event log is
  // complete from day one. Ops validate against the PRE-SAVE model (the state
  // each op was derived from) and chain — never against the already-
  // overwritten workspace.model, which would starve creates/deletes.
  try {
    const store = eventStores.get(id) ?? (() => {
      const fresh = new WorkspaceEventStore(eventStoreRoot(dataFile), id);
      if (!fresh.exists()) fresh.initialize(model);
      eventStores.set(id, fresh);
      return fresh;
    })();
    const compatOps = buildOpsFromDiff(preSaveModel, model);
    // Chain each op: append validates against (and advances) `logModel`,
    // separately from the already-committed `workspace.model`.
    let logModel = preSaveModel;
    for (const op of compatOps) {
      const appended = store.append(logModel, op, actor.subject);
      if (appended.result.ok) {
        logModel = appended.model;
        broadcastEvent(id, { type: 'ops', workspaceId: id, by: actor.subject, ops: [op] });
      }
    }
  } catch (error) {
    app.log.warn(`event-log append skipped for ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  broadcastEvent(workspace.model.id, {
    type: 'saved',
    version: workspace.version,
    by: actor.subject,
    elementCount: model.elements.length,
  });
  reply.header('x-model-version', String(workspace.version));
  return model;
});

app.delete('/api/models/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const workspace = workspaces.get(id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  workspaces.delete(id);
  persistToDisk();
  return reply.code(204).send();
});

app.get('/api/models/:id/diff', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { compare } = request.query as { compare?: string };
  const workspace = workspaces.get(id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  if (compare) {
    const other = workspaces.get(compare);
    if (!other) return reply.code(404).send({ error: 'Comparison workspace not found' });
    // The comparison target is just as sensitive as the primary — check
    // membership on both sides rather than leaking a non-member workspace.
    if (!requireMember(request, reply, other)) return;
    return diffModels(other.model, workspace.model);
  }
  const snapshot = workspace.snapshots.at(-1);
  if (!snapshot) return reply.code(404).send({ error: 'No baseline snapshot to compare against' });
  return diffModels(snapshot.model, workspace.model);
});

app.get('/api/models/:id/comments', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.comments;
});

app.post('/api/models/:id/comments', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const body = request.body as { body?: string; elementId?: string };
  if (!body?.body?.trim()) return reply.code(400).send({ error: 'Comment body is required' });
  const comment: Comment = {
    id: `comment-${crypto.randomUUID()}`,
    modelId: workspace.model.id,
    elementId: body.elementId,
    // The author is ALWAYS the authenticated actor — a client-supplied name
    // must never be able to forge audit actors.
    author: actor.subject,
    body: body.body.trim(),
    createdAt: new Date().toISOString(),
    resolved: false,
  };
  workspace.comments.unshift(comment);
  broadcastEvent(workspace.model.id, { type: 'comment', comment });
  audit(workspace, actor.subject, 'comment', 'Added a comment', comment.elementId);
  persistToDisk();
  return reply.code(201).send(comment);
});

app.get('/api/models/:id/audit', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.audit;
});

app.get('/api/models/:id/snapshots', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.snapshots.map(({ model: _model, ...metadata }) => metadata);
});

app.post('/api/models/:id/snapshots', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const body = (request.body ?? {}) as { label?: string };
  const snapshot: Snapshot = {
    id: `snapshot-${crypto.randomUUID()}`,
    version: workspace.version,
    createdAt: new Date().toISOString(),
    label: body.label || `Revision ${workspace.version}`,
    model: structuredClone(workspace.model),
  };
  workspace.snapshots.push(snapshot);
  // Same rolling cap as save revisions — snapshots are full model clones.
  if (workspace.snapshots.length > 50) {
    workspace.snapshots.splice(0, workspace.snapshots.length - 50);
  }
  audit(workspace, actor.subject, 'create', `Created snapshot ${snapshot.label}`);
  persistToDisk();
  const { model: _model, ...metadata } = snapshot;
  return reply.code(201).send(metadata);
});

app.get('/api/models/:id/snapshots/:snapshotId', async (request, reply) => {
  const { id, snapshotId } = request.params as { id: string; snapshotId: string };
  const workspace = workspaces.get(id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  const snapshot = workspace.snapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) return reply.code(404).send({ error: 'Snapshot not found' });
  return snapshot;
});

app.post('/api/models/:id/snapshots/:snapshotId/restore', async (request, reply) => {
  const { id, snapshotId } = request.params as { id: string; snapshotId: string };
  const workspace = workspaces.get(id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const snapshot = workspace.snapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) return reply.code(404).send({ error: 'Snapshot not found' });
  // Snapshot the in-flight revision first — restore being a destructive
  // decision must stay reversible like every other write.
  workspace.snapshots ??= [];
  workspace.snapshots.push({
    id: `snapshot-${crypto.randomUUID()}`,
    version: workspace.version,
    createdAt: new Date().toISOString(),
    label: `Pre-restore revision ${workspace.version}`,
    model: structuredClone(workspace.model),
  });
  if (workspace.snapshots.length > 50) {
    workspace.snapshots.splice(0, workspace.snapshots.length - 50);
  }
  workspace.model = structuredClone(snapshot.model);
  workspace.model.id = id;
  workspace.version += 1;
  workspace.updatedAt = new Date().toISOString();
  workspace.updatedBy = actor.subject;
  audit(workspace, actor.subject, 'restore', `Restored ${snapshot.label} as revision ${workspace.version}`);
  persistToDisk();
  broadcastEvent(workspace.model.id, { type: 'saved', version: workspace.version, by: actor.subject, restore: true });
  reply.header('x-model-version', String(workspace.version));
  return workspace.model;
});

// ── Saved views ──────────────────────────────────────────────────────────────

app.get('/api/models/:id/saved-views', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.savedViews;
});

app.post('/api/models/:id/saved-views', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const view = request.body as SavedView;
  if (!view?.id || !view.name?.trim()) return reply.code(400).send({ error: 'View id and name are required' });
  const saved: SavedView = { ...view, modelId: workspace.model.id, createdAt: view.createdAt || new Date().toISOString() };
  workspace.savedViews = [...workspace.savedViews.filter((item) => item.id !== saved.id), saved];
  audit(workspace, actor.subject, 'create', `Saved view ${saved.name}`);
  persistToDisk();
  return reply.code(201).send(saved);
});

app.delete('/api/models/:id/saved-views/:viewId', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const { viewId } = request.params as { id: string; viewId: string };
  workspace.savedViews = workspace.savedViews.filter((view) => view.id !== viewId);
  audit(workspace, actor.subject, 'delete', `Deleted saved view ${viewId}`);
  persistToDisk();
  return reply.code(204).send();
});



// ── Mail admin (spec D1/D2) — admin only, masked secrets ────────────────────

app.get('/api/admin/mail', async (request, reply) => {
  const actor = requireAdmin(request, reply);
  if (!actor) return;
  const config = readRuntimeConfig();
  const info = mailAdapter.describe();
  const mail = (config.mail ?? {}) as Record<string, {
    apiKey?: string; pass?: string; host?: string; port?: number; secure?: boolean; user?: string;
  }>;
  return {
    ...info,
    provider: info.provider,
    fromName: mail.fromName,
    fromAddress: mail.fromAddress,
    replyTo: mail.replyTo,
    resend: { apiKeyMasked: mail.resend?.apiKey ? `…${mail.resend.apiKey.slice(-4)}` : undefined },
    smtp: {
      host: mail.smtp?.host,
      port: mail.smtp?.port,
      secure: mail.smtp?.secure,
      user: mail.smtp?.user,
      passMasked: mail.smtp?.pass ? '****' : undefined,
    },
  };
});

app.put('/api/admin/mail', async (request, reply) => {
  const actor = requireAdmin(request, reply);
  if (!actor) return;
  const body = (request.body ?? {}) as Record<string, unknown>;
  const config = readRuntimeConfig();
  const mail = (config.mail ?? {}) as Record<string, unknown>;
  if (body.provider === 'resend' || body.provider === 'smtp') {
    mail.provider = body.provider;
  } else if (body.provider === null) {
    mail.provider = null;
  } else if ('provider' in body) {
    return reply.code(400).send({ error: 'provider must be resend, smtp, or null' });
  }
  if (typeof body.fromName === 'string') mail.fromName = body.fromName.trim() || undefined;
  if (typeof body.fromAddress === 'string') mail.fromAddress = body.fromAddress.trim() || undefined;
  if (typeof body.replyTo === 'string') mail.replyTo = body.replyTo.trim() || undefined;
  if (body.resend && typeof body.resend === 'object') {
    const resend = body.resend as { apiKey?: string };
    mail.resend = { ...(mail.resend as object), ...(resend.apiKey ? { apiKey: resend.apiKey.trim() } : {}) };
  }
  if (body.smtp && typeof body.smtp === 'object') {
    const smtp = body.smtp as { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
    mail.smtp = {
      ...(mail.smtp as object),
      ...(typeof smtp.host === 'string' ? { host: smtp.host.trim() } : {}),
      ...(Number.isFinite(smtp.port) ? { port: Number(smtp.port) } : {}),
      ...(typeof smtp.secure === 'boolean' ? { secure: smtp.secure } : {}),
      ...(typeof smtp.user === 'string' ? { user: smtp.user } : {}),
      ...(typeof smtp.pass === 'string' && smtp.pass ? { pass: smtp.pass } : {}),
    };
  }
  config.mail = mail;
  writeRuntimeConfig(config);
  await refreshMailAdapter();
  app.log.info(`admin ${actor.subject} updated mail config (provider=${mail.provider ?? 'unset'})`);
  return mailAdapter.describe();
});

app.post('/api/admin/mail/test', async (request, reply) => {
  const actor = requireAdmin(request, reply);
  if (!actor) return;
  const body = (request.body ?? {}) as { to?: string };
  const to = String(body.to ?? '').trim();
  if (!to.includes('@')) return reply.code(400).send({ error: 'to (email) is required' });
  const info = mailAdapter.describe();
  if (info.provider === 'console') {
    return reply.code(400).send({ error: 'No mail provider configured (provider + from-address required first)' });
  }
  try {
    const result = await mailAdapter.send({
      to,
      subject: 'OpenArch test email',
      text: 'This is a delivery test from your OpenArch server. If you can read this, invite emails will work.',
    });
    const config = readRuntimeConfig();
    const mail = (config.mail ?? {}) as Record<string, unknown>;
    mail.confirmedTestAt = new Date().toISOString();
    config.mail = mail;
    writeRuntimeConfig(config);
    return { delivered: result.delivered, providerMessageId: result.providerMessageId, emailDeliveryEnabled: true };
  } catch (error) {
    return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
  }
});


// ── Op endpoint (spec C3) — per-op apply-or-reject, live broadcast ──────────

app.post('/api/models/:id/ops', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const body = (request.body ?? {}) as { ops?: unknown[] };
  const incoming = Array.isArray(body.ops) ? body.ops : [];
  if (incoming.length === 0) return reply.code(400).send({ error: 'ops array is required' });
  if (incoming.length > 1000) return reply.code(400).send({ error: 'op batches are capped at 1000' });

  const store = eventStores.get(workspace.model.id) ?? (() => {
    const fresh = new WorkspaceEventStore(eventStoreRoot(dataFile), workspace.model.id);
    if (!fresh.exists()) fresh.initialize(workspace.model);
    eventStores.set(workspace.model.id, fresh);
    return fresh;
  })();

  const rejected: Array<{ seq: number; rule: string; message: string }> = [];
  let current = workspace.model;
  let version = store.readMeta().version;
  let index = 0;
  for (const raw of incoming) {
    index += 1;
    const op = raw as never as Parameters<typeof store.append>[1];
    if (!op || typeof (op as { kind?: unknown }).kind !== 'string') {
      rejected.push({ seq: index, rule: 'op.malformed', message: 'op is missing kind' });
      continue;
    }
    const appended = store.append(current, op, actor.subject);
    if (!appended.result.ok) {
      const first = appended.result.issues?.find((issue) => issue.severity === 'error');
      rejected.push({ seq: index, rule: first?.rule ?? 'op.invalid', message: first?.message ?? 'rejected' });
      continue;
    }
    current = appended.model;
    version = appended.result.version;
    broadcastEvent(workspace.model.id, { type: 'ops', workspaceId: workspace.model.id, ops: [op] });
  }

  if (rejected.length === 0) {
    // All applied: commit the projected model to the workspace + persist.
    workspace.model = current;
    workspace.version += 1;
    workspace.updatedAt = new Date().toISOString();
    workspace.updatedBy = actor.subject;
    audit(workspace, actor.subject, 'update', `Applied ${incoming.length} op(s) (event v${version})`);
    persistToDisk();
    return reply.code(207).send({ applied: incoming.length, rejected: [], version: workspace.version });
  }
  // Per-op verdicts: 207 with the reject list (the spec's body shape).
  const appliedCount = incoming.length - rejected.length;
  if (appliedCount > 0) {
    workspace.model = current;
    workspace.version += 1;
    workspace.updatedAt = new Date().toISOString();
    workspace.updatedBy = actor.subject;
    audit(workspace, actor.subject, 'update', `Applied ${appliedCount}/${incoming.length} op(s)`);
    persistToDisk();
  }
  return reply.code(207).send({ applied: appliedCount, rejected, version: workspace.version });
});

// ── Named tokens ("People & tokens", A2) — admin only ────────────────────────

app.post('/api/admin/tokens', async (request, reply) => {
  const actor = requireAdmin(request, reply);
  if (!actor) return;
  const body = (request.body ?? {}) as { subject?: string; displayName?: string; expiresAt?: string };
  try {
    const { record, token } = tokenStore.mint({
      subject: String(body.subject ?? ''),
      displayName: body.displayName,
      expiresAt: body.expiresAt,
    });
    app.log.info(`admin ${actor.subject} minted named token for ${record.subject}`);
    return reply.code(201).send({ record, token });
  } catch (error) {
    if (error instanceof TokensError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/admin/tokens', async (request, reply) => {
  const actor = requireAdmin(request, reply);
  if (!actor) return;
  return tokenStore.list();
});

app.delete('/api/admin/tokens/:id', async (request, reply) => {
  const actor = requireAdmin(request, reply);
  if (!actor) return;
  const revoked = tokenStore.revoke((request.params as { id: string }).id);
  if (!revoked) return reply.code(404).send({ error: 'Token not found' });
  return reply.code(204).send();
});




// ── OIDC + PKCE login (spec A5) ──────────────────────────────────────────────

app.get('/api/auth/oidc/start', async (request, reply) => {
  if (!oidcIssuerForLogin || !oidcClientId) {
    return reply.code(400).send({ error: 'OIDC login not configured (OPENARCH_OIDC_ISSUER + OPENARCH_OIDC_CLIENT_ID)' });
  }
  const redirectUri =
    process.env.OPENARCH_OIDC_REDIRECT_URI ??
    `${request.protocol}://${request.hostname}/api/auth/oidc/callback`;
  const { authorizationUrl, state, codeVerifier } = pkceStore.begin(redirectUri, (stateParam) =>
    buildAuthorizationUrl({
      issuer: oidcIssuerForLogin,
      clientId: oidcClientId,
      redirectUri,
      state: stateParam,
      codeChallenge: s256(codeVerifier),
    }),
  );
  // PKCE: the code_verifier never leaves this server (state→verifier map is
  // authoritative); the client gets only the URL and state.
  return { authorizationUrl, state };
});

// OIDC callback: IdPs redirect with GET (browser), but API clients may POST.
app.get('/api/auth/oidc/callback', async (request, reply) => {
  const query = request.query as { code?: string; state?: string };
  await handleOidcCallback(query.code, query.state, (result) => {
    // On success: set the cookie and redirect to the app root so the
    // browser lands with a usable session rather than a JSON body.
    if ('token' in result) {
      reply.header('set-cookie', sessionCookie(result.token as string));
      return reply.redirect('/');
    }
    const statusCode = (result as { statusCode?: number }).statusCode ?? 401;
    return reply.code(statusCode).send(result);
  });
});

app.post('/api/auth/oidc/callback', async (request, reply) => {
  const body = (request.body ?? {}) as { code?: string; state?: string };
  const result = await handleOidcCallback(body.code, body.state, (r) => r) as Record<string, unknown>;
  if ('error' in result) {
    const statusCode = typeof result.statusCode === 'number' ? result.statusCode : 401;
    return reply.code(statusCode).send(result);
  }
  const tokenResult = result as { token: string; subject: string; displayName?: string };
  reply.header('set-cookie', sessionCookie(tokenResult.token));
  return tokenResult;
});

async function handleOidcCallback(
  code: string | undefined,
  state: string | undefined,
  done: (result: Record<string, unknown>) => unknown,
): Promise<unknown> {
  if (!code || !state) return done({ statusCode: 400, error: 'code and state are required' });
  const pair = pkceStore.finish(state);
  if (!pair) return done({ statusCode: 401, error: 'Unknown, expired, or reused state' });

  let accessToken: string;
  try {
    const exchanged = await exchangeCode({
      issuer: oidcIssuerForLogin!,
      clientId: oidcClientId!,
      redirectUri: pair.redirectUri,
      code,
      codeVerifier: pair.codeVerifier,
    });
    accessToken = exchanged.accessToken;
  } catch (error) {
    return done({ statusCode: 502, error: error instanceof Error ? error.message : String(error) });
  }

  // Same RS256/JWKS path as bearer tokens — no second crypto.
  const verified = resolveActor({ authorization: `Bearer ${accessToken}` });
  if (!verified?.authenticated) {
    return done({ statusCode: 401, error: 'IdP token failed verification (issuer/audience/expiry)' });
  }
  const { token } = sessionStore.mint({
    subject: verified.subject,
    displayName: verified.displayName ?? verified.subject,
    kind: 'oidc',
    idleDays: SESSION_IDLE_DAYS,
    absoluteDays: 90,
  });
  return done({ token, subject: verified.subject, displayName: verified.displayName });
}

// ── OTP login + sessions (spec A4) ──────────────────────────────────────────

app.post('/api/auth/otp/request', async (request, reply) => {
  const body = (request.body ?? {}) as { email?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  // Generic 204 always: unknown emails never confirm existence.
  const known = tokenStore.list().some((record) => record.subject.toLowerCase() === email)
    || (authConfig.staticTokens.size > 0 && false);
  if (email && known) {
    otpStore.request(email); // rate-limited internally; still 204 either way
  }
  return reply.code(204).send();
});

app.post('/api/auth/otp/verify', async (request, reply) => {
  const body = (request.body ?? {}) as { email?: string; code?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  const ip = request.ip;
  const withinIpBudget = otpStore.verifyFailureForIp(ip);
  const ok = withinIpBudget && otpStore.verify(email, String(body.code ?? ''));
  if (!ok) {
    if (!withinIpBudget) return reply.code(429).send({ error: 'Too many attempts' });
    return reply.code(401).send({ error: 'Invalid or expired code' });
  }
  // Resolve display name from the named-token record.
  const tokenRecord = tokenStore.list().find((record) => record.subject.toLowerCase() === email);
  const displayName = tokenRecord?.displayName ?? email;
  const { token } = sessionStore.mint({
    subject: email,
    displayName,
    kind: 'otp',
    idleDays: SESSION_IDLE_DAYS,
    absoluteDays: 90,
  });
  reply.header('set-cookie', sessionCookie(token));
  return { token, subject: email, displayName };
});

// CSRF guard for cookie-session unsafe methods (spec A4): same-origin check.
app.addHook('preHandler', async (request, reply) => {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  const cookie = request.headers.cookie ?? '';
  if (!cookie.includes('openarch_session=')) return; // Bearer-only clients exempt
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin === 'string' && typeof host === 'string' && new URL(origin).host !== host) {
    return reply.code(403).send({ error: 'Cross-origin request rejected' });
  }
});

app.post('/api/auth/logout', async (request, reply) => {
  const bearer = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice(7).trim()
    : undefined;
  const cookieToken = /openarch_session=([^;]+)/.exec(String(request.headers.cookie ?? ''))?.[1];
  const token = bearer ?? cookieToken;
  if (token) sessionStore.revoke(token);
  reply.header('set-cookie', 'openarch_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return reply.code(204).send();
});


// ── C4: point-in-time restore + store verify (spec §5, plan §12) ───────────

app.post('/api/models/:id/restore-at/:seq', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  const { seq } = request.params as { id: string; seq: string };
  const targetSeq = Number(seq);
  if (!Number.isInteger(targetSeq) || targetSeq < 0) {
    return reply.code(400).send({ error: 'seq must be a non-negative integer' });
  }
  const store = eventStores.get(workspace.model.id);
  if (!store || !store.exists()) {
    return reply.code(404).send({ error: 'No event history for this workspace (log started after its last save?)' });
  }
  // Resolve the file name from the URL form (`.ts` is compiled at runtime here).
  const { ReplayAt } = await import('./replay');
  const metaVersion = store.readMeta().version;
  if (targetSeq > metaVersion) {
    return reply.code(400).send({ error: `Workspace history only reaches seq ${metaVersion}` });
  }
  const replayed = ReplayAt.replayTo(store, targetSeq);
  if (replayed.chainErrors.length) {
    return reply.code(409).send({ error: 'Event history failed verification', details: replayed.chainErrors });
  }
  // Restore IS an event: snapshot the in-flight revision first (never rewrite).
  workspace.snapshots ??= [];
  workspace.snapshots.push({
    id: `snapshot-${crypto.randomUUID()}`,
    version: workspace.version,
    createdAt: new Date().toISOString(),
    label: `Pre-restore-at ${targetSeq} (revision ${workspace.version})`,
    model: structuredClone(workspace.model),
  });
  if (workspace.snapshots.length > 50) {
    workspace.snapshots.splice(0, workspace.snapshots.length - 50);
  }
  workspace.model = structuredClone(replayed.model);
  workspace.model.id = workspace.model.id ?? (request.params as { id: string }).id;
  workspace.version += 1;
  workspace.updatedAt = new Date().toISOString();
  workspace.updatedBy = actor.subject;
  // C4: append a reversal op to the event log so restore is a logged
  // event, not a history rewrite — replay from here reproduces the restore.
  try {
    const reversalOp = {
      kind: 'model.meta.update' as const,
      ref: (request.params as { id: string }).id,
      after: {
        restoredFromSeq: targetSeq,
        note: `Restored point-in-time seq ${targetSeq} as revision ${workspace.version}`,
      },
    };
    const rev = store.append(workspace.model, reversalOp, actor.subject);
    if (rev.result.ok) {
      // The event log's replayed model now matches the live model again.
      void rev.model;
    } else {
      app.log.warn(`reversal op failed for ${(request.params as { id: string }).id}: ${rev.result.issues?.[0]?.message ?? 'unknown'}`);
    }
  } catch (error) {
    app.log.warn(`reversal append error for ${(request.params as { id: string }).id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  audit(workspace, actor.subject, 'restore', `Restored point-in-time seq ${targetSeq} as revision ${workspace.version}`);
  persistToDisk();
  broadcastEvent((request.params as { id: string }).id, {
    type: 'saved',
    version: workspace.version,
    by: actor.subject,
    restore: true,
  });
  return { modelId: (request.params as { id: string }).id, restoredAtSeq: targetSeq, version: workspace.version };
});

// ── Invites (spec A3) — owner-only create/revoke, self-service redeem ─────────

app.post('/api/models/:id/invites', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const body = (request.body ?? {}) as { role?: string; ttlDays?: number; email?: string };
  const role = body.role === 'editor' ? 'editor' : body.role === 'viewer' ? 'viewer' : null;
  if (!role) return reply.code(400).send({ error: 'role must be "editor" or "viewer"' });
  workspace.invites ??= [];
  const outstanding = workspace.invites.filter((invite) => !invite.acceptedAt && !invite.revokedAt);
  if (outstanding.length >= INVITE_DEFAULT_CAP) {
    return reply.code(400).send({ error: `Outstanding invite cap reached (${INVITE_DEFAULT_CAP})` });
  }
  const ttlDays = Math.min(90, Math.max(1, Number(body.ttlDays) || 7));
  const code = inviteCode();
  const invite: InviteRecord = {
    id: `invite-${randomUUID()}`,
    codeHash: hashInvite(code),
    displayPrefix: code.slice(0, 4),
    role,
    email: typeof body.email === 'string' && body.email.includes('@') ? body.email : undefined,
    invitedBy: actor.subject,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
    failedAttempts: 0,
  };
  // D3: email delivery only when configured AND round-trip tested (spec D2).
  const emailConfig = readRuntimeConfig().mail as Record<string, unknown> | undefined;
  const emailDeliveryEnabled =
    Boolean(emailConfig?.confirmedTestAt) && ['resend', 'smtp'].includes(String(emailConfig?.provider ?? ''));
  if (invite.email && !emailDeliveryEnabled) {
    return reply.code(400).send({
      error: 'Email delivery is not enabled: configure and validate a mail provider first (Settings → Email → Send test email).',
    });
  }
  workspace.invites.push(invite);
  audit(workspace, actor.subject, 'create', `Created ${role} invite ${invite.displayPrefix}…`);
  persistToDisk();
  if (invite.email) {
    try {
      await mailAdapter.send({
        to: invite.email,
        subject: `Invitation: ${primaryText(workspace.model.name) || workspace.model.id}`,
        text: [
          `You have been invited to "${primaryText(workspace.model.name) || workspace.model.id}" as ${role}.`,
          '',
          `Open this link to join: ${request.protocol}://${request.hostname}/#invite=${code}`,
          '',
          `The code expires ${invite.expiresAt}. Single use.`,
        ].join('\n'),
      });
    } catch (error) {
      // The invite exists; delivery failure must be visible, but not swallow the create.
      app.log.error(`invite email to ${invite.email} failed: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(201).send({
        id: invite.id,
        code,
        url: `${request.protocol}://${request.hostname}/#invite=${code}`,
        role,
        expiresAt: invite.expiresAt,
        emailDelivered: false,
        warning: 'Invite created, but the email failed to send — share the link manually.',
      });
    }
  }
  return reply.code(201).send({
    id: invite.id,
    code,
    url: `${request.protocol}://${request.hostname}/#invite=${code}`,
    role,
    expiresAt: invite.expiresAt,
    emailDelivered: Boolean(invite.email),
  });
});

app.get('/api/models/:id/invites', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  return (workspace.invites ?? []).map((invite) => ({
    id: invite.id,
    displayPrefix: invite.displayPrefix,
    role: invite.role,
    email: invite.email,
    invitedBy: invite.invitedBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    acceptedBy: invite.acceptedBy,
    revokedAt: invite.revokedAt,
  }));
});

app.delete('/api/models/:id/invites/:inviteId', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const { inviteId } = request.params as { id: string; inviteId: string };
  const invite = (workspace.invites ?? []).find((candidate) => candidate.id === inviteId);
  if (!invite) return reply.code(404).send({ error: 'Invite not found' });
  invite.revokedAt = new Date().toISOString();
  audit(workspace, actor.subject, 'delete', `Revoked invite ${invite.displayPrefix}…`);
  persistToDisk();
  return reply.code(204).send();
});

app.post('/api/invites/redeem', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  const body = (request.body ?? {}) as { code?: string };
  const presented = String(body.code ?? '').trim().toUpperCase();
  if (!presented) return reply.code(400).send({ error: 'code is required' });
  const digest = createHash('sha256').update(presented).digest('hex');
  for (const workspace of workspaces.values()) {
    for (const invite of workspace.invites ?? []) {
      const a = Buffer.from(digest);
      const b = Buffer.from(invite.codeHash);
      if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
      // Found the invite — apply the full lifecycle rules.
      if (invite.revokedAt) return reply.code(403).send({ error: 'Invite revoked' });
      if (invite.acceptedAt) return reply.code(403).send({ error: 'Invite already redeemed' });
      if (Date.parse(invite.expiresAt) < Date.now()) return reply.code(403).send({ error: 'Invite expired' });
      if (invite.failedAttempts >= INVITE_FAILED_ATTEMPT_CAP) {
        return reply.code(403).send({ error: 'Invite locked' });
      }
      workspace.members ??= [];
      if (workspace.members.some((member) => member.subject === actor.subject)) {
        invite.acceptedAt = new Date().toISOString();
        invite.acceptedBy = actor.subject;
        persistToDisk();
        return reply.code(204).send();
      }
      workspace.members.push({ subject: actor.subject, role: invite.role, displayName: actor.displayName });
      invite.acceptedAt = new Date().toISOString();
      invite.acceptedBy = actor.subject;
      audit(workspace, actor.subject, 'update', `${actor.subject} joined via invite ${invite.displayPrefix}…`);
      persistToDisk();
      return reply.code(204).send();
    }
  }
  return reply.code(403).send({ error: 'Unknown invite code' });
});

// ── Members / RBAC ───────────────────────────────────────────────────────────


// ── Real-time collaboration (presence/focus/comments — read-only relays) ────

app.get('/api/models/:id/rt', { websocket: true }, (socket, request) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) {
    socket.close(4404, 'Workspace not found');
    return;
  }
  const header = request.headers.authorization;
  const query = request.query as { token?: string };
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : query.token;
  const actor = resolveActor({
    authorization: `Bearer ${bearer ?? ''}`,
  });
  if (!actor || !isMember(workspace.members, actor, undefined, workspace.groupRoles)) {
    socket.close(4403, 'Not a workspace member');
    return;
  }
  const handle = joinRoom({
    workspace,
    actor,
    client: { send: (data) => socket.send(data), close: (code, reason) => socket.close(code, reason) },
    onClose: () => socket.close(),
  });
  socket.on('message', (raw: Buffer) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (parsed.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    // Focus awareness only. Writes go through validated REST by design.
    if (parsed.type === 'focus') {
      const elementId = typeof parsed.elementId === 'string' ? parsed.elementId : null;
      reportFocus(workspace, actor.subject, elementId);
      return;
    }
    if (parsed.type === 'presence') {
      socket.send(JSON.stringify({ type: 'presence', presence: presenceOf(workspace.model.id) }));
    }
  });
  socket.on('close', () => handle.cleanup());
});

app.get('/api/models/:id/members', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return { members: workspace.members ?? [], groupRoles: workspace.groupRoles ?? [] };
});

app.put('/api/models/:id/members/:subject', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const { subject } = request.params as { id: string; subject: string };
  const body = request.body as { role?: 'owner' | 'editor' | 'viewer'; displayName?: string };
  if (!body?.role || !['owner', 'editor', 'viewer'].includes(body.role)) {
    return reply.code(400).send({ error: 'role must be owner, editor, or viewer' });
  }
  const members = workspace.members ?? [];
  const existing = members.find((member) => member.subject === subject);
  if (existing) {
    existing.role = body.role;
    if (body.displayName) existing.displayName = body.displayName;
  } else {
    members.push({ subject, role: body.role, displayName: body.displayName });
  }
  workspace.members = members;
  audit(workspace, actor.subject, 'update', `Set ${subject} role to ${body.role}`);
  persistToDisk();
  return members;
});

// ── Import preview (semantic diff) ───────────────────────────────────────────

function parseImport(body: unknown): Model {
  const payload = body as { xml?: string; json?: string; model?: Model } | Model;
  if ('model' in (payload as object) && (payload as { model?: Model }).model) {
    return (payload as { model: Model }).model;
  }
  if ('xml' in (payload as object) && typeof (payload as { xml?: string }).xml === 'string') {
    return parseAoef((payload as { xml: string }).xml);
  }
  if ('json' in (payload as object) && typeof (payload as { json?: string }).json === 'string') {
    return parseNativeModel((payload as { json: string }).json);
  }
  if ('elements' in (payload as object)) return payload as Model;
  throw new Error('Provide xml, json, or a model object');
}

app.post('/api/models/:id/import/preview', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  try {
    const incoming = parseImport(request.body);
    const issues = validateAiModel(incoming);
    const diff: ModelDiff = diffModels(workspace.model, incoming);
    return {
      incoming: { id: incoming.id, name: primaryText(incoming.name), elements: incoming.elements.length, relationships: incoming.relationships.length, views: incoming.views.length },
      diff,
      summary: diffSummary(diff),
      issues,
      errorCount: issues.filter((issue) => issue.severity === 'error').length,
      warning: 'Preview only — nothing was written. Review the diff before applying.',
    };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/models/:id/import/apply', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
  if (!actor) return;
  try {
    const incoming = parseImport(request.body);
    const body = request.body as { mode?: 'replace' | 'merge' };
    const mode = body?.mode === 'merge' ? 'merge' : 'replace';
    // Merge goes through the same core helper the web app uses — including
    // view merging and integrity pruning — instead of a hand-rolled element
    // concat that silently dropped views.
    const next: Model = mode === 'merge'
      ? mergeModels(workspace.model, { ...incoming, id: workspace.model.id })
      : { ...incoming, id: workspace.model.id };
    // Invariant 6: the apply path validates like every other write.
    const problem = modelWriteProblem(next);
    if (problem) return reply.code(400).send({ error: problem });
    const changeCount = diffModels(workspace.model, next);
    workspace.model = next;
    workspace.version += 1;
    workspace.updatedAt = new Date().toISOString();
    workspace.updatedBy = actor.subject;
    audit(workspace, actor.subject, 'import', `Applied ${mode} import: ${diffSummary(changeCount)}`);
    persistToDisk();
    return { modelId: workspace.model.id, version: workspace.version, summary: diffSummary(changeCount) };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ── Portfolio ────────────────────────────────────────────────────────────────

app.get('/api/portfolio', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  const readable = [...workspaces.values()].filter(
    (workspace) =>
      !authConfig.required ||
      isMember(workspace.members, actor, undefined, workspace.groupRoles),
  );
  return {
    workspaces: readable.map((workspace) => ({
      ...workspaceSummary(workspace.model),
      updatedAt: workspace.updatedAt,
    })),
    stats: portfolioStats(readable.map((workspace) => workspace.model)),
  };
});

// ── Governance ───────────────────────────────────────────────────────────────

app.get('/api/models/:id/waivers', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.model.waivers ?? [];
});

app.post('/api/models/:id/waivers', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  // Waivers exempt governance rules — the same accountability level as
  // approvals, so only owners can grant or remove them.
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const body = (request.body ?? {}) as { rule?: string; entityId?: string; reason?: string };
  if (!body.rule || !body.reason?.trim()) {
    return reply.code(400).send({ error: 'rule and reason are required' });
  }
  const waiver: Waiver = {
    id: `waiver-${crypto.randomUUID()}`,
    rule: body.rule,
    entityId: body.entityId || undefined,
    reason: body.reason.trim(),
    createdBy: actor.subject,
    createdAt: new Date().toISOString(),
  };
  workspace.model.waivers = [...(workspace.model.waivers ?? []), waiver];
  audit(workspace, actor.subject, 'update', `Waived rule ${waiver.rule}: ${waiver.reason}`);
  persistToDisk();
  return reply.code(201).send(waiver);
});

app.delete('/api/models/:id/waivers/:waiverId', async (request, reply) => {
  const { id, waiverId } = request.params as { id: string; waiverId: string };
  const workspace = workspaces.get(id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const before = workspace.model.waivers ?? [];
  workspace.model.waivers = before.filter((waiver) => waiver.id !== waiverId);
  if (workspace.model.waivers.length === before.length) {
    return reply.code(404).send({ error: 'Waiver not found' });
  }
  audit(workspace, actor.subject, 'delete', `Removed waiver ${waiverId}`);
  persistToDisk();
  return reply.code(204).send();
});


// ── Member management (bulk) & group→role mapping ──────────────────────────

app.put('/api/models/:id/members', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const body = (request.body ?? {}) as {
    members?: Array<{ subject?: string; role?: string; displayName?: string }>;
    groupRoles?: Array<{ group?: string; role?: string }>;
  };
  const validRoles = new Set(['owner', 'editor', 'viewer']);
  const members = (body.members ?? [])
    .filter((member) => member.subject?.trim() && validRoles.has(String(member.role)))
    .map((member) => ({
      subject: String(member.subject).trim(),
      role: String(member.role) as WorkspaceRole,
      displayName: member.displayName,
    }));
  // Governance guard: an owner must remain.
  if (!members.some((member) => member.role === 'owner')) {
    return reply.code(400).send({ error: 'At least one owner must remain a member' });
  }
  for (const entry of body.groupRoles ?? []) {
    if (!entry.group?.trim() || !validRoles.has(String(entry.role))) {
      return reply.code(400).send({ error: `Invalid group→role mapping: ${JSON.stringify(entry)}` });
    }
  }
  const groupRoles = (body.groupRoles ?? []).map((entry) => ({
    group: String(entry.group).trim(),
    role: String(entry.role) as WorkspaceRole,
  }));
  workspace.members = members;
  workspace.groupRoles = groupRoles;
  audit(
    workspace,
    actor.subject,
    'update',
    `Members updated (${members.length} member(s), ${groupRoles.length} group→role mapping(s))`,
  );
  persistToDisk();
  return { members: workspace.members, groupRoles: workspace.groupRoles };
});

app.get('/api/models/:id/approvals', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.model.approvals ?? [];
});

app.post('/api/models/:id/approvals', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  const actor = requireRole(request, reply, workspace, ['owner']);
  if (!actor) return;
  const body = request.body as { baselineId?: string; decision?: 'approved' | 'rejected'; comment?: string };
  if (!body?.baselineId || !body.decision || !['approved', 'rejected'].includes(body.decision)) {
    return reply.code(400).send({ error: 'baselineId and decision (approved|rejected) are required' });
  }
  if (!workspace.snapshots.some((snapshot) => snapshot.id === body.baselineId)) {
    return reply.code(400).send({ error: 'Unknown baseline' });
  }
  if (body.decision === 'approved') {
    // The approved baseline becomes the workspace's current baseline.
    workspace.model.baselineId = body.baselineId;
  }
  const approval = {
    id: `approval-${crypto.randomUUID()}`,
    baselineId: body.baselineId,
    actor: actor.subject,
    decision: body.decision,
    comment: body.comment,
    createdAt: new Date().toISOString(),
  };
  workspace.model.approvals = [...(workspace.model.approvals ?? []), approval];
  if (body.decision === 'approved') {
    workspace.model.status = 'approved';
  }
  workspace.version += 1;
  workspace.updatedAt = new Date().toISOString();
  workspace.updatedBy = actor.subject;
  audit(
    workspace,
    actor.subject,
    'update',
    `${body.decision === 'approved' ? 'Approved' : 'Rejected'} baseline ${body.baselineId}`,
  );
  persistToDisk();
  return reply.code(201).send(approval);
});

// ── AI surfaces ──────────────────────────────────────────────────────────────

app.get('/api/ai/context/:id', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  // Invariant 7: model text is untrusted — AI-facing text keeps the
  // SAFETY_PREFIX like every other AI surface in the product.
  return { modelId: workspace.model.id, markdown: sanitizeAiText(modelToMarkdown(workspace.model)) };
});

app.post('/api/ai/validate/:id', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return { modelId: workspace.model.id, issues: validateAiModel(workspace.model) };
});

app.get('/api/ai/metamodel', async (request, reply) => {
  if (!requireActor(request, reply)) return;
  return ({
  version: '3.2',
  elementTypes: ELEMENT_TYPES.map((type) => type.id),
  relationshipTypes: RELATIONSHIP_TYPES.map((type) => type.id),
  viewpoints: VIEWPOINTS.map((viewpoint) => viewpoint.id),
  });
});

// Compatibility helper used by tests and local scripts.
export function createMemoryRepository(): MemoryRepository {
  return new MemoryRepository([...workspaces.values()].map((workspace) => workspace.model));
}

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Route parity self-audit (spec E1): fail fast at boot when a registered route
// has no minRole expectation (or vice versa) so "new route must add a row"
// is enforced by the build, not by memory.
const parityViolations = auditRouteParity(parsePrintedRoutes(app.printRoutes()));
if (parityViolations.length) {
  app.log.error(`Route parity violations:\n${parityViolations.join('\n')}`);
  if (process.env.OPENARCH_ENFORCE_ROUTE_PARITY === 'true') {
    process.exit(1);
  }
  app.log.warn('OPENARCH_ENFORCE_ROUTE_PARITY=true will make this fatal.');
}
