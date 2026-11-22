/** A parsed Structurizr DSL workspace (pragmatic subset). */
export interface C4Element {
  id: string;
  kind: 'person' | 'softwareSystem' | 'container' | 'component';
  name: string;
  description: string;
  tags?: string;
  technology?: string;
}

export interface C4Relationship {
  source: string;
  target: string;
  label: string;
  technology?: string;
}

export interface C4View {
  key: string;
  kind: 'systemContext' | 'container' | 'component' | 'dynamic' | 'deployment';
  scope?: string; // system/container id for scoped views
  description: string;
  /** Element ids and relationship endpoints included in the view. */
  elements: string[];
  relationships: Array<{ source: string; target: string }>;
}

export interface C4Model {
  name: string;
  description: string;
  elements: C4Element[];
  relationships: C4Relationship[];
  views: C4View[];
}
