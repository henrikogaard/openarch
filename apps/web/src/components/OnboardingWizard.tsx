import {
  createFromTemplate,
  WORKSPACE_TEMPLATES,
  type ModelPurpose,
} from '@openarch/core';
import { exportViewSvg } from '@openarch/exporters';
import type { Model } from '@openarch/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFocusTrap } from '../useFocusTrap';
import { getAccessToken, setAccessToken } from '@openarch/repository';

export type OnboardingMode = 'local' | 'server' | 'folder';
export type SetupStep =
  | 'welcome'
  | 'storage'
  | 'auth'
  | 'template'
  | 'done';

interface OnboardingWizardProps {
  /** Live checks the wizard runs so users cannot continue on broken config. */
  checks: {
    /** Ping a server URL; resolves `true` when reachable. */
    probeServer: (url: string) => Promise<boolean>;
    /** Validate a bearer token against a server's /api/me; resolves the display name. */
    validateServerToken: (url: string, token: string) => Promise<string | null>;
    /** Default server URL from the environment (VITE_API_URL). */
    suggestedServerUrl: string;
  };
  /** Called with the final configuration; the wizard has already validated everything. */
  onFinish: (config: {
    mode: OnboardingMode;
    serverUrl?: string;
    token?: string;
    templateId: string;
    workspaceName: string;
  }) => void;
  /** Called when the user skips the wizard ("explore on my own"). */
  onSkip: () => void;
}

/** Small SVG for each template — the real preview is rendered below the card on select. */
function templateThumb(templateId: string): string {
  try {
    const model = createFromTemplate(templateId);
    if (model.views.length === 0) return '';
    return exportViewSvg(model, model.views[0].id);
  } catch {
    return '';
  }
}

const STEP_TITLES: Record<SetupStep, { title: string; subtitle: string }> = {
  welcome: {
    title: 'Welcome to OpenArch',
    subtitle: 'The open-source, local-first ArchiMate® 3.2 modelling tool. Set up in under a minute.',
  },
  storage: {
    title: 'Where should your models live?',
    subtitle: 'You can change this later in Settings. Nothing leaves your machine unless you choose a server.',
  },
  auth: {
    title: 'Connect to your server',
    subtitle: 'Paste the access token your administrator gave you (or the one printed on first boot).',
  },
  template: {
    title: 'Start with a template',
    subtitle: 'Pick a starting point — you can duplicate, edit, or delete it any time.',
  },
  done: {
    title: 'You are ready',
    subtitle: 'Your first workspace is being created.',
  },
};

const PURPOSE_LABEL: Record<ModelPurpose, string> = {
  'as-is': 'AS-IS',
  'to-be': 'TO-BE',
  migration: 'Migration',
};

/**
 * First-run setup wizard — 4 guided steps with live validation:
 * welcome → storage (Browser/Folder/Server) → auth (when Server) → template.
 * Users cannot finish on a broken config: server mode validates reachability +
 * token, and the template step always fires with a real model.
 */
