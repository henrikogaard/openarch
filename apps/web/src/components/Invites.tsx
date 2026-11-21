import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../i18n';

interface InvitesProps {
  api: {
    list: (workspaceId: string) => Promise<InviteRow[]>;
    create: (workspaceId: string, input: { role: 'viewer' | 'editor'; email?: string }) => Promise<InviteCreation>;
    revoke: (workspaceId: string, inviteId: string) => Promise<void>;
  };
  workspaceId: string | null;
}

export interface InviteRow {
  id: string;
  displayPrefix: string;
  role: string;
  email?: string;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedBy?: string;
  revokedAt?: string;
}

export interface InviteCreation {
  id: string;
  code: string;
  url: string;
  role: string;
  expiresAt: string;
}

/** Owner screen: workspace invites (spec A3 UI half) — copy-link out-of-band or email via D3. */
export default function Invites({ api, workspaceId }: InvitesProps) {
  const t = useTranslation();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [created, setCreated] = useState<InviteCreation | null>(null);

  const refresh = useCallback(async () => {
    if (!api.list || !workspaceId) return;
    try {
      setInvites(await api.list(workspaceId));
    } catch {
      setInvites([]);
    }
  }, [api, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    if (!workspaceId) return;
    setStatus('');
    try {
      const made = await api.create(workspaceId, { role, email: email.trim() || undefined });
      setCreated(made);
      setEmail('');
      await refresh();
    } catch (error) {
      setStatus(`Invite failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const revoke = async (inviteId: string) => {
    if (!workspaceId) return;
    try {
      await api.revoke(workspaceId, inviteId);
      await refresh();
      setStatus('Invite revoked');
    } catch (error) {
      setStatus(`Revoke failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <section className="panel-card wide">
      <h3>Invites</h3>
      <p className="muted">
        A code carries a role (viewer/editor — never owner), expires in 7 days, and is single-use.
        Email delivery activates only after a validated mail provider; otherwise share the link
        out-of-band.
      </p>
      <div className="field-row">
        <select value={role} onChange={(event) => setRole(event.target.value as 'viewer' | 'editor')}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
        <input
          className="form-input"
          type="email"
          placeholder="email (optional — needs validated mail)"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="small-button" onClick={() => void create()}>
          Create invite
        </button>
      </div>
      {created && (
        <div className="token-reveal" role="alert">
          <strong>Share this link (it is shown once):</strong>
          <code>{created.url}</code>
          <button
            className="small-button"
            onClick={() => {
              void navigator.clipboard.writeText(created.url);
              setStatus('Invite link copied');
            }}
          >
            Copy
          </button>
          <button className="link-button" onClick={() => setCreated(null)}>
            {t('cancel') || 'Done'}
          </button>
        </div>
      )}
      {status && <p className="muted" aria-live="polite">{status}</p>}
      <table className="relation-list">
        <thead>
          <tr>
            <th>Code</th>
            <th>Role</th>
            <th>Email</th>
            <th>State</th>
            <th>Expires</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invites.map((invite) => (
            <tr key={invite.id}>
              <td>
                <code>…{invite.displayPrefix}</code>
              </td>
              <td>{invite.role}</td>
              <td>{invite.email ?? '—'}</td>
              <td>
                {invite.revokedAt
                  ? 'revoked'
                  : invite.acceptedAt
                    ? `accepted (${invite.acceptedBy ?? 'member'})`
                    : new Date(invite.expiresAt) < new Date()
                      ? 'expired'
                      : 'outstanding'}
              </td>
              <td>{new Date(invite.expiresAt).toLocaleDateString()}</td>
              <td>
                {!invite.acceptedAt && !invite.revokedAt && (
                  <button className="small-button" onClick={() => void revoke(invite.id)}>
                    {t('remove') || 'Revoke'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {invites.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">No invites yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
