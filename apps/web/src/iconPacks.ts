import type { ArchiElement } from '@openarch/core';

export interface IconPackRule {
  /** Match on the element's properties (e.g. iacKind, provider) or name keywords. */
  match: (element: ArchiElement) => boolean;
  glyph: string;
  color: string;
  label: string;
}

export interface IconPack {
  id: string;
  label: string;
  rules: IconPackRule[];
}

const prop = (element: ArchiElement, key: string) =>
  element.properties.find((property) => property.key === key)?.value ?? '';

/**
 * View-level icon packs (never metamodel changes): they only restyle canvas
 * nodes whose properties/name match a rule. ArchiMate notation stays default.
 */
export const ICON_PACKS: IconPack[] = [
  {
    id: 'archimate',
    label: 'ArchiMate notation',
    rules: [],
  },
  {
    id: 'aws',
    label: 'AWS-style',
    rules: [
      { match: (e) => /ec2|instance|server/i.test(prop(e, 'iacKind') + ' ' + prop(e, 'iacAddress')), glyph: '▣', color: '#ff9900', label: 'Compute' },
      { match: (e) => /rds|database|db/i.test(prop(e, 'iacKind') + ' ' + prop(e, 'iacAddress')), glyph: '⛁', color: '#3b4859', label: 'Database' },
      { match: (e) => /s3|bucket|storage/i.test(prop(e, 'iacKind') + ' ' + prop(e, 'iacAddress')), glyph: '▤', color: '#7aa116', label: 'Storage' },
      { match: (e) => /lambda|function/i.test(prop(e, 'iacKind')), glyph: 'λ', color: '#ff9900', label: 'Function' },
      { match: (e) => /vpc|network|subnet/i.test(prop(e, 'iacKind') + ' ' + prop(e, 'iacAddress')), glyph: '⌗', color: '#7aa116', label: 'Network' },
      { match: (e) => /api|gateway|elb|lb/i.test(prop(e, 'iacKind')), glyph: '⇄', color: '#dd3b8d', label: 'Gateway' },
    ],
  },
  {
    id: 'azure',
    label: 'Azure-style',
    rules: [
      { match: (e) => /vm|instance/i.test(prop(e, 'iacKind') + ' ' + prop(e, 'iacAddress')), glyph: '▣', color: '#0078d4', label: 'VM' },
      { match: (e) => /sql|database/i.test(prop(e, 'iacKind')), glyph: '⛁', color: '#0078d4', label: 'Database' },
      { match: (e) => /storage|blob/i.test(prop(e, 'iacKind')), glyph: '▤', color: '#0078d4', label: 'Storage' },
      { match: (e) => /vnet|network/i.test(prop(e, 'iacKind')), glyph: '⌗', color: '#50e6ff', label: 'Network' },
      { match: (e) => /function/i.test(prop(e, 'iacKind')), glyph: 'λ', color: '#0078d4', label: 'Function' },
    ],
  },
  {
    id: 'gcp',
    label: 'GCP-style',
    rules: [
      { match: (e) => /gce|compute/i.test(prop(e, 'iacKind') + ' ' + prop(e, 'iacAddress')), glyph: '▣', color: '#4285f4', label: 'Compute' },
      { match: (e) => /sql|database/i.test(prop(e, 'iacKind')), glyph: '⛁', color: '#4285f4', label: 'Database' },
      { match: (e) => /gcs|storage|bucket/i.test(prop(e, 'iacKind')), glyph: '▤', color: '#fbbc04', label: 'Storage' },
      { match: (e) => /vpc|network/i.test(prop(e, 'iacKind')), glyph: '⌗', color: '#34a853', label: 'Network' },
      { match: (e) => /function|cloud run/i.test(prop(e, 'iacKind')), glyph: 'λ', color: '#4285f4', label: 'Function' },
    ],
  },
];

export function iconFor(packId: string, element: ArchiElement): IconPackRule | undefined {
  const pack = ICON_PACKS.find((candidate) => candidate.id === packId);
  if (!pack) return undefined;
  return pack.rules.find((rule) => rule.match(element));
}
