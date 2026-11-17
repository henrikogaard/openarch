import { parseAllDocuments } from 'yaml';
import type { IacResource } from './types';
import {
  asArray,
  asRecord,
  asString,
  errorMessage,
  isRecord,
  normalizeEnvironment,
  scalarToString,
  stringRecord,
  type UnknownRecord,
} from './utils';

interface KubernetesResource {
  doc: UnknownRecord;
  kind: string;
  name: string;
  namespace?: string;
  address: string;
  environment?: string;
  attributes: Record<string, string>;
  dependencies: string[];
}

interface ConfigReference {
  kind: 'ConfigMap' | 'Secret';
  name: string;
}

const WORKLOAD_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'ReplicationController',
  'Pod',
  'Job',
  'CronJob',
]);

/** Parse a multi-document Kubernetes manifest into IaC resources. */
export function parseKubernetes(yamlText: string): IacResource[] {
  const documents = readDocuments(yamlText);
  const resources: KubernetesResource[] = [];

  for (const document of documents) {
    const resource = toKubernetesResource(document);
    if (resource) resources.push(resource);
  }

  resolveServiceDependencies(resources);
  return resources.map(toIacResource);
}

function readDocuments(yamlText: string): unknown[] {
  let documents: ReturnType<typeof parseAllDocuments>;
  try {
    documents = parseAllDocuments(yamlText);
  } catch (error) {
    throw new Error(`Invalid Kubernetes YAML: ${errorMessage(error)}`);
  }

  const values: unknown[] = [];
  for (const document of documents) {
    if (document.errors.length > 0) {
      throw new Error(
        `Invalid Kubernetes YAML: ${document.errors[0]?.message ?? 'unknown parse error'}`,
      );
    }

    let value: unknown;
    try {
      value = document.toJS();
    } catch (error) {
      throw new Error(`Invalid Kubernetes YAML: ${errorMessage(error)}`);
    }

    if (value !== null && value !== undefined) values.push(value);
  }
  return values;
}

function toKubernetesResource(value: unknown): KubernetesResource | undefined {
  if (!isRecord(value)) return undefined;

  const kind = asString(value.kind);
  if (!kind) return undefined;

  const metadata = asRecord(value.metadata);
  const name = asString(metadata?.name);
  if (!name) return undefined;

  const namespace = asString(metadata?.namespace) || undefined;
  const labels = stringRecord(metadata?.labels);
  const environment = normalizeEnvironment(labels.environment ?? labels.env);
  const address = kubernetesAddress(kind, name, namespace);
  const attributes = baseAttributes(value, kind, namespace, labels);
  if (environment) attributes.environment = environment;

  return {
    doc: value,
    kind,
    name,
    namespace,
    address,
    environment,
    attributes,
    dependencies: dependenciesFor(value, kind, namespace),
  };
}

function kubernetesAddress(kind: string, name: string, namespace?: string): string {
  const normalizedKind = kind.toLowerCase();
  return namespace
    ? `kubernetes.${normalizedKind}.${namespace}.${name}`
    : `kubernetes.${normalizedKind}.${name}`;
}

function baseAttributes(
  doc: UnknownRecord,
  kind: string,
  namespace: string | undefined,
  labels: Record<string, string>,
): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (namespace) attributes.namespace = namespace;

  const apiVersion = asString(doc.apiVersion);
  if (apiVersion) attributes.apiVersion = apiVersion;

  for (const [key, value] of Object.entries(labels)) {
    attributes[`label.${key}`] = value;
  }

  if (kind === 'ConfigMap' || kind === 'Secret') addDataAttributes(doc, attributes);

  const spec = asRecord(doc.spec);
  if (!spec) return attributes;

  if (kind === 'Service') addServiceAttributes(spec, attributes);
  if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet' || kind === 'ReplicaSet') {
    addWorkloadAttributes(spec, attributes);
  }
  if (kind === 'Ingress') addIngressAttributes(spec, attributes);
  if (kind === 'PersistentVolumeClaim') addClaimAttributes(spec, attributes);

  return attributes;
}

