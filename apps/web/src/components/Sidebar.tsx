import { useRef } from 'react';
import { type Language, useTranslation } from '../i18n';

interface SidebarProps {
  workspaceName: string;
  mode: 'local' | 'server' | 'git' | 'folder';
  language: Language;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onLanguageChange: (language: Language) => void;
  onModeChange: (mode: 'local' | 'server' | 'git' | 'folder') => void;
  onHome: () => void;
  onImport: (file: File) => void;
  onExportAoef: () => void;
  onExportJson: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportCsv: () => void;
  onExportMermaid: () => void;
  onExportArchi?: () => void;
  onExportC4?: () => void;
  onExportDocx?: () => void;
  onExportPptx?: () => void;
  onExportReport?: () => void;
  onPublishConfluence?: () => void;
  onShare: () => void;
  onSave: () => void;
}

export default function Sidebar({
  workspaceName,
  mode,
  language,
  theme,
  onThemeChange,
  onLanguageChange,
  onModeChange,
  onHome,
  onImport,
  onExportAoef,
  onExportJson,
  onExportSvg,
  onExportPng,
  onExportCsv,
  onExportMermaid,
  onExportArchi,
  onExportC4,
  onExportDocx,
  onExportPptx,
  onExportReport,
  onPublishConfluence,
  onShare,
  onSave,
}: SidebarProps) {
  const t = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <aside className="sidebar">
      <button className="link-button home-link" onClick={onHome}>
        ← All workspaces
      </button>

      <div className="brand">
        <span className="brand-mark">OA</span>
        <div>
          <strong>{workspaceName || 'OpenArch'}</strong>
          <small>Workspace</small>
        </div>
      </div>

      <div className="storage-switch" role="group" aria-label="Storage mode">
        <button className={mode === 'local' ? 'active' : ''} onClick={() => onModeChange('local')}>
          {t('local')}
        </button>
        <button className={mode === 'server' ? 'active' : ''} onClick={() => onModeChange('server')}>
          {t('server')}
        </button>
        <button className={mode === 'git' ? 'active' : ''} onClick={() => onModeChange('git')} title="GitHub-backed workspace files">
          Git
        </button>
      </div>

      <div className="sidebar-section actions">
        <input
          ref={fileInput}
          type="file"
          accept=".xml,.json,.archimate,.dsl,.structurizr,application/xml,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = '';
          }}
        />
        <button onClick={onSave}>{t('save')}</button>
        <button onClick={() => fileInput.current?.click()}>{t('import')}</button>
        <button onClick={onExportAoef}>{t('exportAoef')}</button>
        {onExportArchi && <button onClick={onExportArchi}>Export Archi (.archimate)</button>}
        {onExportC4 && <button onClick={onExportC4}>Export C4 DSL (.dsl)</button>}
        <button onClick={onExportSvg}>{t('exportSvg')}</button>
        <button onClick={onExportPng}>{t('exportPng')}</button>
        <button onClick={onExportCsv}>{t('exportCsv')}</button>
        <button onClick={onExportMermaid}>{t('exportMermaid')}</button>
        {onExportReport && <button onClick={onExportReport}>Export report (.md)</button>}
        {onExportDocx && <button onClick={onExportDocx}>Export DOCX report</button>}
        {onExportPptx && <button onClick={onExportPptx}>Export PPTX deck</button>}
        {onPublishConfluence && (
          <button onClick={onPublishConfluence} title="Publish the workspace as a Confluence page (set URL+token in Settings)">
            Publish to Confluence
          </button>
        )}
        <button onClick={onShare}>{t('share')}</button>
        <button onClick={onExportJson}>{t('exportJson')}</button>
      </div>

      <div className="sidebar-section">
        <div className="section-heading">
          <span>{t('language')}</span>
        </div>
        <div className="storage-switch">
          <button className={language === 'en' ? 'active' : ''} onClick={() => onLanguageChange('en')}>
            EN
          </button>
          <button className={language === 'nb' ? 'active' : ''} onClick={() => onLanguageChange('nb')}>
            NB
          </button>
          <button
            className={theme === 'dark' ? 'active' : ''}
            onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle dark mode"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </aside>
  );
}
