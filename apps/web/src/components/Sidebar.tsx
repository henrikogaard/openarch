import { useRef } from 'react';
import { type Language, useTranslation } from '../i18n';

interface SidebarProps {
  workspaceName: string;
  mode: 'local' | 'server';
  language: Language;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  onLanguageChange: (language: Language) => void;
  onModeChange: (mode: 'local' | 'server') => void;
  onHome: () => void;
  onImport: (file: File) => void;
  onExportAoef: () => void;
  onExportJson: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportCsv: () => void;
  onExportMermaid: () => void;
  onExportArchi?: () => void;
  onExportReport?: () => void;
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
  onExportReport,
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
      </div>

      <div className="sidebar-section actions">
        <input
          ref={fileInput}
          type="file"
          accept=".xml,.json,.archimate,application/xml,application/json"
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
        <button onClick={onExportSvg}>{t('exportSvg')}</button>
        <button onClick={onExportPng}>{t('exportPng')}</button>
        <button onClick={onExportCsv}>{t('exportCsv')}</button>
        <button onClick={onExportMermaid}>{t('exportMermaid')}</button>
        {onExportReport && <button onClick={onExportReport}>Export report (.md)</button>}
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
