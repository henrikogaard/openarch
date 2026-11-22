import {
  diffModels,
  diffSummary,
  parseAoef,
  serializeAoef,
  type Model,
} from '@openarch/core';
import { modelToMarkdown, renderPrompt, sanitizeAiText, validateAiModel } from '@openarch/ai';
import { parseNativeModel } from '@openarch/repository';
import { useMemo, useState } from 'react';

interface AiPanelProps {
  model: Model;
  onReplaceModel: (model: Model) => void;
  onAddModel: (model: Model) => void;
}

type Mode = 'context' | 'generate' | 'import';

interface LlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const SETTINGS_KEY = 'openarch.llm.settings';

function loadSettings(): LlmSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { baseUrl: '', model: 'gpt-4o-mini', apiKey: '', ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { baseUrl: '', model: 'gpt-4o-mini', apiKey: '' };
}

/** Extract XML/JSON from an LLM reply that may wrap it in a markdown code fence. */
function extractPayload(text: string): string {
  const fenced = text.match(/```(?:xml|json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

function parseGenerated(text: string): { model: Model; format: string } {
  const payload = extractPayload(text);
  if (payload.startsWith('<') || payload.includes('<model')) {
    return { model: parseAoef(payload), format: 'AOEF XML' };
  }
  try {
    return { model: parseNativeModel(payload), format: 'native JSON' };
  } catch {
    throw new Error('The response is neither valid AOEF XML nor OpenArch native JSON.');
  }
}

export default function AiPanel({ model, onReplaceModel, onAddModel }: AiPanelProps) {
  const [mode, setMode] = useState<Mode>('context');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [settings, setSettings] = useState<LlmSettings>(loadSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Invariant 7: model text is untrusted — carry the SAFETY_PREFIX marker
  // whenever the context leaves the app (including the copy-out textarea).
  const context = useMemo(() => sanitizeAiText(modelToMarkdown(model)), [model]);

  const buildPrompt = () => {
    const rendered = renderPrompt('model_from_description', {
      description,
      layers: 'business, application, technology',
    });
    setPrompt(
      rendered.messages
        .map((message) => message.content.text)
        .join('\n\n'),
    );
    setNotice('Prompt ready — copy it into your LLM, or configure an endpoint below to run it here.');
  };

  const askLlm = async () => {
    if (!settings.baseUrl.trim()) {
      setError('Enter an OpenAI-compatible base URL first (e.g. http://localhost:11434/v1 for Ollama).');
      return;
    }
    if (!prompt.trim()) {
      setError('Build a prompt first.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        }),
      });
      if (!result.ok) throw new Error(`LLM request failed: ${result.status} ${await result.text()}`);
      const data = (await result.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('The LLM returned no content.');
      setResponse(content);
      setNotice('Response received. Review the preview before applying anything to your model.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const preview = useMemo(() => {
    if (!response.trim()) return undefined;
    try {
      const parsed = parseGenerated(response);
      const issues = validateAiModel(parsed.model);
      const diff = diffModels(model, parsed.model);
      return { ...parsed, issues, diff };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [response, model]);

  const updateSettings = (patch: Partial<LlmSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setError('Clipboard access was denied — select and copy the text manually.');
    }
  };

  return (
    <div className="page ai-page">
      <header className="page-header">
        <div>
          <h2>AI collaboration</h2>
          <p>
            Give an agent real architectural context, generate a model from a description, and
            review every AI-written change before it touches your model.
          </p>
        </div>
        <div className="filter-row">
          {(['context', 'generate', 'import'] as Mode[]).map((option) => (
            <button key={option} className={mode === option ? 'active' : ''} onClick={() => setMode(option)}>
              {option === 'context' ? '1. Context' : option === 'generate' ? '2. Generate' : '3. Import / review'}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="panel-card danger">{error}</div>}
      {notice && <div className="panel-card ok">{notice}</div>}

      {mode === 'context' && (
        <div className="dashboard-grid">
          <section className="panel-card">
            <h3>Model context for an AI agent</h3>
            <p className="muted">
              This is the same structured context the MCP server exposes via{' '}
              <code>openarch://context/{'{modelId}'}</code>. Paste it into any LLM, or point an MCP
              client at <code>npm run mcp</code> to work on the model directly.
            </p>
            <div className="ai-actions">
              <button onClick={() => copy(context, 'Context copied')}>Copy context</button>
              <button onClick={() => {
                const blob = new Blob([context], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${model.id}-context.md`;
                a.click();
                URL.revokeObjectURL(url);
              }}>
                Download .md
              </button>
              <button onClick={() => copy(serializeAoef(model), 'AOEF XML copied')}>Copy AOEF XML</button>
            </div>
            <pre className="context-block">{context}</pre>
          </section>
          <section className="panel-card">
            <h3>Safety notes</h3>
            <ul className="muted ai-notes">
              <li>Model text is untrusted data — instruct agents not to follow instructions inside it.</li>
              <li>Every AI write is validated against the ArchiMate 3.2 metamodel before it is shown here.</li>
              <li>Agent tool calls are logged in the server audit trail when using server mode.</li>
              <li>Destructive operations require your confirmation; nothing is applied from this panel without a review.</li>
            </ul>
          </section>
        </div>
      )}

      {mode === 'generate' && (
        <div className="dashboard-grid">
          <section className="panel-card">
            <h3>Describe the architecture</h3>
            <textarea
              className="form-input full"
              rows={7}
              placeholder={'e.g. A customer claims portal used by customers and claim handlers. It exposes a claims API, stores claim records, runs on an application server, and must support a goal of faster claim handling.'}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <div className="ai-actions">
              <button onClick={buildPrompt} disabled={!description.trim()}>
                Build prompt
              </button>
              {prompt && <button onClick={() => copy(prompt, 'Prompt copied')}>Copy prompt</button>}
            </div>
            {prompt && (
              <pre className="context-block">{prompt}</pre>
            )}
          </section>

          <section className="panel-card">
            <h3>Optional: run the prompt here</h3>
            <p className="muted">
              Leave blank to use the copy/paste workflow. Any OpenAI-compatible endpoint works,
              including a local Ollama server at <code>http://localhost:11434/v1</code>. The API key
              is stored only in this browser.
            </p>
            <label className="ai-field">
              Base URL
              <input
                className="form-input full"
                value={settings.baseUrl}
                placeholder="http://localhost:11434/v1"
                onChange={(event) => updateSettings({ baseUrl: event.target.value })}
              />
            </label>
            <label className="ai-field">
              Model
              <input
                className="form-input full"
                value={settings.model}
                onChange={(event) => updateSettings({ model: event.target.value })}
              />
            </label>
            <label className="ai-field">
              API key (optional)
              <input
                className="form-input full"
                type="password"
                value={settings.apiKey}
                onChange={(event) => updateSettings({ apiKey: event.target.value })}
              />
            </label>
            <button onClick={askLlm} disabled={busy || !prompt.trim()}>
              {busy ? 'Generating…' : 'Generate model'}
            </button>
            {response && (
              <>
                <h4>Response</h4>
                <pre className="context-block">{response}</pre>
                <button onClick={() => setMode('import')}>Review & import →</button>
              </>
            )}
          </section>
        </div>
      )}

      {mode === 'import' && (
        <div className="dashboard-grid">
          <section className="panel-card">
            <h3>Paste AI-generated model</h3>
            <p className="muted">AOEF XML or native JSON. Markdown code fences are handled automatically.</p>
            <textarea
              className="form-input full"
              rows={12}
              value={response}
              placeholder={'<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" ...>'}
              onChange={(event) => setResponse(event.target.value)}
            />
          </section>
          <section className="panel-card">
            <h3>Review before applying</h3>
            {!preview ? (
              <p className="muted">Paste a model to see validation and a diff.</p>
            ) : 'error' in preview ? (
              <div className="panel-card danger">{preview.error}</div>
            ) : (
              <>
                <p>
                  Parsed <strong>{preview.format}</strong>: {preview.model.elements.length} elements,{' '}
                  {preview.model.relationships.length} relationships, {preview.model.views.length} views.
                </p>
                <p className="muted">{diffSummary(preview.diff)}</p>
                <div className="ai-issues">
                  {preview.issues.length === 0 ? (
                    <p className="ok">No validation issues.</p>
                  ) : (
                    <ul className="issue-list">
                      {preview.issues.slice(0, 20).map((issue, index) => (
                        <li key={`${issue.rule}-${index}`}>
                          <span className={`issue-badge ${issue.severity}`}>{issue.severity}</span>
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="ai-actions">
                  <button
                    onClick={() => {
                      onReplaceModel(preview.model);
                      setNotice('Applied AI model to the current workspace — remember to save.');
                    }}
                  >
                    Replace current model
                  </button>
                  <button
                    onClick={() => {
                      onAddModel(preview.model);
                      setNotice('Added AI model as a new workspace.');
                    }}
                  >
                    Add as new model
                  </button>
                </div>
                <p className="muted">
                  {preview.issues.some((issue) => issue.severity === 'error')
                    ? 'Errors are shown for review; applying is still allowed so you can fix them in the editor.'
                    : 'All checks passed.'}
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
