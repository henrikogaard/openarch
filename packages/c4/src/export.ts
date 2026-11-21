import { primaryText, type Model, type View } from '@openarch/core';
import type { C4Model } from './types';

function archiKind(type: string, properties: Array<{ key: string; value: string }>): string {
  const c4Kind = properties.find((property) => property.key === 'c4Kind')?.value;
  if (c4Kind) return c4Kind;
  if (type === 'BusinessActor') return 'person';
  return 'softwareSystem';
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Render an OpenArch model (optionally one view) as a Structurizr DSL workspace. */
export function modelToC4(model: Model, view?: View): string {
  const lines: string[] = [];
  const name = primaryText(model.name) || 'Workspace';
  const description = primaryText(model.documentation);
  lines.push(`workspace ${quote(name)}${description ? ` ${quote(description)}` : ''} {`);
  lines.push('  model {');

  const idOf = new Map<string, string>();
  model.elements.forEach((element, index) => {
    const short = `e${index + 1}`;
    idOf.set(element.id, short);
    const kind = archiKind(element.type, element.properties);
    const technology = element.properties.find((property) => property.key === 'technology')?.value;
    const elementName = primaryText(element.name) || element.id;
    lines.push(`    ${short} = ${kind} ${quote(elementName)}${technology ? ` ${quote(technology)}` : ''}`);
  });

  for (const relationship of model.relationships) {
    const source = idOf.get(relationship.source);
    const target = idOf.get(relationship.target);
    if (!source || !target) continue;
    const label = primaryText(relationship.name);
    const technology = relationship.properties.find((property) => property.key === 'technology')?.value;
    lines.push(`    ${source} -> ${target}${label ? ` ${quote(label)}` : ''}${technology ? ` ${quote(technology)}` : ''}`);
  }
  lines.push('  }');

  lines.push('  views {');
  const views = view ? [view] : model.views;
  for (const view of views) {
    const key = view.id.replace(/[^a-zA-Z0-9_-]/g, '');
    lines.push(`    systemContext ${quote(key)} ${quote(primaryText(view.name) || key)} {`);
    lines.push('      include *');
    lines.push('    }');
  }
  lines.push('  }');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** Convenience: C4Model → DSL (used to normalise parsed input). */
export function c4ToDsl(c4: C4Model): string {
  const lines: string[] = [];
  lines.push(`workspace ${quote(c4.name)}${c4.description ? ` ${quote(c4.description)}` : ''} {`);
  lines.push('  model {');
  for (const element of c4.elements) {
    lines.push(
      `    ${element.id} = ${element.kind} ${quote(element.name)}${element.description ? ` ${quote(element.description)}` : ''}${element.tags ? ` ${quote(element.tags)}` : ''}`,
    );
  }
  for (const relationship of c4.relationships) {
    lines.push(
      `    ${relationship.source} -> ${relationship.target}${relationship.label ? ` ${quote(relationship.label)}` : ''}${relationship.technology ? ` ${quote(relationship.technology)}` : ''}`,
    );
  }
  lines.push('  }');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
