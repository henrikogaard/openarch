import type { ArchiElement, Relationship } from '@openarch/core';

/** A single infrastructure resource discovered in an IaC source. */
export interface IacResource {
  /** Stable id, e.g. aws_instance.web. */
  address: string;
  /** Provider resource kind, e.g. aws_instance or Deployment. */
  kind: string;
  /** Human-readable name. */
  name: string;
  /** aws | azure | gcp | kubernetes | docker. */
  provider?: string;
  /** dev | staging | prod if discoverable. */
  environment?: string;
  attributes: Record<string, string>;
  /** Addresses this resource depends on. */
  dependencies: string[];
}

/** Result of mapping IaC resources onto the ArchiMate metamodel. */
export interface IacImport {
  elements: ArchiElement[];
  relationships: Relationship[];
  warnings: string[];
}

export interface IacOptions {
  environment?: string;
  /** Domain id to assign to every imported element. */
  domain?: string;
  /** Defaults to 'iac'. */
  idPrefix?: string;
}
