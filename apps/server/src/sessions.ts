import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * OTP login + sessions (spec A4).
 *
 * - OTP codes: 6 digits, single use, 10-minute TTL, hashed in memory only;
 *   restart clears live codes and lockouts (users re-request — acceptable).
 * - Sessions: opaque 256-bit ids, stored **hashed** in data/sessions.json,
 *   idle + absolute expiry, revocation on logout.
 * - Email delivery is pluggable: a MailSink callback set by the server (D1
 *   wires real adapters; the default prints to stderr so A4 works decoupled).
 */
export interface SessionRecord {
  id: string;
  subject: string;
  displayName: string;
  kind: 'otp' | 'token' | 'oidc';
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;   // absolute expiry
}

interface SessionHashRow extends Omit<SessionRecord, 'id'> {
  sha256: string;
}

interface OtpRow {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  requestsPerHour: number[];
  verifyFailures: number;
}

export interface MailSink {
  sendLoginCode(email: string, code: string): Promise<void>;
}

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_VERIFY_FAILURES = 5;
const OTP_MAX_REQUESTS_PER_HOUR = 10;

export class SessionStore {
  private readonly file: string;
  private rows: SessionHashRow[] = [];

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.rows = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as { sessions?: SessionHashRow[] };
      this.rows = parsed.sessions ?? [];
    } catch {
      this.rows = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify({ sessions: this.rows }, null, 2));
    renameSync(temp, this.file);
  }

  mint(input: {
    subject: string;
    displayName: string;
    kind: SessionRecord['kind'];
    idleDays: number;
    absoluteDays: number;
  }): { token: string; record: SessionRecord } {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const row: SessionHashRow = {
      sha256: createHash('sha256').update(token).digest('hex'),
      subject: input.subject,
      displayName: input.displayName,
      kind: input.kind,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.absoluteDays * 86_400_000).toISOString(),
    };
    this.rows.push(row);
    // Idle expiry is enforced at resolve() using lastSeenAt + idleDays; the
    // absolute date is stored as expiresAt.
    this.persist();
    void input.idleDays;
    return {
      token,
      record: { id: row.sha256.slice(0, 12), ...row, expiresAt: row.expiresAt },
    };
  }

  /** Resolve a session token; refreshes lastSeenAt. Undefined when invalid/expired. */
  resolve(presented: string, idleDays: number): SessionRecord | undefined {
    const digest = createHash('sha256').update(presented).digest('hex');
    const now = Date.now();
    for (const row of this.rows) {
      const a = Buffer.from(digest);
      const b = Buffer.from(row.sha256);
      if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
      if (Date.parse(row.expiresAt) < now) return undefined;
      if (Date.parse(row.lastSeenAt) + idleDays * 86_400_000 < now) return undefined;
      row.lastSeenAt = new Date().toISOString();
      this.persist();
      const { sha256: _hash, ...record } = row;
      void _hash;
      return { id: _hash.slice(0, 12), ...record };
    }
    return undefined;
  }

  revoke(presented: string): boolean {
    const digest = createHash('sha256').update(presented).digest('hex');
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => {
      const a = Buffer.from(digest);
      const b = Buffer.from(row.sha256);
      return !(a.length === b.length && timingSafeEqual(a, b));
    });
    if (this.rows.length === before) return false;
    this.persist();
    return true;
  }
}

export class OtpStore {
  private readonly rows = new Map<string, OtpRow>();
  private readonly ipVerifyFailures = new Map<string, number[]>();
  mailSink: MailSink = {
    async sendLoginCode(email, code) {
      // Default console sink: A4 works without a mail adapter (spec A4). The
      // code intentionally goes to stderr — server logs, not HTTP responses.
      process.stderr.write(`OpenArch OTP for ${email}: ${code} (mail not configured; 10 min)\n`);
    },
  };

  /** Request a code for an email. Returns false when rate-limited. */
  request(email: string): boolean {
    const key = email.trim().toLowerCase();
    const now = Date.now();
    const row = this.rows.get(key) ?? {
      email: key,
      codeHash: '',
      expiresAt: 0,
      attempts: 0,
      requestsPerHour: [] as number[],
      verifyFailures: 0,
    };
    row.requestsPerHour = row.requestsPerHour.filter((time) => now - time < 3_600_000);
    if (row.requestsPerHour.length >= OTP_MAX_REQUESTS_PER_HOUR) {
      this.rows.set(key, row);
      return false;
    }
    row.requestsPerHour.push(now);
    const code = String(100_000 + (randomBytes(4).readUInt32BE(0) % 900_000));
    row.codeHash = createHash('sha256').update(code).digest('hex');
    row.expiresAt = now + OTP_TTL_MS;
    row.attempts = 0;
    row.verifyFailures = 0;
    this.rows.set(key, row);
    void this.mailSink.sendLoginCode(key, code);
    return true;
  }

  /** Verify a code. Returns true when valid; false on mismatch, lockout, or expiry. */
  verify(email: string, code: string): boolean {
    const key = email.trim().toLowerCase();
    const row = this.rows.get(key);
    if (!row || !row.codeHash) return false;
    const now = Date.now();
    if (row.expiresAt < now || row.verifyFailures >= OTP_MAX_VERIFY_FAILURES) {
      this.rows.delete(key);
      return false;
    }
    const digest = createHash('sha256').update(String(code).trim()).digest('hex');
    const a = Buffer.from(digest);
    const b = Buffer.from(row.codeHash);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      this.rows.delete(key); // single use
      return true;
    }
    row.verifyFailures += 1;
    if (row.verifyFailures >= OTP_MAX_VERIFY_FAILURES) this.rows.delete(key);
    return false;
  }

  /** Global per-IP verify-failure limiter (60/hour). */
  verifyFailureForIp(ip: string): boolean {
    const now = Date.now();
    const list = (this.ipVerifyFailures.get(ip) ?? []).filter((time) => now - time < 3_600_000);
    list.push(now);
    this.ipVerifyFailures.set(ip, list);
    return list.length <= 60;
  }
}

export function sessionCookie(token: string): string {
  return `openarch_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${90 * 86_400}`;
}

export function randomId(): string {
  return randomUUID();
}
