import { useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { useFocusTrap } from '../useFocusTrap';

export interface GitConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Token lives only in memory for this session — never written to disk or the repo. */
  token: string;
}

interface GitConfigDialogProps {
  onConnect: (config: GitConfig) => void;
  onCancel: () => void;
}

/**
 * Connect a GitHub repository as the workspace store (models are saved as
 * `architecture/<workspace>.json` and committed via the Contents API).
 */
export default function GitConfigDialog({ onConnect, onCancel }: GitConfigDialogProps) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, true);
  const t = useTranslation();
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');

  const valid = owner.trim() && repo.trim() && branch.trim() && token.trim();

  return (
    <div ref={trapRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('connectGit')} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="modal">
        <header className="modal-header">
          <h2>{t('connectGit')}</h2>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>
        <div className="modal-body">
          <p className="muted">
            Workspaces are stored as <code>architecture/&lt;workspace&gt;.json</code> and committed on save. The
            token is used for this session only and is never persisted.
          </p>
          <label className="field">
            {t('ownerOrganisation')}
            <input className="form-input full" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="my-org" autoFocus />
          </label>
          <label className="field">
            {t('repositoryLabel')}
            <input className="form-input full" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="architecture-repo" />
          </label>
          <div className="field-row">
            <label className="field">
              {t('branchLabel')}
              <input className="form-input full" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </label>
            <label className="field">
              {t('tokenContents')}
              <input
                className="form-input full"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_…"
                autoComplete="off"
              />
            </label>
          </div>
        </div>
        <footer className="modal-footer">
          <button onClick={onCancel}>{t('cancel')}</button>
          <button
            className="primary-button"
            disabled={!valid}
            onClick={() => onConnect({ owner: owner.trim(), repo: repo.trim(), branch: branch.trim(), token: token.trim() })}
          >
            {t('connect')}
          </button>
        </footer>
      </div>
    </div>
  );
}
