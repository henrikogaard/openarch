import { createSampleModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import { modelToMarkdown, modelToYaml } from './context';
import { PROMPTS, renderPrompt } from './prompts';
import { SAFETY_PREFIX, sanitizeAiText, suggestRelationshipTypes, validateAiModel } from './guardrails';

describe('modelToMarkdown', () => {
  const model = createSampleModel();

  it('contains element names and relationship information', () => {
    const markdown = modelToMarkdown(model);
    expect(markdown).toContain('Customer');
    expect(markdown).toContain('Claims Portal');
    expect(markdown).toContain('Assignment');
    expect(markdown).toContain('view-overview');
  });

  it('caps output with a truncation marker', () => {
    const markdown = modelToMarkdown(model, 200);
    expect(markdown).toContain('… [truncated]');
    expect(markdown.length).toBeLessThanOrEqual(200);
  });

  it('quotes YAML scalars containing a colon or hash', () => {
    const modelWithText = createSampleModel();
    modelWithText.elements[0].name = [{ lang: 'en', value: 'Cost: #1 customer' }];
    expect(modelToYaml(modelWithText)).toContain('"Cost: #1 customer"');
  });
});

describe('sanitizeAiText', () => {
  it('prepends the safety prefix and strips control characters', () => {
    const result = sanitizeAiText('hello\u0000\u0007world\nnext');
    expect(result.startsWith(SAFETY_PREFIX)).toBe(true);
    expect(result).toContain('helloworld\nnext');
    expect(result).not.toContain('\u0000');
  });

  it('caps output at 40000 characters', () => {
    expect(sanitizeAiText('x'.repeat(50000)).length).toBe(40000);
  });
});

describe('validateAiModel', () => {
  it('accepts the sample model without error-severity issues', () => {
    expect(validateAiModel(createSampleModel()).filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('catches an illegal relationship with an actionable suggestion', () => {
    const model = createSampleModel();
    // BusinessActor -> BusinessProcess cannot be a Triggering relationship.
    const relationship = model.relationships.find((item) => item.id === 'r-assign-1');
    expect(relationship).toBeDefined();
    relationship!.type = 'Triggering';

    const issues = validateAiModel(model);
    const illegal = issues.find((issue) => issue.rule === 'ai.relationship.illegal-type');
    expect(illegal).toBeDefined();
    expect(illegal?.severity).toBe('error');
    expect(illegal?.suggestion).toBeTruthy();
  });

  it('warns about duplicate names and suggests alternatives', () => {
    const model = createSampleModel();
    model.elements[1].name = [{ lang: 'en', value: 'Customer' }];
    const duplicate = validateAiModel(model).find((issue) => issue.rule === 'ai.element.duplicate-name');
    expect(duplicate?.severity).toBe('warning');
    expect(duplicate?.suggestion).toBeTruthy();
  });

  it('returns allowed relationship types for a source/target pair', () => {
    expect(suggestRelationshipTypes('BusinessActor', 'BusinessProcess').map((item) => item.id)).toContain(
      'Assignment',
    );
  });
});

describe('PROMPTS', () => {
  it('defines at least five prompts', () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(5);
    expect(PROMPTS.map((prompt) => prompt.name)).toContain('model_from_description');
  });

  it('renders argument placeholders', () => {
    const rendered = renderPrompt('explain_element', { elementId: 'e-customer' });
    expect(rendered.description).toContain('element');
    expect(rendered.messages.some((message) => message.content.text.includes('e-customer'))).toBe(true);
  });
});