export default function OnboardingWizard({ checks, onFinish, onSkip }: OnboardingWizardProps) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, true);
  const [step, setStep] = useState<SetupStep>('welcome');
  const [mode, setMode] = useState<OnboardingMode>('local');
  const [serverUrl, setServerUrl] = useState(checks.suggestedServerUrl);
  const [token, setToken] = useState(getAccessToken() ?? '');
  const [probeState, setProbeState] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [authState, setAuthState] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [authName, setAuthName] = useState('');
  const [templateId, setTemplateId] = useState('archimate-starter');
  const [workspaceName, setWorkspaceName] = useState('');
  const [selectedThumb, setSelectedThumb] = useState('');

  // Template list + SVG previews
  const templates = useMemo(() => WORKSPACE_TEMPLATES, []);
  useEffect(() => {
    setSelectedThumb(templateThumb(templateId));
  }, [templateId]);

  // Auto-set a good default workspace name based on template
  useEffect(() => {
    if (!workspaceName && step === 'template') {
      const template = templates.find((candidate) => candidate.id === templateId);
      if (template) setWorkspaceName(template.name);
    }
  }, [step, templateId, workspaceName, templates]);

  const [order, setOrder] = useState<SetupStep[]>([
    'welcome', 'storage', 'template', 'done',
  ]);

  const currentStep = step;
  const info = STEP_TITLES[currentStep];
  const stepIndex = useMemo(
    () => Math.max(0, order.indexOf(currentStep)),
    [order, currentStep],
  );

  const goNext = () => {
    if (currentStep === 'welcome') setStep('storage');
    else if (currentStep === 'storage') {
      if (mode === 'server') {
        // insert auth before template
        setOrder(['welcome', 'storage', 'auth', 'template', 'done']);
        setStep('auth');
      } else {
        setStep('template');
      }
    } else if (currentStep === 'auth') {
      setStep('template');
    } else if (currentStep === 'template') {
      // validate + finish
      const config = {
        mode,
        serverUrl: mode === 'server' ? serverUrl : undefined,
        token: mode === 'server' ? token : undefined,
        templateId,
        workspaceName: workspaceName || templates.find((t) => t.id === templateId)?.name || 'My workspace',
      };
      setStep('done');
      onFinish(config);
    }
  };

  const goBack = () => {
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]);
  };

  const probeServer = async () => {
    setProbeState('checking');
    try {
      const ok = await checks.probeServer(serverUrl);
      setProbeState(ok ? 'ok' : 'fail');
    } catch {
      setProbeState('fail');
    }
  };

  const validateToken = async () => {
    setAuthState('checking');
    try {
      const name = await checks.validateServerToken(serverUrl, token);
      setAuthState(name ? 'ok' : 'fail');
      setAuthName(name ?? '');
      if (name) setAccessToken(token);
    } catch {
      setAuthState('fail');
    }
  };

  const canContinue = (() => {
    if (currentStep === 'welcome') return true;
    if (currentStep === 'storage') return true;
    if (currentStep === 'auth') {
      return probeState === 'ok' && authState === 'ok';
    }
    if (currentStep === 'template') return Boolean(templateId);
    return false;
  })();

  return (
    <div className="modal-overlay onboarding-overlay" role="dialog" aria-modal="true" aria-label="OpenArch first-time setup">
      <div className="onboarding-wizard onboarding-wizard-fullscreen" ref={trapRef}>
        {/* Header */}
        <header className="onboarding-header">
          <span className="brand-mark onboarding-brand">OA</span>
          <div className="onboarding-progress">
            {order.map((stepName, index) => (
              <span
                key={stepName}
                className={`onboarding-dot ${index === stepIndex ? 'active' : ''} ${index < stepIndex ? 'completed' : ''}`}
                title={STEP_TITLES[stepName].title}
              />
            ))}
          </div>
          <button className="link-button" onClick={onSkip} aria-label="Skip setup and explore on my own">
            Skip
          </button>
        </header>

        {/* Title */}
        <div className={`onboarding-title ${currentStep === 'welcome' ? 'onboarding-title-center' : ''}`}>
          <h2>{info.title}</h2>
          <p className="muted">{info.subtitle}</p>
        </div>

        {/* Body */}
        <div className="onboarding-body">

          {/* WELCOME */}
          {currentStep === 'welcome' && (
            <div className="onboarding-content onboarding-splash">
              <div className="onboarding-splash-grid">
                <div className="onboarding-feature">
                  <span className="onboarding-feature-icon">✏️</span>
                  <h3>Model</h3>
                  <p className="muted">Full ArchiMate 3.2 palette, multi-select, undo, live validation, drag-and-drop, on-canvas rename.</p>
                </div>
                <div className="onboarding-feature">
                  <span className="onboarding-feature-icon">📥</span>
                  <h3>Import</h3>
                  <p className="muted">AOEF, .archimate, C4/Structurizr, draw.io, Terraform, Kubernetes, docker-compose.</p>
                </div>
                <div className="onboarding-feature">
                  <span className="onboarding-feature-icon">👥</span>
                  <h3>Share</h3>
                  <p className="muted">Self-hosted server with auth, invites, real-time awareness, version history, and backups.</p>
                </div>
              </div>
              <p className="muted onboarding-privacy-note">
                Local-first by design: no account needed, nothing leaves your machine unless you choose a server.
              </p>
            </div>
          )}

          {/* STORAGE */}
          {currentStep === 'storage' && (
            <div className="onboarding-content onboarding-storage-cards">
              <button
                className={`onboarding-card ${mode === 'local' ? 'selected' : ''}`}
                onClick={() => setMode('local')}
                aria-pressed={mode === 'local'}
              >
                <span className="onboarding-card-icon">💾</span>
                <strong>This browser</strong>
                <span className="muted">Fastest start. Everything stays here (IndexedDB). Back up with Export-all.</span>
                <span className="onboarding-card-tag">Beginner</span>
              </button>
              <button
                className={`onboarding-card ${mode === 'folder' ? 'selected' : ''}`}
                onClick={() => setMode('folder')}
                aria-pressed={mode === 'folder'}
              >
                <span className="onboarding-card-icon">📁</span>
                <strong>A folder on my computer</strong>
                <span className="muted">Real files you can see, sync, and back up. Best with Chromium/Edge.</span>
                <span className="onboarding-card-tag">Recommended</span>
              </button>
              <button
                className={`onboarding-card ${mode === 'server' ? 'selected' : ''}`}
                onClick={() => setMode('server')}
                aria-pressed={mode === 'server'}
              >
                <span className="onboarding-card-icon">☁️</span>
                <strong>A team server</strong>
                <span className="muted">Share with colleagues, real-time awareness, version history, backups.</span>
                <span className="onboarding-card-tag">Team</span>
              </button>
            </div>
          )}

          {/* AUTH (only when server mode) */}
          {currentStep === 'auth' && (
            <div className="onboarding-content onboarding-auth">
              <div className="onboarding-auth-row">
                <label className="field field-grow">
                  Server URL
                  <input
                    className="form-input"
                    type="url"
                    value={serverUrl}
                    onChange={(event) => {
                      setServerUrl(event.target.value.trim());
                      setProbeState('idle');
                      setAuthState('idle');
                    }}
                    placeholder="https://arch.internal.example:8080/api"
                  />
                </label>
                <button
                  className='small-button'
                  disabled={!serverUrl || probeState === 'checking'}
                  onClick={() => void probeServer()}
                >
                  {probeState === 'checking' ? 'Checking…' : probeState === 'ok' ? '✓ Reachable' : probeState === 'fail' ? '✗ Unreachable — retry' : 'Test connection'}
                </button>
              </div>
              {probeState === 'fail' && (
                <p className="onboarding-hint-error" role="alert">
                  Cannot reach the server. Check the URL and firewall (the server must allow this app's origin in CORS).
                </p>
              )}
              <div className="onboarding-auth-row">
                <label className="field field-grow">
                  Access token
                  <input
                    className="form-input"
                    type="password"
                    value={token}
                    onChange={(event) => {
                      setToken(event.target.value);
                      setAuthState('idle');
                    }}
                    placeholder="openarch_admin_… or the token from your administrator"
                    autoComplete="off"
                  />
                </label>
                <button
                  className="small-button"
                  disabled={!token || probeState !== 'ok' || authState === 'checking'}
                  onClick={() => void validateToken()}
                >
                  {authState === 'checking' ? 'Verifying…' : authState === 'ok' ? `✓ ${authName}` : authState === 'fail' ? '✗ Invalid — retry' : 'Verify token'}
                </button>
              </div>
              {authState === 'ok' && (
                <p className="onboarding-hint-success">
                  Authenticated as <strong>{authName}</strong> — you can save to this server.
                </p>
              )}
              {authState === 'fail' && (
                <p className="onboarding-hint-error" role="alert">
                  The token was rejected. Ask your administrator for a current one (Settings → People & tokens).
                </p>
              )}
              <div className="onboarding-auth-info">
                <p className="muted">
                  📦 Self-hosting? The server's first boot prints a one-time owner token to the Docker/compose logs.
                  That is the token above. See <code>docs/deployment.md</code> for the full setup.
                </p>
              </div>
            </div>
          )}

          {/* TEMPLATE */}
          {currentStep === 'template' && (
            <div className="onboarding-content onboarding-templates">
              <div className="onboarding-template-preview">
                <div
                  className="onboarding-preview-svg"
                  role="img"
                  aria-label="Template preview"
                  dangerouslySetInnerHTML={{
                    __html:
                      selectedThumb ||
                      '<span class="muted" style="display: flex; height: 100%; align-items: center; justify-content: center;">Select a template to preview</span>',
                  }}
                />
              </div>
              <div className="onboarding-template-list">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    className={`onboarding-template-card ${templateId === template.id ? 'selected' : ''}`}
                    onClick={() => setTemplateId(template.id)}
                    aria-pressed={templateId === template.id}
                  >
                    <strong>{template.name}</strong>
                    <span className="muted">{template.description}</span>
                    <span className="chip">{PURPOSE_LABEL[template.purpose]}</span>
                  </button>
                ))}
              </div>
              <label className="field onboarding-template-name">
                Workspace name
                <input
                  className="form-input"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder='My first workspace'
                />
              </label>
            </div>
          )}

          {/* DONE */}
          {currentStep === 'done' && (
            <div className="onboarding-content onboarding-done">
              <span className="onboarding-done-icon">✓</span>
              <p>Creating <strong>{workspaceName || 'your workspace'}</strong>…</p>
              <p className="muted">This closes automatically when the workspace loads.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="onboarding-footer">
          <button className="link-button" onClick={goBack} disabled={stepIndex === 0} aria-label="Go back">
            ← Back
          </button>
          <div className="onboarding-footer-right">
            {currentStep !== 'done' && (
              <button
                className="primary-button onboarding-next"
                disabled={!canContinue}
                onClick={goNext}
              >
                {currentStep === 'template' ? 'Create workspace' : 'Continue'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
