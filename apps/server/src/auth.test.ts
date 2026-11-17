import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hasRole,
  isMember,
  loadAuthConfig,
  resolveActor,
  roleFor,
  verifyJwt,
} from './auth';

const restricted = loadAuthConfig({
  OPENARCH_TOKENS: JSON.stringify({
    'admin-token': { subject: 'admin', displayName: 'Admin' },
    'editor-token': 'editor',
  }),
  OPENARCH_REQUIRE_AUTH: 'true',
  OPENARCH_JWT_SECRET: 'test-secret',
} as unknown as NodeJS.ProcessEnv);

const open = loadAuthConfig({} as NodeJS.ProcessEnv);

const members = [
  { subject: 'admin', role: 'owner' as const },
  { subject: 'editor', role: 'editor' as const },
  { subject: 'reader', role: 'viewer' as const },
];

function sign(payload: object, secret = 'test-secret'): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('auth config', () => {
  it('parses static tokens in both object and string form', () => {
    expect(restricted.staticTokens.get('admin-token')?.subject).toBe('admin');
    expect(restricted.staticTokens.get('editor-token')?.subject).toBe('editor');
    expect(restricted.required).toBe(true);
  });

  it('defaults the bootstrap admin to the first static token', () => {
    expect(restricted.adminSubject).toBe('admin');
  });

  it('rejects malformed token JSON', () => {
    expect(() =>
      loadAuthConfig({ OPENARCH_TOKENS: 'not-json' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/OPENARCH_TOKENS/);
  });
});

describe('actor resolution', () => {
  it('accepts a configured static token', () => {
    const actor = resolveActor({ authorization: 'Bearer editor-token' }, restricted);
    expect(actor?.subject).toBe('editor');
    expect(actor?.authenticated).toBe(true);
  });

  it('accepts a valid HS256 JWT', () => {
    const actor = resolveActor(
      { authorization: `Bearer ${sign({ sub: 'alice', name: 'Alice' })}` },
      restricted,
    );
    expect(actor?.subject).toBe('alice');
    expect(actor?.displayName).toBe('Alice');
  });

  it('rejects expired and tampered JWTs', () => {
    const expired = sign({ sub: 'alice', exp: Math.floor(Date.now() / 1000) - 60 });
    expect(resolveActor({ authorization: `Bearer ${expired}` }, restricted)).toBeNull();

    const valid = sign({ sub: 'alice' });
    const tampered = `${valid.slice(0, -4)}AAAA`;
    expect(resolveActor({ authorization: `Bearer ${tampered}` }, restricted)).toBeNull();
  });

  it('rejects unsigned and unknown tokens when auth is required', () => {
    expect(resolveActor({}, restricted)).toBeNull();
    expect(resolveActor({ authorization: 'Bearer nope' }, restricted)).toBeNull();
  });

  it('falls back to an anonymous actor when auth is disabled', () => {
    const actor = resolveActor({ 'x-actor': 'henrik' }, open);
    expect(actor?.subject).toBe('henrik');
    expect(actor?.authenticated).toBe(false);
  });
});

describe('role and membership', () => {
  it('maps owners, editors, viewers, and non-members', () => {
    expect(roleFor(members, { subject: 'admin', authenticated: true }, restricted)).toBe('owner');
    expect(roleFor(members, { subject: 'editor', authenticated: true }, restricted)).toBe('editor');
    expect(roleFor(members, { subject: 'reader', authenticated: true }, restricted)).toBe('viewer');
    expect(roleFor(members, { subject: 'stranger', authenticated: true }, restricted)).toBe('viewer');
  });

  it('treats everyone as owner when auth is disabled', () => {
    expect(roleFor(undefined, { subject: 'anyone', authenticated: false }, open)).toBe('owner');
  });

  it('isolates reads to members when auth is required', () => {
    expect(isMember(members, { subject: 'reader', authenticated: true }, restricted)).toBe(true);
    expect(isMember(members, { subject: 'stranger', authenticated: true }, restricted)).toBe(false);
    expect(isMember(undefined, { subject: 'stranger', authenticated: true }, restricted)).toBe(false);
    // The bootstrap admin can always read.
    expect(isMember(undefined, { subject: 'admin', authenticated: true }, restricted)).toBe(true);
  });

  it('allows everyone to read when auth is disabled', () => {
    expect(isMember(undefined, { subject: 'stranger', authenticated: false }, open)).toBe(true);
  });

  it('enforces write roles', () => {
    expect(hasRole('viewer', ['owner', 'editor'])).toBe(false);
    expect(hasRole('editor', ['owner', 'editor'])).toBe(true);
    expect(hasRole('owner', ['owner'])).toBe(true);
  });
});

describe('JWT verification', () => {
  it('rejects non-HS256 algorithms', () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'none' });
    const body = encode({ sub: 'alice' });
    expect(verifyJwt(`${header}.${body}.`, 'test-secret')).toBeUndefined();
  });
});
