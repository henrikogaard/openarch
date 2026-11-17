import type { ArchiElement, Relationship } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { parseDockerCompose } from './compose';
import { parseKubernetes } from './kubernetes';
import { mapResources } from './map';
import { parseTerraformPlan } from './terraform';
import type { IacImport } from './types';

const terraformPlan = {
  format_version: '1.2',
  planned_values: {
    root_module: {
      resources: [
        {
          address: 'aws_vpc.main',
          mode: 'managed',
          type: 'aws_vpc',
          name: 'main',
          values: { cidr_block: '10.0.0.0/16', tags: { Environment: 'Prod' } },
        },
        {
          address: 'aws_subnet.public',
          mode: 'managed',
          type: 'aws_subnet',
          name: 'public',
          values: { cidr_block: '10.0.1.0/24', tags: { env: 'staging' } },
          depends_on: ['aws_vpc.main'],
        },
        {
          address: 'aws_instance.web',
          mode: 'managed',
          type: 'aws_instance',
          name: 'web',
          values: { instance_type: 't3.micro', tags: { Environment: 'prod' } },
          depends_on: ['aws_subnet.public'],
        },
        {
          address: 'aws_db_instance.main',
          mode: 'managed',
          type: 'aws_db_instance',
          name: 'main',
          values: { engine: 'postgres', environment: 'prod' },
          depends_on: ['aws_subnet.public'],
        },
        {
          address: 'aws_s3_bucket.assets',
          mode: 'managed',
          type: 'aws_s3_bucket',
          name: 'assets',
          values: { bucket: 'assets', tags: { Environment: 'prod' } },
        },
      ],
    },
  },
};

const kubernetesYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: shop
  labels:
    environment: prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          envFrom:
            - configMapRef:
                name: web-config
      volumes:
        - name: secret
          secret:
            secretName: web-secret
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: shop
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: shop
data:
  LOG_LEVEL: info
---
apiVersion: v1
kind: Secret
metadata:
  name: web-secret
  namespace: shop
type: Opaque
stringData:
  token: secret
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: shop
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
`;

const composeYaml = `x-environment: staging
services:
  web:
    image: nginx:1.27
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16
    environment:
      ENVIRONMENT: prod
volumes:
  data: {}
networks:
  backend: {}
