# @openarch/iac

Deterministic infrastructure-as-code (IaC) importer for OpenArch. It reads real
Terraform, Kubernetes, and Docker Compose definitions and maps them onto
ArchiMate elements and relationships. There is no LLM and no network access:
the same input always produces the same ids, elements, and relationships.

## Usage

```ts
import { mapResources, parseTerraformPlan } from '@openarch/iac';

const resources = parseTerraformPlan(planJson);
const { elements, relationships, warnings } = mapResources(resources, {
  environment: 'prod',
  domain: 'domain-cloud',
  idPrefix: 'iac',
});
```

`mapResources` returns:

- `elements`: ArchiMate elements with `source=iac`, `iacAddress`, and `iacKind`
  properties.
- `relationships`: only relationships allowed by the core metamodel.
- `warnings`: unknown kinds, missing dependency targets, and skipped
  relationships.

## Importers

### Terraform

```ts
import { parseTerraformPlan } from '@openarch/iac';

const resources = parseTerraformPlan(json);
```

Accepts `terraform show -json` output in both forms:

- plan output: `planned_values.root_module.resources` plus
  `resource_changes[].change.after`
- raw state: `values.root_module.resources`

Nested `child_modules` are traversed. Data sources (`mode: "data"` or addresses
starting with `data.`) are skipped. Dependencies come from `depends_on`.
Attributes are flattened to strings; nested objects are skipped.

### Kubernetes

```ts
import { parseKubernetes } from '@openarch/iac';

const resources = parseKubernetes(manifestYaml);
```

Parses multi-document YAML with `yaml`'s `parseAllDocuments`. It reads `kind`,
`metadata.name`, `metadata.namespace`, `metadata.labels.environment`, and
`spec`.

Dependencies are resolved statically:

- Ingress → Service from `spec.rules[].http.paths[].backend.service.name`
  (v1) or `backend.serviceName` (legacy), plus default backends.
- Service → workload by matching `spec.selector` against pod template labels.
- Deployment/StatefulSet/DaemonSet/Job/CronJob/Pod → ConfigMap/Secret from
  `envFrom[].configMapRef.name`, `envFrom[].secretRef.name`,
  `volumes[].configMap.name`, and `volumes[].secret.secretName`.

Service selectors are also recorded as `selector` and `selector.<key>`
attributes so the match can be inspected.

### Docker Compose

```ts
import { parseDockerCompose } from '@openarch/iac';

const resources = parseDockerCompose(composeYaml);
```

- `services` become `compose.service` resources.
- `volumes` become `compose.volume` resources.
- `networks` become `compose.network` resources.
- `depends_on` supports both the array and map forms.
- Environment is read from `environment` (map or `KEY=value` list, using
  `ENVIRONMENT`/`ENV`) or from top-level `x-environment`.

## Type mapping

The mapper uses `getElementType` to confirm every target type exists and falls
back to `Node` with a warning when a kind is unknown.

| IaC kind pattern | ArchiMate type |
| --- | --- |
| `network`, `vpc`, `virtual_network` | `CommunicationNetwork` |
| `subnet`, `subnetwork` | `Grouping` |
| `instance`, `vm`, `virtual_machine`, `compute` | `Node` |
| `lambda`, `function`, `container`, `app_service`, `cloud_run` | `SystemSoftware` |
| `bucket`, `storage`, `blob`, `volume`, `artifact` | `Artifact` |
| `database`, `db`, `rds`, `postgres`, `mysql`, `sql` | `Node` |
| `load_balancer`, `lb`, `alb`, `elb`, `application_gateway`, `api_gateway` | `TechnologyService` |
| `ingress`, `route`, `gateway` | `TechnologyInterface` |
| Kubernetes `Service` | `TechnologyService` |
| Kubernetes `Namespace` | `Grouping` |
| Kubernetes `ConfigMap`, `Secret`, `PersistentVolumeClaim` | `Artifact` |
| Kubernetes workloads (`Deployment`, `StatefulSet`, `DaemonSet`, `Job`, `CronJob`, `Pod`) | `Node` |
| Docker Compose `service` | `SystemSoftware` |
| Docker Compose `volume` | `Artifact` |
| Docker Compose `network` | `CommunicationNetwork` |
| anything else | `Node` (with a warning) |

## Relationships

For every dependency, the importer chooses a relationship in this order:

1. `Composition` for network/grouping containment (container → member).
2. `Serving` for workload → workload.
3. `Access` for workload → artifact.
4. The first allowed fallback among `Composition`, `Serving`, and `Access`.

Every candidate is checked with `isAllowedRelationship`. If none is allowed,
the dependency is skipped and a warning is added. Containment is oriented from
the container to its member even when the member declared the dependency, so an
instance that depends on a subnet produces a subnet → instance `Composition`.

The core metamodel's `denySelf` rule rejects same-type relationships. For two
distinct workload elements of the same type (for example two Compose services),
the importer still uses `Serving`, because the rule is intended to prevent
self-loops rather than service-to-service dependencies.

## Deterministic and idempotent design

- Element ids are `${idPrefix}-${slug(address)}`; the default prefix is `iac`.
- Relationship ids are `rel-iac-${slug(source)}-${slug(target)}`.
- Resources are deduplicated by address.
- Relationships are deduplicated by oriented source/target pair.
- No timestamps, random ids, network calls, or LLM calls are used.
- Importing the same input twice yields identical element and relationship ids.
- Invalid JSON/YAML throws an error prefixed with the importer name.

## Environment and domain

`IacOptions.environment` overrides any environment discovered in the source.
Otherwise the importer uses the resource environment (lowercased from tags,
labels, or Compose environment variables). `IacOptions.domain` is assigned to
every imported element. The environment is also written to an element property.
