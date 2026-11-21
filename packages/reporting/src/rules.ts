import {
  applyWaivers,
  getElementType,
  getRelationshipType,
  isAllowedRelationship,
  primaryText,
} from '@openarch/core';
import type { ArchiElement, Model, ValidationIssue, Waiver } from '@openarch/core';

export type RuleType =
  | 'element-missing-property'
  | 'element-without-domain'
  | 'element-without-environment'
  | 'relationship-not-allowed'
  | 'application-without-owner'
  | 'unrealized-capability'
  | 'element-name-pattern'
  | 'max-elements';

export const RULE_TYPES: RuleType[] = [
  'element-missing-property',
  'element-without-domain',
  'element-without-environment',
  'relationship-not-allowed',
  'application-without-owner',
  'unrealized-capability',
  'element-name-pattern',
  'max-elements',
];

export interface RuleDefinition {
  id: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  type: RuleType;
  params?: Record<string, unknown>;
}

/** Governance checks suitable for CI. All rules are deterministic and offline. */
export const DEFAULT_RULES: RuleDefinition[] = [
  {
    id: 'app-owner',
    description: 'Every ApplicationComponent must have an owner property.',
    severity: 'warning',
    type: 'application-without-owner',
  },
  {
    id: 'element-domain',
    description: 'Every element must be assigned to a domain.',
    severity: 'info',
    type: 'element-without-domain',
  },
  {
    id: 'deployment-environment',
    description: 'Every ApplicationComponent and Node must declare an environment.',
    severity: 'info',
    type: 'element-without-environment',
    params: { elementTypes: ['ApplicationComponent', 'Node'] },
  },
  {
    id: 'relationship-allowed',
    description: 'Relationships must be allowed by the ArchiMate metamodel.',
    severity: 'warning',
    type: 'relationship-not-allowed',
  },
  {
    id: 'capability-realized',
    description: 'Every Capability must be realized or served by at least one element.',
    severity: 'warning',
    type: 'unrealized-capability',
  },
  {
    id: 'element-name',
    description: 'Element names must not be empty.',
    severity: 'error',
    type: 'element-name-pattern',
    params: { pattern: '\\S' },
  },
  {
    id: 'max-elements',
    description: 'A workspace must not contain more than 2000 elements.',
    severity: 'warning',
    type: 'max-elements',
    params: { max: 2000 },
  },
];

function ruleIssue(
  rule: RuleDefinition,
  message: string,
  entityId: string,
  suggestion: string,
): ValidationIssue {
  return {
    severity: rule.severity,
    rule: `rule.${rule.id}`,
    message,
    entityId,
    suggestion,
  };
}

function configIssue(rule: RuleDefinition, model: Model, message: string): ValidationIssue {
  return ruleIssue(rule, message, model.id, 'Fix the rule definition and run the check again.');
}

function displayName(element: ArchiElement): string {
  return primaryText(element.name).trim() || element.id;
}

function hasProperty(element: ArchiElement, key: string): boolean {
  const needle = key.trim().toLowerCase();
  return element.properties.some(
    (property) =>
      property.key.trim().toLowerCase() === needle && property.value.trim().length > 0,
  );
}

function stringParam(
  params: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArrayParam(
  params: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = params?.[key];
  if (!Array.isArray(value)) return undefined;
  const items: unknown[] = value;
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') return undefined;
    result.push(item);
  }
  return result;
}

function checkElementMissingProperty(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  const property = stringParam(rule.params, 'property')?.trim();
  if (!property) {
    issues.push(
      configIssue(rule, model, `Rule "${rule.id}" requires a non-empty "property" parameter.`),
    );
    return;
  }

  const elementType = stringParam(rule.params, 'elementType')?.trim();
  for (const element of model.elements) {
    if (elementType && element.type !== elementType) continue;
    if (hasProperty(element, property)) continue;
    const name = displayName(element);
    issues.push(
      ruleIssue(
        rule,
        `${element.type} "${name}" is missing required property "${property}".`,
        element.id,
        `Add a "${property}" property to "${name}".`,
      ),
    );
  }
}

