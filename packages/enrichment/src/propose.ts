import {
  getElementType,
  getRelationshipType,
  isAllowedRelationship,
  primaryText,
  type ArchiElement,
  type Model,
  type Relationship,
} from '@openarch/core';
import type { EnrichmentResult, Proposal, RawResource } from './types';

const FALLBACK_TYPE = 'ApplicationComponent';

interface InferenceRule {
  type: string;
  extensions: string[];
  words: string[];
  hint: string;
}

/** Ordered by specificity; the first rule wins ties so behaviour is deterministic. */
const RULES: InferenceRule[] = [
  {
    type: 'ApplicationComponent',
    extensions: ['java', 'ts', 'js', 'cs', 'go'],
    words: ['service', 'api', 'controller', 'component', 'module'],
    hint: 'application code / component',
  },
  {
    type: 'DataObject',
    extensions: ['sql', 'json', 'csv'],
    words: ['table', 'schema', 'model', 'dto', 'entity'],
    hint: 'data / schema',
  },
  {
    type: 'Node',
    extensions: ['yaml', 'yml', 'tf', 'config'],
    words: ['config', 'deploy', 'infra', 'server', 'host', 'cluster'],
    hint: 'infrastructure / deployment',
  },
  {
    type: 'BusinessActor',
    extensions: [],
    words: ['actor', 'user', 'role', 'team', 'person'],
    hint: 'actor / people',
  },
  {
    type: 'BusinessProcess',
    extensions: [],
    words: ['process', 'flow', 'workflow', 'job'],
    hint: 'process / workflow',
  },
  {
    type: 'Goal',
    extensions: [],
    words: ['goal', 'objective', 'driver', 'outcome'],
    hint: 'goal / objective',
  },
  {
    type: 'Capability',
    extensions: [],
    words: ['capability'],
    hint: 'capability',
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(haystack);
}

function resourceHaystack(resource: RawResource): string {
  return [resource.key, ...Object.values(resource.fields)].join(' ').toLowerCase();
}

function displayName(resource: RawResource): string {
  const named = resource.fields.name?.trim();
  if (named) return named;
  const parts = resource.key.split(/[\\/]/);
  return parts[parts.length - 1] || resource.key;
}

function description(resource: RawResource): string {
  const value = resource.fields.description ?? resource.fields.documentation;
  if (value?.trim()) return value.trim();
  return `Enriched from ${resource.source} resource "${resource.key}".`;
}

interface Inference {
  type: string;
  confidence: number;
  reason: string;
}

/** Infer a valid ArchiMate element type and a confidence score for a resource. */
function infer(resource: RawResource): Inference {
  const haystack = resourceHaystack(resource);
  const ext = (resource.fields.ext ?? '').toLowerCase().replace(/^\./, '');
  const key = resource.key.toLowerCase();

  let best: Inference | undefined;
  let bestScore = 0;
  for (const rule of RULES) {
    const extMatch =
      rule.extensions.length > 0 &&
      (rule.extensions.includes(ext) || rule.extensions.some((e) => key.endsWith(`.${e}`)));
    const words = rule.words.filter((word) => containsWord(haystack, word));
    const score = (extMatch ? 10 : 0) + words.length;
    if (score === 0 || score < bestScore) continue;

    const signal =
      extMatch
        ? `File extension .${ext}`
        : words.length > 1
          ? `Keywords ${words.map((word) => `'${word}'`).join(', ')}`
          : `Keyword '${words[0]}'`;
    const rawType = getElementType(rule.type) ? rule.type : FALLBACK_TYPE;
    const confidence = extMatch
      ? Math.min(0.95, 0.9 + (words.length ? 0.05 : 0))
      : Math.min(0.85, 0.55 + 0.1 * words.length);
    const candidate: Inference = {
      type: rawType,
      confidence,
      reason: `${signal} suggests ${rule.hint}.`,
    };
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best ?? {
    type: FALLBACK_TYPE,
    confidence: 0.4,
    reason: 'No specific signal; defaulting to application component.',
  };
}

/**
 * Turn raw resources into reviewable element proposals. Resources whose key or
 * name already matches an existing element (case-insensitive) are skipped, so
 * re-running enrichment against the enriched model yields no new proposals.
 */
export function proposeElements(model: Model, resources: RawResource[]): Proposal[] {
  const existing = new Set<string>();
  for (const element of model.elements) {
    existing.add(element.id.toLowerCase());
    existing.add(primaryText(element.name).toLowerCase());
  }

  const proposals: Proposal[] = [];
  for (const resource of resources) {
    const name = displayName(resource);
    if (existing.has(resource.key.toLowerCase()) || existing.has(name.toLowerCase())) continue;
    const inference = infer(resource);
    proposals.push({
      id: resource.key,
      type: inference.type,
      name,
      documentation: description(resource),
      source: resource.source,
      confidence: inference.confidence,
      reason: inference.reason,
    });
  }
  return proposals;
}

/** Convert a proposal into a stable, deterministic ArchiMate element. */
/** Convert proposals into stable, deterministic ArchiMate elements.
 * Slugs can collide across different keys (`a/b.ts` and `a_b.ts` both slug to
 * `a-b-ts`), so ids are disambiguated deterministically. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function proposalsToElements(proposals: Proposal[]): ArchiElement[] {
  const usedIds = new Set<string>();
  return proposals.map((proposal) => {
    let id = `enriched-${slug(proposal.id)}`;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `enriched-${slug(proposal.id)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      type: getElementType(proposal.type) ? proposal.type : FALLBACK_TYPE,
      name: [{ lang: 'en', value: proposal.name }],
      documentation: proposal.documentation ? [{ lang: 'en', value: proposal.documentation }] : [],
      properties: [
        { key: 'source', value: proposal.source },
        { key: 'enrichmentReason', value: proposal.reason },
        { key: 'enrichmentConfidence', value: String(proposal.confidence) },
      ],
    };
  });
}

const MAX_RELATIONSHIPS = 40;

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);
}

/**
 * Best-effort relationships between the proposed elements and the rest of the
 * model. Two elements sharing a meaningful name token get an Association;
 * ApplicationComponent → DataObject becomes Access and ApplicationComponent →
 * Node becomes Assignment when ArchiMate permits it. Results are capped,
 * de-duplicated and limited to valid relationship types.
 */
export function proposeRelationships(
  model: Model,
  proposals: Proposal[],
  elements: ArchiElement[],
): Relationship[] {
  const relationships: Relationship[] = [];
  const seen = new Set<string>();
  const pool = [...model.elements, ...elements];
  const typeByElementId = new Map<string, string>();
  for (const element of pool) typeByElementId.set(element.id, element.type);
  const tokenByElementId = new Map<string, string[]>();
  for (const element of pool) {
    tokenByElementId.set(element.id, Array.from(new Set(tokens(primaryText(element.name)))));
  }

  const preferredType = (sourceType: string, targetType: string): string => {
    if (sourceType === 'ApplicationComponent' && targetType === 'DataObject') return 'Access';
    if (sourceType === 'ApplicationComponent' && targetType === 'Node') return 'Assignment';
    return 'Association';
  };

  for (const source of elements) {
    if (relationships.length >= MAX_RELATIONSHIPS) break;
    const sourceTokens = tokenByElementId.get(source.id) ?? [];
    if (sourceTokens.length === 0) continue;

    for (const target of pool) {
      if (relationships.length >= MAX_RELATIONSHIPS) break;
      if (target.id === source.id) continue;
      const targetTokens = tokenByElementId.get(target.id) ?? [];
      if (!sourceTokens.some((token) => targetTokens.includes(token))) continue;

      let type = preferredType(source.type, target.type);
      if (
        !getRelationshipType(type) ||
        !isAllowedRelationship(type, source.type, target.type)
      ) {
        type = 'Association';
      }
      if (!getRelationshipType(type)) continue;

      const key = `${source.id}->${target.id}:${type}`;
      const reverse = `${target.id}->${source.id}:${type}`;
      if (seen.has(key) || seen.has(reverse)) continue;
      seen.add(key);

      relationships.push({
        id: `enriched-rel-${slug(source.id)}-${slug(target.id)}`,
        type,
        source: source.id,
        target: target.id,
        name: [],
        documentation: [],
        properties: [{ key: 'source', value: source.properties[0]?.value ?? 'enrichment' }],
      });
    }
  }

  // `proposals` is accepted for API symmetry with the other pipeline stages;
  // element names/types already encode everything needed for the heuristics.
  void proposals;
  return relationships;
}

/**
 * Full pipeline over raw resources: deduped proposals plus the count of
 * skipped duplicates on one place.
 */
export function runEnrichment(model: Model, resources: RawResource[]): EnrichmentResult {
  const proposals = proposeElements(model, resources);
  return { proposals, skipped: resources.length - proposals.length };
}
