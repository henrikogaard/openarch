import type { Actor } from './auth';
import { isMember, roleFor } from './auth';

/**
 * The workspace shape the hub needs (declared locally to avoid a circular
 * import with the server's index module).
 */
interface RtWorkspace {
  model: { id: string };
  version: number;
  members?: Array<{ subject: string; role: 'owner' | 'editor' | 'viewer' }>;
  groupRoles?: Array<{ group: string; role: 'owner' | 'editor' | 'viewer' }>;
}

/**
 * Real-time collaboration hub (per-workspace rooms).
 *
 * Scope is deliberately READ-ONLY realtime: presence, focus awareness,
 * comments, and save notifications are broadcast; every actual write still
 * goes through the validated REST path. This gives teams live awareness
 * without the CRDT trap (convergence without validity) for a strongly
 * constrained model — structural conflicts still resolve through optimistic
 * locking + the three-way review.
 */
export interface RtClient {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

interface RoomMember {
  subject: string;
  displayName: string;
  client: RtClient;
  lastFocus?: string;
}

export interface PresenceInfo {
  subject: string;
  displayName: string;
  focus?: string;
}

interface Room {
  members: Set<RoomMember>;
}

const rooms = new Map<string, Room>();

function roomOf(workspaceId: string): Room {
  let room = rooms.get(workspaceId);
  if (!room) {
    room = { members: new Set() };
    rooms.set(workspaceId, room);
  }
  return room;
}

function sendTo(client: RtClient, event: Record<string, unknown>): void {
  try {
    client.send(JSON.stringify(event));
  } catch {
    // Dead sockets are cleaned up on their close event.
  }
}

function broadcast(room: Room, event: Record<string, unknown>): void {
  for (const member of room.members) sendTo(member.client, event);
}

export function presenceOf(workspaceId: string): PresenceInfo[] {
  const room = rooms.get(workspaceId);
  if (!room) return [];
  return [...room.members].map((member) => ({
    subject: member.subject,
    displayName: member.displayName,
    focus: member.lastFocus,
  }));
}

/** Join a room. Returns a handle to close and detach the client. */
export function joinRoom(params: {
  workspace: RtWorkspace;
  actor: Actor;
  client: RtClient;
  onClose: () => void;
}): { cleanup: () => void } {
  const { workspace, actor, client, onClose } = params;
  const room = roomOf(workspace.model.id);
  const member: RoomMember = {
    subject: actor.subject,
    displayName: actor.displayName ?? actor.subject,
    client,
  };
  room.members.add(member);
  sendTo(client, {
    type: 'hello',
    you: { subject: member.subject, displayName: member.displayName },
    presence: presenceOf(workspace.model.id),
    version: workspace.version,
  });
  broadcastPresence(room);

  return {
    cleanup() {
      room.members.delete(member);
      onClose();
      broadcastPresence(room);
      if (room.members.size === 0) rooms.delete(workspace.model.id);
    },
  };
}

function broadcastPresence(room: Room): void {
  const presence = [...room.members].map((member) => ({
    subject: member.subject,
    displayName: member.displayName,
    focus: member.lastFocus,
  }));
  broadcast(room, { type: 'presence', presence });
}

/** Relay focus awareness (which element a user is looking at/editing). */
export function reportFocus(workspace: RtWorkspace, subject: string, elementId: string | null): void {
  const room = rooms.get(workspace.model.id);
  if (!room) return;
  let member: RoomMember | undefined;
  for (const candidate of room.members) {
    if (candidate.subject === subject) {
      member = candidate;
      break;
    }
  }
  if (!member) return;
  member.lastFocus = elementId ?? undefined;
  broadcast(room, {
    type: 'focus',
    subject: member.subject,
    displayName: member.displayName,
    elementId: elementId ?? undefined,
  });
}

/** Broadcast-only connective for REST writes (no payload trust: server builds the event). */
export function broadcastEvent(workspaceId: string, event: Record<string, unknown>): void {
  const room = rooms.get(workspaceId);
  if (room && room.members.size) broadcast(room, event);
}

export function roomSize(workspaceId: string): number {
  return rooms.get(workspaceId)?.members.size ?? 0;
}

export function actorCanJoin(workspace: RtWorkspace, actor: Actor, authRequired: boolean, adminSubject: string): boolean {
  if (!authRequired) return true;
  if (actor.subject === adminSubject) return true;
  return isMember(workspace.members, actor, undefined, workspace.groupRoles) && roleFor(workspace.members, actor, undefined, workspace.groupRoles) !== 'viewer' ? true : isMember(workspace.members, actor, undefined, workspace.groupRoles);
}
