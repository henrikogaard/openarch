import { useState } from 'react';

interface OnboardingDialogProps {
  onCreate: () => void;
  onImport: () => void;
  onDismiss: () => void;
}

const STEPS = [
  {
    title: '1 · Start from a template',
    body: 'Blank, ArchiMate starter, cloud landing zone, TOGAF vision, or integration landscape — duplicate one and make it yours.',
  },
  {
    title: '2 · Import reality',
    body: 'Paste a Terraform plan, Kubernetes manifests, or docker-compose to generate the topology, or import an AOEF / .archimate / JSON file.',
  },
  {
    title: '3 · Govern and share',
    body: 'Assign domains, tag environments, write ADRs, then save to the server or a Git repo for review and baselines.',
  },
];

/** First-run welcome; shown once per browser (localStorage flag). */
export default function OnboardingDialog({ onCreate, onImport, onDismiss }: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Welcome to OpenArch">
      <div className="modal">
        <header className="modal-header">
          <h2>Welcome to OpenArch</h2>
          <button className="icon-button" onClick={onDismiss} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">
          <h3>{current.title}</h3>
          <p className="muted">{current.body}</p>
          <div className="filter-row">
            {STEPS.map((_, index) => (
              <button
                key={index}
                className={`small-button ${index === step ? 'active' : ''}`}
                onClick={() => setStep(index)}
                aria-label={`Step ${index + 1}`}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>
        <footer className="modal-footer">
          <button onClick={onImport}>Import a file</button>
          <button className="primary-button" onClick={onCreate}>
            Create a workspace
          </button>
        </footer>
      </div>
    </div>
  );
}
