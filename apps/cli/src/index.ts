import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  type Model,
  parseAoef,
  primaryText,
  serializeAoef,
  validateModel,
} from '@openarch/core';
import { parseNativeModel, serializeNativeModel } from '@openarch/repository';
import { exportElementsCsv, exportMermaid } from '@openarch/exporters';
import { exportArchi, importArchi } from '@openarch/archi';
import { c4ToModel, modelToC4, parseStructurizr } from '@openarch/c4';
import { checkRules, exportWorkspaceMarkdown, parseRules } from '@openarch/reporting';
import { diffModels } from './diff';

type Format = 'xml' | 'json' | 'csv' | 'mermaid' | 'dsl';

const HELP = `OpenArch CLI — manage ArchiMate® models

Usage:
  openarch <command> [arguments]

Commands:
  validate <file>            Validate a model file (.xml, .json, .archimate)
  list <file>                Print workspace name and counts
  convert <input> <output>   Convert between .xml, .json, .archimate, .csv, .mermaid
  diff <a> <b>               Compare two model files
  check <file> [rules.json]  Run architecture rules; exit 1 on errors
  report <file> <output.md>  Write a Markdown workspace report
  doctor                     Print environment and capability information
  --help                     Show this help

Formats:
  .xml        ArchiMate Open Exchange Format (AOEF)
  .json       OpenArch native model
  .archimate  Archi desktop native format (ZIP)
  .csv        Elements CSV (output only)
  .mermaid    Mermaid diagram of the first view (output only)

Examples:
  openarch validate model.xml
  openarch list model.json
  openarch convert model.xml model.archimate
  openarch check model.xml architecture-rules.json
  openarch report model.xml report.md
  openarch diff before.xml after.xml
`;

function formatFromPath(filePath: string): Format {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.xml':
      return 'xml';
    case '.json':
      return 'json';
    case '.csv':
      return 'csv';
    case '.mermaid':
    case '.mmd':
      return 'mermaid';
    case '.dsl':
    case '.structurizr':
      return 'dsl';
    default:
      throw new Error(
        `Unsupported file extension "${extension || '(none)'}" for "${filePath}". ` +
          'Expected one of .xml, .json, .csv, .mermaid, .dsl or .archimate.',
      );
  }
}

function describeFile(filePath: string): string {
  const format = formatFromPath(filePath);
  if (format !== 'xml' && format !== 'json' && format !== 'dsl') {
    throw new Error(`Cannot read "${filePath}" as a model: expected a .xml, .json or .dsl file.`);
  }
  return format;
}