function checkElementWithoutDomain(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  for (const element of model.elements) {
    if (element.domain?.trim()) continue;
    const name = displayName(element);
    issues.push(
      ruleIssue(
        rule,
        `Element "${name}" (${element.id}) is not assigned to a domain.`,
        element.id,
        'Assign the element to a domain so the workspace can be filtered and reported by area.',
      ),
    );
  }
}

function checkElementWithoutEnvironment(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  const configuredTypes = rule.params?.elementTypes;
  let elementTypes = ['ApplicationComponent', 'Node'];
  if (configuredTypes !== undefined) {
    const parsed = stringArrayParam(rule.params, 'elementTypes');
    if (!parsed) {
      issues.push(
        configIssue(
          rule,
          model,
          `Rule "${rule.id}" has an invalid "elementTypes" parameter; expected an array of element type names.`,
        ),
      );
      return;
    }
    elementTypes = parsed;
  }

  for (const element of model.elements) {
    if (!elementTypes.includes(element.type)) continue;
    if (element.environment?.trim()) continue;
    const name = displayName(element);
    issues.push(
      ruleIssue(
        rule,
        `${element.type} "${name}" has no environment.`,
        element.id,
        'Set the environment to dev, staging, prod, or a custom deployment value.',
      ),
    );
  }
}

function checkRelationshipNotAllowed(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  const elementById = new Map(model.elements.map((element) => [element.id, element]));
  for (const relationship of model.relationships) {
    const source = elementById.get(relationship.source);
    const target = elementById.get(relationship.target);
    if (!source || !target) continue;
    if (!getElementType(source.type) || !getElementType(target.type)) continue;
    if (!getRelationshipType(relationship.type)) continue;
    if (isAllowedRelationship(relationship.type, source.type, target.type)) continue;

    issues.push(
      ruleIssue(
        rule,
        `Relationship "${relationship.type}" from ${source.type} "${displayName(source)}" to ${target.type} "${displayName(target)}" is not allowed by the metamodel.`,
        relationship.id,
        'Use an allowed relationship type or change the source or target element type.',
      ),
    );
  }
}

function checkApplicationWithoutOwner(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  for (const element of model.elements) {
    if (element.type !== 'ApplicationComponent') continue;
    if (hasProperty(element, 'owner')) continue;
    const name = displayName(element);
    issues.push(
      ruleIssue(
        rule,
        `Application component "${name}" has no owner property.`,
        element.id,
        'Add an "owner" property naming the accountable team or person.',
      ),
    );
  }
}

function checkUnrealizedCapability(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  const realized = new Set<string>();
  for (const relationship of model.relationships) {
    if (relationship.type === 'Realization' || relationship.type === 'Serving') {
      realized.add(relationship.target);
    }
  }

  for (const element of model.elements) {
    if (element.type !== 'Capability') continue;
    if (realized.has(element.id)) continue;
    const name = displayName(element);
    issues.push(
      ruleIssue(
        rule,
        `Capability "${name}" has no incoming Realization or Serving relationship.`,
        element.id,
        'Add an incoming Realization or Serving relationship from the element that provides the capability.',
      ),
    );
  }
}

function checkElementNamePattern(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  const pattern = stringParam(rule.params, 'pattern');
  if (!pattern) {
    issues.push(
      configIssue(rule, model, `Rule "${rule.id}" requires a non-empty "pattern" parameter.`),
    );
    return;
  }

  const flags = stringParam(rule.params, 'flags') ?? '';
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    issues.push(
      configIssue(rule, model, `Rule "${rule.id}" has an invalid regular expression: ${detail}`),
    );
    return;
  }

  const customMessage = stringParam(rule.params, 'message');
  for (const element of model.elements) {
    const name = primaryText(element.name);
    regex.lastIndex = 0;
    if (regex.test(name)) continue;
    const label = name.trim() || element.id;
    issues.push(
      ruleIssue(
        rule,
        customMessage ??
          (name.trim()
            ? `Element "${label}" does not match the required name pattern /${pattern}/.`
            : `Element "${element.id}" has an empty name.`),
        element.id,
        `Rename the element so it matches /${pattern}/.`,
      ),
    );
  }
}

