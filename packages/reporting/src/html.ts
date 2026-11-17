import { portfolioStats, primaryText } from '@openarch/core';
import type { Model, ValidationIssue } from '@openarch/core';
import { exportViewSvg } from '@openarch/exporters';
import {
  applicationComponentTimeRows,
  domainRows,
  elementGroups,
  elementTypeLabel,
  metadataRows,
  portfolioSummaryRows,
  portfolioWorkspaceRows,
  purposeRows,
  relationshipRows,
  statusRows,
  timeSummaryRows,
  validationCounts,
  validationIssues,
  workspaceName,
} from './report-data';

const STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem;
  background: #ffffff;
  color: #1f2933;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.5;
}
main { max-width: 1100px; margin: 0 auto; }
h1 { margin: 0 0 0.25rem; font-size: 2rem; }
h2 { margin-top: 2.5rem; padding-bottom: 0.35rem; border-bottom: 1px solid #d9e2ec; }
h3 { margin-top: 1.75rem; }
h4 { margin-top: 1.25rem; }
p { margin: 0.5rem 0 1rem; }
ul { margin: 0.5rem 0 1rem; padding-left: 1.25rem; }
table { width: 100%; margin: 0.75rem 0 1.5rem; border-collapse: collapse; font-size: 0.9rem; }
th, td { padding: 0.4rem 0.55rem; border: 1px solid #d9e2ec; text-align: left; vertical-align: top; }
th { background: #f0f4f8; font-weight: 600; }
tbody tr:nth-child(even) { background: #fafcfe; }
.meta { color: #486581; }
.empty { color: #627d98; font-style: italic; }
.tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.tag { padding: 0.1rem 0.5rem; border-radius: 999px; background: #e6f0fa; font-size: 0.8rem; }
.artefact { margin: 1rem 0; padding: 1rem 1.25rem; border: 1px solid #d9e2ec; border-radius: 6px; page-break-inside: avoid; }
.artefact h3 { margin-top: 0; }
.artefact pre { margin: 0; white-space: pre-wrap; font-family: inherit; }
.svg-frame { margin: 1rem 0; padding: 0.75rem; border: 1px solid #d9e2ec; border-radius: 6px; overflow: auto; }
.svg-frame svg { max-width: 100%; height: auto; }
.svg-frame figcaption { margin-top: 0.5rem; color: #486581; font-size: 0.85rem; }
.severity-error { color: #b42318; font-weight: 600; }
.severity-warning { color: #b54708; font-weight: 600; }
.severity-info { color: #175cd3; font-weight: 600; }
@media print {
  body { padding: 0; font-size: 11pt; }
  main { max-width: none; }
  h2 { page-break-after: avoid; }
  table, .artefact, .svg-frame { page-break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '<p class="empty">None.</p>';
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function severityClass(severity: ValidationIssue['severity']): string {
  if (severity === 'error') return 'severity-error';
  if (severity === 'warning') return 'severity-warning';
  return 'severity-info';
}

function validationTable(issues: ValidationIssue[]): string {
  if (issues.length === 0) return '<p class="empty">No validation issues.</p>';
  const rows = issues
    .map((issue) => {
      const severity = `<span class="${severityClass(issue.severity)}">${escapeHtml(issue.severity)}</span>`;
      return `<tr><td>${severity}</td><td>${escapeHtml(issue.rule)}</td><td>${escapeHtml(issue.entityId ?? '—')}</td><td>${escapeHtml(issue.message)}</td><td>${escapeHtml(issue.suggestion ?? '—')}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Severity</th><th>Rule</th><th>Entity</th><th>Message</th><th>Suggestion</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function documentHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

/**
 * Render a standalone, printable HTML workspace report. All user text is
 * escaped; the first view is embedded as inline SVG from the exporters package.
 */
export function exportWorkspaceHtml(model: Model): string {
  const tags = (model.tags ?? [])
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');
  const description = primaryText(model.documentation).trim();
  const artefacts = model.artefacts ?? [];
  const firstView = model.views[0];
  const issues = validationIssues(model);
  const counts = validationCounts(issues);

  const elementsHtml = elementGroups(model)
    .map((group) => {
      const domainsHtml = group.domains
        .map(
          (domain) => `
<h4>${escapeHtml(domain.name)}</h4>
${htmlTable(
  ['ID', 'Type', 'Name', 'Environment'],
  domain.elements.map((element) => [
    element.id,
    elementTypeLabel(element.type),
    primaryText(element.name) || '(unnamed)',
    element.environment?.trim() || '—',
  ]),
)}`,
        )
        .join('');
      return `
<h3>${escapeHtml(group.label)}</h3>${domainsHtml}`;
    })
    .join('');

  const viewsHtml =
    model.views.length === 0
      ? '<p class="empty">No views.</p>'
      : `<ul>${model.views
          .map(
            (view) =>
              `<li><strong>${escapeHtml(primaryText(view.name) || '(unnamed view)')}</strong> <span class="meta">${escapeHtml(view.type)} · ${view.nodes.length} nodes · ${view.edges.length} relationships</span></li>`,
          )
          .join('')}</ul>`;

  const diagramHtml = firstView
    ? `<figure class="svg-frame">${exportViewSvg(model, firstView.id)}<figcaption>${escapeHtml(primaryText(firstView.name) || firstView.id)}</figcaption></figure>`
    : '<p class="empty">No views to render.</p>';

  const artefactsHtml =
    artefacts.length === 0
      ? '<p class="empty">No artefacts.</p>'
      : artefacts
          .map(
            (artefact) => `
<article class="artefact">
<h3>${escapeHtml(artefact.title)}</h3>
<p class="meta">${escapeHtml(artefact.kind)} · ${escapeHtml(artefact.status)}${artefact.author ? ` · ${escapeHtml(artefact.author)}` : ''} · Updated ${escapeHtml(artefact.updatedAt)}</p>
${artefact.elementIds.length ? `<p class="meta">Elements: ${escapeHtml(artefact.elementIds.join(', '))}</p>` : ''}
<pre>${escapeHtml(artefact.body)}</pre>
</article>`,
          )
          .join('');

  const body = `
<header>
<h1>${escapeHtml(workspaceName(model))}</h1>
${description ? `<p class="meta">${escapeHtml(description)}</p>` : ''}
${tags ? `<p class="tags">${tags}</p>` : ''}
</header>
<section>
<h2>Metadata</h2>
${htmlTable(['Field', 'Value'], metadataRows(model))}
</section>
<section>
<h2>Domains</h2>
${htmlTable(['Domain', 'Owner', 'Elements', 'Relationships', 'Cross-domain'], domainRows(model))}
</section>
<section>
<h2>Elements</h2>
${elementsHtml || '<p class="empty">No elements.</p>'}
</section>
<section>
<h2>Relationships</h2>
${htmlTable(['Type', 'Source → Target'], relationshipRows(model))}
</section>
<section>
<h2>Views</h2>
${viewsHtml}
</section>
<section>
<h2>Diagram</h2>
${diagramHtml}
</section>
<section>
<h2>Artefacts</h2>
${artefactsHtml}
</section>
<section>
<h2>Validation</h2>
<p>Errors: <span class="severity-error">${counts.error}</span> · Warnings: <span class="severity-warning">${counts.warning}</span> · Info: <span class="severity-info">${counts.info}</span></p>
${validationTable(issues)}
</section>`;

  return documentHtml(workspaceName(model), body);
}

/** Render the portfolio report as a standalone, printable HTML document. */
export function exportPortfolioHtml(models: Model[]): string {
  const stats = portfolioStats(models);
  const body = `
<header>
<h1>Architecture portfolio</h1>
</header>
<section>
<h2>Summary</h2>
${htmlTable(['Metric', 'Value'], portfolioSummaryRows(stats))}
</section>
<section>
<h2>By status</h2>
${htmlTable(['Status', 'Workspaces'], statusRows(stats.byStatus))}
</section>
<section>
<h2>By purpose</h2>
${htmlTable(['Purpose', 'Workspaces'], purposeRows(stats.byPurpose))}
</section>
<section>
<h2>Workspaces</h2>
${htmlTable(
  [
    'Workspace',
    'Purpose',
    'Status',
    'Owner',
    'Elements',
    'Domains',
    'Artefacts',
    'Updated',
  ],
  portfolioWorkspaceRows(models),
)}
</section>
<section>
<h2>TIME portfolio</h2>
<p>Application components classified by TIME.</p>
${htmlTable(['Classification', 'Application components'], timeSummaryRows(stats))}
<h3>Application components</h3>
${htmlTable(
  ['Workspace', 'Application component', 'TIME'],
  applicationComponentTimeRows(models),
)}
</section>`;

  return documentHtml('Architecture portfolio', body);
}
