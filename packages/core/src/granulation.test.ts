import { describe, expect, it } from 'vitest';
import {
  buildConfiguredView,
  defaultConfigFor,
  elementAttributes,
  GRANULATION_LEVELS,
  VIEWPOINT_CATALOG,
} from './granulation';
import { createSampleModel } from './validation';

const model = createSampleModel();

function typesInView(viewId: string, granulation: 'L1' | 'L2' | 'L3' | 'L4'): Set<string> {
  const definition = GRANULATION_LEVELS.find((level) => level.id === granulation)!;
  const config = {
    ...defaultConfigFor(viewId),
    granulation,
    elementTypes: [...definition.elementTypes],
    relationshipTypes: [...definition.relationshipTypes],
  };
  const result = buildConfiguredView(model, config);
  return new Set(
    result.view.nodes
      .filter((node) => node.elementRef)
      .map((node) => model.elements.find((element) => element.id === node.elementRef)?.type ?? ''),
  );
}

describe('granulation levels', () => {
  it('L1 shows the landscape without data objects', () => {
    const types = typesInView('enterprise-landscape', 'L1');
    expect(types.has('ApplicationComponent')).toBe(true);
    expect(types.has('Node')).toBe(true);
    expect(types.has('DataObject')).toBe(false);
  });

  it('L2 shows applications, services, and data', () => {
    const types = typesInView('solution-architecture', 'L2');
    expect(types.has('ApplicationComponent')).toBe(true);
    expect(types.has('DataObject')).toBe(true);
    expect(types.has('Node')).toBe(false);
  });

  it('L3 shows servers and artifacts behind applications', () => {
    const types = typesInView('deployment', 'L3');
    expect(types.has('ApplicationComponent')).toBe(true);
    expect(types.has('Node')).toBe(true);
    expect(types.has('Artifact')).toBe(true);
  });

  it('L4 shows infrastructure', () => {
    const types = typesInView('infrastructure', 'L4');
    expect(types.has('Node')).toBe(true);
    expect(types.has('Artifact')).toBe(true);
    expect(types.has('ApplicationComponent')).toBe(false);
  });
});

describe('view configuration', () => {
  it('expands an application with the servers behind it', () => {
    const config = {
      ...defaultConfigFor('solution-architecture'),
      expandElementIds: ['e-portal'],
    };
    const result = buildConfiguredView(model, config);
    const ids = result.view.nodes
      .filter((node) => node.elementRef)
      .map((node) => node.elementRef);
    expect(ids).toContain('e-server');
    expect(result.stats.expanded).toBeGreaterThan(0);
  });

  it('builds a dependency neighbourhood from a root element', () => {
    const config = {
      ...defaultConfigFor('dependency-impact'),
      rootElementIds: ['e-portal'],
      depth: 1,
    };
    const result = buildConfiguredView(model, config);
    const ids = result.view.nodes
      .filter((node) => node.elementRef)
      .map((node) => node.elementRef);
    expect(ids).toContain('e-claim-data');
    expect(ids).toContain('e-server');
  });

  it('filters by domain', () => {
    const config = {
      ...defaultConfigFor('solution-architecture'),
      domainFilter: 'domain-technology',
    };
    const result = buildConfiguredView(model, config);
    const domains = result.view.nodes
      .filter((node) => node.elementRef)
      .map((node) => model.elements.find((element) => element.id === node.elementRef)?.domain);
    expect(domains.every((domain) => domain === 'domain-technology')).toBe(true);
  });

  it('adds group labels when grouping by domain', () => {
    const config = { ...defaultConfigFor('solution-architecture'), groupBy: 'domain' as const };
    const result = buildConfiguredView(model, config);
    expect(result.view.nodes.some((node) => node.type === 'Label')).toBe(true);
    expect(result.stats.groups).toBeGreaterThan(1);
  });

  it('stores the recipe on the generated view', () => {
    const config = defaultConfigFor('deployment');
    const result = buildConfiguredView(model, config);
    expect(result.view.config).toEqual(config);
    expect(result.view.name[0].value).toContain('L3');
  });
});

describe('displayed attributes', () => {
  it('resolves built-ins and properties such as version and ip', () => {
    const portal = model.elements.find((element) => element.id === 'e-portal')!;
    const server = model.elements.find((element) => element.id === 'e-server')!;

    const portalAttributes = elementAttributes(model.domains, portal, [
      'type',
      'domain',
      'version',
      'owner',
      'ip',
    ]);
    expect(portalAttributes.find((item) => item.key === 'version')?.value).toBe('2.4.1');
    expect(portalAttributes.find((item) => item.key === 'domain')?.value).toBe('Application');
    expect(portalAttributes.find((item) => item.key === 'ip')).toBeUndefined();

    const serverAttributes = elementAttributes(model.domains, server, ['ip', 'version']);
    expect(serverAttributes.find((item) => item.key === 'ip')?.value).toBe('10.0.1.10');
  });
});

describe('viewpoint catalog', () => {
  it('covers the main stakeholder concerns', () => {
    const ids = VIEWPOINT_CATALOG.map((viewpoint) => viewpoint.id);
    expect(ids).toContain('capability-landscape');
    expect(ids).toContain('deployment');
    expect(ids).toContain('infrastructure');
    expect(ids).toContain('dependency-impact');
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it('every viewpoint has a stakeholder, granulation, and attributes', () => {
    for (const viewpoint of VIEWPOINT_CATALOG) {
      expect(viewpoint.stakeholderId).toBeTruthy();
      expect(['L1', 'L2', 'L3', 'L4']).toContain(viewpoint.granulation);
      expect(viewpoint.attributes.length).toBeGreaterThan(0);
    }
  });
});