function checkMaxElements(
  model: Model,
  rule: RuleDefinition,
  issues: ValidationIssue[],
): void {
  const raw = rule.params?.max;
  let max = 2000;
  if (raw !== undefined) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      issues.push(
        configIssue(
          rule,
          model,
          `Rule "${rule.id}" has an invalid "max" parameter; expected a non-negative number.`,
        ),
      );
      return;
    }
    max = Math.floor(raw);
  }

  if (model.elements.length <= max) return;
  issues.push(
    ruleIssue(
      rule,
      `Workspace has ${model.elements.length} elements, exceeding the maximum of ${max}.`,
      model.id,
      'Split the workspace into smaller domains or raise the limit if the size is intentional.',
    ),
  );
}

/**
 * Run the rule engine. Every finding is a ValidationIssue whose `rule` is
 * prefixed with `rule.` so it can be distinguished from core validation.
 */
export function checkRules(
  model: Model,
  rules: RuleDefinition[] = DEFAULT_RULES,
  waivers: Waiver[] = model.waivers ?? [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const rule of rules) {
    switch (rule.type) {
      case 'element-missing-property':
        checkElementMissingProperty(model, rule, issues);
        break;
      case 'element-without-domain':
        checkElementWithoutDomain(model, rule, issues);
        break;
      case 'element-without-environment':
        checkElementWithoutEnvironment(model, rule, issues);
        break;
      case 'relationship-not-allowed':
        checkRelationshipNotAllowed(model, rule, issues);
        break;
      case 'application-without-owner':
        checkApplicationWithoutOwner(model, rule, issues);
        break;
      case 'unrealized-capability':
        checkUnrealizedCapability(model, rule, issues);
        break;
      case 'element-name-pattern':
        checkElementNamePattern(model, rule, issues);
        break;
      case 'max-elements':
        checkMaxElements(model, rule, issues);
        break;
    }
  }
  return applyWaivers(issues, waivers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const RULE_TYPE_SET = new Set<string>(RULE_TYPES);

/**
 * Parse a JSON rule set. Accepts either a bare array or an object with a
 * `rules` array. Throws a descriptive error for invalid JSON or rule shapes.
 */
export function parseRules(json: string): RuleDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid rules JSON: ${detail}`);
  }

  const candidate: unknown[] | undefined = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rules)
      ? parsed.rules
      : undefined;

  if (!candidate) {
    throw new Error(
      'Invalid rules JSON: expected an array of rules or an object with a "rules" array.',
    );
  }

  const rules: RuleDefinition[] = [];
  const seen = new Set<string>();

  candidate.forEach((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Invalid rule at index ${index}: expected an object.`);
    }

    const { id, description, severity, type, params } = value;
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(`Invalid rule at index ${index}: "id" must be a non-empty string.`);
    }
    const ruleId = id.trim();
    if (seen.has(ruleId)) {
      throw new Error(`Invalid rule at index ${index}: duplicate id "${ruleId}".`);
    }
    seen.add(ruleId);

    if (typeof description !== 'string' || !description.trim()) {
      throw new Error(
        `Invalid rule "${ruleId}": "description" must be a non-empty string.`,
      );
    }
    if (severity !== 'error' && severity !== 'warning' && severity !== 'info') {
      throw new Error(
        `Invalid rule "${ruleId}": "severity" must be "error", "warning", or "info".`,
      );
    }
    if (typeof type !== 'string' || !RULE_TYPE_SET.has(type)) {
      throw new Error(
        `Invalid rule "${ruleId}": "type" must be one of ${RULE_TYPES.join(', ')}.`,
      );
    }
    if (params !== undefined && !isRecord(params)) {
      throw new Error(`Invalid rule "${ruleId}": "params" must be an object.`);
    }

    const ruleSeverity = severity as RuleDefinition['severity'];
    const ruleParams = isRecord(params) ? params : undefined;

    rules.push({
      id: ruleId,
      description: description.trim(),
      severity: ruleSeverity,
      type: type as RuleType,
      ...(ruleParams ? { params: ruleParams } : {}),
    });
  });

  return rules;
}
