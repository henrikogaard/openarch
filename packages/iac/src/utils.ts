/** Shared, dependency-free helpers used by the IaC importers. */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

export function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** Convert a map of scalar values into a string map, dropping nested values. */
export function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const text = scalarToString(entry);
    if (text !== undefined) result[key] = text;
  }
  return result;
}

/**
 * Flatten top-level scalar attributes and arrays of scalars into strings.
 * Nested objects and arrays containing objects are deliberately skipped.
 */
export function flattenScalarAttributes(values: UnknownRecord): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isScalar(value)) {
      attributes[key] = String(value);
    } else if (Array.isArray(value) && value.length > 0 && value.every(isScalar)) {
      attributes[key] = value.map((entry) => String(entry)).join(', ');
    }
  }
  return attributes;
}

export function normalizeEnvironment(value: unknown): string | undefined {
  const text = asString(value)?.trim();
  return text ? text.toLowerCase() : undefined;
}

/** Stable, filesystem- and id-safe slug. */
export function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return result || 'unknown';
}

/** Title-case identifier-like names while leaving human names untouched. */
export function humanizeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'Unnamed resource';
  if (/\s/.test(trimmed) || !/^[a-z0-9._-]+$/.test(trimmed)) return trimmed;
  return trimmed
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
