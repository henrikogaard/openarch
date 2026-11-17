import { describe, expect, it } from 'vitest';
import {
  allowedRelationships,
  buildMatrix,
  buildPresetMatrix,
  createSampleModel,
  diffModels,
  ELEMENT_TYPES,
  filterModelByViewpoint,
  impactAnalysis,
  isAllowedRelationship,
  MATRIX_PRESETS,
  primaryText,
  registerPlugin,
  RELATIONSHIP_TYPES,
  searchModel,
  traceElements,
  validateModel,
  validateWithPlugins,
  VIEWPOINTS,
} from './index';

describe('full metamodel', () => {
  it('covers the ArchiMate 3.2 element and relationship set', () => {
    expect(ELEMENT_TYPES.length).toBeGreaterThanOrEqual(55);
    // AOEF 3.x defines exactly 11 relationship types; junctions are elements.
    expect(RELATIONSHIP_TYPES.length).toBe(11);
    expect(new Set(ELEMENT_TYPES.map((type) => type.id)).size).toBe(ELEMENT_TYPES.length);
    expect(ELEMENT_TYPES.some((type) => type.id === 'DistributionNetwork')).toBe(true);
    expect(ELEMENT_TYPES.some((type) => type.id === 'Stakeholder')).toBe(true);
  });

  it('rejects invalid AOEF element types and includes the junctions', () => {
    const ids = ELEMENT_TYPES.map((type) => type.id);
    expect(ids).not.toContain('Junction');
    expect(ids).toContain('AndJunction');
    expect(ids).toContain('OrJunction');
    expect(ids).toContain('Path');
  });

  it('keeps the magic connector rules coherent', () => {
    const suggestions = allowedRelationships('BusinessProcess', 'DataObject');
    expect(suggestions.map((type) => type.id)).toContain('Access');
    expect(suggestions.map((type) => type.id)).toContain('Flow');
    expect(allowedRelationships('Goal', 'Node').map((type) => type.id)).toContain('Influence');
  });
});

describe('core validation', () => {
  it('flags illegal relationships, not just AI writes', () => {
    const model = createSampleModel();
    model.relationships.push({
      id: 'illegal',
      type: 'Access',
      source: 'e-customer',
      target: 'e-claim',
      name: [],
      documentation: [],
      properties: [],
    });
    const issues = validateModel(model);
    expect(issues.some((issue) => issue.rule === 'relationship.not-allowed')).toBe(true);
  });

  it('allows same-type relationships but rejects self-loops', () => {
    expect(isAllowedRelationship('Composition', 'Capability', 'Capability')).toBe(true);
    expect(isAllowedRelationship('Serving', 'ApplicationComponent', 'ApplicationComponent')).toBe(true);

    const model = createSampleModel();
    model.relationships.push({
      id: 'self-loop',
      type: 'Serving',
      source: 'e-portal',
      target: 'e-portal',
      name: [],
      documentation: [],
      properties: [],
    });
    expect(validateModel(model).some((issue) => issue.rule === 'relationship.self')).toBe(true);
  });

  it('flags unknown relationship types', () => {
    const model = createSampleModel();
    model.relationships.push({
      id: 'unknown',
      type: 'NotARelationship',
      source: 'e-customer',
      target: 'e-claim',
      name: [],
      documentation: [],
      properties: [],
    });
    const issues = validateModel(model);
    expect(issues.some((issue) => issue.rule === 'relationship.unknown-type')).toBe(true);
  });
});

describe('viewpoints', () => {
  it('provides a broad viewpoint library', () => {
    expect(VIEWPOINTS.length).toBeGreaterThanOrEqual(20);
  });

  it('filters a model without mutating the original', () => {
    const model = createSampleModel();
    const filtered = filterModelByViewpoint(model, 'application-structure');
    expect(model.elements.length).toBeGreaterThan(filtered.elements.length);
    expect(filtered.elements.every((element) => element.type.startsWith('Application') || element.type === 'DataObject')).toBe(true);
    expect(filtered.views[0].nodes.length).toBeLessThanOrEqual(model.views[0].nodes.length);
  });
});

describe('analysis', () => {
  const model = createSampleModel();

  it('traces relationships in both directions', () => {
    const traces = traceElements(model, 'e-portal', { maxDepth: 2 });
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.some((trace) => trace.element.id === 'e-insurance')).toBe(true);
  });

  it('computes impact and matrices', () => {
    expect(impactAnalysis(model, 'e-portal').length).toBeGreaterThan(0);
    expect(MATRIX_PRESETS.length).toBe(3);
    const preset = buildPresetMatrix(model, 'process-application');
    expect(preset?.rows.length).toBeGreaterThan(0);
    const matrix = buildMatrix(model, 'Process × App service', 'BusinessProcess', 'ApplicationService', ['Serving']);
    expect(matrix.cells.length).toBeGreaterThan(0);
  });

  it('searches elements', () => {
    expect(searchModel(model, 'claim').length).toBeGreaterThan(0);
  });
});

describe('diff', () => {
  it('detects additions, removals, and changes', () => {
    const before = createSampleModel();
    const after = structuredClone(before);
    after.elements.push({
      id: 'new-element',
      type: 'Goal',
      name: [{ lang: 'en', value: 'Improve claims' }],
      documentation: [],
      properties: [],
    });
    after.elements[0].name = [{ lang: 'en', value: 'Customer renamed' }];
    after.relationships.pop();
    const diff = diffModels(before, after);
    expect(diff.addedElements).toContain('new-element (Improve claims)');
    expect(diff.changedElements.some((change) => change.entityId === 'e-customer')).toBe(true);
    expect(diff.removedRelationships.length).toBe(1);
  });
});

describe('plugins', () => {
  it('runs custom validators alongside built-in ones', () => {
    registerPlugin({
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      validators: [
        (model) =>
          primaryText(model.name).includes('Sample')
            ? [{ severity: 'info', rule: 'custom.sample', message: 'Sample model detected' }]
            : [],
      ],
    });
    expect(validateWithPlugins(createSampleModel()).some((issue) => issue.rule === 'custom.sample')).toBe(
      true,
    );
  });
});
