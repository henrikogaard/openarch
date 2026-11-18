import {
  createSampleModel,
  diffModels,
  parseAoef,
  primaryText,
  type AuditEvent,
  type Comment,
  type Model,
  type SavedView,
  type WorkspaceMember,
} from '@openarch/core';
import { diffSummary, type ModelDiff } from '@openarch/core';
import { modelToMarkdown, validateAiModel } from '@openarch/ai';
import {
  ELEMENT_TYPES,
  portfolioStats,
  RELATIONSHIP_TYPES,
  VIEWPOINTS,
  workspaceSummary,
  type Waiver,
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
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  const stored = JSON.parse(readFileSync(dataFile, 'utf-8')) as
    | Workspace[]
    | Record<string, Workspace>
    | Model[];
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
  writeFileSync(dataFile, `${JSON.stringify([...workspaces.values()], null, 2)}\n`);
}

loadFromDisk();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
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
  const actor = resolveActor(request.headers);
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
  if (!isMember(workspace.members, actor)) {
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
  if (!hasRole(roleFor(workspace.members, actor), allowed)) {
    void reply.code(403).send({ error: 'Forbidden: your workspace role does not allow this operation' });
    return null;
  }
  return actor;
}

app.get('/health', async () => ({
  status: 'ok',
  workspaces: workspaces.size,
  auth: authConfig.required ? 'required' : 'open',
}));

app.get('/api/me', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  const roles: Record<string, string> = {};
  for (const workspace of workspaces.values()) {
    roles[workspace.model.id] = roleFor(workspace.members, actor);
  }
  return { ...actor, roles };
});

app.get('/api/models', async (request, reply) => {
  const actor = requireActor(request, reply);
  if (!actor) return;
  // Only list workspaces the actor can actually read. In open mode every
  // workspace is visible; with auth on, membership is required.
  return [...workspaces.values()]
    .filter((workspace) => !authConfig.required || isMember(workspace.members, actor))
    .map((workspace) => ({ ...workspace.model, updatedAt: workspace.updatedAt }));
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
    role: roleFor(workspace.members, resolveActor(request.headers)!),
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
  if (!model?.id) return reply.code(400).send({ error: 'Model id is required' });
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
  const changeCount = diffModels(workspace.model, model);
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
  void changeCount;
  persistToDisk();
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
  const body = request.body as { body?: string; elementId?: string; author?: string };
  if (!body?.body?.trim()) return reply.code(400).send({ error: 'Comment body is required' });
  const comment: Comment = {
    id: `comment-${crypto.randomUUID()}`,
    modelId: workspace.model.id,
    elementId: body.elementId,
    author: body.author || actor.subject,
    body: body.body.trim(),
    createdAt: new Date().toISOString(),
    resolved: false,
  };
  workspace.comments.unshift(comment);
  audit(workspace, comment.author, 'comment', 'Added a comment', comment.elementId);
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
  workspace.model = structuredClone(snapshot.model);
  workspace.model.id = id;
  workspace.version += 1;
  workspace.updatedAt = new Date().toISOString();
  workspace.updatedBy = actor.subject;
  audit(workspace, actor.subject, 'restore', `Restored ${snapshot.label} as revision ${workspace.version}`);
  persistToDisk();
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

// ── Members / RBAC ───────────────────────────────────────────────────────────

app.get('/api/models/:id/members', async (request, reply) => {
  const workspace = workspaces.get((request.params as { id: string }).id);
  if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
  if (!requireMember(request, reply, workspace)) return;
  return workspace.members ?? [];
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
    const next: Model = mode === 'merge'
      ? {
          ...workspace.model,
          elements: [...workspace.model.elements, ...incoming.elements.filter((element) => !workspace.model.elements.some((current) => current.id === element.id))],
          relationships: [...workspace.model.relationships, ...incoming.relationships.filter((relationship) => !workspace.model.relationships.some((current) => current.id === relationship.id))],
        }
      : { ...incoming, id: workspace.model.id };
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
    (workspace) => !authConfig.required || isMember(workspace.members, actor),
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
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
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
  const actor = requireRole(request, reply, workspace, ['owner', 'editor']);
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
  return { modelId: workspace.model.id, markdown: modelToMarkdown(workspace.model) };
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