`;

function elementFor(result: IacImport, address: string): ArchiElement | undefined {
  return result.elements.find((element) =>
    element.properties.some(
      (property) => property.key === 'iacAddress' && property.value === address,
    ),
  );
}

function relationshipBetween(
  result: IacImport,
  sourceAddress: string,
  targetAddress: string,
): Relationship | undefined {
  const source = elementFor(result, sourceAddress);
  const target = elementFor(result, targetAddress);
  return result.relationships.find(
    (relationship) => relationship.source === source?.id && relationship.target === target?.id,
  );
}

describe('terraform importer', () => {
  it('maps a plan with a VPC, subnet, instance, RDS and S3 bucket', () => {
    const resources = parseTerraformPlan(JSON.stringify(terraformPlan));
    const result = mapResources(resources);

    expect(elementFor(result, 'aws_vpc.main')?.type).toBe('CommunicationNetwork');
    expect(elementFor(result, 'aws_subnet.public')?.type).toBe('Grouping');
    expect(elementFor(result, 'aws_instance.web')?.type).toBe('Node');
    expect(elementFor(result, 'aws_db_instance.main')?.type).toBe('Node');
    expect(elementFor(result, 'aws_s3_bucket.assets')?.type).toBe('Artifact');

    expect(elementFor(result, 'aws_vpc.main')?.environment).toBe('prod');
    expect(elementFor(result, 'aws_subnet.public')?.environment).toBe('staging');
    expect(elementFor(result, 'aws_instance.web')?.environment).toBe('prod');

    expect(relationshipBetween(result, 'aws_subnet.public', 'aws_instance.web')?.type).toBe(
      'Composition',
    );
    expect(relationshipBetween(result, 'aws_vpc.main', 'aws_subnet.public')?.type).toBe(
      'Composition',
    );

    const ids = result.relationships.map((relationship) => relationship.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('flattens scalar attributes and skips nested objects', () => {
    const [vpc] = parseTerraformPlan(JSON.stringify(terraformPlan));
    expect(vpc?.attributes.cidr_block).toBe('10.0.0.0/16');
    expect(vpc?.attributes.tags).toBeUndefined();
  });

  it('parses raw state, nested child modules and skips data sources', () => {
    const state = {
      values: {
        root_module: {
          resources: [
            {
              address: 'aws_vpc.main',
              mode: 'managed',
              type: 'aws_vpc',
              name: 'main',
              values: {},
            },
            {
              address: 'data.aws_ami.ubuntu',
              mode: 'data',
              type: 'aws_ami',
              name: 'ubuntu',
              values: {},
            },
          ],
          child_modules: [
            {
              address: 'module.app',
              resources: [
                {
                  address: 'module.app.aws_instance.web',
                  mode: 'managed',
                  type: 'aws_instance',
                  name: 'web',
                  values: {},
                },
              ],
            },
          ],
        },
      },
    };

    const resources = parseTerraformPlan(JSON.stringify(state));
    expect(resources.map((resource) => resource.address)).toEqual([
      'aws_vpc.main',
      'module.app.aws_instance.web',
    ]);
  });

  it('falls back to resource_changes when planned values are absent', () => {
    const plan = {
      resource_changes: [
        {
          address: 'aws_instance.web',
          mode: 'managed',
          type: 'aws_instance',
          name: 'web',
          change: { after: { instance_type: 't3.micro' } },
        },
      ],
    };

    const resources = parseTerraformPlan(JSON.stringify(plan));
    expect(resources).toHaveLength(1);
    expect(resources[0]?.kind).toBe('aws_instance');
    expect(resources[0]?.attributes.instance_type).toBe('t3.micro');
  });
});

describe('kubernetes importer', () => {
  it('maps a multi-document manifest and resolves service dependencies', () => {
    const resources = parseKubernetes(kubernetesYaml);
    const result = mapResources(resources);

    expect(elementFor(result, 'kubernetes.deployment.shop.web')?.type).toBe('Node');
    expect(elementFor(result, 'kubernetes.service.shop.web')?.type).toBe('TechnologyService');
    expect(elementFor(result, 'kubernetes.configmap.shop.web-config')?.type).toBe('Artifact');
    expect(elementFor(result, 'kubernetes.secret.shop.web-secret')?.type).toBe('Artifact');
    expect(elementFor(result, 'kubernetes.ingress.shop.web')?.type).toBe('TechnologyInterface');

    expect(elementFor(result, 'kubernetes.deployment.shop.web')?.environment).toBe('prod');

    expect(
      relationshipBetween(
        result,
        'kubernetes.service.shop.web',
        'kubernetes.deployment.shop.web',
      )?.type,
    ).toBe('Serving');
    expect(
      relationshipBetween(result, 'kubernetes.ingress.shop.web', 'kubernetes.service.shop.web')
        ?.type,
    ).toBe('Serving');
    expect(
      relationshipBetween(
        result,
        'kubernetes.deployment.shop.web',
        'kubernetes.configmap.shop.web-config',
      )?.type,
    ).toBe('Access');
    expect(
      relationshipBetween(
        result,
        'kubernetes.deployment.shop.web',
        'kubernetes.secret.shop.web-secret',
      )?.type,
    ).toBe('Access');

    const ids = result.relationships.map((relationship) => relationship.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records the service selector as attributes', () => {
    const service = parseKubernetes(kubernetesYaml).find(
      (resource) => resource.address === 'kubernetes.service.shop.web',
    );
    expect(service?.attributes.selector).toBe('app=web');
    expect(service?.attributes['selector.app']).toBe('web');
  });
});

describe('docker compose importer', () => {
  it('maps services, volumes and networks and resolves depends_on', () => {
    const resources = parseDockerCompose(composeYaml);
    const result = mapResources(resources);

    expect(elementFor(result, 'compose.service.web')?.type).toBe('SystemSoftware');
    expect(elementFor(result, 'compose.service.db')?.type).toBe('SystemSoftware');
    expect(elementFor(result, 'compose.volume.data')?.type).toBe('Artifact');
    expect(elementFor(result, 'compose.network.backend')?.type).toBe('CommunicationNetwork');

    expect(elementFor(result, 'compose.service.web')?.environment).toBe('staging');
    expect(elementFor(result, 'compose.service.db')?.environment).toBe('prod');

    expect(relationshipBetween(result, 'compose.service.web', 'compose.service.db')?.type).toBe(
      'Serving',
    );
  });

  it('supports the array form of depends_on', () => {
    const resources = parseDockerCompose(`services:
  api:
    image: example/api
    depends_on:
      - db
  db:
    image: postgres
`);

    expect(
      resources.find((resource) => resource.address === 'compose.service.api')?.dependencies,
    ).toEqual(['compose.service.db']);
  });
});

describe('deterministic ids', () => {
  it('produces identical element and relationship ids for repeated imports', () => {
    const first = mapResources(parseTerraformPlan(JSON.stringify(terraformPlan)));
    const second = mapResources(parseTerraformPlan(JSON.stringify(terraformPlan)));

    expect(second.elements.map((element) => element.id)).toEqual(
      first.elements.map((element) => element.id),
    );
    expect(second.relationships.map((relationship) => relationship.id)).toEqual(
      first.relationships.map((relationship) => relationship.id),
    );

    const kubernetesFirst = mapResources(parseKubernetes(kubernetesYaml));
    const kubernetesSecond = mapResources(parseKubernetes(kubernetesYaml));
    expect(kubernetesSecond.elements.map((element) => element.id)).toEqual(
      kubernetesFirst.elements.map((element) => element.id),
    );

    const composeFirst = mapResources(parseDockerCompose(composeYaml));
    const composeSecond = mapResources(parseDockerCompose(composeYaml));
    expect(composeSecond.elements.map((element) => element.id)).toEqual(
      composeFirst.elements.map((element) => element.id),
    );
  });
});

describe('invalid input', () => {
  it('throws clear errors for malformed Terraform JSON', () => {
    expect(() => parseTerraformPlan('{ "planned_values":')).toThrow(/Invalid Terraform JSON/);
    expect(() => parseTerraformPlan('[]')).toThrow(/Invalid Terraform JSON/);
  });

  it('throws clear errors for malformed Kubernetes YAML', () => {
    expect(() => parseKubernetes('kind: [unclosed')).toThrow(/Invalid Kubernetes YAML/);
  });

  it('throws clear errors for malformed docker-compose YAML', () => {
    expect(() => parseDockerCompose('services: [unclosed')).toThrow(
      /Invalid docker-compose YAML/,
    );
  });
});
