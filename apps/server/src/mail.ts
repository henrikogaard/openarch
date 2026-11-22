import type { RuntimeConfig } from './index';

/**
 * Mail adapter (spec D1): both Resend and SMTP from day one, one interface.
 *
 * The runtime config (data/config.json → mail) holds the provider settings
 * including the from-address set during configuration. API keys are only
 * readable from env at call time (never echoed back by describe()/endpoints).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailSendResult {
  delivered: boolean;
  providerMessageId?: string;
}

export interface ProviderInfo {
  provider: 'resend' | 'smtp' | 'console';
  fromAddress?: string;
  /** Present only when the provider is configured; used by the setup screen. */
  configured: boolean;
}

export interface MailAdapter {
  send(message: MailMessage): Promise<MailSendResult>;
  describe(): ProviderInfo;
}

export interface MailConfig {
  provider?: 'resend' | 'smtp' | null;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
  resend?: { apiKey?: string };
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string };
}

/** Console fallback: OTP/login works with no provider configured (spec A4). */
class ConsoleMailAdapter implements MailAdapter {
  async send(message: MailMessage): Promise<MailSendResult> {
    process.stderr.write(
      `OpenArch mail (console): to=${message.to} subject="${message.subject}"\n${message.text}\n`,
    );
    return { delivered: true, providerMessageId: 'console' };
  }
  describe(): ProviderInfo {
    return { provider: 'console', configured: false };
  }
}

class ResendMailAdapter implements MailAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(message: MailMessage): Promise<MailSendResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
      }),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      throw new Error(`Resend delivery failed: ${response.status} ${body}`);
    }
    const created = (await response.json()) as { id?: string };
    return { delivered: true, providerMessageId: created.id };
  }

  describe(): ProviderInfo {
    return { provider: 'resend', fromAddress: this.from, configured: Boolean(this.apiKey) };
  }
}

class SmtpMailAdapter implements MailAdapter {
  constructor(
    private readonly transport: { sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }> },
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(message: MailMessage): Promise<MailSendResult> {
    const sent = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
    });
    return { delivered: true, providerMessageId: sent.messageId };
  }

  describe(): ProviderInfo {
    return { provider: 'smtp', fromAddress: this.from, configured: true };
  }
}

/**
 * Build the adapter from runtime config. Reads API keys from env directly
 * (they are secrets; config.json stores them but describe() never returns
 * them, and the GET endpoint masks them).
 */
export async function buildMailAdapter(config: RuntimeConfig): Promise<MailAdapter> {
  const mail = (config.mail ?? {}) as MailConfig;
  const from = [mail.fromName, mail.fromAddress].filter(Boolean).join(' ').trim() || 'OpenArch <onboarding@resend.dev>';
  const env = process.env;
  if (mail.provider === 'resend') {
    const apiKey = mail.resend?.apiKey || env.OPENARCH_RESEND_API_KEY;
    if (!apiKey || !mail.fromAddress) return new ConsoleMailAdapter();
    return new ResendMailAdapter(apiKey, from, mail.replyTo);
  }
  if (mail.provider === 'smtp') {
    const host = mail.smtp?.host || env.SMTP_HOST;
    if (!host || !mail.fromAddress) return new ConsoleMailAdapter();
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: mail.smtp?.port ?? (Number(env.SMTP_PORT) || 587),
      secure: mail.smtp?.secure ?? env.SMTP_SECURE === 'true',
      auth: mail.smtp?.user || env.SMTP_USER
        ? { user: mail.smtp?.user || env.SMTP_USER, pass: mail.smtp?.pass || env.SMTP_PASS }
        : undefined,
    });
    return new SmtpMailAdapter(transport, from, mail.replyTo);
  }
  return new ConsoleMailAdapter();
}

export type { RuntimeConfig };
