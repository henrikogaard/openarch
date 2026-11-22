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

describe('OIDC RS256 end-to-end (local JWKS issuer)', () => {
  it('verifies a real RS256 token against a discovered JWKS, and rejects bad aud/iss/signature', async () => {
    const { generateKeyPairSync, sign: cryptoSign } = await import('node:crypto');
    const { createServer } = await import('node:http');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'test-key-1', alg: 'RS256', use: 'sig' };

    const server = createServer((req, res) => {
      if (req.url?.startsWith('/.well-known/openid-configuration')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jwks_uri: `http://127.0.0.1:${(server.address() as { port: number }).port}/jwks` }));
      } else if (req.url?.startsWith('/jwks')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    try {
      const { refreshJwks, loadAuthConfig, resolveActor } = await import('./auth');
      const config = loadAuthConfig({
        OPENARCH_REQUIRE_AUTH: 'true',
        OPENARCH_OIDC_ISSUER: issuer,
        OPENARCH_OIDC_AUDIENCE: 'openarch-api',
      } as unknown as NodeJS.ProcessEnv);
      await refreshJwks(config);

      const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const makeToken = (payload: object, key = privateKey) => {
        const header = b64({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' });
        const body = b64(payload);
        const signature = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${body}`), key).toString('base64url');
        return `${header}.${body}.${signature}`;
      };

      const good = makeToken({
        sub: 'oidc-user@example.com',
        name: 'OIDC User',
        iss: issuer,
        aud: 'openarch-api',
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      const actor = resolveActor({ authorization: `Bearer ${good}` }, config);
      expect(actor?.subject).toBe('oidc-user@example.com');
      expect(actor?.authenticated).toBe(true);

      const wrongAud = makeToken({ sub: 'u', iss: issuer, aud: 'other-api', exp: Math.floor(Date.now() / 1000) + 600 });
      expect(resolveActor({ authorization: `Bearer ${wrongAud}` }, config)).toBeNull();

      const wrongIss = makeToken({ sub: 'u', iss: 'https://evil.example', aud: 'openarch-api', exp: Math.floor(Date.now() / 1000) + 600 });
      expect(resolveActor({ authorization: `Bearer ${wrongIss}` }, config)).toBeNull();

      const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const forged = makeToken({ sub: 'u', iss: issuer, aud: 'openarch-api', exp: Math.floor(Date.now() / 1000) + 600 }, otherKey);
      expect(resolveActor({ authorization: `Bearer ${forged}` }, config)).toBeNull();

      const expired = makeToken({ sub: 'u', iss: issuer, aud: 'openarch-api', exp: Math.floor(Date.now() / 1000) - 10 });
      expect(resolveActor({ authorization: `Bearer ${expired}` }, config)).toBeNull();
    } finally {
      server.close();
    }
  });
});