function addServiceAttributes(spec: UnknownRecord, attributes: Record<string, string>): void {
  const selector = stringRecord(spec.selector);
  const entries = Object.entries(selector);
  if (entries.length > 0) {
    attributes.selector = entries.map(([key, value]) => `${key}=${value}`).join(',');
    for (const [key, value] of entries) attributes[`selector.${key}`] = value;
  }

  const type = asString(spec.type);
  if (type) attributes.serviceType = type;

  const clusterIp = asString(spec.clusterIP);
  if (clusterIp) attributes.clusterIP = clusterIp;
}

function addWorkloadAttributes(spec: UnknownRecord, attributes: Record<string, string>): void {
  const replicas = scalarToString(spec.replicas);
  if (replicas !== undefined) attributes.replicas = replicas;

  const podSpec = asRecord(asRecord(spec.template)?.spec);
  const image = firstContainerImage(podSpec);
  if (image) attributes.image = image;
}

function firstContainerImage(podSpec: UnknownRecord | undefined): string | undefined {
  for (const container of asArray(podSpec?.containers)) {
    const image = asString(asRecord(container)?.image);
    if (image) return image;
  }
  return undefined;
}

function addIngressAttributes(spec: UnknownRecord, attributes: Record<string, string>): void {
  const ingressClass = asString(spec.ingressClassName);
  if (ingressClass) attributes.ingressClassName = ingressClass;

  const hosts: string[] = [];
  for (const rule of asArray(spec.rules)) {
    const host = asString(asRecord(rule)?.host);
    if (host) hosts.push(host);
  }
  if (hosts.length > 0) attributes.hosts = hosts.join(', ');
}

function addDataAttributes(resource: UnknownRecord, attributes: Record<string, string>): void {
  const data = asRecord(resource.data);
  if (data) attributes.dataKeys = Object.keys(data).join(', ');

  const stringData = asRecord(resource.stringData);
  if (stringData) attributes.stringDataKeys = Object.keys(stringData).join(', ');
}

function addClaimAttributes(spec: UnknownRecord, attributes: Record<string, string>): void {
  const storageClassName = asString(spec.storageClassName);
  if (storageClassName) attributes.storageClassName = storageClassName;

  const accessModes = asArray(spec.accessModes).filter(
    (entry): entry is string => typeof entry === 'string',
  );
  if (accessModes.length > 0) attributes.accessModes = accessModes.join(', ');

  const requests = asRecord(asRecord(spec.resources)?.requests);
  const storage = asString(requests?.storage);
  if (storage) attributes.storage = storage;
}

function dependenciesFor(
  doc: UnknownRecord,
  kind: string,
  namespace: string | undefined,
): string[] {
  const dependencies = new Set<string>();

  if (kind === 'Ingress') {
    for (const serviceName of ingressServiceNames(doc)) {
      dependencies.add(kubernetesAddress('Service', serviceName, namespace));
    }
  }

  for (const reference of referencedConfigObjects(doc, kind)) {
    dependencies.add(kubernetesAddress(reference.kind, reference.name, namespace));
  }

  return [...dependencies];
}

function ingressServiceNames(doc: UnknownRecord): string[] {
  const spec = asRecord(doc.spec);
  if (!spec) return [];

  const names = new Set<string>();
  addBackendServiceName(asRecord(spec.defaultBackend), names);
  addBackendServiceName(asRecord(spec.backend), names);

  for (const rule of asArray(spec.rules)) {
    const http = asRecord(asRecord(rule)?.http);
    for (const path of asArray(http?.paths)) {
      addBackendServiceName(asRecord(asRecord(path)?.backend), names);
    }
  }

  return [...names];
}