async function readModelFile(filePath: string): Promise<Model> {
  if (filePath.toLowerCase().endsWith('.archimate')) {
    try {
      const buffer = await readFile(filePath);
      return importArchi(new Uint8Array(buffer)).model;
    } catch (error) {
      throw new Error(`Could not read "${filePath}" as an Archi model: ${errorMessage(error)}`);
    }
  }
  const format = describeFile(filePath);
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read "${filePath}": ${errorMessage(error)}`);
  }
  try {
    if (format === 'dsl') return c4ToModel(parseStructurizr(text));
    return format === 'xml' ? parseAoef(text) : parseNativeModel(text);
  } catch (error) {
    throw new Error(`Could not parse "${filePath}" as ${format.toUpperCase()}: ${errorMessage(error)}`);
  }
}

function serializeModel(model: Model, format: Format): string {
  switch (format) {
    case 'xml':
      return serializeAoef(model);
    case 'json':
      return serializeNativeModel(model);
    case 'csv':
      return exportElementsCsv(model);
    case 'dsl':
      return modelToC4(model);
    case 'mermaid': {
      const view = model.views[0];
      if (!view) {
        throw new Error('The model has no views to export as a Mermaid diagram.');
      }
      return exportMermaid(model, view.id);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const render = (cells: string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');

  console.log(render(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(render(row));
  }
}

function requireArgs(args: string[], command: string, expected: number): void {
  if (args.length !== expected) {
    throw new Error(
      `Command "${command}" expects ${expected} argument${expected === 1 ? '' : 's'}, got ${args.length}.`,
    );
  }
}

async function validate(filePath: string): Promise<number> {
  const model = await readModelFile(filePath);
  const issues = validateModel(model);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  console.log(`Validating ${filePath} (${primaryText(model.name) || 'unnamed model'})`);

  if (issues.length === 0) {
    console.log('No issues found.');
    return 0;
  }

  const groups: Array<[string, typeof issues]> = [
    ['Errors', errors],
    ['Warnings', warnings],
  ];
  for (const [label, group] of groups) {
    if (group.length === 0) continue;
    console.log(`${label} (${group.length}):`);
    for (const issue of group) {
      const location = issue.entityId ? ` [${issue.entityId}]` : '';
      console.log(`  - ${issue.message}${location} (${issue.rule})`);
    }
  }
  console.log(`Found ${errors.length} error(s) and ${warnings.length} warning(s).`);
  return errors.length > 0 ? 1 : 0;
}

async function list(filePath: string): Promise<number> {
  const model = await readModelFile(filePath);
  printTable(
    ['Model', 'Elements', 'Relationships', 'Views'],
    [
      [
        primaryText(model.name) || 'Untitled model',
        String(model.elements.length),
        String(model.relationships.length),
        String(model.views.length),
      ],
    ],
  );
  return 0;
}

async function convert(input: string, output: string): Promise<number> {
  const model = await readModelFile(input);
  if (output.toLowerCase().endsWith('.archimate')) {
    try {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, exportArchi(model));
    } catch (error) {
      throw new Error(`Could not write "${output}": ${errorMessage(error)}`);
    }
    console.log(`Converted ${input} -> ${output} (archimate).`);
    return 0;
  }
  const format = formatFromPath(output);
  const text = serializeModel(model, format);
  try {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, text, 'utf8');
  } catch (error) {
    throw new Error(`Could not write "${output}": ${errorMessage(error)}`);
  }
  console.log(`Converted ${input} -> ${output} (${format}).`);
  return 0;
}

async function check(filePath: string, rulesPath?: string): Promise<number> {
  const model = await readModelFile(filePath);
  const rules = rulesPath ? parseRules(await readFile(rulesPath, 'utf8')) : undefined;
  const issues = checkRules(model, rules);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  console.log(`Checking ${filePath} (${primaryText(model.name)})`);
  if (issues.length === 0) {
    console.log('No rule violations.');
    return 0;
  }
  const limit = 40;
  for (const issue of issues.slice(0, limit)) {
    console.log(`  [${issue.severity}] ${issue.message} (${issue.rule})`);
    if (issue.suggestion) console.log(`           ${issue.suggestion}`);
  }
  if (issues.length > limit) {
    console.log(`  …and ${issues.length - limit} more`);
  }
  console.log('');
  console.log(`Found ${errors.length} error(s) and ${warnings.length} warning(s).`);
  return errors.length > 0 ? 1 : 0;
}

async function report(filePath: string, output: string): Promise<number> {
  const model = await readModelFile(filePath);
  try {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, exportWorkspaceMarkdown(model), 'utf8');
  } catch (error) {
    throw new Error(`Could not write "${output}": ${errorMessage(error)}`);
  }
  console.log(`Wrote workspace report to ${output}.`);
  return 0;
}

async function diff(aPath: string, bPath: string): Promise<number> {
  const [a, b] = await Promise.all([readModelFile(aPath), readModelFile(bPath)]);
  const diff = diffModels(a, b);

  console.log(`Comparing ${aPath} -> ${bPath}`);
  console.log('');

  if (
    diff.addedElements.length === 0 &&
    diff.removedElements.length === 0 &&
    diff.changedElements.length === 0 &&
    diff.addedRelationships.length === 0 &&
    diff.removedRelationships.length === 0
  ) {
    console.log('No differences found.');
    return 0;
  }

  if (
    diff.addedElements.length ||
    diff.removedElements.length ||
    diff.changedElements.length
  ) {
    console.log('Elements:');
    for (const element of diff.addedElements) console.log(`  + ${element}`);
    for (const element of diff.removedElements) console.log(`  - ${element}`);
    for (const change of diff.changedElements) {
      console.log(`  ~ ${change.id} ${change.field}: "${change.from}" -> "${change.to}"`);
    }
    console.log('');
  }

  if (diff.addedRelationships.length || diff.removedRelationships.length) {
    console.log('Relationships:');
    for (const relationship of diff.addedRelationships) console.log(`  + ${relationship}`);
    for (const relationship of diff.removedRelationships) console.log(`  - ${relationship}`);
    console.log('');
  }

  console.log(
    'Summary: ' +
      `${diff.addedElements.length} element(s) added, ` +
      `${diff.removedElements.length} element(s) removed, ` +
      `${diff.changedElements.length} element(s) changed, ` +
      `${diff.addedRelationships.length} relationship(s) added, ` +
      `${diff.removedRelationships.length} relationship(s) removed.`,
  );
  return 0;
}

function doctor(): number {
  console.log('OpenArch doctor');
  console.log('');
  console.log(`  Node version:  ${process.version}`);
  console.log(`  Platform:      ${process.platform} (${process.arch})`);
  console.log(`  CLI version:   0.1.0`);
  console.log('');
  console.log('Loaded model capability:');
  console.log('  Read:    AOEF XML (.xml), native JSON (.json)');
  console.log('  Write:   AOEF XML (.xml), native JSON (.json)');
  console.log('  Export:  elements CSV (.csv), Mermaid (.mermaid), SVG (via @openarch/exporters)');
  console.log('  Analyze: structural validation, model diff');
  console.log('');
  console.log('ArchiMate® is a registered trademark of The Open Group.');
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'validate':
      requireArgs(args, command, 1);
      return validate(args[0]);
    case 'list':
      requireArgs(args, command, 1);
      return list(args[0]);
    case 'convert':
      requireArgs(args, command, 2);
      return convert(args[0], args[1]);
    case 'diff':
      requireArgs(args, command, 2);
      return diff(args[0], args[1]);
    case 'check':
      requireArgs(args, command, 1);
      return check(args[0], args[1]);
    case 'report':
      requireArgs(args, command, 2);
      return report(args[0], args[1]);
    case 'doctor':
      requireArgs(args, command, 0);
      return doctor();
    default:
      throw new Error(`Unknown command "${command}". Run "openarch --help" for usage.`);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`openarch: ${errorMessage(error)}`);
    console.error('Run "openarch --help" for usage.');
    process.exitCode = 1;
  });
