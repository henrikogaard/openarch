import { parse } from 'yaml';
import type { IacResource } from './types';
import {
  asArray,
  asRecord,
  errorMessage,
  isRecord,
  isScalar,
  normalizeEnvironment,
  scalarToString,
  type UnknownRecord,
} from './utils';

/** Parse a docker-compose YAML file into IaC resources. */
export function parseDockerCompose(yamlText: string): IacResource[] {
  let parsed: unknown;
  try {
    parsed = parse(yamlText);
  } catch (error) {
    throw new Error(`Invalid docker-compose YAML: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error('Invalid docker-compose YAML: expected an object');
  }

  const defaultEnvironment = composeEnvironment(parsed['x-environment']);
  const resources: IacResource[] = [];

  const services = asRecord(parsed.services);
  if (services) {
    for (const [name, value] of Object.entries(services)) {
      resources.push(serviceResource(name, asRecord(value) ?? {}, defaultEnvironment));
    }
  }

  const volumes = asRecord(parsed.volumes);
  if (volumes) {
    for (const [name, value] of Object.entries(volumes)) {
      resources.push(volumeResource(name, asRecord(value) ?? {}, defaultEnvironment));
    }
  } else {
    for (const name of stringArray(parsed.volumes)) {
      resources.push(volumeResource(name, {}, defaultEnvironment));
    }
  }

  const networks = asRecord(parsed.networks);
  if (networks) {
    for (const [name, value] of Object.entries(networks)) {
      resources.push(networkResource(name, asRecord(value) ?? {}, defaultEnvironment));
    }
  } else {
    for (const name of stringArray(parsed.networks)) {
      resources.push(networkResource(name, {}, defaultEnvironment));
    }
  }

  return resources;
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === 'string');
}

function serviceResource(
  name: string,
  service: UnknownRecord,
  defaultEnvironment: string | undefined,
): IacResource {
  const attributes: Record<string, string> = {};
  addAttribute(attributes, 'image', scalarToString(service.image));
  addAttribute(attributes, 'build', buildValue(service.build));
  addAttribute(attributes, 'container_name', scalarToString(service.container_name));
  addAttribute(attributes, 'restart', scalarToString(service.restart));
  addAttribute(attributes, 'ports', joinScalars(service.ports));
  addAttribute(attributes, 'expose', joinScalars(service.expose));
  addAttribute(attributes, 'profiles', joinScalars(service.profiles));
  addAttribute(attributes, 'networks', composeNetworkNames(service.networks));
  addAttribute(attributes, 'command', joinScalars(service.command));

  const result: IacResource = {
    address: `compose.service.${name}`,
    kind: 'compose.service',
    name,
    provider: 'docker',
    attributes,
    dependencies: composeDependencies(service.depends_on),
  };

  const environment = serviceEnvironment(service.environment) ?? defaultEnvironment;
  if (environment) result.environment = environment;
  return result;
}

function volumeResource(
  name: string,
  volume: UnknownRecord,
  environment: string | undefined,
): IacResource {
  const attributes: Record<string, string> = {};
  addAttribute(attributes, 'driver', scalarToString(volume.driver));
  addAttribute(attributes, 'external', scalarToString(volume.external));
  addAttribute(attributes, 'name', scalarToString(volume.name));

  const result: IacResource = {
    address: `compose.volume.${name}`,
    kind: 'compose.volume',
    name,
    provider: 'docker',
    attributes,
    dependencies: [],
  };
  if (environment) result.environment = environment;
  return result;
}

function networkResource(
  name: string,
  network: UnknownRecord,
  environment: string | undefined,
): IacResource {
  const attributes: Record<string, string> = {};
  addAttribute(attributes, 'driver', scalarToString(network.driver));
  addAttribute(attributes, 'external', scalarToString(network.external));
  addAttribute(attributes, 'name', scalarToString(network.name));

  const result: IacResource = {
    address: `compose.network.${name}`,
    kind: 'compose.network',
    name,
    provider: 'docker',
    attributes,
    dependencies: [],
  };
  if (environment) result.environment = environment;
  return result;
}

function addAttribute(
  attributes: Record<string, string>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== '') attributes[key] = value;
}

function buildValue(value: unknown): string | undefined {
  const text = scalarToString(value);
  if (text !== undefined) return text;
  return scalarToString(asRecord(value)?.context);
}

function joinScalars(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (!value.every(isScalar)) return undefined;
    return value.map((entry) => String(entry)).join(', ');
  }
  return scalarToString(value);
}

function composeNetworkNames(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const names = stringArray(value);
    return names.length > 0 ? names.join(', ') : undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  const names = Object.keys(record);
  return names.length > 0 ? names.join(', ') : undefined;
}

function composeDependencies(value: unknown): string[] {
  const names = new Set<string>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') names.add(entry);
    }
  } else if (isRecord(value)) {
    for (const name of Object.keys(value)) names.add(name);
  } else if (typeof value === 'string') {
    names.add(value);
  }

  return [...names].map((name) => `compose.service.${name}`);
}

function composeEnvironment(value: unknown): string | undefined {
  if (typeof value === 'string') return normalizeEnvironment(value);
  const record = asRecord(value);
  return record ? environmentFromRecord(record) : undefined;
}

function serviceEnvironment(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') continue;
      const separator = entry.indexOf('=');
      const key = (separator >= 0 ? entry.slice(0, separator) : entry).trim();
      if (!isEnvironmentKey(key)) continue;
      const environment = normalizeEnvironment(
        separator >= 0 ? entry.slice(separator + 1) : undefined,
      );
      if (environment) return environment;
    }
    return undefined;
  }

  const record = asRecord(value);
  return record ? environmentFromRecord(record) : undefined;
}

function environmentFromRecord(record: UnknownRecord): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (!isEnvironmentKey(key)) continue;
    const environment = normalizeEnvironment(value);
    if (environment) return environment;
  }
  return undefined;
}

function isEnvironmentKey(key: string): boolean {
  const normalized = key.trim().toUpperCase();
  return normalized === 'ENVIRONMENT' || normalized === 'ENV';
}
