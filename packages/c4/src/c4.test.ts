import { validateModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { c4ToDsl, c4ToModel, modelToC4, parseStructurizr } from './index';

const SAMPLE = `
workspace "Internet Banking System" "Example" {
  model {
    customer = person "Customer" "A customer" "External"
    ib = softwareSystem "Internet Banking" "Provides banking" "Bank"
    web = container "Web App" "Serves pages" "React"
    api = container "API" "Business logic" "Node.js"
    db = container "Database" "Stores data" "PostgreSQL"

    customer -> ib "Uses"
    ib -> web "Contains"
    web -> api "Calls" "HTTPS"
    api -> db "Reads/writes" "JDBC"
  }
  views {
    systemContext ib "context" "System context" {
      include *
      autoLayout
    }
    container ib "containers" "Containers" {
      include *
    }
  }
}
`;

describe('Structurizr DSL bridge', () => {
  it('parses elements, relationships, and views', () => {
    const c4 = parseStructurizr(SAMPLE);
    expect(c4.name).toBe('Internet Banking System');
    expect(c4.elements.map((e) => e.id).sort()).toEqual(['api', 'customer', 'db', 'ib', 'web']);
    expect(c4.relationships.length).toBe(4);
    expect(c4.views.map((v) => v.key).sort()).toEqual(['containers', 'context']);
    const context = c4.views.find((v) => v.key === 'context')!;
    expect(context.elements.length).toBe(5);
  });

  it('maps C4 onto ArchiMate elements, relationships, and views — validation-clean', () => {
    const model = c4ToModel(parseStructurizr(SAMPLE));
    expect(model.elements.length).toBe(5);
    const customer = model.elements.find((e) => e.properties.some((p) => p.key === 'c4Kind' && p.value === 'person'))!;
    expect(customer.type).toBe('BusinessActor');
    const rel = model.relationships.find((r) => r.id === 'c4rel-customer-ib')!;
    expect(rel.type).toBe('Serving');
    expect(model.views.length).toBe(2);
    expect(model.views[0].nodes.length).toBeGreaterThan(0);
    expect(validateModel(model).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('round-trips model → DSL → model', () => {
    const model = c4ToModel(parseStructurizr(SAMPLE));
    const dsl = modelToC4(model);
    const reparsed = c4ToModel(parseStructurizr(dsl));
    expect(reparsed.elements.length).toBe(model.elements.length);
    expect(reparsed.relationships.length).toBe(model.relationships.length);
    expect(validateModel(reparsed).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('normalises parsed C4 back to DSL', () => {
    const dsl = c4ToDsl(parseStructurizr(SAMPLE));
    expect(dsl).toContain('workspace "Internet Banking System"');
    expect(dsl).toContain('customer = person "Customer"');
  });
});

describe('C4 DSL hostile-input round trips', () => {
  it('round-trips quoted names, URLs, hashes, and chained arrows', () => {
    const dsl = `
      workspace "W \"quoted\"" {
        model {
          user = person "User #1" "Uses https://api.example.com // not a comment"
          sys = softwareSystem "Sys" ""
          db = container "db" ""
          user -> sys -> db "chained" "https"
          sys -> db "reads"
          sys -> db "writes"
        }
        views {
          systemContext "ctx" "C" {
            include *
          }
        }
      }
    `;
    const parsed = parseStructurizr(dsl);
    expect(parsed.elements.map((e) => e.id).sort()).toEqual(['db', 'sys', 'user']);
    expect(parsed.elements[0].name).toBe('User #1');
    expect(parsed.elements[0].description).toContain('https://api.example.com'); // not eaten by //
    // A chain a -> b -> c yields two hops; plus reads + writes = 4 total.
    expect(parsed.relationships.length).toBe(4);
    expect(parsed.relationships[0]).toMatchObject({ source: 'user', target: 'sys' });
    expect(parsed.relationships[1]).toMatchObject({ source: 'sys', target: 'db', label: 'chained' });
    // Same-pair duplicates (reads + writes) must not collide.
    const model = c4ToModel(parsed);
    expect(model.relationships.length).toBe(4);
    expect(new Set(model.relationships.map((r) => r.id)).size).toBe(4);
  });

  it('disambiguates same-name elements across kinds instead of colliding', () => {
    const parsed = parseStructurizr(`
      workspace "W" {
        model {
          person "Customer" ""
          softwareSystem "Customer" ""
        }
      }
    `);
    expect(parsed.elements.map((e) => e.id).sort()).toEqual(['customer', 'customer-2']);
  });
});
