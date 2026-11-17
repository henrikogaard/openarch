import type { IacResource } from './types';
import {
  asArray,
  asRecord,
  asString,
  errorMessage,
  flattenScalarAttributes,
  isRecord,
  normalizeEnvironment,
  type UnknownRecord,
} from './utils';

interface CollectedResource {
  address: string;
  resource: UnknownRecord;
}

/**
 * Parse `terraform show -json` output.
 *
 * Accepts plan output (planned_values plus resource_changes), raw state
 * (`values.root_module`), and nested child modules. Data sources are skipped.
 */
export function parseTerraformPlan(json: string): IacResource[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid Terraform JSON: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Invalid Terraform JSON: expected an object');
  }

  const collected: CollectedResource[] = [];
  const plannedRoot = asRecord(asRecord(parsed.planned_values)?.root_module);
  if (plannedRoot) collectModuleResources(plannedRoot, '', collected);

  const stateRoot = asRecord(asRecord(parsed.values)?.root_module);
  if (stateRoot) collectModuleResources(stateRoot, '', collected);

  collected.push(...collectResourceChanges(asArray(parsed.resource_changes)));

  return dedupeByAddress(collected).map(toIacResource);
}

function collectModuleResources(
  module: UnknownRecord,
  moduleAddress: string,
  collected: CollectedResource[],
): void {
  for (const entry of asArray(module.resources)) {
    if (!isRecord(entry)) continue;
    const address = asString(entry.address) ?? fallbackAddress(moduleAddress, entry);
    if (isDataSource(entry, address)) continue;
    collected.push({ address, resource: entry });
  }

  for (const child of asArray(module.child_modules)) {
    if (!isRecord(child)) continue;
    const childAddress = asString(child.address) ?? moduleAddress;
    collectModuleResources(child, childAddress, collected);
  }
}

function collectResourceChanges(changes: unknown[]): CollectedResource[] {
  const collected: CollectedResource[] = [];
  for (const entry of changes) {
    if (!isRecord(entry)) continue;
    const after = asRecord(asRecord(entry.change)?.after);
    if (!after) continue;
    const address = asString(entry.address) ?? fallbackAddress('', entry);
    if (isDataSource(entry, address)) continue;
    collected.push({ address, resource: { ...entry, values: after } });
  }
  return collected;
}

function isDataSource(resource: UnknownRecord, address: string): boolean {
  return resource.mode === 'data' || /(^|\.)data\./.test(address);
}

function fallbackAddress(moduleAddress: string, resource: UnknownRecord): string {
  const type = asString(resource.type) ?? 'unknown';
  const name = asString(resource.name) ?? 'unnamed';
  return moduleAddress ? `${moduleAddress}.${type}.${name}` : `${type}.${name}`;
}

function dedupeByAddress(collected: CollectedResource[]): CollectedResource[] {
  const seen = new Set<string>();
  const result: CollectedResource[] = [];
  for (const entry of collected) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    result.push(entry);
  }
  return result;
}

function toIacResource({ address, resource }: CollectedResource): IacResource {
  const values = asRecord(resource.values) ?? {};
  const kind = asString(resource.type) ?? kindFromAddress(address);
  const environment = environmentFromValues(values);

  const result: IacResource = {
    address,
    kind,
    name: nameFromResource(resource, values),
    attributes: flattenScalarAttributes(values),
    dependencies: dependenciesFromResource(resource),
  };

  const provider = providerFromKind(kind);
  if (provider) result.provider = provider;
  if (environment) result.environment = environment;
  return result;
}

function kindFromAddress(address: string): string {
  const parts = address.split('.').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'unknown';
}

function providerFromKind(kind: string): string | undefined {
  const separator = kind.indexOf('_');
  return separator > 0 ? kind.slice(0, separator) : undefined;
}

function nameFromResource(resource: UnknownRecord, values: UnknownRecord): string {
  const direct = asString(resource.name);
  if (direct) return direct;

  const valueName = asString(values.name);
  if (valueName) return valueName;

  const tags = asRecord(values.tags);
  return asString(tags?.Name) || 'unnamed';
}

function environmentFromValues(values: UnknownRecord): string | undefined {
  const tags = asRecord(values.tags);
  const candidates = [tags?.Environment, tags?.env, tags?.environment, values.environment];
  for (const candidate of candidates) {
    const environment = normalizeEnvironment(candidate);
    if (environment) return environment;
  }
  return undefined;
}

function dependenciesFromResource(resource: UnknownRecord): string[] {
  return asArray(resource.depends_on).filter(
    (entry): entry is string => typeof entry === 'string',
  );
}
