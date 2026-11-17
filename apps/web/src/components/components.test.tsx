// @vitest-environment jsdom
import { createSampleModel, validateModel } from '@openarch/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Catalog from './Catalog';
import Dashboard from './Dashboard';
import EamViews from './EamViews';
import Inspector from './Inspector';
import MatrixView from './MatrixView';
import ValidationPanel from './ValidationPanel';
import ViewDesigner from './ViewDesigner';
import WorkspaceHome from './WorkspaceHome';

afterEach(cleanup);

const model = createSampleModel();

describe('analysis components render the model', () => {
  it('lists elements in the catalogue', () => {
    render(<Catalog elements={model.elements} selectedElementId={null} onSelect={() => {}} />);
    expect(screen.getByText('Element catalogue')).toBeTruthy();
    expect(screen.getByText('Customer')).toBeTruthy();
    expect(screen.getByText('Claims Portal')).toBeTruthy();
  });

  it('shows live counts on the dashboard', () => {
    render(<Dashboard model={model} />);
    expect(screen.getByText('Model dashboard')).toBeTruthy();
    expect(screen.getAllByText(String(model.elements.length)).length).toBeGreaterThan(0);
  });

  it('reports validation findings', () => {
    const broken = createSampleModel();
    broken.relationships.push({
      id: 'dangling',
      type: 'Serving',
      source: 'missing',
      target: 'e-claim',
      name: [],
      documentation: [],
      properties: [],
    });
    expect(validateModel(broken).some((issue) => issue.rule === 'relationship.dangling')).toBe(
      true,
    );
    render(<ValidationPanel model={broken} onSelect={() => {}} />);
    expect(screen.getByText('Validation')).toBeTruthy();
    expect(screen.getAllByText(/missing element/i).length).toBeGreaterThan(0);
  });

  it('renders the EAM capability tree', () => {
    render(<EamViews model={model} onSelect={() => {}} />);
    expect(screen.getByText('EAM views')).toBeTruthy();
    expect(screen.getAllByText(/Capability tree/).length).toBeGreaterThan(0);
  });

  it('renders matrix presets', () => {
    render(<MatrixView model={model} />);
    expect(screen.getByText('Matrix views')).toBeTruthy();
  });

  it('lists workspaces with purpose badges and counts', () => {
    render(
      <WorkspaceHome
        workspaces={[
          {
            id: 'ws-1',
            name: 'Claims platform',
            description: 'Target architecture for claims',
            purpose: 'to-be',
            status: 'active',
            owner: 'Henrik',
            tags: ['claims'],
            elementCount: 42,
            relationshipCount: 30,
            viewCount: 3,
            domainCount: 4,
            artefactCount: 2,
            updatedAt: new Date().toISOString(),
          },
        ]}
        onCreate={() => {}}
        onOpen={() => {}}
        onDuplicate={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onImport={() => {}}
        onOpenPortfolio={() => {}}
      />,
    );
    expect(screen.getAllByText('Workspaces').length).toBeGreaterThan(0);
    expect(screen.getByText('Claims platform')).toBeTruthy();
    expect(screen.getAllByText('TO-BE').length).toBeGreaterThan(0);
    expect(screen.getByText('42 elements')).toBeTruthy();
  });

  it('renders the view designer with a live preview', () => {
    render(
      <ViewDesigner
        model={model}
        activeViewIndex={0}
        onCreateView={() => {}}
        onUpdateView={() => {}}
        onDeleteView={() => {}}
        onOpenView={() => {}}
      />,
    );
    expect(screen.getByText('View designer')).toBeTruthy();
    expect(screen.getByText('Granulation')).toBeTruthy();
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('Displayed attributes')).toBeTruthy();
  });

  it('shows element details in the inspector', () => {
    const element = model.elements.find((candidate) => candidate.id === 'e-portal');
    render(
      <Inspector
        element={element}
        elements={model.elements}
        relationships={model.relationships}
        onSelect={() => {}}
        onUpdate={() => {}}
      />,
    );
    expect(screen.getByText('Claims Portal')).toBeTruthy();
    expect(screen.getByText('Application Component')).toBeTruthy();
  });
});
