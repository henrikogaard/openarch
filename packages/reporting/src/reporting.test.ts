import { primaryText } from '@openarch/core';
import type { Model } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import {
  STANDARDS_PACKS,
  applyStandardsPack,
  checkRules,
  exportPortfolioHtml,
  exportPortfolioMarkdown,
  exportWorkspaceHtml,
  exportWorkspaceMarkdown,
  parseRules,
} from './index';

const model: Model = {
  id: 'model-payments',
  name: [{ lang: 'en', value: 'Payments Architecture' }],
  documentation: [{ lang: 'en', value: 'Payments reference architecture.' }],
  properties: [],
  propertyDefinitions: [],
  purpose: 'as-is',
  status: 'active',
  owner: 'Architecture Team',
  tags: ['payments', 'core'],
  domains: [
    { id: 'domain-payments', name: 'Payments', owner: 'Payments Team' },
    { id: 'domain-platform', name: 'Platform' },
  ],
  elements: [
    {
      id: 'e-portal',
      type: 'ApplicationComponent',
      name: [{ lang: 'en', value: 'Payments Portal' }],
      documentation: [],
      properties: [],
      domain: 'domain-payments',
      environment: 'prod',
    },
    {
      id: 'e-api',
      type: 'ApplicationComponent',
      name: [{ lang: 'en', value: 'Payments API' }],
      documentation: [],
      properties: [{ key: 'owner', value: 'Payments Team' }],
      domain: 'domain-payments',
      environment: 'prod',
    },
    {
      id: 'e-server',
      type: 'Node',
      name: [{ lang: 'en', value: 'Application Server' }],
      documentation: [],
      properties: [],
      domain: 'domain-platform',
      environment: 'prod',
    },
    {
      id: 'e-capability',
      type: 'Capability',
      name: [{ lang: 'en', value: 'Payment Processing' }],
      documentation: [],
      properties: [],
      domain: 'domain-payments',
    },
    {
      id: 'e-process',
      type: 'BusinessProcess',
      name: [{ lang: 'en', value: 'Process Payment' }],
      documentation: [],
      properties: [],
      domain: 'domain-payments',
    },
    {
      id: 'e-unowned',
      type: 'ApplicationComponent',
      name: [{ lang: 'en', value: 'Legacy Batch' }],
      documentation: [],
      properties: [],
    },
    {
      id: 'e-script',
      type: 'ApplicationComponent',
      name: [{ lang: 'en', value: '<script>alert("x")</script>' }],
      documentation: [],
      properties: [],
      domain: 'domain-payments',
      environment: 'prod',
    },
  ],
  relationships: [
    {
      id: 'r-realize',
      type: 'Realization',
      source: 'e-api',
      target: 'e-capability',
      name: [],
      documentation: [],
      properties: [],
    },
    {
      id: 'r-serve',
      type: 'Serving',
      source: 'e-process',
      target: 'e-portal',
      name: [],
      documentation: [],
      properties: [],
    },
    {
      id: 'r-assign',
      type: 'Assignment',
      source: 'e-portal',
      target: 'e-process',
      name: [],
      documentation: [],
      properties: [],
    },
  ],
  views: [
    {
      id: 'view-overview',
      type: 'Diagram',
      name: [{ lang: 'en', value: 'Overview' }],
      nodes: [
        {
          id: 'n1',
          type: 'Element',
          elementRef: 'e-portal',
          label: [],
          bounds: { x: 40, y: 40, w: 160, h: 60 },
        },
        {
          id: 'n2',
          type: 'Element',
          elementRef: 'e-api',
          label: [],
          bounds: { x: 260, y: 40, w: 160, h: 60 },
        },
        {
          id: 'n3',
          type: 'Element',
          elementRef: 'e-capability',
          label: [],
          bounds: { x: 480, y: 40, w: 160, h: 60 },
        },
      ],
      edges: [
        {
          id: 'ed1',
          type: 'Relationship',
          relationshipRef: 'r-realize',
          source: 'n2',
          target: 'n3',
          bendpoints: [],
        },
      ],
    },
  ],
  artefacts: [
    {
      id: 'adr-1',
      kind: 'adr',
      title: 'ADR-001 Payments platform',
      body: '## Context\n\nUse a shared payments platform.',
      status: 'accepted',
      elementIds: ['e-portal'],
      author: 'A. Architect',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  updatedAt: '2026-01-03T00:00:00.000Z',
};

const secondModel: Model = {
  id: 'model-claims',
  name: [{ lang: 'en', value: 'Claims Architecture' }],
  documentation: [],
  properties: [],
  propertyDefinitions: [],
  purpose: 'to-be',
  status: 'draft',
  owner: 'Claims Team',
  tags: [],
  domains: [{ id: 'domain-claims', name: 'Claims' }],
  elements: [
    {
      id: 'e-claims',
      type: 'ApplicationComponent',
      name: [{ lang: 'en', value: 'Claims Engine' }],
      documentation: [],
      properties: [{ key: 'owner', value: 'Claims Team' }],
      domain: 'domain-claims',
      environment: 'staging',
    },
  ],
  relationships: [],
  views: [],
  artefacts: [],
  updatedAt: '2026-02-01T00:00:00.000Z',
};

describe('workspace Markdown report', () => {
  it('contains the model name, a domain, an element, and an artefact title', () => {
    const markdown = exportWorkspaceMarkdown(model);

    expect(markdown).toContain('# Payments Architecture');
    expect(markdown).toContain('Payments');
    expect(markdown).toContain('Payments Portal');
    expect(markdown).toContain('ADR-001 Payments platform');
    expect(markdown).toContain('## Domains');
    expect(markdown).toContain('## Validation');
  });
});

describe('workspace HTML report', () => {
  it('is a complete document with an inline SVG and escaped user text', () => {
    const html = exportWorkspaceHtml(model);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<svg');
    expect(html).toContain('@media print');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});

describe('portfolio reports', () => {
  it('contains a row per workspace in Markdown', () => {
    const markdown = exportPortfolioMarkdown([model, secondModel]);

    expect(markdown).toContain('## Workspaces');
    expect(markdown).toContain('| Payments Architecture |');
    expect(markdown).toContain('| Claims Architecture |');
    expect(markdown).toContain('## TIME portfolio');
  });

  it('renders a standalone HTML document', () => {
    const html = exportPortfolioHtml([model, secondModel]);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Claims Architecture');
    expect(html).toContain('TIME portfolio');
  });
});

describe('rule engine', () => {
  it('flags an ApplicationComponent without an owner property', () => {
    const issues = checkRules(model);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'rule.app-owner', entityId: 'e-portal' }),
        expect.objectContaining({ rule: 'rule.app-owner', entityId: 'e-unowned' }),
      ]),
    );
  });

  it('flags an element without a domain', () => {
    const issues = checkRules(model);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'rule.element-domain', entityId: 'e-unowned' }),
      ]),
    );
  });

  it('supports custom element-missing-property rules', () => {
    const issues = checkRules(model, [
      {
        id: 'capability-owner',
        description: 'Capabilities need an owner.',
        severity: 'warning',
        type: 'element-missing-property',
        params: { elementType: 'Capability', property: 'owner' },
      },
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        rule: 'rule.capability-owner',
        entityId: 'e-capability',
      }),
    ]);
  });
});

