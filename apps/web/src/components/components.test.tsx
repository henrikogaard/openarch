// @vitest-environment jsdom
import { createSampleModel, validateModel } from '@openarch/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Catalog from './Catalog';
import Dashboard from './Dashboard';
import EamViews from './EamViews';
import ErrorBoundary from './ErrorBoundary';
import Inspector from './Inspector';
import MatrixView from './MatrixView';
import ValidationPanel from './ValidationPanel';
import ValueStreams from './ValueStreams';
import { MigrationTimelinePanel, TraceabilityPanel } from './AnalysisPanels';
import ScenarioPanel from './ScenarioPanel';
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
        onExportAll={() => {}}
        onImportBackup={() => {}}
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

  it('renders value streams with stages and capabilities', () => {
    const withStreams = createSampleModel();
    withStreams.elements.push(
      { id: 'vs', type: 'ValueStream', name: [{ lang: 'en', value: 'Order to cash' }], documentation: [], properties: [] },
      { id: 'stage-1', type: 'ValueStream', name: [{ lang: 'en', value: 'Order received' }], documentation: [], properties: [] },
      { id: 'cap-1', type: 'Capability', name: [{ lang: 'en', value: 'Order management' }], documentation: [], properties: [] },
    );
    withStreams.relationships.push(
      { id: 'f1', type: 'Flow', source: 'vs', target: 'stage-1', name: [], documentation: [], properties: [] },
      { id: 'r-cap', type: 'Realization', source: 'cap-1', target: 'stage-1', name: [], documentation: [], properties: [] },
    );
    render(<ValueStreams model={withStreams} onSelect={() => {}} />);
    expect(screen.getAllByText('Order to cash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order received').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Order management').length).toBeGreaterThan(0);
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

describe('ErrorBoundary', () => {
  it('shows a recoverable panel when a child throws, and recovers on retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) throw new Error('boom');
      return <div>recovered</div>;
    };
    render(
      <ErrorBoundary name="editor">
        <MaybeThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
    expect(screen.getByText(/editor/)).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('recovered')).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('analysis panels', () => {
  it('renders requirement traceability with coverage and uncovered lists', () => {
    const model = createSampleModel();
    model.elements.push(
      { id: 'req-1', type: 'Requirement', name: [{ lang: 'en', value: 'Multi-language UI' }], documentation: [], properties: [] },
      { id: 'req-2', type: 'Constraint', name: [{ lang: 'en', value: 'GDPR residency' }], documentation: [], properties: [] },
    );
    model.relationships.push({
      id: 'rr-1', type: 'Realization', source: 'e-portal', target: 'req-1', name: [], documentation: [], properties: [],
    });
    render(<TraceabilityPanel model={model} onSelect={() => {}} />);
    expect(screen.getAllByText('Multi-language UI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('GDPR residency').length).toBeGreaterThan(0);
  });

  it('renders the migration timeline sorted by date', () => {
    const model = createSampleModel();
    model.elements.push(
      { id: 'ms-2', type: 'Plateau', name: [{ lang: 'en', value: 'Target 2027' }], documentation: [], properties: [{ key: 'date', value: '2027-06-01' }] },
      { id: 'ms-1', type: 'WorkPackage', name: [{ lang: 'en', value: 'Wave 1' }], documentation: [], properties: [{ key: 'date', value: '2026-12-01' }] },
    );
    render(<MigrationTimelinePanel model={model} onSelect={() => {}} />);
    expect(screen.getByText('Wave 1')).toBeTruthy();
    expect(screen.getByText('Target 2027')).toBeTruthy();
  });
});

describe('ScenarioPanel', () => {
  it('compares two scenarios with overlap and changed/new/dropped elements', () => {
    const baseline = createSampleModel();
    const target = createSampleModel();
    target.elements = target.elements.map((e) =>
      e.id === 'e-portal' ? { ...e, name: [{ lang: 'en', value: 'Claims Portal v2' }] } : e,
    );
    target.elements.push({
      id: 'e-new', type: 'ApplicationComponent', name: [{ lang: 'en', value: 'Analytics' }], documentation: [], properties: [],
    });
    render(<ScenarioPanel baseline={baseline} target={target} />);
    expect(screen.getByText(/Scenario comparison/)).toBeTruthy();
    expect(screen.getAllByText(/changed/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Analytics')).toBeTruthy();
  });
});
