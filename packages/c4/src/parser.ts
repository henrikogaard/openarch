import type { C4Element, C4Model, C4Relationship, C4View } from './types';

const KINDS = ['person', 'softwareSystem', 'container', 'component'] as const;
type Kind = (typeof KINDS)[number];

function unquote(value: string): string {
  return value.replace(/^"|"$/g, '');
}

/** Split a line into tokens, respecting double-quoted strings. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    tokens.push(match[1] !== undefined ? `"${match[1]}"` : match[2]);
  }
  return tokens;
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  const slash = line.indexOf('//');
  const cut = [hash, slash].filter((index) => index >= 0);
  return (cut.length ? line.slice(0, Math.min(...cut)) : line).trim();
}

function camelId(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || 'element';
}

/**
 * Parse the pragmatic subset of the Structurizr DSL used in practice:
 * workspace/model/views blocks, element declarations (`id = kind "name" "desc" "tags"`),
 * relationships (`a -> b "label" "technology"`), and view blocks with element /
 * relationship / `include *` statements.
 */
export function parseStructurizr(dsl: string): C4Model {
  const model: C4Model = { name: 'Workspace', description: '', elements: [], relationships: [], views: [] };
  const lines = dsl.split('\n').map(stripComment).filter((line) => line.length > 0);

  // Scope stack: 'workspace' | 'model' | view key
  const scope: string[] = [];
  let currentView: C4View | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\{/g, ' { ').replace(/\}/g, ' } ').trim();
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;
    const hasOpen = tokens.includes('{');
    const hasClose = tokens.includes('}');
    const body = tokens.filter((token) => token !== '{' && token !== '}');
    if (body.length === 0) {
      if (hasClose) {
        scope.pop();
        currentView = null;
      }
      continue;
    }

    const head = body[0];

    if (head === 'workspace') {
      if (body[1]) model.name = unquote(body[1]);
      if (body[2]) model.description = unquote(body[2]);
      if (hasOpen) scope.push('workspace');
      continue;
    }
    if (head === 'model') {
      if (hasOpen) scope.push('model');
      continue;
    }
    if (head === 'views') {
      if (hasOpen) scope.push('views');
      continue;
    }

    // View declaration: systemContext <scope>? "key" "desc"? { ... }
    if (['systemContext', 'container', 'component', 'dynamic', 'deployment'].includes(head)) {
      const rest = body.slice(1);
      const viewScope = rest.length && !rest[0].startsWith('"') ? rest[0] : undefined;
      const quoted = (viewScope ? rest.slice(1) : rest).filter((token) => token.startsWith('"'));
      const view: C4View = {
        kind: head as C4View['kind'],
        scope: viewScope,
        key: quoted[0] ? unquote(quoted[0]) : 'view',
        description: quoted[1] ? unquote(quoted[1]) : '',
        elements: [],
        relationships: [],
      };
      model.views.push(view);
      if (hasOpen) {
        scope.push(`view:${view.key}`);
        currentView = view;
      }
      continue;
    }

    // Relationship: a -> b "label" "technology"?
    const arrow = body.indexOf('->');
    if (arrow > 0) {
      const source = body[arrow - 1];
      const target = body[arrow + 1];
      if (!source || !target) continue;
      const quoted = body.slice(arrow + 2).filter((token) => token.startsWith('"'));
      const relationship: C4Relationship = {
        source,
        target,
        label: quoted[0] ? unquote(quoted[0]) : '',
        technology: quoted[1] ? unquote(quoted[1]) : undefined,
      };
      if (currentView) {
        currentView.relationships.push({ source, target });
        for (const id of [source, target]) if (!currentView.elements.includes(id)) currentView.elements.push(id);
      } else {
        model.relationships.push(relationship);
      }
      continue;
    }

    // include * / include a b ...
    if (head === 'include' && currentView) {
      const rest = body.slice(1);
      if (rest.includes('*')) {
        for (const element of model.elements) if (!currentView.elements.includes(element.id)) currentView.elements.push(element.id);
        for (const relationship of model.relationships) currentView.relationships.push({ source: relationship.source, target: relationship.target });
      } else {
        for (const id of rest) if (!currentView.elements.includes(id)) currentView.elements.push(id);
      }
      continue;
    }

    // Element declaration: [id =] kind ["name"] ["desc"] ["tags"]  (also: kind id "name" ...)
    let index = 0;
    let id: string | undefined;
    if (body[1] === '=') {
      id = body[0];
      index = 2;
    }
    const kind = body[index];
    if (!KINDS.includes(kind as Kind)) continue;
    const rest = body.slice(index + 1);
    // Form A: kind "name" "desc" "tags"   Form B: kind id "name" "desc"
    let elementId = id;
    let strings = rest;
    if (rest.length && !rest[0].startsWith('"')) {
      elementId = rest[0];
      strings = rest.slice(1);
    }
    const quoted = strings.filter((token) => token.startsWith('"'));
    const element: C4Element = {
      id: elementId ?? camelId(unquote(quoted[0] ?? kind)),
      kind: kind as Kind,
      name: unquote(quoted[0] ?? kind),
      description: quoted[1] ? unquote(quoted[1]) : '',
      tags: quoted[2] ? unquote(quoted[2]) : undefined,
    };
    model.elements.push(element);
    if (currentView && !currentView.elements.includes(element.id)) currentView.elements.push(element.id);
    if (hasOpen) scope.push(`element:${element.id}`);
  }

  // Views with no explicit elements fall back to all elements (context views).
  for (const view of model.views) {
    if (view.elements.length === 0 && view.kind === 'systemContext') {
      view.elements = model.elements.map((element) => element.id);
      view.relationships = model.relationships.map((r) => ({ source: r.source, target: r.target }));
    }
  }
  return model;
}
