import { createContext, useContext } from 'react';

export type Language = 'en' | 'nb';

export const translations = {
  en: {
    editor: 'Editor',
    catalog: 'Catalog',
    analysis: 'Analysis',
    views: 'Views',
    dashboard: 'Dashboard',
    eam: 'EAM views',
    validation: 'Validation',
    trace: 'Trace',
    matrices: 'Matrices',
    deployment: 'Deployment',
    interfaces: 'Interfaces',
    enrichment: 'Enrichment',
    artefacts: 'Artefacts',
    collaborate: 'Collaborate',
    settings: 'Settings',
    ai: 'AI',
    addElement: 'Add element',
    save: 'Save model',
    import: 'Import AOEF / JSON / Archi…',
    exportAoef: 'Export AOEF (.xml)',
    exportJson: 'Export native (.json)',
    exportSvg: 'Export SVG',
    exportPng: 'Export PNG',
    exportCsv: 'Export CSV',
    exportMermaid: 'Export Mermaid',
    share: 'Copy share link',
    undo: 'Undo',
    redo: 'Redo',
    models: 'Workspaces',
    local: 'Local',
    server: 'Server',
    newModel: 'New workspace',
    searchElements: 'Search elements…',
    inspector: 'Inspector',
    documentation: 'Documentation',
    properties: 'Properties',
    relationships: 'Relationships',
    language: 'Language',
    allDomains: 'All domains',
    allEnvironments: 'All environments',
    domain: 'Domain',
    environment: 'Environment',
    domains: 'Domains',
  },
  nb: {
    editor: 'Editor',
    catalog: 'Katalog',
    analysis: 'Analyse',
    views: 'Visninger',
    dashboard: 'Oversikt',
    eam: 'EAM-visninger',
    validation: 'Validering',
    trace: 'Sporing',
    matrices: 'Matriser',
    deployment: 'Driftsmiljø',
    interfaces: 'Grensesnitt',
    enrichment: 'Berikelse',
    artefacts: 'Artefakter',
    collaborate: 'Samarbeid',
    settings: 'Innstillinger',
    ai: 'AI',
    addElement: 'Legg til element',
    save: 'Lagre modell',
    import: 'Importer AOEF / JSON / Archi…',
    exportAoef: 'Eksporter AOEF (.xml)',
    exportJson: 'Eksporter nativ (.json)',
    exportSvg: 'Eksporter SVG',
    exportPng: 'Eksporter PNG',
    exportCsv: 'Eksporter CSV',
    exportMermaid: 'Eksporter Mermaid',
    share: 'Kopier delingslenke',
    undo: 'Angre',
    redo: 'Gjør om',
    models: 'Arbeidsområder',
    local: 'Lokalt',
    server: 'Server',
    newModel: 'Nytt arbeidsområde',
    searchElements: 'Søk i elementer…',
    inspector: 'Inspektør',
    documentation: 'Dokumentasjon',
    properties: 'Egenskaper',
    relationships: 'Relasjoner',
    language: 'Språk',
    allDomains: 'Alle domener',
    allEnvironments: 'Alle miljøer',
    domain: 'Domene',
    environment: 'Miljø',
    domains: 'Domener',
  },
} as const;

export type TranslationKey = keyof (typeof translations)['en'];

export function translate(language: Language, key: TranslationKey): string {
  return translations[language][key] ?? translations.en[key];
}

export const LanguageContext = createContext<Language>('en');

export function useTranslation(): (key: TranslationKey) => string {
  const language = useContext(LanguageContext);
  return (key) => translate(language, key);
}
