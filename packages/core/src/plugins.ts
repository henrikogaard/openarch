import type { ElementTypeDefinition, Model, RelationshipTypeDefinition } from './types';
import type { ViewpointDefinition } from './viewpoints';
import { validateModel, type ValidationIssue } from './validation';

/** Extension points for custom notation, exports, viewpoints, and validation. */
export interface OpenArchPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  elementTypes?: ElementTypeDefinition[];
  relationshipTypes?: RelationshipTypeDefinition[];
  viewpoints?: ViewpointDefinition[];
  exporters?: ModelExporter[];
  validators?: ModelValidator[];
}

export interface ModelExporter {
  id: string;
  label: string;
  extension: string;
  mimeType: string;
  export(model: Model): string | Promise<string>;
}

export type ModelValidator = (model: Model) => ValidationIssue[];

const plugins = new Map<string, OpenArchPlugin>();

export function registerPlugin(plugin: OpenArchPlugin): void {
  if (plugins.has(plugin.id)) throw new Error(`Plugin "${plugin.id}" is already registered`);
  plugins.set(plugin.id, plugin);
}

export function unregisterPlugin(id: string): void {
  plugins.delete(id);
}

export function listPlugins(): OpenArchPlugin[] {
  return [...plugins.values()];
}

export function pluginElementTypes(): ElementTypeDefinition[] {
  return [...plugins.values()].flatMap((plugin) => plugin.elementTypes ?? []);
}

export function pluginRelationshipTypes(): RelationshipTypeDefinition[] {
  return [...plugins.values()].flatMap((plugin) => plugin.relationshipTypes ?? []);
}

export function pluginViewpoints(): ViewpointDefinition[] {
  return [...plugins.values()].flatMap((plugin) => plugin.viewpoints ?? []);
}

export function pluginExporters(): ModelExporter[] {
  return [...plugins.values()].flatMap((plugin) => plugin.exporters ?? []);
}

export function validateWithPlugins(model: Model): ValidationIssue[] {
  const custom = [...plugins.values()].flatMap((plugin) =>
    (plugin.validators ?? []).flatMap((validator) => validator(model)),
  );
  return [...validateModel(model), ...custom];
}

export function clearPlugins(): void {
  plugins.clear();
}
