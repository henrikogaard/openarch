import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../i18n';

interface PeopleTokensProps {
  /** POST/GET/DELETE /api/admin/tokens through the app's API base with the session token. */
  api: {
    list: () => Promise<Array<TokenRow>>;
    mint: (input: { subject: string; displayName?: string }) => Promise<{ record: TokenRow; token: string }>;
    revoke: (id: string) => Promise<void>;
  };
}

export interface TokenRow {
  id: string;
  subject: string;
  displayName?: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  prefix4?: string;
}

/** Admin screen: People & tokens (spec A2 UI half). Plaintext is shown once at mint; never listed. */
export default function PeopleTokens({ api }: PeopleTokensProps) {
  const t = useTranslation();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [subject, setSubject] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState('');
  const [minted, setMinted] = useState<{ token: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTokens(await api.list());
    } catch (error) {
      setStatus(`Could not load tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mint = async () => {
    if (!subject.trim()) return;
    setStatus('');
    try {
      const created = await api.mint({ subject: subject.trim(), displayName: displayName.trim() || undefined });
      setMinted({ token: created.token });
      setSubject('');
      setDisplayName('');
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message.includes('409') ? 'A token already exists for this subject' : `Mint failed: ${message}`);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revoke(id);
      await refresh();
      setStatus('Token revoked');
    } catch (error) {
      setStatus(`Revoke failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <section className="panel-card wide">
      <h3>{t('peopleTokens') || 'People & tokens'}</h3>
      <p className="muted">
        Long-lived access tokens for people (and CLI/MCP automation). The token value is shown
        exactly once at minting; only its hash is stored. Tokens identify — workspace membership
        still decides what each person can do.
      </p>
      <div className="field-row">
        <input
          className="form-input"
          placeholder="name@example.com"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
        <input
          className="form-input"
          placeholder={t('nameLabel') || 'Display name (optional)'}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <button className="small-button" disabled={!subject.trim()} onClick={() => void mint()}>
          {t('addMember') || 'Mint token'}
        </button>
      </div>
      {minted && (
        <div className="token-reveal" role="alert">
          <strong>Copy this now — it will not be shown again:</strong>
          <code>{minted.token}</code>
          <button
            className="small-button"
            onClick={() => {
              void navigator.clipboard.writeText(minted.token);
              setStatus('Copied to clipboard');
            }}
          >
            {t('delete') && 'Copy' || 'Copy'}
          </button>
          <button className="link-button" onClick={() => setMinted(null)}>
            {t('cancel') || 'Done'}
          </button>
        </div>
      )}
      {status && <p className="muted" aria-live="polite">{status}</p>}
      <table className="relation-list">
        <thead>
          <tr>
            <th>{t('subject') || 'Subject'}</th>
            <th>Token</th>
            <th>Created</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.id}>
              <td>{token.displayName ?? token.subject}</td>
              <td>
                <code>…{token.prefix4}</code>
              </td>
              <td>{new Date(token.createdAt).toLocaleDateString()}</td>
              <td>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : '—'}</td>
              <td>
                <button className="small-button" onClick={() => void revoke(token.id)}>
                  {t('remove') || 'Revoke'}
                </button>
              </td>
            </tr>
          ))}
          {tokens.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No tokens yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
