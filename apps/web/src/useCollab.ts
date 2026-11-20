import { getAccessToken, setAccessToken } from '@openarch/repository';
import type { Op } from '@openarch/core';
import { useEffect, useRef, useState } from 'react';

export interface PresenceUser {
  subject: string;
  displayName: string;
  focus?: string;
}

export type CollabEvent =
  | { type: 'hello'; you: { subject: string; displayName: string }; presence: PresenceUser[] }
  | { type: 'presence'; presence: PresenceUser[] }
  | { type: 'comment'; comment: { id: string; author: string; body: string } }
  | { type: 'saved'; version: number; by: string; restore?: boolean }
  | { type: 'focus'; subject: string; displayName: string; elementId?: string }
  | { type: 'ops'; workspaceId: string; by?: string; ops: Op[] }
  | { type: 'pong' };

export { getAccessToken, setAccessToken };

/** Real-time collaboration hook (server mode): presence, focus, comment/save events. */
export function useCollab(options: { enabled: boolean; workspaceId?: string; onEvent?: (event: CollabEvent) => void }) {
  const { enabled, workspaceId } = options;
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'error'>('off');
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setStatus('off');
      setPresence([]);
      return;
    }
    // Derive the ws endpoint from the API base (same origin in Docker).
    const api = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api';
    const wsBase = api.replace(/^http/, 'ws').replace(/\/api$/, '');
    const token = getAccessToken();
    const socket = new WebSocket(
      `${wsBase}/api/models/${encodeURIComponent(workspaceId)}/rt${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    );
    socketRef.current = socket;
    setStatus('connecting');
    let heartbeat: number | undefined;
    socket.onopen = () => {
      setStatus('live');
      heartbeat = window.setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), 25_000);
    };
    socket.onerror = () => setStatus('error');
    socket.onclose = () => {
      setStatus((current) => (current === 'error' ? current : 'off'));
      if (heartbeat) window.clearInterval(heartbeat);
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(String(message.data)) as CollabEvent;
        if (event.type === 'hello' || event.type === 'presence') setPresence(event.presence);
        onEventRef.current?.(event);
      } catch {
        // Ignore malformed frames.
      }
    };
    return () => {
      if (heartbeat) window.clearInterval(heartbeat);
      socket.close();
      socketRef.current = null;
    };
  }, [enabled, workspaceId]);

  const sendFocus = (elementId: string | null) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'focus', elementId }));
    }
  };

  return { presence, status, sendFocus };
}
