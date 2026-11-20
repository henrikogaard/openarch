/**
 * 3/7 — Session/offline resilience.
 *
 * `withReauth` classifies repository errors: a 401 raises a ReauthError that
 * the app surfaces as a re-login prompt (instead of "Save failed"), while
 * network failures raise OfflineError ("not sent yet — retry in a moment").
 */
export class ReauthError extends Error {
  constructor(message = 'Your session expired — sign in again') {
    super(message);
    this.name = 'ReauthError';
  }
}

export class OfflineError extends Error {
  constructor(message = 'Could not reach the server — changes stay queued') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function classifyRepositoryError(error: unknown): 'reauth' | 'offline' | 'other' {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (/\b401\b|unauthor|session expired|forbidden: you are not a member/.test(lower)) {
    return 'reauth';
  }
  if (/\boffline\b|network|fetch failed|failed to fetch|timeout|econnrefused|unreachable/.test(lower)) {
    return 'offline';
  }
  return 'other';
}

/** Wrap a repository call so save errors classify instead of raw-thrown. */
export async function withErrorClass<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const kind = classifyRepositoryError(error);
    if (kind === 'reauth') throw new ReauthError(error instanceof Error ? error.message : undefined);
    if (kind === 'offline') throw new OfflineError(error instanceof Error ? error.message : undefined);
    throw error;
  }
}
