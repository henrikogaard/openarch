import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

/**
 * Named access tokens ("People & tokens", spec A2).
 *
 * Server-side store, hashed at rest: the plaintext is shown exactly once at
 * mint time and never persisted. Auth resolution is constant-time against
 * the hash. Admin-scoped surface only (bootstrap owner) — tokens are
 * identity, never permission: capabilities still flow from per-workspace
 * membership.
 */
export interface NamedTokenRecord {
  id: string;
  subject: string;
  displayName?: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  /** first 4 chars of the ORIGINAL token, for admin recognition only. */
  prefix4: string;
}

interface TokenStoreFile {
  version: 1;
  tokens: Array<NamedTokenRecord & { sha256: string }>;
}

export class TokenStore {
  private readonly file: string;
  private records: Array<NamedTokenRecord & { sha256: string }> = [];

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      this.records = [];
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as TokenStoreFile;
      this.records = parsed.tokens ?? [];
    } catch {
      // Corrupt store: quarantine persists in loadScimUsers-style patterns; here
      // treat as empty and let persistence rewrite it on the next change.
      this.records = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const payload: TokenStoreFile = { version: 1, tokens: this.records };
    const temp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`);
    renameSync(temp, this.file);
  }

  /** Mint a named token. Returns the plaintext exactly once. */
  mint(input: {
    subject: string;
    displayName?: string;
    expiresAt?: string;
  }): { record: NamedTokenRecord; token: string } {
    const subject = input.subject.trim();
    if (!subject) throw new Error('subject is required');
    if (this.records.some((record) => record.subject === subject)) {
      throw new TokensError('A token already exists for this subject', 409);
    }
    const token = `openarch_pat_${randomBytes(24).toString('hex')}`;
    const sha256 = createHash('sha256').update(token).digest('hex');
    const record: NamedTokenRecord & { sha256: string } = {
      id: `token-${randomBytes(8).toString('hex')}`,
      subject,
      displayName: input.displayName?.trim() || subject,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      prefix4: token.slice(-4),
      sha256,
    };
    this.records.push(record);
    this.persist();
    const { sha256: _hash, ...publicRecord } = record;
    void _hash;
    return { record: publicRecord, token };
  }

  /** Resolve a presented bearer token to its subject; undefined when unknown/expired. */
  resolve(presented: string): NamedTokenRecord | undefined {
    const digest = createHash('sha256').update(presented).digest('hex');
    for (const record of this.records) {
      const a = Buffer.from(digest);
      const b = Buffer.from(record.sha256);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return undefined;
        record.lastUsedAt = new Date().toISOString();
        this.persist();
        const { sha256: _hash, ...publicRecord } = record;
        void _hash;
        return publicRecord;
        }
    }
    return undefined;
  }

  list(): NamedTokenRecord[] {
    return this.records.map((record) => {
      const { sha256: _hash, ...publicRecord } = record;
      void _hash;
      return publicRecord;
    });
  }

  revoke(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.id !== id);
    if (this.records.length === before) return false;
    this.persist();
    return true;
  }
}

export class TokensError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