describe('parseRules', () => {
  it('accepts an array and an object wrapper', () => {
    const rules = [
      {
        id: 'max',
        description: 'Keep the workspace reviewable.',
        severity: 'warning',
        type: 'max-elements',
        params: { max: 10 },
      },
    ];

    expect(parseRules(JSON.stringify(rules))).toHaveLength(1);
    expect(parseRules(JSON.stringify({ rules }))).toHaveLength(1);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseRules('{')).toThrow(/Invalid rules JSON/);
  });

  it('rejects invalid rule shapes', () => {
    expect(() => parseRules('{"rules":{}}')).toThrow(/Invalid rules JSON/);
    expect(() => parseRules(JSON.stringify([{ id: 'x' }]))).toThrow(/description/);
    expect(() =>
      parseRules(
        JSON.stringify([
          { id: 'x', description: 'd', severity: 'fatal', type: 'max-elements' },
        ]),
      ),
    ).toThrow(/severity/);
    expect(() =>
      parseRules(
        JSON.stringify([
          { id: 'x', description: 'd', severity: 'warning', type: 'not-a-rule' },
        ]),
      ),
    ).toThrow(/type/);
  });
});

describe('standards packs', () => {
  it('adds requirements and a Compliance domain without mutating the input', () => {
    const pack = STANDARDS_PACKS.find((candidate) => candidate.id === 'nist-csf');
    expect(pack).toBeDefined();

    const beforeElements = model.elements.length;
    const beforeDomains = model.domains?.length ?? 0;
    const next = applyStandardsPack(model, 'nist-csf');

    expect(next).not.toBe(model);
    expect(next.elements.length).toBe(beforeElements + (pack?.requirements.length ?? 0));
    expect(next.domains?.some((domain) => domain.name === 'Compliance')).toBe(true);
    expect(
      next.views.some((view) => primaryText(view.name) === 'Compliance – nist-csf'),
    ).toBe(true);

    const requirement = next.elements.find(
      (element) => element.id === 'req-nist-csf-governance',
    );
    expect(requirement).toMatchObject({ type: 'Requirement' });
    expect(primaryText(requirement?.documentation ?? [])).toBe(
      pack?.requirements[0]?.description,
    );
    expect(requirement?.properties).toEqual([
      { key: 'standard', value: 'nist-csf' },
      { key: 'control', value: 'governance' },
    ]);

    expect(model.elements.length).toBe(beforeElements);
    expect(model.domains?.length).toBe(beforeDomains);
    expect(model.domains?.some((domain) => domain.name === 'Compliance')).toBe(false);
    expect(
      model.views.some((view) => primaryText(view.name).startsWith('Compliance')),
    ).toBe(false);
  });

  it('rejects an unknown pack', () => {
    expect(() => applyStandardsPack(model, 'unknown')).toThrow(/Unknown standards pack/);
  });
});
