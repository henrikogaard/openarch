import { useCallback, useEffect, useState } from 'react';

interface EmailSetupProps {
  api: {
    get: () => Promise<MailConfigMasked>;
    put: (config: Record<string, unknown>) => Promise<unknown>;
    test: (to: string) => Promise<{ delivered: boolean }>;
  };
}

export interface MailConfigMasked {
  provider: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
  resend?: { apiKeyMasked?: string };
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; passMasked?: string };
}

/**
 * Admin screen: Settings → Email (spec D2). Sending stays disabled server-side
 * until POST /api/admin/mail/test succeeds; this screen refuses to present
 * email invites as available until then.
 */
export default function EmailSetup({ api }: EmailSetupProps) {
  const [config, setConfig] = useState<MailConfigMasked | null>(null);
  const [provider, setProvider] = useState('');
  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [testTo, setTestTo] = useState('');
  const [status, setStatus] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await api.get();
      setConfig(current);
      setProvider(current.provider === 'resend' || current.provider === 'smtp' ? current.provider : '');
      setFromName(current.fromName ?? '');
      setFromAddress(current.fromAddress ?? '');
      setSmtpHost(current.smtp?.host ?? '');
      setSmtpPort(String(current.smtp?.port ?? 587));
      setSmtpUser(current.smtp?.user ?? '');
      setConfirmed(current.provider === 'resend' || current.provider === 'smtp');
    } catch (error) {
      setStatus(`Could not load mail config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setStatus('');
    const payload: Record<string, unknown> = { provider: provider || null, fromName, fromAddress };
    if (provider === 'resend' && apiKey.trim()) payload.resend = { apiKey: apiKey.trim() };
    if (provider === 'smtp') {
      payload.smtp = {
        host: smtpHost.trim(),
        port: Number(smtpPort) || 587,
        secure: false,
        ...(smtpUser.trim() ? { user: smtpUser.trim() } : {}),
        ...(smtpPass ? { pass: smtpPass } : {}),
      };
    }
    try {
      await api.put(payload);
      setApiKey('');
      setSmtpPass('');
      setConfirmed(false);
      await load();
      setStatus('Saved — run the test email to enable invite-by-email');
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const sendTest = async () => {
    if (!testTo.trim().includes('@')) {
      setStatus('Enter the recipient email first');
      return;
    }
    setStatus('');
    try {
      await api.test(testTo.trim());
      setConfirmed(true);
      setStatus('Test delivered — invite-by-email is now enabled');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message.includes('No mail provider') ? 'Configure and save a provider + from-address first' : message);
    }
  };

  return (
    <section className="panel-card wide">
      <h3>Email</h3>
      <p className="muted">
        Invite-by-email unlocks only after a test email round-trips. Keys are stored on the
        server and never displayed again (masked below).
      </p>
      <div className="field-row">
        <label className="field">
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="">None (OTP codes go to server logs)</option>
            <option value="resend">Resend</option>
            <option value="smtp">SMTP</option>
          </select>
        </label>
        <label className="field">
          From name
          <input className="form-input" value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="OpenArch" />
        </label>
        <label className="field">
          From address
          <input
            className="form-input"
            value={fromAddress}
            onChange={(event) => setFromAddress(event.target.value)}
            placeholder="arch@example.com"
          />
        </label>
      </div>
      {provider === 'resend' && (
        <div className="field-row">
          <label className="field">
            Resend API key {config?.resend?.apiKeyMasked && <span className="muted">(current {config.resend.apiKeyMasked})</span>}
            <input
              className="form-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="re_…"
              autoComplete="off"
            />
          </label>
        </div>
      )}
      {provider === 'smtp' && (
        <div className="field-row">
          <label className="field">
            SMTP host
            <input className="form-input" value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" />
          </label>
          <label className="field">
            Port
            <input className="form-input" value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} />
          </label>
          <label className="field">
            User
            <input className="form-input" value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} />
          </label>
          <label className="field">
            Password {config?.smtp?.passMasked && <span className="muted">(saved)</span>}
            <input
              className="form-input"
              type="password"
              value={smtpPass}
              onChange={(event) => setSmtpPass(event.target.value)}
              autoComplete="off"
            />
          </label>
        </div>
      )}
      <div className="settings-actions">
        <button className="primary-button" onClick={() => void save()}>
          Save
        </button>
        <span aria-live="polite" className={confirmed ? 'muted' : ''}>
          {confirmed ? '✓ Invite-by-email enabled' : 'Invite-by-email disabled until a test is delivered'}
        </span>
      </div>
      <div className="field-row">
        <label className="field">
          Send test to
          <input
            className="form-input"
            type="email"
            value={testTo}
            onChange={(event) => setTestTo(event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <button className="small-button" disabled={!provider} onClick={() => void sendTest()}>
          Send test email
        </button>
      </div>
      {status && <p className="muted" aria-live="polite">{status}</p>}
    </section>
  );
}
