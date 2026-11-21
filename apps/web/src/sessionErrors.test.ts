import { describe, expect, it } from 'vitest';
import { classifyRepositoryError, OfflineError, ReauthError, withErrorClass } from './sessionErrors';

describe('session error classification (3/7)', () => {
  it('routes 401/session/auth failures to reauth', () => {
    expect(classifyRepositoryError(new Error('Server request failed: 401'))).toBe('reauth');
    expect(classifyRepositoryError(new Error('Authentication required'))).toBe('reauth');
    expect(classifyRepositoryError(new Error('Your session expired'))).toBe('reauth');
  });

  it('membership 403 is NOT reauth (re-login cannot fix permissions)', () => {
    expect(classifyRepositoryError(new Error('Forbidden: you are not a member'))).toBe('other');
  });

  it('routes network/timeout failures to offline', () => {
    expect(classifyRepositoryError(new Error('TypeError: Failed to fetch'))).toBe('offline');
    expect(classifyRepositoryError(new Error('Could not reach repository: network down'))).toBe('offline');
  });

  it('leaves other errors alone (conflicts, validation…)', () => {
    expect(classifyRepositoryError(new Error('Conflict: workspace changed'))).toBe('other');
    expect(classifyRepositoryError(new Error('Save failed: invalid model'))).toBe('other');
  });

  it('withErrorClass rethrows the right type', async () => {
    await expect(withErrorClass(async () => { throw new Error('Server request failed: 401 UNAUTHORIZED'); }))
      .rejects.toBeInstanceOf(ReauthError);
    await expect(withErrorClass(async () => { throw new Error('TypeError: failed to fetch (offline)'); }))
      .rejects.toBeInstanceOf(OfflineError);
    await expect(withErrorClass(async () => { throw new Error('Conflict: workspace'); }))
      .rejects.toThrow('Conflict');
    await expect(withErrorClass(async () => 42)).resolves.toBe(42);
  });
});
