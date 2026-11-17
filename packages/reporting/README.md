# @openarch/reporting

Deterministic, offline reporting, CI rules, and standards packs for OpenArch workspaces.

The package performs no network calls and uses no LLM. Given the same `Model`, every report is
byte-for-byte reproducible: no generated timestamps are inserted, and elements are ordered
deterministically inside each report section.

## Reports

### Workspace Markdown

```ts
import { exportWorkspaceMarkdown } from '@openarch/reporting';

const markdown = exportWorkspaceMarkdown(model);
```

The report contains:

- title and workspace documentation;
- a metadata table (purpose, status, owner, tags, counts, last update);
- a domains table (owner, elements, internal relationships, cross-domain relationships);
- elements grouped by ArchiMate layer and then by domain, with id, type, name, and environment;
- relationships as `type` and `source → target`;
- a views list with node and relationship counts;
- every artefact rendered with `artefactMarkdown` from `@openarch/core`;
- a validation summary combining `validateModel` and `validateWorkspace`, with severity counts
  and one row per issue.

### Workspace HTML

```ts
import { exportWorkspaceHtml } from '@openarch/reporting';

const html = exportWorkspaceHtml(model);
```

The HTML report is a standalone printable document (`<!doctype html>`) with inline CSS and no
external assets. It contains the same sections as the Markdown report, plus the first view
rendered as inline SVG with `exportViewSvg` from `@openarch/exporters`. All user text is escaped,
and a `@media print` rule keeps tables and artefacts from breaking across pages.

### Portfolio Markdown and HTML

```ts
import { exportPortfolioHtml, exportPortfolioMarkdown } from '@openarch/reporting';

const markdown = exportPortfolioMarkdown(models);
const html = exportPortfolioHtml(models);
```

Portfolio reports contain:

- aggregate statistics from `portfolioStats` (workspaces, elements, relationships, domains,
  artefacts);
- status and purpose breakdowns;
- one row per workspace with name, purpose, status, owner, element count, domain count,
  artefact count, and last update;
- a TIME summary for application components and a detailed workspace/component/TIME table.
  TIME classifies each application component as tolerate, invest, migrate, or eliminate using
  the same `timeClassification` helper as the core portfolio statistics.

## Rule engine

Rules are plain data and can be checked in CI without a browser or network access.

```ts
import { checkRules, parseRules } from '@openarch/reporting';
import { readFileSync } from 'node:fs';

const rules = parseRules(readFileSync('architecture-rules.json', 'utf8'));
const issues = checkRules(model, rules);

for (const issue of issues) {
  console.log(`${issue.severity} ${issue.rule}: ${issue.message}`);
}

if (issues.some((issue) => issue.severity === 'error')) process.exit(1);
```

`checkRules(model)` uses `DEFAULT_RULES` when no rules are supplied. Every finding has
`rule: 'rule.<id>'`, a clear message, an `entityId`, and a `suggestion`.

### Rule types

| Type | Parameters | Checks |
| --- | --- | --- |
| `element-missing-property` | `property` (required), `elementType` (optional) | The property exists with a non-empty value. |
| `element-without-domain` | none | Every element has a non-empty `domain`. |
| `element-without-environment` | `elementTypes` (default `["ApplicationComponent", "Node"]`) | Matching elements have a non-empty `environment`. |
| `relationship-not-allowed` | none | Relationships are allowed by the ArchiMate metamodel. Unknown element or relationship types and dangling endpoints are left to core validation. |
| `application-without-owner` | none | Every `ApplicationComponent` has an `owner` property. |
| `unrealized-capability` | none | Every `Capability` has at least one incoming `Realization` or `Serving` relationship. |
| `element-name-pattern` | `pattern` (required), `flags` (optional), `message` (optional) | Element names match the regular expression. |
| `max-elements` | `max` (default `2000`) | The workspace does not exceed the element limit. |

### Default rules

| Id | Severity | Purpose |
| --- | --- | --- |
| `app-owner` | warning | Application components have an owner property. |
| `element-domain` | warning | Every element belongs to a domain. |
| `deployment-environment` | warning | Application components and nodes declare an environment. |
| `relationship-allowed` | error | Relationships are metamodel-valid. |
| `capability-realized` | warning | Capabilities are realized or served. |
| `element-name` | error | Element names are not empty. |
| `max-elements` | warning | The workspace has at most 2000 elements. |

### Rule JSON

`parseRules` accepts either a bare array or an object with a `rules` array. It validates ids,
descriptions, severities, types, and the `params` object, and throws a descriptive error for
invalid JSON or shapes.

```json
{
  "rules": [
    {
      "id": "max-elements",
      "description": "Keep workspaces reviewable in one pass.",
      "severity": "warning",
      "type": "max-elements",
      "params": { "max": 500 }
    },
    {
      "id": "app-owner",
      "description": "Every application component has an accountable owner.",
      "severity": "error",
      "type": "application-without-owner"
    }
  ]
}
```

## Standards packs

`STANDARDS_PACKS` contains concise, well-known control themes rather than invented article
numbers. Each pack has 8–12 requirements with an id, title, description, and category.

| Pack id | Name | Requirements |
| --- | --- | --- |
| `nist-csf` | NIST CSF 2.0 | 11 |
| `iso-27001` | ISO/IEC 27001:2022 | 12 |
| `dora` | DORA | 10 |
| `gdpr` | GDPR | 12 |

```ts
import { applyStandardsPack } from '@openarch/reporting';

const next = applyStandardsPack(model, 'nist-csf');
```

`applyStandardsPack` returns a copy and never mutates the input. It:

- creates a `Compliance` domain if one does not exist (reusing an existing domain named
  `Compliance` when present);
- adds one `Requirement` element per requirement, assigned to the Compliance domain, with id
  `req-<pack>-<slug(requirement.id)>`, documentation set to the requirement description, and
  properties `standard=<pack>` and `control=<requirement.id>`;
- adds or replaces the view `Compliance – <pack id>` with a simple grid of the requirement
  elements;
- skips requirement ids that already exist, so applying the same pack twice is idempotent.

An unknown pack id throws an error listing the available packs.

## Development

The package is part of the OpenArch npm workspace. Tests live in
`src/reporting.test.ts` and are run by the repository's Vitest configuration.