function addBackendServiceName(
  backend: UnknownRecord | undefined,
  names: Set<string>,
): void {
  if (!backend) return;
  const name =
    asString(asRecord(backend.service)?.name) ?? asString(backend.serviceName);
  if (name) names.add(name);
}

function referencedConfigObjects(doc: UnknownRecord, kind: string): ConfigReference[] {
  const podSpec = podSpecOf(doc, kind);
  if (!podSpec) return [];

  const references = new Map<string, ConfigReference>();
  const add = (reference: ConfigReference): void => {
    references.set(`${reference.kind}/${reference.name}`, reference);
  };

  for (const container of asArray(podSpec.containers)) {
    for (const envFrom of asArray(asRecord(container)?.envFrom)) {
      const envFromRecord = asRecord(envFrom);
      const configMapName = asString(asRecord(envFromRecord?.configMapRef)?.name);
      if (configMapName) add({ kind: 'ConfigMap', name: configMapName });

      const secretName = asString(asRecord(envFromRecord?.secretRef)?.name);
      if (secretName) add({ kind: 'Secret', name: secretName });
    }
  }

  for (const volume of asArray(podSpec.volumes)) {
    const volumeRecord = asRecord(volume);
    const configMapName = asString(asRecord(volumeRecord?.configMap)?.name);
    if (configMapName) add({ kind: 'ConfigMap', name: configMapName });

    const secretName = asString(asRecord(volumeRecord?.secret)?.secretName);
    if (secretName) add({ kind: 'Secret', name: secretName });
  }

  return [...references.values()];
}

function podSpecOf(doc: UnknownRecord, kind: string): UnknownRecord | undefined {
  if (kind === 'Pod') return asRecord(doc.spec);
  return asRecord(podTemplateOf(doc, kind)?.spec);
}

function podTemplateOf(doc: UnknownRecord, kind: string): UnknownRecord | undefined {
  const spec = asRecord(doc.spec);
  if (!spec) return undefined;

  if (kind === 'CronJob') {
    const jobSpec = asRecord(asRecord(spec.jobTemplate)?.spec);
    return asRecord(jobSpec?.template);
  }

  return asRecord(spec.template);
}

function resolveServiceDependencies(resources: KubernetesResource[]): void {
  const workloads = resources.filter((resource) => WORKLOAD_KINDS.has(resource.kind));

  for (const service of resources) {
    if (service.kind !== 'Service') continue;

    const selector = serviceSelector(service.doc);
    if (Object.keys(selector).length === 0) continue;

    for (const workload of workloads) {
      if (workload.namespace !== service.namespace) continue;
      if (!matchesSelector(workload, selector)) continue;
      addDependency(service, workload.address);
    }
  }
}

function serviceSelector(doc: UnknownRecord): Record<string, string> {
  return stringRecord(asRecord(doc.spec)?.selector);
}

function matchesSelector(
  workload: KubernetesResource,
  selector: Record<string, string>,
): boolean {
  const labels = workloadPodLabels(workload.doc, workload.kind);
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function workloadPodLabels(doc: UnknownRecord, kind: string): Record<string, string> {
  if (kind === 'Pod') return stringRecord(asRecord(doc.metadata)?.labels);

  const templateLabels = stringRecord(asRecord(podTemplateOf(doc, kind)?.metadata)?.labels);
  const selectorLabels = stringRecord(
    asRecord(asRecord(asRecord(doc.spec)?.selector)?.matchLabels),
  );
  return { ...selectorLabels, ...templateLabels };
}

function addDependency(resource: KubernetesResource, address: string): void {
  if (!resource.dependencies.includes(address)) resource.dependencies.push(address);
}

function toIacResource(resource: KubernetesResource): IacResource {
  const result: IacResource = {
    address: resource.address,
    kind: resource.kind,
    name: resource.name,
    provider: 'kubernetes',
    attributes: resource.attributes,
    dependencies: resource.dependencies,
  };
  if (resource.environment) result.environment = resource.environment;
  return result;
}
