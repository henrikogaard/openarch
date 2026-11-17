import { artefactMarkdown, portfolioStats, primaryText } from '@openarch/core';
import type { Model } from '@openarch/core';
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

function inlineText(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim();
}

function mdCell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_None._';
  const header = `| ${headers.map(mdCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`).join('\n');
  return `${header}\n${separator}\n${body}`;
}

function finish(lines: string[]): string {
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Render a complete workspace report as deterministic Markdown.
 *
 * The report covers metadata, domains, elements grouped by layer and domain,
 * relationships, views, artefacts, and the combined structural + workspace
 * validation result.
 */
export function exportWorkspaceMarkdown(model: Model): string {
  const lines: string[] = [];
  const description = primaryText(model.documentation).trim();
  const artefacts = model.artefacts ?? [];

  lines.push(`# ${inlineText(workspaceName(model))}`, '');
  if (description) lines.push(description, '');

  lines.push('## Metadata', '', table(['Field', 'Value'], metadataRows(model)), '');
  lines.push(
    '## Domains',
    '',
    table(['Domain', 'Owner', 'Elements', 'Relationships', 'Cross-domain'], domainRows(model)),
    '',
  );

  lines.push('## Elements', '');
  const groups = elementGroups(model);
  if (groups.length === 0) {
    lines.push('_No elements._', '');
  } else {
    for (const group of groups) {
      lines.push(`### ${group.label}`, '');
      for (const domain of group.domains) {
        lines.push(`#### ${inlineText(domain.name)}`, '');
        lines.push(
          table(
            ['ID', 'Type', 'Name', 'Environment'],
            domain.elements.map((element) => [
              element.id,
              elementTypeLabel(element.type),
              primaryText(element.name) || '(unnamed)',
              element.environment?.trim() || '—',
            ]),
          ),
          '',
        );
      }
    }
  }

  lines.push(
    '## Relationships',
    '',
    table(['Type', 'Source → Target'], relationshipRows(model)),
    '',
  );

  lines.push('## Views', '');
  if (model.views.length === 0) {
    lines.push('_No views._', '');
  } else {
    for (const view of model.views) {
      const name = inlineText(primaryText(view.name)) || '(unnamed view)';
      lines.push(
        `- ${name} — ${view.type} (${view.nodes.length} nodes, ${view.edges.length} relationships)`,
      );
    }
    lines.push('');
  }

  lines.push('## Artefacts', '');
  if (artefacts.length === 0) {
    lines.push('_No artefacts._', '');
  } else {
    for (const artefact of artefacts) {
      lines.push(artefactMarkdown(artefact), '');
    }
  }

  const issues = validationIssues(model);
  const counts = validationCounts(issues);
  lines.push('## Validation', '');
  lines.push(
    `Errors: ${counts.error} · Warnings: ${counts.warning} · Info: ${counts.info}`,
    '',
  );
  if (issues.length === 0) {
    lines.push('_No validation issues._', '');
  } else {
    lines.push(
      table(
        ['Severity', 'Rule', 'Entity', 'Message', 'Suggestion'],
        issues.map((issue) => [
          issue.severity,
          issue.rule,
          issue.entityId ?? '—',
          issue.message,
          issue.suggestion ?? '—',
        ]),
      ),
      '',
    );
  }

  return finish(lines);
}

/**
 * Render a portfolio report as deterministic Markdown: aggregate statistics,
 * one row per workspace, and the TIME view of application components.
 */
export function exportPortfolioMarkdown(models: Model[]): string {
  const stats = portfolioStats(models);
  const lines: string[] = ['# Architecture portfolio', ''];

  lines.push('## Summary', '', table(['Metric', 'Value'], portfolioSummaryRows(stats)), '');
  lines.push(
    '### By status',
    '',
    table(['Status', 'Workspaces'], statusRows(stats.byStatus)),
    '',
  );
  lines.push(
    '### By purpose',
    '',
    table(['Purpose', 'Workspaces'], purposeRows(stats.byPurpose)),
    '',
  );

  lines.push(
    '## Workspaces',
    '',
    table(
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
    ),
    '',
  );

  lines.push('## TIME portfolio', '');
  lines.push('Application components classified by TIME.', '');
  lines.push(
    table(['Classification', 'Application components'], timeSummaryRows(stats)),
    '',
  );
  lines.push(
    '### Application components',
    '',
    table(
      ['Workspace', 'Application component', 'TIME'],
      applicationComponentTimeRows(models),
    ),
    '',
  );

  return finish(lines);
}
